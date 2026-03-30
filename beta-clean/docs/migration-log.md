# Migration Log

## Paso 1

Archivo elegido: `scripts/path.js`

### Que hace ahora

- construye rutas de Firebase bajo `v2/users/{uid}`
- concentra aliases de modulos
- evita hardcodear paths en varios sitios

### Dependencias

- no depende del DOM
- no depende de Firebase directamente
- solo requiere un `uid`

### Que conviene conservar

- el esquema `v2/users/{uid}`
- la idea de aliases por modulo
- la API simple para construir rutas

### Que conviene limpiar

- nombre del archivo para que refleje mejor su funcion
- validaciones basicas de entrada
- separar mejor helpers internos y API publica
- documentacion mas util para la siguiente migracion

### Alcance de este paso

- crear carpeta limpia
- migrar el helper de rutas
- dejar preparado el punto de entrada de la nueva app

No se han migrado aun vistas, CSS de tabs ni render de UI.

## Paso 2

Archivo elegido: `scripts/firebase-shared.js`

### Que hace ahora

- inicializa Firebase una sola vez
- expone `app`, `auth`, `db` y `storage`
- sirve de punto compartido para toda la beta

### Dependencias

- SDK modular de Firebase por URL
- configuracion del proyecto actual
- futura integracion con paths `v2/users/{uid}`

### Que se conserva

- misma configuracion Firebase
- mismo patron de singleton con `getApps()` y `getApp()`
- mismos servicios base: app, auth, realtime database y storage

### Que se limpia

- separacion entre config y runtime
- helpers de auth extraidos a un modulo propio
- helper pequeno de database integrado con `app-paths.js`
- un punto de entrada unico desde `scripts/shared/firebase/index.js`

### Dependencias candidatas para migrar despues

- `scripts/auth.js`, porque ya puede apuntar al nuevo modulo compartido
- `scripts/app.js`, para consumir `onUserChange`, `getCurrentUserId` y refs de usuario sin acoplarse al archivo viejo

## Paso 3

Archivos elegidos: `index.html`, `styles/mainstyles.css` y el shell minimo de `scripts/app.js`

### Que se conserva

- nombres y ids de vistas top-level
- estructura base de `header`, `.view` y `.bottom-nav`
- estado inicial con `view-books`
- persistencia de vista por `localStorage` y hash

### Que se corrige

- `html` y `body` dejan de scrollear para evitar doble scroll
- la vista activa pasa a ser el unico contenedor con scroll vertical real
- solo una vista puede estar activa cada vez
- se anade una guarda de boot para evitar doble montaje del shell
- la navegacion cambia estado de vista y no monta capas nuevas

### Alcance excluido

- no se migra ninguna logica interna de tabs
- no se migran modales ni overlays funcionales
- no se migra render de contenido real de cada vista

## Paso 4

Ventanas candidatas revisadas primero:

- `view-videos-hub`: la mas encapsulada y con menor riesgo estructural
- `view-world`: manejable, pero depende de mapa, fetchs y sheet extra
- `view-games`: estructura visible sencilla, pero logica y modales mucho mas pesados

### Ventana elegida

`view-videos-hub`

### Motivo

- HTML top-level autocontenido
- CSS propio ya bastante aislado
- sin overlays pesados en la propia vista
- JS moderado y con un ciclo de vida claro

### Que se conserva

- HTML y clases originales de la ventana
- layout y copy visual
- tabs internas `list`, `detail` y `stats`
- persistencia y sync con Firebase para la propia vista

### Que se limpia

- HTML separado del shell general
- cache de DOM acotada a la raiz del modulo
- carga una sola vez del HTML y del JS
- guardas para no duplicar listeners ni montajes

### Riesgos evitados en esta pasada

- `index.html` gigante
- doble render de la vista al reentrar
- listeners duplicados por reinicializacion del modulo
- wrappers nuevos que alteren el scroll del shell

## Paso 5

Vista elegida despues de `view-videos-hub`:

`view-world`

### Motivo

- mas pequena y acotada que `media`, `videos`, `books`, `recipes`, `habits`, `gym` o `finance`
- logica visible concentrada en un solo modulo
- mejor candidata que `games` por riesgo estructural general

### Que se conserva

- HTML top-level original de la vista
- CSS propio de la pestaña casi literal
- logica de datos, filtros, timeline, watchlist y mapas
- ids y clases de la beta para mantener fidelidad

### Que se limpia

- HTML fuera del shell en `views/world.html`
- imports adaptados a la base limpia
- dependencias del modulo aisladas en su carpeta
- reentrada controlada mediante `onShow` para redimensionar el mapa sin reinicializar todo

