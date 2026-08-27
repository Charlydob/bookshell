# beta-clean

Versión activa del proyecto **Bookshell**.

## Estructura

- `index.html`: shell principal y arranque.
- `views/`: HTML por módulo.
- `styles/core` y `styles/modules`: estilos base y por módulo.
- `scripts/app`: bootstrap, navegación y sesión.
- `scripts/modules`: lógica funcional por módulo.
- `scripts/shared`: utilidades y adaptadores compartidos (Firebase/config).

## Web Push base (despliegue)

La migración idempotente está en `db/migrations/20260827_web_push_base.sql` y las
dependencias del backend en `package.json`. El actual script `update-bookshell` no
está versionado en este repositorio, por lo que no se presupone que aplique ninguna
de las dos cosas.

En el servidor hay un único paso de configuración: generar una vez las claves con
`npx web-push generate-vapid-keys`, guardar `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` y `VAPID_SUBJECT=https://bookshell.charlydob.com` en el entorno
persistente del contenedor API, instalar con `npm ci` (o `npm install` si todavía
no existe lockfile), aplicar la migración con `psql -v ON_ERROR_STOP=1` y recrear
solo el servicio API. La clave privada nunca se sirve ni pertenece al frontend.
No se debe modificar `BOOKSHELL_AUTOMATION_SECRET`.

## Entrada de la app

- Entrada web raíz: `../index.html` (redirige a `./index.html`).
- Entrada principal: `beta-clean/index.html`.
