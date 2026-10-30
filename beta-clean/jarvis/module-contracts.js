'use strict';
const {z}=require('zod/v3');
const id=z.string().min(1).max(150).regex(/^[A-Za-z0-9_-]+$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const text=z.string().trim().min(1).max(500),optionalText=z.string().max(20000);
const revision=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().min(8).max(180);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v);
const zone=z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const ingredient=z.object({id:id.optional(),name:text,qty:z.number().nonnegative(),unit:z.string().max(30),notes:optionalText.optional(),productId:id.optional()}).strict();
const step=z.object({id:id.optional(),title:optionalText.optional(),description:optionalText,done:z.boolean().optional()}).strict();
const recipe=z.object({title:text,ingredients:z.array(ingredient).max(200),steps:z.array(step).max(200),servings:z.number().positive().max(10000),tags:z.array(text).max(50).optional(),meal:z.string().max(100).optional(),health:z.string().max(100).optional(),notes:optionalText.optional(),favorite:z.boolean().optional(),country:z.string().max(100).optional()}).strict();
const person=z.object({firstName:text,lastName:z.string().max(200).optional(),nationality:z.string().max(200).optional(),phone:z.string().max(200).optional(),birthday:date.or(z.literal('')).optional(),address:optionalText.optional(),socials:optionalText.optional()}).strict();
const note=z.object({title:text,content:optionalText,folderId:id.or(z.literal('')).optional(),tags:z.array(text).max(50).optional(),category:z.string().max(200).optional()}).strict();
const folder=z.object({name:text,parentId:id.or(z.literal('')).optional(),emoji:z.string().max(16).optional(),color:z.string().regex(/^#[a-fA-F0-9]{6}$/).optional()}).strict();
const book=z.object({title:text,author:z.string().max(500).nullable().optional(),isbn:z.string().max(32).nullable().optional(),pages:z.number().int().nonnegative().max(100000).optional(),genre:z.string().max(200).optional(),language:z.string().max(100).optional(),status:z.enum(['reading','planned','finished']).optional()}).strict();
const entry=z.object({id:z.string(),data:z.unknown(),revision});
const query=z.object({query:z.string().max(200).optional(),id:id.optional(),from:date.optional(),to:date.optional(),limit:z.number().int().min(1).max(100).default(30),offset:z.number().int().nonnegative().max(100000).default(0)});
const collections={recipes:['items','foodItems'],people:['people'],notes:['notes','folders'],books:['books','readingLog'],nutrition:['products','dailyLogsByDate','macroTargets'],gym:['exercises','workouts','templates','body','cardio'],finance:['accounts','transactions','budgets','categories','goals','snapshots','recurring'],world:['geography','places','saved','stays','watch']};
const schemas={},scopes={},descriptions={},outputSchemas={};
function add(name,schema,required,description,out){schemas[name]=schema;scopes[name]=required;descriptions[name]=description;outputSchemas[name]=out||z.object({item:entry,warnings:z.array(z.string()).optional()}).strict();}
for(const [module,sections] of Object.entries(collections)) add(module+'_query',query.extend({collection:z.enum(sections).default(sections[0])}).strict(),[module+':read'],`Consulta ${module} en el modelo nativo, con identificadores, revisión, búsqueda por contenido y paginación. No inventa valores ausentes.`,z.object({items:z.array(entry),nextOffset:z.number().nullable(),total:z.number(),summary:z.unknown().optional(),warnings:z.array(z.string()).optional()}).strict());
for(const [module,payload] of Object.entries({recipes:recipe,people:person,notes:note,books:book,folders:folder})){
 const scope=module==='folders'?'notes':module;
 add(module+'_create',z.object({data:payload,idempotencyKey:key}).strict(),[scope+':write'],`Crea ${module} en su estructura existente; rechaza duplicados. Lee primero para reutilizar registros.`);
 add(module+'_update',z.object({id,expectedRevision:revision,patch:payload.partial(),idempotencyKey:key}).strict(),[scope+':write'],`Edita ${module} con revisión e idempotencia; conserva los campos no modificados.`);
}
for(const module of ['recipes','notes']){
 add(module+'_delete',z.object({id,expectedRevision:revision,confirmed:z.literal(true),idempotencyKey:key}).strict(),[module+':write'],`Retira recuperablemente ${module}. Requiere confirmación humana. Conserva el registro en el ledger existente; usa deletionKey para recuperar.`,z.object({item:entry,deletionKey:key}).strict());
 add(module+'_restore',z.object({deletionKey:key,idempotencyKey:key}).strict(),[module+':write'],`Restaura ${module} desde una eliminación propia. Rechaza sobrescribir registros existentes.`);
}
add('recipes_scale',z.object({id,servings:z.number().positive().max(10000)}).strict(),['recipes:read'],'Calcula cantidades para las raciones solicitadas sin modificar la receta; conserva unidades y no inventa ingredientes.');
add('people_add_note',z.object({id,expectedRevision:revision,text:optionalText.min(1),idempotencyKey:key}).strict(),['people:write'],'Añade una entrada a las notas de una ficha persona existente.');
add('people_link',z.object({id,targetId:id,label:text,remove:z.boolean().default(false),expectedRevision:revision,idempotencyKey:key}).strict(),['people:write'],'Añade, cambia o retira un enlace de relación explícita entre fichas existentes, usando linkRefs nativos. No infiere parentescos.');
add('books_progress',z.object({id,expectedRevision:revision,currentPage:z.number().int().nonnegative().max(100000),date,timezone:zone,idempotencyKey:key}).strict(),['books:write'],'Actualiza página y estado de lectura junto al registro diario atómicamente. Usa fecha explícita; no deduce sesiones temporales.');
module.exports={schemas,scopes,descriptions,outputSchemas,collections};
