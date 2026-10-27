'use strict';
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {z}=require('zod/v3');
const {createDomain,schemas,projectSchema,projectPatchSchema,fail}=require('./domain');
const {createAuth,RESOURCE,SCOPES,body,json}=require('./auth');
const uuid=z.string().uuid();
const kind=z.enum(Object.keys(schemas));
function safeError(e){return e.issues?e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; '):e.status?e.message:'Error interno; consulta el identificador de diagnóstico';}
function createProjects({pool,sendNotification}){
  const domain=createDomain(pool),auth=createAuth(pool);
  function tools(a){
    const pid={projectId:uuid};
    const definitions=[
      ['list_projects','Lista proyectos, plantillas, tareas, bloqueos y estadísticas reales.',{},false,()=>domain.list(a.userId)],
      ['get_project','Consulta proyecto completo con notas, documentación, compras, inventario y dependencias.',pid,false,b=>domain.get(a.userId,b.projectId)],
      ['create_project','Crea un proyecto; el progreso físico no se inventa. Puede usar una plantilla.',{project:projectSchema,templateId:uuid.optional()},true,b=>domain.create(a.userId,b.project,b.templateId)],
      ['update_project','Modifica un proyecto con su versión actual. Archivar requiere confirmación explícita.',{...pid,version:z.number().int().positive(),patch:projectPatchSchema,confirmed:z.boolean().default(false)},true,b=>{if(b.patch.status==='archived'&&!b.confirmed)fail('Confirma antes de archivar');return domain.update(a.userId,b.projectId,b.patch,b.version);}],
      ['get_agenda','Consulta pendientes y agenda. Fechas ISO; puede incluir vencidos. Usa Europe/Madrid para interpretar la semana.',{from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),pendingOnly:z.boolean().default(true)},false,async b=>(await domain.agenda(a.userId,b)).filter(e=>!b.pendingOnly||!['done','cancelled'].includes(e.status))],
      ['get_statistics','Estadísticas de tareas, progreso, bloqueos, costes por moneda e inventario.',pid,false,async b=>(await domain.get(a.userId,b.projectId)).stats],
      ['get_activity','Historial de cambios del proyecto.',pid,false,b=>domain.history(a.userId,b.projectId)],
      ['reschedule_dependencies','Desplaza una tarea y todas sus dependientes pendientes el mismo número de días; no inventa fechas para tareas sin fecha.',{...pid,taskId:uuid,days:z.number().int().min(-3650).max(3650)},true,b=>domain.reschedule(a.userId,b.projectId,b.taskId,b.days)],
      ['delete_entry','Borrado recuperable de un registro. Requiere confirmación expresa del usuario y versión actual.',{...pid,entryId:uuid,kind,version:z.number().int().positive(),confirmed:z.literal(true)},true,b=>domain.writeEntry(a.userId,b.projectId,b.kind,{},b.entryId,b.version,true)]
    ];
    for(const [k,schema]of Object.entries(schemas)){
      definitions.push([`create_${k}`,`Crea ${k} dentro del proyecto. description acepta Markdown con tablas, imágenes, código y Mermaid.`,{...pid,data:schema},true,b=>domain.writeEntry(a.userId,b.projectId,k,b.data)]);
      definitions.push([`update_${k}`,`Edita ${k} con la versión leída. Para completar tareas usa status=done; para reprogramar usa dueAt ISO.`,{...pid,entryId:uuid,version:z.number().int().positive(),patch:schema.partial()},true,b=>domain.writeEntry(a.userId,b.projectId,k,b.patch,b.entryId,b.version)]);
    }
    return definitions;
  }
  async function mcp(req,res){
    if(req.headers.origin&&!['https://chatgpt.com','https://bookshell.charlydob.com'].includes(req.headers.origin))fail('Origen no permitido',403);
    const a=await auth.requireAuth(req,res,'projects:read',true);if(!a)return;
    auth.rate(req,'mcp',600);
    const server=new McpServer({name:'bookshell-projects',version:'1.0.0'},{instructions:'Datos privados del usuario autenticado. Consulta antes de modificar; respeta versiones y confirmaciones. El porcentaje de tareas no es el progreso físico. No inventes avances ni fechas.'});
    for(const[name,description,inputSchema,write,fn]of tools(a)){
      const securitySchemes=[{type:'oauth2',scopes:[write?'projects:write':'projects:read']}];
      server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:!write,destructiveHint:name==='delete_entry'||name==='update_project',idempotentHint:!write,openWorldHint:false},_meta:{securitySchemes}},async b=>{
        if(!a.scopes.includes(write?'projects:write':'projects:read'))return {isError:true,content:[{type:'text',text:'Permisos insuficientes'}],_meta:{'mcp/www_authenticate':[`Bearer scope="projects:write", resource_metadata="https://mcp-bookshell.charlydob.com/.well-known/oauth-protected-resource"`]}};
        try{const result=await fn(b);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}catch(e){const diagnostic=require('crypto').randomUUID();if(!e.status&&!e.issues)console.error('[projects:mcp]',{diagnostic,tool:name,message:e.message});return {isError:true,content:[{type:'text',text:JSON.stringify({error:safeError(e),diagnostic,status:e.status||400})}]};}
      });
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    await server.connect(transport);await transport.handleRequest(req,res,req.method==='POST'?await body(req):undefined);
  }
  async function handle(req,res,url){
    if(!url.pathname.startsWith('/projects')&&!url.pathname.startsWith('/oauth/')&&!url.pathname.startsWith('/.well-known/oauth-')&&url.pathname!=='/mcp')return false;
    try{
      if(req.method==='OPTIONS'){res.writeHead(204,{Allow:'GET, POST, PATCH, DELETE, OPTIONS'});res.end();return true;}
      if(await auth.oauth(req,res,url))return true;
      if(url.pathname==='/mcp'){await mcp(req,res);return true;}
      const write=!['GET','HEAD'].includes(req.method);if(write)auth.origin(req);
      const a=await auth.requireAuth(req,res,write?'projects:write':'projects:read');if(!a)return true;
      const user=a.userId;
      if(url.pathname==='/projects/access'&&req.method==='GET'){const tokens=(await pool.query('SELECT client_id,scope,expires_at,revoked_at FROM project_oauth_tokens WHERE user_id=$1 AND revoked_at IS NULL',[user])).rows;json(res,200,{tokens});return true;}
      if(url.pathname==='/projects/access'&&req.method==='DELETE'){const b=await body(req);if(b.confirmed!==true)fail('Requiere confirmación');await pool.query('UPDATE project_oauth_tokens SET revoked_at=now() WHERE user_id=$1',[user]);json(res,200,{ok:true});return true;}
      if(url.pathname==='/projects/agenda'&&req.method==='GET'){json(res,200,{result:await domain.agenda(user,Object.fromEntries(url.searchParams))});return true;}
      if(url.pathname==='/projects'){
        if(req.method==='GET')json(res,200,{projects:await domain.list(user)});
        else if(req.method==='POST'){const b=await body(req);json(res,201,{project:await domain.create(user,b.project,b.templateId)});}else fail('Método no permitido',405);
        return true;
      }
      const match=/^\/projects\/([0-9a-f-]{36})(?:\/(entries|activity|reschedule|deliveries)(?:\/([0-9a-f-]{36}))?)?$/.exec(url.pathname);
      if(!match)fail('Ruta no encontrada',404);const[,id,resource,entryId]=match;
      if(!resource){
        if(req.method==='GET')json(res,200,{project:await domain.get(user,id)});
        else if(req.method==='PATCH'){const b=await body(req);if(b.patch?.status==='archived'&&b.confirmed!==true)fail('Requiere confirmación');json(res,200,{project:await domain.update(user,id,b.patch,b.version)});}else fail('Método no permitido',405);
      }else if(resource==='activity'&&req.method==='GET')json(res,200,{activity:await domain.history(user,id)});
      else if(resource==='deliveries'&&req.method==='GET'){await domain.get(user,id);json(res,200,{deliveries:(await pool.query('SELECT d.* FROM project_deliveries d JOIN project_entries e ON e.id=d.entry_id WHERE e.project_id=$1 ORDER BY d.updated_at DESC LIMIT 100',[id])).rows});}
      else if(resource==='reschedule'&&req.method==='POST'){const b=z.object({taskId:uuid,days:z.number().int().min(-3650).max(3650)}).parse(await body(req));json(res,200,await domain.reschedule(user,id,b.taskId,b.days));}
      else if(resource==='entries'&&['POST','PATCH','DELETE'].includes(req.method)){
        const b=await body(req);if(req.method==='DELETE'&&b.confirmed!==true)fail('Requiere confirmación');if(req.method==='POST'&&entryId||req.method!=='POST'&&!entryId)fail('Identificador inválido');json(res,req.method==='POST'?201:200,{entry:await domain.writeEntry(user,id,b.kind,b.data||{},entryId,b.version,req.method==='DELETE')});
      }else fail('Método no permitido',405);
    }catch(e){if(res.headersSent){res.end();return true;}const diagnostic=require('crypto').randomUUID();if(!e.status&&!e.issues)console.error('[projects:http]',{diagnostic,path:url.pathname,message:e.message});json(res,e.status||(e.issues?400:500),{error:safeError(e),diagnostic});}
    return true;
  }
  let ticking=false;
  async function tick(){if(ticking)return;ticking=true;try{
    // Only the new reminder table is read; existing reminder schedules remain independent.
    const due=(await pool.query(`SELECT e.id,e.data,p.user_id FROM project_entries e JOIN project_workspaces p ON p.id=e.project_id WHERE e.kind='reminder' AND e.deleted_at IS NULL AND e.data->>'status'='pending' AND e.data->>'notify'='true' AND p.data->>'status'='active' AND p.data->>'template'='false' AND (e.data->>'dueAt')::timestamptz<=now() LIMIT 100`)).rows;
    for(const r of due){const key=r.data.dueAt;const claim=await pool.query(`INSERT INTO project_deliveries(entry_id,schedule_key,status,attempts) VALUES($1,$2,'sending',1) ON CONFLICT(entry_id,schedule_key) DO UPDATE SET status='sending',attempts=project_deliveries.attempts+1,updated_at=now() WHERE project_deliveries.status IN ('pending','failed','no_subscription') AND project_deliveries.attempts<5 AND project_deliveries.updated_at<now()-interval '5 minutes' RETURNING *`,[r.id,key]);if(!claim.rowCount)continue;
      try{const result=await sendNotification(r.user_id,{title:'Bookshell · Proyectos',body:r.data.title,url:'https://bookshell.charlydob.com/#view-projects',tag:'project-reminder:'+r.id,type:'project-reminder'});await pool.query('UPDATE project_deliveries SET status=$3,error=$4,updated_at=now() WHERE entry_id=$1 AND schedule_key=$2',[r.id,key,result.accepted?'sent':result.attemptedCount?'failed':'no_subscription',result.accepted?null:result.reason||'No hay suscripción activa']);}catch(e){await pool.query("UPDATE project_deliveries SET status='failed',error=$3,updated_at=now() WHERE entry_id=$1 AND schedule_key=$2",[r.id,key,String(e.message).slice(0,200)]);}
    }
    await pool.query("DELETE FROM project_sessions WHERE expires_at<now(); DELETE FROM project_oauth_requests WHERE expires_at<now(); DELETE FROM project_oauth_codes WHERE expires_at<now()");
  }catch(e){console.error('[projects:scheduler]',{message:e.message});}finally{ticking=false;}}
  return {handle,domain,tools,tick,start(){const timer=setInterval(()=>void tick(),60000);timer.unref();void tick();return timer;}};
}
module.exports={createProjects};
