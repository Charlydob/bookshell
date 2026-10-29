# JARVIS 2.0: primera vertical revisable

Base: main `6d106995109035988396649c8b740cf867801059`. Rama `codex/jarvis2-habits-time`.
Estado: implementado y probado mediante cliente MCP HTTP y PostgreSQL aislado. No desplegado ni instalado en la conexión ChatGPT de producción.

## Qué cambia

El MCP Proyectos conserva sus 23 herramientas y añade, solo al activar `BOOKSHELL_JARVIS_V2_ENABLED=1`, doce operaciones semánticas de hábitos y tiempo. No hay herramientas SQL ni escritura por ruta. Los tokens existentes conservan sus permisos: no adquieren dominios nuevos. El emparejamiento web ordinario solo permite Proyectos; un operador debe emitir un ticket de permisos ampliados por el procedimiento offline revisable.

Las escrituras validan entradas con Zod, usuario activo, permisos por operación y pertenencia de proyecto/entidades; bloquean la fila JSON del propietario autenticado. Una clave de idempotencia se liga a usuario, operación y cuerpo; repetirla devuelve el resultado anterior y reutilizarla con otro cuerpo produce conflicto. Las ediciones y cambios de sesión usan revisión SHA-256 del objeto canónico. La auditoría registra operación e identificador, sin payloads personales ni tokens. El resultado persistente y su clave se guardan en la misma transacción.

La migración `20261029_jarvis_v2.sql` es aditiva y explícita; no se incorpora al arranque. Añade permisos de ticket y tablas de idempotencia/auditoría. No modifica ni elimina registros de hábitos existentes.

## Herramientas candidatas

| Herramienta | Permisos | Comportamiento |
|---|---|---|
| jarvis_context | habits:read | Horarios/preferencias existentes y zona persistida; no inventa datos |
| habits_list | habits:read | Búsqueda normalizada y revisión; archivados opcionales |
| habits_create | habits:write | Crea check/count/time, calendario daily/days y objetivos; rechaza duplicados exactos normalizados |
| habits_update | habits:write | Edición con revisión; no permite cambiar tipo ni perder historial |
| habits_archive | habits:write | Archivado recuperable, confirmed=true y revisión; impide archivar con sesión activa |
| habits_record | habits:write | Incremento o acumulado por fecha; tipo/unidad estrictos; bajar acumulado exige confirmación |
| habits_history | habits:read | Serie diaria, total y revisión del valor; hasta 367 fechas incluidas |
| habits_reminders | habits:write + notifications:write | Hasta seis horas explícitas, zona, rango y calendario del hábito |
| activity_start | time:write | Inicio explícito, permite actividades distintas simultáneas |
| activity_change | time:write | Pausa/reanuda/finaliza con revisión; finalización acredita el hábito atómicamente |
| activity_manual | time:write | Intervalos declarados; rechaza futuro y solapamiento dentro de una misma sesión |
| activity_query | time:read | Intervalos, sumas por actividad, unión cronológica, tiempo exclusivo y solapado; por fecha |

Crear un hábito con `reminderPlan` configura hábito y avisos en una sola transacción y exige además notifications:write. Los horarios deben haber sido solicitados o acordados: el servicio no decide preferencias personales. Asociar actividad a hábito exige habits:write; asociarla a proyecto exige projects:read y pertenencia al usuario. La comprobación condicional ocurre en el servicio aunque los metadatos MCP anuncien el permiso base.

Los contratos JSON Schema completos se generan en la entrega `JARVIS2-contratos-MCP.json`; el catálogo vivo se debe refrescar después de un despliegue aprobado. El total candidato es 35, mientras que producción sigue con 23.

## Hábitos y compatibilidad del modelo

Se reutilizan `habits/habits`, `habitChecks`, `habitCounts` y `habitSessions`. Los objetivos de tiempo se proyectan en goalsByRange, que en el frontend existente representa minutos. Para check/count se usa `jarvisTargets`: evita convertir tres cepillados en tres minutos. La API presenta targetsByRange en unidades de objetivo del hábito. El frontend conserva los campos extendidos al editar una ficha.

Calendarios: daily o días concretos (0 domingo, 6 sábado). Los objetivos pueden ser diarios, semanales, mensuales, anuales o totales. No se inventa una fecha de realización para “dos veces esta semana”: se pide el día o los días necesarios para registrar el hecho en el modelo diario. Historia devuelve datos, no conclusiones sobre horas de incumplimiento que el historial no contenga.

Los set de acumulados requieren la revisión obtenida en habits_history. En hábitos check se usa set 0/1. En count, increment añade al valor previo sin reemplazarlo. En time se convierten minutos/segundos antes de comparar y escribir. Cambiar un total con intervalos ya guardados devuelve SESSION_CORRECTION_REQUIRED: esta primera entrega no reescribe arbitrariamente su cronología.

## Tiempo simultáneo

`habits/activitySessions` conserva las sesiones explícitas de esta vertical, sus intervalos, pausas, zona, relación de hábito y proyecto. Al finalizar se añaden los intervalos y total a la representación nativa habitSessions en la misma transacción. No se tocan sesiones web activas ni se duplican sus registros.

Una hora de diseño y una hora de Twitch simultáneas producen actividad=7200 s, transcurrido=3600 s, exclusivo=0 y solapado=3600 s. Los cálculos recortan al intervalo de consulta y dividen los días por medianoche local, incluidos cambios de hora de 23/25 horas. El tiempo exclusivo es el tiempo con exactamente una actividad de la selección consultada; no significa una medida de atención o productividad.

