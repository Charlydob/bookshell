# Proyectos de Bookshell — despliegue y operación

Fecha de verificación: 27 de octubre de 2026, Europe/Madrid.

## Direcciones y estado

- Módulo integrado: https://bookshell.charlydob.com/#view-projects
- MCP de Bookshell: https://mcp-bookshell.charlydob.com/mcp
- Bookshell Proyectos usa el mismo acceso directo que las demás secciones: no requiere cuenta, contraseña, cookie ni enlace de activación. El navegador, móvil y PWA usan la identidad de propietario único ya configurada en Bookshell. ChatGPT conserva OAuth con PKCE S256; los tokens de acceso duran una hora y los refresh rotatorios cien años, hasta revocación.
- Estado del servidor: desplegado y verificado con un cliente MCP del SDK oficial; 23 herramientas descubiertas y operaciones reales de lectura/escritura comprobadas.
- Prueba dentro de ChatGPT: completada. Conector privado creado con autorización del usuario, OAuth y DCR operativos, lectura de HOOKBOX y creación/edición/consulta posterior de un proyecto de verificación confirmadas desde ChatGPT y cotejadas directamente en PostgreSQL.

## Arquitectura comprobada antes de implementar

Repositorio: `https://github.com/Charlydob/bookshell`, revisión inicial `6b68c40`. La copia desplegada era `/opt/bookshell`, sin cambios locales. Frontend estático modular en `beta-clean/`, JavaScript, CSS y HTML; Caddy sirve esa carpeta. No existe una aplicación nueva ni un servicio web paralelo.

La API existente se ejecuta en `bookshell-api-api-1`, Node 22, con PostgreSQL 16 del contenedor `charly-stack-postgres-1`, base `bookshell`. El servicio escucha en `127.0.0.1:3002` del host. Su fuente efectiva está montada desde `beta-clean/deploy-bookshell-api-server.js`, no desde la copia histórica de `/opt/bookshell-api/server.js`.

El proxy activo es Caddy de systemd, configuración `/etc/caddy/Caddyfile`. Ya servía Bookshell, su API, JARVIS, HOOKBOX, HotelApp y otros servicios. Estos continúan usando sus rutas y procesos existentes. Se añadió únicamente el sitio MCP y el acceso al módulo desde el mismo dominio de Bookshell.

El DNS público del nombre solicitado devuelve las direcciones de Cloudflare `188.114.96.12` y `188.114.97.12`; la inspección SSH confirmó el servidor de origen en `46.224.61.193`. No se modificó DNS ni se crearon otros nombres. Caddy obtuvo TLS y el acceso HTTPS a través de Cloudflare quedó verificado.

La API antigua tiene autenticación web desactivada y funciona en modo de usuario único. Las cuentas y sus hashes bcrypt seguían presentes en `users`, pero no se recupera su uso para iniciar sesión. Proyectos conserva el identificador interno de propietario que ya usa Bookshell. La sección web no solicita credenciales y llama a su API como las demás vistas de la aplicación. OAuth se mantiene únicamente en la conexión remota de ChatGPT. Cambiar la autenticación de los módulos antiguos queda fuera de este despliegue.

No había módulo Proyectos ni tablas de proyectos. Notas y su calendario/recordatorios están integrados en la sección antigua de Notas. Las notas existentes se guardan en el JSON canónico `firebase_import_raw`; los recordatorios existentes usan `reminders`, `reminder_alerts` y su registro de entregas. Se contaron 74 filas de recordatorios antes del despliegue.

## Endpoints inventariados y reutilización

| Rutas existentes | Función | Decisión |
| --- | --- | --- |
| `/auth/me`, `/auth/login`, `/auth/logout` | Identidad antigua de usuario único | No sirven como autenticación del módulo nuevo; se conserva su comportamiento |
| `/data`, `/data/*`, `/data/push`, `/data/transaction` | Árbol canónico de módulos antiguos | Se preservan sus datos; no se migran proyectos dentro de ese JSON |
| `/reminders`, `/reminders/:id`, `/reminders/:id/complete` | Recordatorios anteriores | Permanecen independientes |
| `/push/status`, `/push/subscribe`, `/push/test` | Web Push existente | Proyectos reutiliza el envío y las suscripciones del propietario original |
| `/automation/reminders*`, `/automation/reminder-alerts/*` | Automatización y programación anteriores | No se cambian sus estados ni calendario |
| `/jarvis/books`, `/jarvis/data/*`, `/jarvis/reminders*` | Acceso de JARVIS por token y permisos | Se conservan; un token de JARVIS no autoriza acceso MCP |
| `/shortcuts/finance/*`, `/shortcuts/world/*`, `/shortcuts/reminders/today` | Atajos existentes | Sin cambios |
| `/export`, `/health`, `/data-usage` | Exportación, diagnóstico, métricas antiguas | Sin cambios de contrato |

