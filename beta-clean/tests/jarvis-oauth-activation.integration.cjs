'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
let f, cookie;
const resource = 'https://mcp-bookshell.charlydob.com/mcp';
test.before(async()=>{ f=await require('./qa-phase2-fixture.cjs').createFixture(); cookie=await f.login(); });
test.after(async()=>{ await f?.close(); });
async function post(path, body, headers={}) {
  return fetch(f.base+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
async function authorize(scope) {
  const redirect='https://chatgpt.com/connector/oauth/bookshell-qa';
  const registered=await post('/oauth/register',{redirect_uris:[redirect],token_endpoint_auth_method:'none'});
  assert.equal(registered.status,201);
  const {client_id}=await registered.json(), verifier=crypto.randomBytes(32).toString('base64url');
  const query=new URLSearchParams({client_id,redirect_uri:redirect,response_type:'code',resource,scope,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'qa'});
  const page=await fetch(f.base+'/oauth/authorize?'+query);
  assert.equal(page.status,200);
  const nonce=page.headers.get('set-cookie').split(';')[0];
  const request_id=/name="request_id" value="([^"]+)"/.exec(await page.text())[1];
  const issued=await post('/projects/access-code',{}, {Cookie:cookie,Origin:'https://bookshell.charlydob.com'});
  assert.equal(issued.status,201);
  const ticket=(await issued.json()).ticket;
  const denied=await post('/oauth/authorize',{request_id,pair_code:ticket});
  assert.equal(denied.status,403);
  const approved=await post('/oauth/authorize',{request_id,pair_code:ticket},{Cookie:nonce});
  assert.equal(approved.status,302);
  const target=new URL(approved.headers.get('location'));
  assert.equal(target.searchParams.get('state'),'qa');
  const exchange={grant_type:'authorization_code',client_id,redirect_uri:redirect,resource,code:target.searchParams.get('code'),code_verifier:verifier};
  const response=await post('/oauth/token',exchange);assert.equal(response.status,200);
  assert.equal((await post('/oauth/token',exchange)).status,400);
  return {client_id,...await response.json()};
}
async function capabilities(token) {
  const client=new Client({name:'oauth-activation-qa',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const catalog=await client.listTools();
    const result=await client.callTool({name:'jarvis_capabilities',arguments:{}});
    assert.ok(!result.isError);
    return {operations:result.structuredContent.result.operations,names:catalog.tools.map(t=>t.name)};
  } finally {await client.close();}
}
test('native web consent grants advertised write scopes and exposes authorized MCP operations',async()=>{
  const discovery=await (await fetch(f.base+'/.well-known/oauth-authorization-server')).json();
  for(const scope of ['finance:write','gym:write','nutrition:write'])assert.ok(discovery.scopes_supported.includes(scope));
  const session=await authorize(discovery.scopes_supported.join(' '));
  const {operations,names}=await capabilities(session.access_token);
  for(const name of ['finance_create','finance_update','finance_void','finance_transfer','finance_transfer_update','finance_rule_set','gym_workout_create','nutrition_entry_create','recipes_create','people_update']) {
    assert.ok(names.includes(name),name); assert.equal(operations.find(o=>o.name===name).authorized,true,name);
  }
});
test('refresh cannot upgrade a read-only connection even when additional scope is requested',async()=>{
  const session=await authorize('projects:read finance:read');
  const refresh=await post('/oauth/token',{grant_type:'refresh_token',client_id:session.client_id,resource,refresh_token:session.refresh_token,scope:'projects:read finance:read finance:write'});
  assert.equal(refresh.status,200);
  const next=await refresh.json();assert.equal(next.scope,'projects:read finance:read');
  const result=await capabilities(next.access_token);
  assert.equal(result.operations.find(o=>o.name==='finance_create').authorized,false);
});
test('operator grant accepts current write scopes only with explicit approval and rejects unknown scopes',async()=>{
  const {spawnSync}=require('node:child_process'), script=require('node:path').join(__dirname,'../jarvis/issue-grant.cjs');
  const run=(args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:process.env});
  assert.notEqual(run([]).status,0);
  assert.notEqual(run(['--issue-approved-grant',f.owner,'world:write']).status,0);
  const issued=run(['--issue-approved-grant',f.owner,'finance:write,gym:write,nutrition:write']);
  assert.equal(issued.status,0,issued.stderr);
  const hash=crypto.createHash('sha256').update(issued.stdout.trim()).digest('hex');
  const row=(await f.pool.query('SELECT user_id,allowed_scopes FROM project_access_tickets WHERE token_hash=$1',[hash])).rows[0];
  assert.equal(row.user_id,f.owner);
  assert.deepEqual(row.allowed_scopes,['finance:write','gym:write','nutrition:write']);
});
