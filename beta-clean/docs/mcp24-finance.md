# JARVIS — MCP 2.4, continuación de PR #586

## Resultado y alcance

Finanzas dispone de escritura para movimientos ordinarios y transferencias internas en código y QA. **No está desplegado ni disponible como escritura en el catálogo de este chat.** El objetivo global de todos los módulos sigue incompleto. Se reutilizaron la auditoría de 67 herramientas, los tres commits anteriores de la PR y su regresión; no se repitió una auditoría completa.

## Capacidades reales por módulo

| Módulo | Lectura | Creación / edición / corrección | Clasificación y límite |
| --- | --- | --- | --- |
| Finanzas | Cuentas, movimientos, categorías y demás colecciones; preferencias/cotización nuevas | Gasto, ingreso, corrección, anulación, transferencia y reglas, probados mediante SDK+BD aislada | Parcialmente operativa: QA operativa; publicación MCP y autorización finance:write pendientes. Tickets/hábitos/recurrencias complejos excluidos |
| Gimnasio | Colecciones existentes probadas por SDK | La web registra ejercicios/series; escrituras MCP ausentes | Parcialmente operativa; prioridad siguiente |
| Nutrición | Productos, diarios y macros conocidos | La web registra consumos; escrituras MCP ausentes | Parcialmente operativa; snapshots/efectos sobre inventario pendientes de extracción |
| Recetas | Receta e ingredientes; cálculo de raciones | Crear, editar, borrar/recuperar probado; no registra lotes cocinados | Parcialmente operativa; cocinado ausente |
| Personas | Fichas nativas de Notas | Crear/editar, notas y relaciones explícitas probadas | Parcialmente operativa; cumpleaños no sincroniza recordatorios automáticamente |
| Agenda | Vista pendientes/historia y recurrencias probadas en continuación anterior | Tareas y avisos de proyecto; no CRUD global completo | Parcialmente operativa; continuación 2.3 aún no desplegada |
| World | Colecciones de lugares/viajes existentes | Escrituras MCP ausentes | Parcialmente operativa; no confundir editores web con acceso MCP |
| Biblioteca | Libros y progreso diario | Crear/editar, progreso/corrección probado en regresión existente | Parcialmente operativa; valoraciones y parte de recuperación ausentes |
| Proyectos | Proyectos, tareas y relaciones | Escrituras con idempotencia transaccional y dependencias/DST probadas en continuación | Parcialmente operativa; recuperación de entradas pendiente |
| Hábitos y actividades | Hábitos, sesiones y totales | Registros históricos, correcciones y simultaneidad probados | Operativa en los flujos cubiertos; campos retroactivos bloqueados en catálogos antiguos del host |

“Probado” indica SDK MCP real y persistencia en QA, no evaluación del modelo interpretando cada frase ni verificación personal desde ChatGPT. La disponibilidad del host sigue limitada a sus contratos ofrecidos.

## Implementado ahora

- Ocho herramientas nuevas: finance_preferences, finance_quote, finance_create, finance_update, finance_transfer, finance_transfer_update, finance_void y finance_rule_set. Se conserva finance_query; añade colección voidedTransactions. Catálogo del candidato: 76 herramientas.
- Movimiento nativo con importe original y cargado, monedas, categoría existente, fecha histórica, metadatos del cambio y revisión. No crea cuentas, categorías ni tipos de cambio implícitos.
- Selección de cuenta explícita, regla autorizada, predeterminada compatible o única cuenta compatible; ambigüedad obliga a precisar la cuenta. Sin categoría fiable puede guardar indicando que quedó sin categoría.
- Transferencias internas conservan importes distintos en cada moneda; no realizan operaciones bancarias. Corrección y anulación recalculan las cuentas afectadas, desde la fecha anterior/nueva, sin dejar saldos derivados posteriores obsoletos.
- Se extraen normalización de tipos, construcción común del movimiento y proyección nativa de saldos/snapshots a scripts/shared/services/finance-business.js, consumido por web y MCP. Se conservan tablas, almacenamiento nativo y ledger transaccional existentes. Sin migraciones ni dependencias nuevas.
- Idempotencia obligatoria en nuevas escrituras; replay antes de comparar revisión, conflicto de payload y rollback de movimiento/saldos/ledger/auditoría. Revisión obligatoria para corregir/anular. Anulación conserva copia consultable, sin herramienta de restauración financiera todavía.
- finance_quote consulta referencia ECB por fecha mediante Frankfurter, valida par, fecha, antigüedad máxima de siete días y tasa positiva. No usa las constantes de respaldo del navegador. Referencia aproximada, no cambio bancario efectivo. Solo transmite monedas y fecha. Proveedor: https://frankfurter.dev/.

## Datos necesarios y confirmaciones

