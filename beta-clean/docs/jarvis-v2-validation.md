# Validación de la primera vertical

29/10/2026. Base main 6d106995109035988396649c8b740cf867801059.

Resultado final: 47 resultados de prueba correctos, cero fallos y cero omitidos.

- 6 pruebas unitarias nuevas: contratos, unidades/objetivos, selección de días, unión de intervalos, DST y contratos futuros de descanso/personas.
- 17 pruebas nuevas de integración PostgreSQL/HTTP MCP: permisos, usuario desactivado, propietario, revisiones, idempotencia, incrementos concurrentes, sesiones simultáneas, pausa/reanudación, medianoche, avisos, operaciones compuestas, OAuth/PKCE/ticket limitado, lectura desde función web nativa, migración Telegram y separación de canales.
- 24 resultados de regresión en ocho archivos existentes: JARVIS anterior, dominio Proyectos, planificación, notificaciones, recordatorios, scheduler Web Push, Atajos y exportación. Algunos archivos ejecutan múltiples casos internamente.

La integración utilizó el SDK MCP real mediante HTTP con tokens ficticios de QA, no llamadas directas como sustituto del transporte. Se comprobó creación, registro y lectura posterior; las llamadas repetidas por transporte no duplican el valor. OAuth se probó mediante autorización y canje con PKCE y rechazo de escalada de permisos.

El PostgreSQL es una instancia temporal separada, sin acceso de red externo ni puertos publicados, base bookshell_qa y datos sintéticos. La suite crea/elimina su propio esquema y rechaza otros nombres de base. Los envíos Web Push son simulados; no se envían notificaciones personales.

La lectura de tiempo finalizado también se comprobó ejecutando la función nativa de lectura de Hábitos sobre datos persistidos por el servicio. Eso verifica el formato de datos, no una prueba de navegador ni controles web de sesiones activas.

Se reprodujo por separado la ambigüedad del matcher Python antiguo: dos nombres equivalentes por acentos producen una selección arbitraria sin candidatos ambiguos. No se utilizó Python como dependencia de JARVIS 2.0.

No se modificó la base personal ni se desplegó código. La conexión ChatGPT de producción permanece en las 23 herramientas actuales. Faltan autorización de producción, frontera privada del acceso web, concurrencia frente a ediciones web/offline obsoletas, controles web de sesiones nuevas y verificación del dispositivo real. El detalle está en jarvis-v2.md y el procedimiento Telegram en jarvis-v2-telegram.md.
