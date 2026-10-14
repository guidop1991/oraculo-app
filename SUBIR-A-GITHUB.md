# Cómo ver el Oráculo desde el celular (GitHub Pages)

1. Entrá a github.com → **New repository**. Nombre: `oraculo` (o el que quieras). Dejalo **Public** y creá el repo vacío.
2. En el repo: **Add file → Upload files**. Arrastrá el CONTENIDO de esta carpeta (index.html, sw.js, manifest.webmanifest, css, js, data, fonts, icons, img, README.md, _headers).
   - Si GitHub dice que son demasiados archivos, subí por tandas: primero todo menos `img`, y después `img/decks/rider-waite`, `img/decks/marsella` y `img/decks/vieville` de a una. En cada tanda, tocá **Commit changes**.
3. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. Esperá 1 o 2 minutos. Tu app queda en: `https://TU-USUARIO.github.io/oraculo/`
5. En el celular abrí ese link:
   - **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.
   - **iPhone (Safari):** botón Compartir → *Agregar a inicio*.

## Para actualizar después
Subí los archivos que cambiaron (reemplazan a los anteriores) y listo. En el celular, cerrá y volvé a abrir la app una o dos veces para que tome la versión nueva.

## Ojo
- El repositorio público muestra todos los archivos, incluidos tus mensajes. Los datos de las personas (nombre, fecha de nacimiento) se guardan solo en cada celular, no en GitHub.
- Antes de monetizar conviene pasar a Cloudflare Pages o Netlify.
