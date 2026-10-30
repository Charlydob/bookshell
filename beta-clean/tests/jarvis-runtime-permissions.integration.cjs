'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('migration grants the non-superuser API only the required ledger permissions',async()=>{
 const pool=new(require('pg').Pool)({connectionString:process.env.BOOKSHELL_TEST_DATABASE_URL});
 const c=await pool.connect(),schema='runtime_grants_'+crypto.randomBytes(5).toString('hex');
 try{
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'bookshell_qa');
  await c.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='bookshell_app') THEN CREATE ROLE bookshell_app; END IF; END $$");
  await c.query('CREATE SCHEMA '+schema+'; SET search_path='+schema+',public; GRANT USAGE ON SCHEMA '+schema+' TO bookshell_app');
  await c.query('CREATE TABLE jarvis_operations(value text);CREATE TABLE web_mutations(value text);CREATE TABLE jarvis_operation_audit(id bigserial PRIMARY KEY)');
  await c.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261030_jarvis_api_permissions.sql'),'utf8'));
  await c.query('SET ROLE bookshell_app');
  assert.equal((await c.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0].rolsuper,false);
  await c.query("INSERT INTO jarvis_operations VALUES('qa'); INSERT INTO web_mutations VALUES('qa'); INSERT INTO jarvis_operation_audit DEFAULT VALUES");
  assert.equal((await c.query('SELECT * FROM jarvis_operations')).rowCount,1);
  assert.equal((await c.query('SELECT * FROM web_mutations')).rowCount,1);
  await assert.rejects(c.query("DELETE FROM jarvis_operations"),e=>e.code==='42501');
 }finally{await c.query('RESET ROLE');await c.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');c.release();await pool.end();}
});
