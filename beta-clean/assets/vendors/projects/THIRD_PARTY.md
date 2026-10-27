# Browser dependencies for Projects

The checked-in browser files come from the corresponding packages pinned by `beta-clean/package-lock.json`:

- `marked.js`: `marked/lib/marked.esm.js`, MIT; see `MARKED-LICENSE.txt`.
- `purify.js`: `dompurify/dist/purify.es.mjs`, Apache-2.0 OR MPL-2.0; see `DOMPURIFY-LICENSE.txt`.
- `mermaid.js`: `mermaid/dist/mermaid.min.js`, MIT and bundled dependency notices retained in the distribution file.

Reproduce after `npm ci` by copying those files to this directory. Mermaid is loaded only when rendering a diagram. No external CDN is required.