Creación: tipo, importe, moneda, fecha y concepto. La interpretación natural resuelve hoy/ayer en Europe/Zurich; el contrato exige una fecha absoluta válida. Cuenta y categoría pueden reutilizarse a partir de consultas/reglas. Divisa diferente de EUR: tipo EUR explícito/verificado; finance_quote evita preguntar cuando hay referencia disponible. Si la moneda del gasto difiere de la cuenta, accountAmount es el importe cargado explícito. Transferencia entre monedas: destinationAmount obligatorio, nunca supuesto. Corrección: ID y revisión leídos, campos cambiados y clave nueva por intención; reintento idéntico conserva clave.

No se añade confirmación redundante a registrar/corregir un gasto ordinario pedido claramente. Anular, registrar/corregir transferencias y guardar reglas requieren autorización expresa y confirmed=true. finance:write es un permiso OAuth nuevo, no se concede a tokens antiguos por publicar código.

## Pruebas

**101 aprobadas; 0 fallidas; 0 omitidas.** Se reutiliza la regresión de 91 y se añaden 10 pruebas (7 escenarios de integración financiera y 3 pruebas del servicio/cotización). PostgreSQL 16 efímero, bookshell_qa, schemas y usuarios sintéticos. SDK MCP auténtico y comprobación de filas persistidas; no se escribieron datos personales.

Cubierto: lectura/paginación por módulos, creación de gasto/ingreso, corrección histórica, revisión obsoleta, anulación, moneda distinta de la cuenta, transferencia y reversión de ambas cuentas, regla/predeterminada/ambigüedad, fecha inválida/futura, categoría/cuenta desconocida, permisos, aislamiento de usuario, replay concurrente, conflicto de payload y rollback inyectando fallo en el ledger. También snapshot autoritativo, normalización heredada y rechazo de IDs heredados conflictivos; FX inválido/obsoleto/caído sin respaldo ficticio. Consulta pública real CHF→EUR por fecha comprobada separadamente; las pruebas deterministas del proveedor usan respuestas sintéticas.

Fallos intermedios resueltos: precisión del total EUR, expectativa de mayúsculas en error de permiso y montaje inicial del contenedor. No quedan fallos de pruebas conocidos. Sin nueva QA visual del editor web ni evaluación automatizada del lenguaje natural; no se afirma verificación de escrituras desde ChatGPT.

## Skill privada

JARVIS 0.3.0 publicado sobre el mismo plugin privado y conexión. Verificado por lectura posterior: manifiestos equivalentes salvo versión y skill esperada; el servicio normaliza espacios/JSON. Añade extracción mínima de datos, reglas autorizadas, aclaraciones mínimas, Europe/Zurich, intención futura frente a hecho, FX verificable y distinción transferencia contable/bancaria. Preserva las reglas de simultaneidad, consulta previa, revisiones e idempotencia. Publicar la skill no despliega el backend ni refresca el catálogo del host.

## Limitaciones pendientes y continuación

| Gravedad | Pendiente / efecto |
| --- | --- |
| Alta | Nuevas escrituras no desplegadas; host actual solo expone finance_query. Desplegar candidato validado y refrescar conexión existente/autorización finance:write antes de afirmar disponibilidad |
| Alta | Gimnasio, Nutrición y World aún sin escrituras MCP; no implementados en este bloque |
| Alta | Corrección/anulación de movimientos vinculados a hábitos, tickets, recetas o recurrencias requiere servicio nativo completo; se rechaza antes de persistir. Importes heredados ambiguos/incompatibles tampoco se fuerzan |
| Media | Cotización ECB puede no cubrir una moneda/fecha o estar caída; se necesita tasa real aportada. Cuenta en otra moneda requiere importe cargado; transferencia exige importe recibido |
| Media | No hay restauración MCP de anulaciones, borrado de reglas ni gestión completa de cuentas. Anulaciones y reglas permanecen consultables |
| Media | Lotes cocinados, recordatorios globales/cumpleaños, valoraciones y recuperación de entradas de proyecto siguen pendientes de la auditoría previa |
| Media | Falta QA visual nueva de web; la proyección compartida y las persistencias están probadas, no se declara validación visual completa |

Continuación precisa: mantener la misma rama/PR y ascendencia de cce5e1d. Gimnasio: extraer createJarvisGymSession/jarvisWorkoutTotals del backend y contrastar computeWorkoutTotals, normalización de series y snapshots de scripts/modules/gym/runtime.js; no exponer directamente el adaptador legado ligado al propietario global. Añadir creación, edición/corrección histórica, revisiones e idempotencia sobre el mismo servicio, con SDK+bookshell_qa y permisos/propiedad. Después Nutrición, cocinado, Personas/avisos, World, Biblioteca y recuperación de proyectos en el orden solicitado.

Producción no se ha modificado en esta iteración. Estado previo documentado: MCP 2.2 cce5e1d. PR #586 continúa como borrador, sin fusionar. Este informe entrega un bloque financiero comprobable y un punto de continuación; no declara alcanzado el objetivo global.