### Garantias mantenidas

- una sola carga de HTML
- una sola inicializacion del modulo
- una sola vista activa en el shell
- sin listeners duplicados al volver a entrar
- sin crear un segundo scroll estructural

## Paso 6

Vista elegida:

`view-media`

### Motivo

- el usuario la ha priorizado explicitamente
- ya existe un patron modular probado en `videos-hub` y `world`
- la vista puede separarse sin tocar otras tabs

### Que se conserva

- HTML top-level real de la beta
- CSS del modulo practicamente literal
- logica existente de lista, charts, mapa y modales propios

### Que se limpia

- arranque del modulo desacoplado del autoejecutado original
- alta en el shell con carga unica de HTML/CSS/JS
- imports adaptados a `beta-clean`

### Nota de riesgo

`media` sigue siendo bastante mas compleja que `videos-hub` y `world`, asi que esta pasada prioriza espejo y estabilidad por encima de refactor interno.

## Paso 7

Vista elegida:

`view-gym`

### Motivo

- prioridad directa del usuario
- mejor mantener el runtime casi intacto para no introducir bugs funcionales

### Que se conserva

- HTML top-level real de la beta
- CSS del modulo
- runtime original casi literal

### Que se limpia

- entrada modular minima en `scripts/modules/gym/index.js`
- imports adaptados a `beta-clean`
- correccion estructural del scroll para evitar doble scroll entre `#view-gym` y `.gym-wrap.scroll`

### Garantia clave

En `beta-clean`, el scroll estructural de gym queda delegado a `.gym-wrap.scroll`, no al contenedor `.view`.

## Paso 8

Vista elegida:

`view-recipes`

### Motivo

- prioridad directa del usuario
- modulo grande, pero con una estrategia segura de importacion unica

### Que se conserva

- HTML real de la vista y sus modales principales
- CSS del modulo
- runtime original casi intacto

### Que se limpia

- integracion en el shell con carga unica
- imports adaptados a `beta-clean`
- dependencias del modulo aisladas en su propia carpeta

### Enfoque de riesgo

Igual que en `gym`, se prioriza espejo funcional sobre refactor interno para no abrir regresiones visuales o de comportamiento.

## Paso 9

Vista elegida:

`view-books`

### Motivo

- prioridad directa del usuario
- vista principal y buen candidato para seguir consolidando el patron modular

### Que se conserva

- HTML real de la vista con stats, calendario, lista y modales principales
- CSS original de libros como base del modulo
- runtime original casi intacto

### Que se limpia

- integracion en el shell con carga unica
- imports Firebase adaptados a `beta-clean`
- dependencias del modulo aisladas en su propia carpeta
- eliminada la navegacion global vieja y el registro duplicado del service worker

### Enfoque de riesgo

Se prioriza fidelidad visual y funcional del modulo original, tocando solo el acoplamiento estructural que chocaba con el shell ya migrado.

## Paso 10

Vista elegida:

`view-games`

### Motivo

- prioridad directa del usuario
- modulo con CSS propio y estructura top-level acotada, buen candidato para espejo conservador

### Que se conserva

- HTML real de la vista y sus modales principales
- CSS del modulo
- runtime original casi intacto

### Que se limpia

- integracion en el shell con carga unica
- imports adaptados a `beta-clean`
- helpers directos aislados en `scripts/modules/games/`
- arranque ajustado para no depender de `auth.currentUser` resuelto en el momento del import

## Paso 11

Vista elegida:

`view-finance`

### Motivo

- prioridad directa del usuario
- modulo ya bastante separado en la beta original, adecuado para una migracion espejo muy fiel

### Que se conserva

- host HTML real de la vista
- CSS propio del modulo
- runtime original y submodulos internos

### Que se limpia

- integracion en el shell con carga unica
- imports adaptados a `beta-clean`
- uso del core Firebase compartido nuevo
- espera de sesion antes del `boot()` para no arrancar sin UID disponible

## Paso 12

Vista elegida:

`view-habits`

### Motivo

- prioridad directa del usuario
- modulo grande pero autocontenido, mejor candidato para espejo conservador que para refactor profundo

### Que se conserva

- HTML real de la vista y sus modales principales
- CSS del modulo
- runtime original casi intacto

### Que se limpia

- integracion en el shell con carga unica
- imports adaptados a `beta-clean`
- uso del core Firebase compartido nuevo
- arranque ajustado para no depender de `auth.currentUser` resuelto en el momento del import
- eliminado el hook viejo a `.nav-btn` para no duplicar renders con el shell actual
