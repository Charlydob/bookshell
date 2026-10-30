'use strict';
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {z}=require('zod/v3');
const {createDomain,schemas,projectSchema,projectPatchSchema,fail}=require('./domain');
const {createAuth,RESOURCE,SCOPES,body,json}=require('./auth');
const uuid=z.string().uuid();
const kind=z.enum(Object.keys(schemas));
function safeError(e){return e.issues?e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; '):e.status?e.message:'Error interno; consulta el identificador de diagnóstico';}
function createProjects({pool,sendNotification,sendDevice,ownerId,legacyUid,pushConfigured=true,nowFn,jarvisEnabled=process.env.BOOKSHELL_JARVIS_V2_ENABLED==='1'}){
  const domain=createDomain(pool,{nowFn}),auth=createAuth(pool,{jarvisEnabled});
  const jarvis=jarvisEnabled?require('../jarvis/domain').createJarvis({pool,nowFn}):null;
  const habitNotices=jarvisEnabled?require('../jarvis/notifications').createHabitNotices():null;
  const notifications=require('./notifications').createNotifications({pool,domain,ownerId,legacyUid,pushConfigured,nowFn,enqueueAdditional:habitNotices?.enqueue,validateAdditional:habitNotices?.validate,sendDevice:sendDevice||((user,endpoint,payload)=>sendNotification(user,payload))});
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
    const a=await auth.requireAuth(req,res,null);if(!a)return;
    auth.rate(req,'mcp',600);
    const server=new McpServer({name:'bookshell-projects',version:'1.0.0'},{instructions:'Datos del espacio de Bookshell. Consulta antes de modificar; respeta versiones y confirmaciones. El porcentaje de tareas no es el progreso físico. No inventes avances ni fechas.'});
    for(const[name,description,inputSchema,write,fn,extraScopes]of [...tools(a),...(jarvis?require('../jarvis/tools').definitions(jarvis,a):[])]){
      const requiredScopes=extraScopes||[write?'projects:write':'projects:read'];
      const securitySchemes=[{type:'oauth2',scopes:requiredScopes}];
      server.registerTool(name,{description,inputSchema,securitySchemes,...(extraScopes?{outputSchema:{result:require('../jarvis/contracts').outputSchemas[name]}}:{}),annotations:{readOnlyHint:!write,destructiveHint:name==='delete_entry'||name==='update_project'||name==='habits_archive',idempotentHint:!write||!!extraScopes,openWorldHint:false},_meta:{securitySchemes}},async b=>{
        const requestedScopes=[...requiredScopes];
        if(extraScopes){if(b.reminderPlan)requestedScopes.push('notifications:write');if(name.startsWith('activity_')&&b.habitId)requestedScopes.push('habits:write');if(name.startsWith('activity_')&&b.projectId)requestedScopes.push('projects:read');}
        if(requestedScopes.some(scope=>!a.scopes.includes(scope)))return {isError:true,content:[{type:'text',text:'Autoriza los permisos necesarios para esta operación.'}],_meta:{'mcp/www_authenticate':[`Bearer error="insufficient_scope", error_description="Authorize the requested Bookshell permissions", scope="${[...new Set(requestedScopes)].join(' ')}", resource_metadata="https://mcp-bookshell.charlydob.com/.well-known/oauth-protected-resource"`]}};
        try{const result=await fn(b);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};}catch(e){const diagnostic=require('crypto').randomUUID();if(!e.status&&!e.issues)console.error('[projects:mcp]',{diagnostic,tool:name,message:e.message});return {isError:true,content:[{type:'text',text:JSON.stringify({error:safeError(e),diagnostic,status:e.status||400})}]};}
      });
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    await server.connect(transport);await transport.handleRequest(req,res,req.method==='POST'?await body(req):undefined);
  }
  async function handle(req,res,url){
    if(!url.pathname.startsWith('/projects')&&!url.pathname.startsWith('/oauth/')&&!url.pathname.startsWith('/.well-known/oauth-')&&url.pathname!=='/mcp')return false;
    const started=Date.now();
    res.once('finish',()=>console.info('[projects:request]',{method:req.method,path:url.pathname,status:res.statusCode,durationMs:Date.now()-started}));
    try{
      if(req.method==='OPTIONS'){res.writeHead(204,{Allow:'GET, POST, PATCH, DELETE, OPTIONS'});res.end();return true;}
      if(await auth.oauth(req,res,url))return true;
      if(url.pathname==='/mcp'){await mcp(req,res);return true;}
      const write=!['GET','HEAD'].includes(req.method);if(write)auth.origin(req);
      if(!ownerId){json(res,503,{error:'workspace_owner_unavailable'});return true;}
      auth.rate(req,'project-web',1200);
      if(process.env.BOOKSHELL_WEB_AUTH_MODE==='required'&&!req.webActor&&url.pathname!=='/projects/notifications/receipts')fail('AUTH_REQUIRED',401);
      const user=req.webActor?.userId||ownerId;
      if(url.pathname==='/projects/access-code'&&req.method==='POST'){auth.rate(req,'pair-code',30);json(res,201,{ticket:await auth.issueTicket(user,'oauth'),expiresIn:600});return true;}
      if(url.pathname==='/projects/access'&&req.method==='GET'){const tokens=(await pool.query('SELECT client_id,scope,expires_at,revoked_at FROM project_oauth_tokens WHERE user_id=$1 AND revoked_at IS NULL',[user])).rows;json(res,200,{tokens});return true;}
      if(url.pathname==='/projects/access'&&req.method==='DELETE'){const b=await body(req);if(b.confirmed!==true)fail('Requiere confirmación');await pool.query('UPDATE project_oauth_tokens SET revoked_at=now() WHERE user_id=$1',[user]);json(res,200,{ok:true});return true;}
      if(url.pathname.startsWith('/projects/notifications/')){
        const action=url.pathname.slice('/projects/notifications/'.length);
        if(action==='settings'&&req.method==='GET')json(res,200,{settings:await notifications.settings(user)});
        else if(action==='settings'&&req.method==='PATCH')json(res,200,{settings:await notifications.saveSettings(user,z.object({dailyEnabled:z.boolean().optional(),dailyTime:z.string().optional(),timezone:z.string().optional()}).strict().parse(await body(req)))});
        else if(action==='status'&&req.method==='GET')json(res,200,await notifications.status(user));
        else if(action==='agenda'&&req.method==='GET')json(res,200,{agenda:await notifications.summary(user)});
        else if(action==='preview'&&req.method==='POST')json(res,200,{agenda:await notifications.summary(user),simulation:true,scheduleUnchanged:true});
        else if(action==='test'&&req.method==='POST'){auth.rate(req,'notification-test',15);const b=z.object({endpoint:z.string().url().optional(),summaryTest:z.boolean().default(true),requestId:uuid.optional()}).strict().parse(await body(req));json(res,200,await notifications.test(user,b));}
        else if(action==='receipts'&&req.method==='POST'){const b=z.object({notificationId:uuid,subscriptionId:uuid,receiptToken:z.string().min(30).max(100),event:z.enum(['display-reported','opened'])}).strict().parse(await body(req));json(res,200,await notifications.receipt(b));}
        else fail('Ruta no encontrada',404);return true;
      }
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
  async function tick(options={}){const result=await notifications.tick(options);await pool.query("DELETE FROM project_sessions WHERE expires_at<now(); DELETE FROM project_oauth_requests WHERE expires_at<now(); DELETE FROM project_oauth_codes WHERE expires_at<now()");return result;}
  return {handle,domain,tools,jarvis,notifications,tick,start(){
    let ready=null;const ensureReady=()=>ready||(ready=require('./migrate-task-alerts').migrateLinks(pool,{apply:true}).then(r=>{console.info('[notifications:migration]',{linked:r.linked.length,review:r.review.length});return r;}).catch(error=>{ready=null;throw error;}));
    const run=()=>void ensureReady().then(()=>tick()).catch(e=>console.error('[notifications:scheduler]',{message:e.message}));
    const timer=setInterval(run,60000);timer.unref();run();return timer;
  }};
}
module.exports={createProjects};
