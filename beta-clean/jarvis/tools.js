"use strict";
const { schemas, scopes } = require("./contracts");
const descriptions = {
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
    "Inicia una actividad explícita, opcionalmente asociada a hábito de tiempo y proyecto propio. Permite actividades simultáneas.",
  activity_change:
    "Pausa, reanuda o termina una sesión explícita usando su revisión. Al terminar acredita el hábito de forma atómica.",
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
module.exports = { definitions, descriptions };