La lógica nueva vive en `projects/`, cargada dentro del servidor existente. Comparte PostgreSQL, el identificador interno del propietario y el proveedor Web Push. Sus endpoints propios son necesarios para mantener datos, sesiones, permisos y OAuth separados.

## Uso del módulo

La navegación principal añade Proyectos sin quitar Notas ni Recordatorios. El selector permite abrir proyectos activos, en pausa, archivados y plantillas. Los detalles se distribuyen en Resumen, Kanban, Lista, Calendario, Cronograma, Notas, Documentación, Materiales, Recordatorios y Actividad.

Las tareas admiten casillas, prioridad, responsable, subtareas, fechas de inicio y vencimiento, dependencias e hitos. Se rechazan dependencias ajenas al proyecto, ciclos y la finalización con dependencias o subtareas pendientes. «Reprogramar cadena» desplaza las fechas existentes de la tarea y sus dependientes pendientes; conserva las tareas completadas y no inventa fechas.

El porcentaje de tareas incluye todas las tareas y subtareas, con el mismo peso. Es independiente del porcentaje de fabricación. El progreso físico es desconocido por defecto y exige una evidencia escrita cuando se establece un porcentaje.

Una plantilla se marca al editar el proyecto; al crear otro proyecto puede elegirse como origen. Las referencias entre tareas se reasignan; los estados y fechas se reinician para evitar heredar avances físicos, tareas completadas o entregas supuestas.

Notas y documentos utilizan Markdown con vista previa, imágenes por URL, tablas, enlaces, bloques de código y diagramas Mermaid. El HTML se sanea con DOMPurify; Mermaid utiliza modo estricto. La búsqueda incluye título, contenido y categoría. Las imágenes se enlazan; no se implementa un repositorio de subida de archivos.

Compras e inventario mantienen cantidades, estados de pedido/recepción, proveedores, costes y existencias mínimas. Los costes se agregan por moneda y no se mezclan divisas.

Después de guardar, todas las vistas se regeneran desde la respuesta persistida. Los cambios externos se consultan cada 20 segundos mientras la vista está visible y no hay un editor abierto. El botón Actualizar permite forzar la consulta. Los editores rechazan una versión obsoleta con HTTP 409; no sobrescriben silenciosamente un cambio simultáneo.

Los recordatorios nuevos tienen programación y un registro propio de envío. El proceso existente comprueba vencimientos cada minuto. Registra `sent`, `failed` o `no_subscription`, con reintentos limitados y recuperación de envíos interrumpidos. Un recordatorio reprogramado tiene otra clave de entrega. La recepción física de una notificación depende de una suscripción activa y del dispositivo; la prueba automatizada de envío usa un proveedor controlado, no demuestra recepción en un teléfono del usuario.

## HOOKBOX

Se creó un proyecto HOOKBOX con ocho tareas, dos hitos, una nota y un documento técnico. Fuentes revisadas: `README_V2_CROWPANEL.md`, `protocol/protocol.md` y `protocol/webots_contract.md`, dentro de la carpeta local `HOOKBOX_Control_V2_CROWPANEL`.

Las tareas corresponden a contrato, recepción de PCBs, montaje de banco, pantalla/ADMIN, Wi-Fi/NVS, actuadores, OTA y prueba integral. Todos sus estados iniciales son pendientes; seis tareas presentan dependencias pendientes. Progreso de tareas: 0 %. Fabricación: sin confirmar. No se inventaron entregas, compras, fechas ni pruebas físicas realizadas. Los hallazgos documentados de firmware no se confunden con validaciones actuales del montaje.

## API nueva y herramientas MCP

El navegador usa `/projects-api/projects...` en el dominio de Bookshell; Caddy elimina `/projects-api` y envía la petición al mismo proceso API. La API web adopta el modelo de acceso directo de Bookshell y usa el propietario único ya configurado. El sitio MCP solamente permite `/mcp`, `/oauth/*` y el descubrimiento OAuth; no expone las rutas antiguas ni la API web por ese dominio.

| Operación | API del proceso existente |
| --- | --- |
| Proyectos | GET/POST `/projects`, GET/PATCH `/projects/:id` |
| Registros del proyecto | POST `/projects/:id/entries`, PATCH/DELETE `/projects/:id/entries/:entryId` |
| Actividad y entregas | GET `/projects/:id/activity`, GET `/projects/:id/deliveries` |
| Reprogramación de dependientes | POST `/projects/:id/reschedule` |
| Agenda | GET `/projects/agenda` |
| Consultar/revocar conexiones | GET/DELETE `/projects/access` |
| Conexión ChatGPT | POST `/projects/access-code` |