Las sesiones nuevas se controlan desde MCP. Los controles web existentes de sesiones activas todavía no gestionan este registro; los totales finalizados sí son legibles por su función nativa. El análisis cronológico de activity_query cubre sesiones JARVIS explícitas, no horas de todos los proyectos existentes ni intervalos reconstruidos desde agregados legacy. Los mensajes de chat no crean tiempo por sí solos.

## Notificaciones

Los avisos de hábitos se añaden a notification_runs y usan el mismo motor de entrega, reintentos por dispositivo, recibos y bloqueo de scheduler de Proyectos. No hay un worker ni canal Telegram para hábitos. La ventana de envío es de quince minutos; no se hace envío masivo de avisos viejos después de una caída. Cada hábito/plan/fecha/hora tiene clave única; los objetivos diarios completados, hábitos archivados y planes cambiados se comprueban de nuevo antes de enviar.

La aceptación del proveedor es distinta de que el aviso se muestre en el móvil. En pruebas se usa un proveedor simulado, sin enviar avisos reales. Las suscripciones y permisos del dispositivo deberán verificarse tras autorización de producción.

## Qué se reutiliza de JARVIS-v0 y fallos comprobados

- Se conservan la semántica check/count/time, normalización de nombres, rutas canónicas y contratos de fechas/unidades. Se trasladan al servicio Node; no se utiliza Python, Core, gateway, modelos locales ni voz como dependencia.
- El cliente antiguo ya usaba token separado y read-back. La nueva implementación persiste resultado/idempotencia junto a la escritura y verifica mediante nuevas consultas MCP en las pruebas.
- Se reprodujo `_match` con dos nombres equivalentes tras normalizar acentos: elige el primero y devuelve cero candidatos ambiguos. Sus umbrales solo consideran ambigüedad si la puntuación superior es menor de 0,82. Aquí la búsqueda devuelve candidatos y las escrituras usan identificador explícito.
- markJarvisHabit antiguo asigna valores count/time y reemplaza el objeto time del día; no incrementa ni conserva todos los intervalos. La nueva operación distingue mode y preserva los metadatos diarios.
- La idempotencia financiera del Core usa por defecto un hash con un bucket de minuto: un reintento cruzando el minuto genera otra clave. No se ha afirmado que eso causara un movimiento duplicado real. La nueva vertical requiere clave estable proporcionada por la llamada.
- El servicio antiguo de gym actualiza una plantilla por nombre al registrar sesión; no se reutiliza como operación de cardio.
- El timeout HTTP de quince segundos y las llamadas consecutivas existen en código. No se dispone de métricas suficientes para atribuir fallos históricos a latencia, al modelo o a la voz.

## Pruebas y estado real

Pruebas nuevas: permisos por dominio, usuario desactivado, aislamiento por propietario, contratos estrictos, fechas inválidas, deduplicación y conflicto de idempotencia, incrementos concurrentes, revisiones, tipos/unidades, intervalos simultáneos, pausa y medianoche/DST, avisos sin duplicación, objetivo diario completado, creación compuesta, lectura con función web nativa, migración de Telegram y reclamación por canal. El flujo HTTP usa el SDK MCP real; descubre 35 herramientas, conserva list_projects para tokens antiguos, rechaza hábitos con esos tokens y verifica registro/read-back con el nuevo permiso. El flujo OAuth prueba consentimiento, PKCE, ticket limitado y renovación rechazada para usuario desactivado.

El PostgreSQL de prueba es un contenedor temporal sin red externa ni puertos publicados, con base bookshell_qa y esquema propio eliminado al terminar. No es una copia de datos personales. Se montan dependencias de producción en solo lectura; no se conecta la base de prueba a la base personal.

Ejecutar unitarias: `node --test tests/jarvis-v2.test.cjs`.
Ejecutar integración: establecer BOOKSHELL_TEST_DATABASE_URL para una base aislada llamada bookshell_qa y ejecutar `node --test tests/jarvis-v2.integration.cjs`. El test rechaza otro nombre de base antes de crear su esquema.

## Revisión y límites antes de desplegar

1. El acceso web heredado continúa abierto por petición anterior. El OAuth nuevo no hereda ese acceso ni permite emitir grants ampliados desde la web, pero tampoco cierra las rutas /data antiguas. No activar nuevos dominios sensibles sin resolver esa frontera.
2. Las escrituras MCP se serializan y tienen revisiones; escrituras web/offline antiguas de acumulados todavía pueden reemplazar una rama con un valor viejo. Falta adaptar esas ediciones a transacciones semánticas o CAS antes de garantizar concurrencia web+MCP completa. La conservación de campos extendidos y lectura nativa están probadas; una prueba de navegador integral sigue pendiente.
3. No hay interfaz web de control de las sesiones JARVIS nuevas ni corrección de sus intervalos finalizados.
4. No se publican todavía herramientas de personas, sueño, finanzas, nutrición, libros, cardio ni viajes en esta entrega. Sus fases no se presentan como terminadas.
5. La unión temporal cubre actividades registradas explícitamente; no mide atención ni acceso al dispositivo.

Esta entrega deja una vertical MCP ejecutable y revisable en entorno aislado. No autoriza un despliegue con los límites anteriores sin tratar ni una ampliación automática de permisos.
