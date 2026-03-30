# Bookshell Clean Beta

Base de migracion espejo de la beta actual.

Objetivos de esta carpeta:

- no tocar la beta original
- migrar archivo a archivo
- mantener la UX y la logica existentes mientras saneamos estructura
- usar ES modules sin frameworks
- separar lo compartido de lo especifico por modulo

## Estructura inicial

```text
beta-clean/
  index.html
  README.md
  docs/
    migration-log.md
  styles/
    core/
      base.css
      shell.css
    modules/
      books.css
      finance.css
      games.css
      habits.css
      gym.css
      media.css
      recipes.css
      videos-hub.css
      world.css
  scripts/
    app/
      main.js
    modules/
      books/
        countries.js
        index.js
        runtime.js
        world-heatmap.js
      finance/
        finance/
          data.js
          import.js
          state.js
          ui.js
        index.js
        runtime.js
      habits/
        export-utils.js
        index.js
        runtime.js
        schedule-credits.js
        time-by-habit.js
      games/
        export-utils.js
        index.js
        range-helpers.js
        runtime.js
      gym/
        index.js
        met-catalog.js
        runtime.js
      media/
        index.js
        tmdb.js
      recipes/
        countries.js
        finance-data.js
        foodrepo.js
        index.js
        met-catalog.js
        runtime.js
        world-heatmap.js
      world/
        countries.js
        index.js
        world-heatmap.js
      videos-hub/
        index.js
    shared/
      config/
        app-paths.js
      firebase/
        app.js
        auth.js
        config.js
        database.js
        index.js
  views/
    books.html
    finance.html
    games.html
    habits.html
    gym.html
    media.html
    recipes.html
    videos-hub.html
    world.html
```

## Criterio de organizacion

- `scripts/app/`: arranque, shell y coordinacion general
- `scripts/shared/`: utilidades realmente compartidas entre tabs
- `scripts/modules/`: codigo especifico de cada area de la app
- `styles/core/`: base comun
- `styles/modules/`: CSS por modulo o feature
- `docs/`: decisiones pequenas de migracion y alcance por paso

## Primer archivo migrado

Se empieza por `scripts/path.js` -> `scripts/shared/config/app-paths.js`.

Segundo paso:

- `scripts/firebase-shared.js` -> `scripts/shared/firebase/`
- separando inicializacion, auth, database y config
- manteniendo el mismo proyecto Firebase y el mismo esquema de datos

Tercer paso:

- shell base espejo de la beta en `index.html`
- CSS critico de layout en `styles/core/base.css` y `styles/core/shell.css`
- logica minima de shell en `scripts/app/main.js`
- una sola vista activa y un unico scroll real en la `.view` activa

Cuarto paso:

- primera ventana simple migrada: `view-videos-hub`
- HTML segmentado en `views/videos-hub.html`
- CSS propio en `styles/modules/videos-hub.css`
- JS propio en `scripts/modules/videos-hub/index.js`
- carga del modulo una sola vez desde el shell

Quinto paso:

- segunda vista simple migrada: `view-world`
- HTML segmentado en `views/world.html`
- CSS propio en `styles/modules/world.css`
- JS propio en `scripts/modules/world/index.js`
- dependencias directas locales del modulo: `countries.js` y `world-heatmap.js`

Sexto paso:

- tercera vista migrada: `view-media`
- HTML segmentado en `views/media.html`
- CSS propio en `styles/modules/media.css`
- JS propio en `scripts/modules/media/index.js`
- dependencia directa local del modulo: `tmdb.js`

Septimo paso:

- cuarta vista migrada: `view-gym`
- HTML segmentado en `views/gym.html`
- CSS propio en `styles/modules/gym.css`
- JS de entrada en `scripts/modules/gym/index.js`
- runtime original conservado en `scripts/modules/gym/runtime.js`

Octavo paso:

- quinta vista migrada: `view-recipes`
- HTML segmentado en `views/recipes.html`
- CSS propio en `styles/modules/recipes.css`
- JS de entrada en `scripts/modules/recipes/index.js`
- runtime original conservado en `scripts/modules/recipes/runtime.js`

Noveno paso:

- sexta vista migrada: `view-books`
- HTML segmentado en `views/books.html`
- CSS propio en `styles/modules/books.css`
- JS de entrada en `scripts/modules/books/index.js`
- runtime original conservado en `scripts/modules/books/runtime.js`
- dependencias directas locales del modulo: `countries.js` y `world-heatmap.js`
- eliminada la navegacion global vieja del modulo para no duplicar listeners con el shell

Decimo paso:

- septima vista migrada: `view-games`
- HTML segmentado en `views/games.html`
- CSS propio en `styles/modules/games.css`
- JS de entrada en `scripts/modules/games/index.js`
- runtime original conservado en `scripts/modules/games/runtime.js`
- helpers locales copiados: `range-helpers.js` y `export-utils.js`
- arranque adaptado para esperar sesion Firebase sin rehacer la logica del modulo

Undecimo paso:

- octava vista migrada: `view-finance`
- HTML segmentado en `views/finance.html`
- CSS propio en `styles/modules/finance.css`
- JS de entrada en `scripts/modules/finance/index.js`
- runtime original conservado en `scripts/modules/finance/runtime.js`
- estructura interna del modulo preservada en `scripts/modules/finance/finance/`
- arranque adaptado a `beta-clean` para usar Firebase compartido y esperar sesion antes del boot

Duodecimo paso:

- novena vista migrada: `view-habits`
- HTML segmentado en `views/habits.html`
- CSS propio en `styles/modules/habits.css`
- JS de entrada en `scripts/modules/habits/index.js`
- runtime original conservado en `scripts/modules/habits/runtime.js`
- helpers locales copiados: `time-by-habit.js`, `export-utils.js` y `schedule-credits.js`
- arranque adaptado para usar Firebase compartido, esperar sesion y evitar el hook viejo a `.nav-btn`

Motivos:

- es pequeno y transversal
- no fuerza cambios visuales
- ayuda a centralizar rutas y compatibilidad de datos
- permite fijar una convencion para los siguientes modulos
