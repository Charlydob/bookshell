# Retirada de Telegram: plan y resultado de preparación

Estado: no se ha desactivado ningún workflow ni borrado ningún recurso de producción. El encargo exige autorización antes de alterar la base real o desplegar.

## Inventario comprobado

Bookshell tiene tres workflows: Reminders v4 PostgreSQL y v4 FIXED PostgreSQL están inactivos; v4.4.1 LOGICA + VOZ READY está activo, con 16 nodos Telegram/Telegram Trigger y una credencial Telegram referenciada. La misma credencial está referenciada por los tres workflows Bookshell. No se descifró ni imprimió su token.

El sistema n8n tiene tres credenciales telegramApi: una para Bookshell, otra usada por seis versiones de workflows HotelApp y otra por Inventario personal. También están activos un workflow HotelApp y uno Inventario. No se deben eliminar n8n, sus tablas, sus credenciales ajenas ni reiniciar servicios compartidos para retirar Bookshell.

No se verificó mediante Telegram la existencia o estado del bot remoto; requeriría acceso explícito a la API/BotFather. No se asume que eliminar una credencial local elimine un bot remoto.

El workflow Bookshell activo recibe comandos Telegram y crea, consulta, cancela recordatorios y añade alertas. Además sondea due y confirma sent/failed. Las funciones equivalentes de programación y entrega existen en Bookshell mediante scheduler/Web Push. Los comandos conversacionales se trasladan progresivamente a MCP: esta entrega añade hábitos/tiempo, no todas las herramientas de recordatorios personales del bot.

Snapshot de solo lectura de alertas antiguas: 1 pendiente, 60 enviadas, 39 canceladas y 9 fallidas, todas etiquetadas telegram y ninguna bloqueada. Hay 2 suscripciones push activas. Ninguna pendiente carece de una suscripción del propietario asociado por firebase_uid. Esto demuestra persistencia y asociación, no recepción visible de un push. El snapshot puede cambiar: debe repetirse al cortar.

## Riesgo resuelto en el código candidato

La función claimDueReminderAlerts acepta canal explícito y filtra tanto expiraciones como reclamaciones. Con BOOKSHELL_EXPLICIT_NOTIFICATION_CHANNELS=1, el scheduler interno reclama webpush y el endpoint de automatización reclama telegram. El test PostgreSQL prueba que no consumen la fila del otro canal.

Con BOOKSHELL_TELEGRAM_RETIRED=1, las rutas /automation responden 410 antes de reclamar alertas, y la normalización/materialización de nuevas alertas usa webpush. No se borra historial ni se cambia la semántica de ocurrencias ya enviadas. Estos flags están desactivados por defecto y no se han configurado en producción.

jarvis/telegram-retirement.js ofrece plan de solo lectura y migrate con tres condiciones explícitas: autorización, workflow inactivo y Web Push verificado. La migración vuelve a comprobar suscripciones por propietario y ausencia de alertas reclamadas; copia canal anterior por alert_id y convierte únicamente pendientes telegram a webpush. No borra recordatorios, fallidos, cancelados, enviados, workflows ni credenciales. Es idempotente y transaccional; se probó en base aislada.

## Secuencia propuesta para el corte autorizado

1. Repetir inventario, identificar versiones y credencial exacta Bookshell; confirmar que sus referencias no se ampliaron.
2. Respaldar código, compose, Caddy y la base completa en ubicación protegida. Exportar de forma segura la configuración n8n pertinente, sin incorporarla a Git ni al informe.
3. Verificar una notificación Web Push en el dispositivo y constatar el diagnóstico de entrega. Comprobar permisos, suscripciones y scheduler. No confundir proveedor aceptado con aviso visto.
4. Desactivar solo el workflow Bookshell activo mediante la interfaz/API soportada de n8n; esperar a que terminen ejecuciones en curso y leases. No editar directamente active en SQL: no garantiza desregistrar el trigger ni parar ejecuciones.
5. Durante una ventana controlada, evitar que el worker antiguo reclame mientras se cambia el canal. Desplegar versión candidata con filtros explícitos y rutas retiradas; ejecutar migrate aprobado y comprobar todas las pendientes, fechas, recurrencias y recuentos contra respaldo.
6. Iniciar exclusivamente el scheduler Bookshell y probar creación, reprogramación, cancelación, recurrencia, reinicio y ausencia de duplicados. Comprobar que cada nueva alerta tiene canal webpush y que /automation ya no reclama.
7. Observar un ciclo real y conservar n8n desactivado, sus configuraciones y credencial durante el periodo de reversión.
8. Presentar aparte la lista concreta de bots, credencial Bookshell y tres workflows para autorizar su eliminación definitiva. Esta entrega no ejecuta esa eliminación.

Si no hay suscripción válida o el reemplazo no entrega correctamente, el corte no debe continuar. No se reactivan en bloque alertas failed/cancelled ni se reenvían avisos históricos.

## Reversión

Antes de enviar por el nuevo canal, se pueden restaurar canales pendientes desde jarvis_retired_alert_channels, con comprobación de que sigan pendientes/no reclamadas y no hayan sido editadas después del corte; restablecer código/flags y reactivar únicamente el workflow anterior. Después de una entrega, no restaurar una copia completa de DB ni repetir esa alerta: conservar el ledger de entregas y reconciliar individualmente. No se elimina ninguna tabla nueva durante rollback de código.

Límite conocido: el worker legacy conserva una ventana incierta si cae tras enviar y antes del ACK. Separar canales evita consumo equivocado; no equivale a garantizar exactly-once del proveedor. La entrega de hábitos reutiliza el motor por dispositivo que marca esos casos inciertos para no reenviarlos ciegamente.