Herramientas MCP:

- `list_projects`, `get_project`, `create_project`, `update_project`.
- `get_agenda`, `get_statistics`, `get_activity`, `reschedule_dependencies`, `delete_entry`.
- `create_task`, `update_task`.
- `create_note`, `update_note`.
- `create_document`, `update_document`.
- `create_event`, `update_event`.
- `create_reminder`, `update_reminder`.
- `create_purchase`, `update_purchase`.
- `create_inventory`, `update_inventory`.

Completar una tarea usa `update_task` con `status=done`. Consultar un proyecto devuelve registros, dependencias y bloqueos, por lo que no se requiere navegar por la interfaz. Los resultados incluyen JSON estructurado. Las ediciones necesitan la versión leída. Archivar y borrar requieren confirmación explícita; el borrado de registros es lógico y el historial conserva los datos anteriores.

El transporte es MCP Streamable HTTP con el SDK oficial. OAuth admite registro dinámico de cliente, PKCE S256, tokens opacos con hash en la base, audiencia/recurso específico, los tokens de acceso duran una hora y refresh rotatorio sin caducidad automática. Los códigos son de un solo uso. Los permisos `projects:read` y `projects:write` se comprueban en cada llamada. El MCP exige OAuth con alcance y propietario. La API web conserva el modelo abierto de Bookshell y valida los datos de entrada y el origen de las escrituras del navegador. Los logs registran método, ruta sin parámetros, estado HTTP y duración; los errores internos usan un identificador de diagnóstico y no devuelven secretos.

## Añadir el servidor en ChatGPT

