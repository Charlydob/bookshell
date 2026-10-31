"use strict";
const { schemas, scopes } = require("./contracts");
const descriptions = {
  activity_update:"Corrige startedAt (ISO con zona explícita) y metadatos de sesiones activas, pausadas o terminadas con revisión e idempotencia. Intervalos y duración requieren sesión terminada. Conserva pausas, hábito, históricos y simultaneidad; recalcula aportaciones al cerrar o corregir una sesión terminada.",
  activity_reassign:"Traslada una sesión terminada a otro hábito de tiempo existente. Resta su aportación original y suma la nueva atómicamente sin cambiar los intervalos.",
  activity_delete:"Elimina recuperablemente una sesión terminada y retira su aportación, con confirmación humana expresa, revisión e idempotencia.",
  activity_restore:"Recupera una sesión eliminada usando su revisión actual y restaura su aportación una sola vez.",
  activity_split:"Reparte una sesión terminada entre hábitos existentes mediante intervalos ISO contiguos o separados que cubran exactamente la sesión original, sin perder ni duplicar tiempo.",
  jarvis_capabilities:"Descubre versión, operaciones, scopes y módulos reales. authorized indica los permisos de esta conexión; consulta antes de asumir capacidades.",
  habits_list:
    "Consulta hábitos existentes y revisiones. Busca antes de crear; no convierte ejemplos en datos.",
  habits_create:
    "Crea un hábito check/count/time en el modelo web canónico. Acepta reminderPlan explícito para crear hábito y avisos atómicamente con notifications:write. No elige horas implícitas.",
  habits_update:
    "Edita configuración del hábito con revisión leída. No cambia el tipo ni sobrescribe registros.",
  habits_archive:
    "Archiva recuperablemente un hábito; requiere confirmación humana explícita y revisión actual.",
  habits_record:
    "Registra un incremento o fija un acumulado para una fecha explícita. Un set requiere revisión de habits_history; bajar un valor requiere confirmación. Check usa set 0/1.",
  habits_history:
    "Consulta agregados diarios, total e identificadores de revisión. No deduce horas de cumplimiento ni sueño.",
  habits_reminders:
    "Configura hasta seis horas explícitas con zona y rango. Requiere permiso notifications:write. Evita horarios duplicados y no insiste tras completar objetivo diario.",
  activity_start:
    "Inicia una actividad abierta, opcionalmente con startedAt retroactivo ISO con zona explícita; sin startedAt usa la hora del servidor. Conserva hábito y proyecto propio; permite actividades simultáneas. Rechaza inicio futuro o anterior a 366 días. Usa idempotencyKey para reintentos.",
  activity_change:
    "Pausa, reanuda o termina una sesión explícita usando revisión e idempotencia. Para pausar o terminar una sesión running acepta endedAt ISO con zona explícita entre el inicio abierto y ahora. Sin endedAt usa hora del servidor. Al terminar acredita el hábito de forma atómica.",
  activity_manual:
    "Registra intervalos declarados, sin inferir duración entre mensajes. Rechaza solapamiento dentro de la misma sesión; permite actividades simultáneas distintas.",
  activity_query:
    "Consulta sesiones explícitas y tiempo de actividad, transcurrido por unión, exclusivo y solapado. Los totales legacy no acreditan intervalos.",
  jarvis_context:
    "Consulta preferencias de hábitos y horarios existentes, zona configurada y operaciones permitidas; no inventa preferencias.",
};
function definitions(service, actor) {
  return Object.entries(schemas).map(([name, schema]) => [
    name,
    descriptions[name],
    schema.shape,
    scopes[name].some((s) => s.endsWith(":write")),
    (b) => service.run(actor, name, b),
    scopes[name],
  ]);
}
Object.assign(descriptions, require('./module-contracts').descriptions);
module.exports = { definitions, descriptions };