Procedimiento contrastado con el formulario de ChatGPT y la [guía oficial de conexión](https://developers.openai.com/plugins/deploy/connect-chatgpt):

1. Abre https://chatgpt.com/plugins con tu sesión iniciada.
2. Pulsa Añadir → Añadir servidor MCP personalizado.
3. Nombre: `Bookshell Proyectos`.
4. URL del servidor: `https://mcp-bookshell.charlydob.com/mcp`.
5. Autenticación: OAuth. En ajustes avanzados, comprobar detección automática y Registro dinámico de clientes (DCR). No introducir claves ni secretos manualmente. Permisos: `projects:read` y `projects:write`.
6. Revisa la advertencia y, si estás de acuerdo, pulsa Crear como complemento y después Conectar Bookshell Proyectos.
7. Abre Proyectos directamente desde Bookshell, igual que Finanzas o Libros. Funciona en la web, móvil y PWA sin un paso de activación. La conexión ya creada con ChatGPT se renueva con refresh token rotatorio; puedes revocarla desde Proyectos → ChatGPT.
8. Comprueba que ChatGPT descubre las 23 herramientas. Selecciona el complemento escribiendo `@` en el cuadro de mensaje y eligiendo Bookshell Proyectos.
9. Prueba primero «Consulta HOOKBOX y dime tareas, bloqueos y progreso, distinguiendo fabricación». Después crea un proyecto de prueba con una tarea y una nota, edítalos y verifica los cambios en Bookshell. No dar por válida la integración solo porque el formulario haya guardado la URL.

Si el formulario no carga la URL de retorno o la configuración OAuth después de iniciar sesión, recarga ChatGPT y reabre el formulario. En esta sesión la recarga resolvió un fallo inicial y permitió la detección automática.

Para desconectar, usa la gestión de complementos de ChatGPT o Proyectos → ChatGPT → Revocar conexiones MCP. Bookshell no mantiene una sesión separada para Proyectos. Revocar el conector OAuth no afecta el uso directo de la aplicación.

## Pruebas y evidencias

- Sintaxis de la API, módulo y JavaScript de interfaz: correcta. La interfaz estática no necesita una compilación de framework.
- `npm ci`: 241 paquetes, auditoría sin vulnerabilidades en la fecha del despliegue.
- Diez archivos de regresión anteriores y cinco pruebas nuevas de dominio: correctos, 15 resultados del runner, sin fallos.
- Diecisiete comprobaciones de integración sobre el HTTPS público: correctas. Incluyen descubrimiento, DCR, PKCE, rechazo de callback externo, audiencia incorrecta y reutilización de código; inicialización y 23 herramientas; CRUD, notas/documentación/eventos/recordatorios/compras/inventario; progreso y bloqueos; aislamiento por propietario; concurrencia; plantillas; reprogramación; confirmaciones; protección CSRF; solo lectura; refresh/revocación y envío programado sin duplicación. La prueba adicional verifica códigos de conexión de un solo uso, caducidad, separación de propósito y rechazo del acceso por contraseña antigua.
- Pruebas de interfaz reales: tarea temporal, actualización 0→13 % de ocho tareas, disminución de bloqueos, gráfico y Kanban coherentes; fecha guardada visible en calendario y cronograma; documentación con tabla y diagrama Mermaid; escritorio y móvil de 390×844, sin desbordamiento horizontal. Las mutaciones de interfaz se hicieron con un propietario temporal aislado, no en HOOKBOX del propietario real.
- Reinicio del contenedor: HOOKBOX conserva ocho tareas pendientes y fabricación desconocida. Cuenta, sesiones y datos persistentes sobreviven al reinicio.
- Regresión de datos: notas, libros y finanzas iguales a la copia previa mediante hashes del JSON correspondiente. Se mantienen las 74 filas antiguas de recordatorios. `/data/notes`, `/reminders` y `/health` responden correctamente. Notas antiguas y su calendario de recordatorios también se abrieron desde la interfaz.
- Fuente de servidor nueva: bloqueada por Caddy en el sitio estático.
- Copia de seguridad restaurada con éxito en una base temporal y cotejada con los datos actuales.
- ChatGPT: lectura real de HOOKBOX con ocho tareas, cero completadas, seis bloqueadas y avance físico desconocido. Escritura real del proyecto «Verificación MCP — 27/10/2026», archivado desde su creación, con una tarea creada y completada y una nota persistida. Relectura desde ChatGPT y verificación independiente en PostgreSQL correctas. [Conversación de prueba](https://chatgpt.com/c/6ae0de79-8684-83eb-9b29-e7307987478e).
- Identificadores de la prueba: proyecto `660a5921-af15-4e62-81dd-2a9c62ba12ba`; tarea `7273efa1-fb1d-4e98-bc50-38b32ed9c2d4`, versión 2 y estado done; nota `3f269bea-547a-4286-8374-14cca655ea04`. El proyecto real HOOKBOX no cambió.
- Pendiente de comprobación física: recepción de notificaciones push en un dispositivo del usuario. No se ha afirmado que esa recepción esté verificada.

La prueba de navegador detectó dos detalles que el cliente técnico por sí solo no mostraba: formularios de navegación que envían Origin:null por la política de referrer, y el retorno OAuth externo restringido por CSP. Se mantuvo la protección por nonce HttpOnly de la solicitud de un solo uso y se permitió expresamente el destino verificado `https://chatgpt.com` en form-action. Después de esas correcciones, la autorización y las operaciones reales de ChatGPT funcionaron.

Capturas de escritorio, móvil y conexión: carpeta local de entrega `deliverables/Bookshell-Proyectos`. No contienen contraseñas. Las capturas de Notion Life OS y Finance Tracker mencionadas en el encargo no estaban entre los archivos adjuntos disponibles; se siguió la descripción visual oscura con acentos verdes.

## Copia y rollback

Copia previa en Hetzner: `/opt/backups/bookshell-projects-20261027T164144Z`, acceso root 0700. Incluye código, configuración Caddy, compose y volcado PostgreSQL en formato custom.

SHA-256 del volcado: `e786bcdf11a1e8dff267ed7cc849e7f28d52bf751d181ad141c880a01ad3c639`.

SHA-256 del archivo de código: `b04d6d74f55ee39100f34f83c698023396f9df24425279236424cbb89d666f48`.

Rollback de código y proxy, conservando todas las tablas y datos nuevos:

```bash
bash /opt/bookshell/beta-clean/projects/rollback.sh /opt/backups/bookshell-projects-20261027T164144Z
```

El script guarda una copia adicional de la base actual y los archivos operativos, valida el Caddy anterior, restaura el código/configuración anteriores y recrea solo la API de Bookshell. No elimina tablas ni datos nuevos y no reinicia otros servicios. Como restaura la configuración de la fecha de la copia, revisa antes cualquier cambio posterior de Caddy/compose. No se ejecutó sobre producción, pues retiraría el módulo desplegado.

Para volver atrás permanentemente en el repositorio hay que revertir los commits de esta función antes del siguiente despliegue automático. El workflow existente de GitHub ejecuta `update-bookshell`, que toma `origin/main`, aplica migraciones y recrea la API. No restaurar el volcado completo sobre producción salvo recuperación de datos expresamente decidida; sobrescribiría cambios posteriores de otros módulos.

El desarrollo y las pruebas reproducibles se mantienen en `projects/integration-test.js` y `tests/projects-domain.test.mjs`. La integración crea cuentas temporales aisladas y elimina exclusivamente sus filas al finalizar. La migración `20261027_projects.sql` es aditiva e idempotente.
