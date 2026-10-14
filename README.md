# Oráculo · Fase 1 (MVP, versión 6)

PWA con menú de tiradas, Arcano del año, Usuario (carta natal) y 3 mazos de tarot (78 cartas cada uno). Sin dependencias, sin build. Funciona offline.

## Correrla en tu compu

```bash
cd oraculo
python3 -m http.server 8000      # en Windows: python -m http.server 8000
```

Abrí http://localhost:8000. Para probar sin esperar a mañana: http://localhost:8000/?dev=1 (aparece "Barajar de nuevo").

## Publicarla (para instalarla en el celu)

La instalación requiere HTTPS. Lo más simple y gratis: **Netlify Drop** (app.netlify.com/drop, arrastrás la carpeta `oraculo`), GitHub Pages o Cloudflare Pages. `_headers` aplica los encabezados de seguridad en Netlify y Cloudflare.

**Cada vez que cambies archivos, subí `VERSION` en `sw.js`** (v9 → v10). Con conexión, la app siempre carga la última versión; sin conexión usa la guardada.

## Dónde editar cada cosa

| Qué | Archivo |
|---|---|
| Las 78 cartas de cada mazo: nombre, significados, palabra única, imagen | `data/decks/<mazo>.json` |
| Lista de mazos del selector y mazo por defecto | `data/decks.json` |
| Mensajes de IA pre-generados (3 por carta y orientación). Valen para los 3 mazos | `data/messages/tarot.json` |
| **Tus mensajes (pisan a los de la IA)** | `data/human/tarot.json` |
| Tiradas del menú y sus posiciones | `data/spreads.json` |
| Textos de la Carta natal (22 arcanos, luz/sombra) | `data/arcanos.json` |
| **Tus textos de Carta natal (pisan a los anteriores)** | `data/human/arcanos.json` |
| Cálculo de los arcanos (reglas de tus apuntes) | `js/natal.js` |
| Probabilidad de carta invertida, banderas futuras | `js/config.js` |
| Colores y estilo | `css/styles.css` |

### La palabra de cada carta

Cada carta muestra una sola palabra: `word` (derecha) o `wordReversed` (invertida) en `rider-waite.json`. Cambiala ahí si querés otra. Las `keywords` quedan guardadas para usos futuros (buscador, combinaciones).

### Activar una tirada

En `data/spreads.json`, cambiá `"enabled": false` por `true`. Las posiciones (`positions`) son editables: agregá o quitá cartas y renombralas. Si una tirada es `"daily": true`, el resultado se guarda hasta medianoche.

### Cargar tus propios mensajes

En `data/human/tarot.json`, dentro de `"messages"`:

```json
"messages": {
  "rw-00": { "upright": ["Tu mensaje para El Loco derecho"], "reversed": ["Tu mensaje invertido"] }
}
```

Los ids son universales: la misma carta tiene el mismo id en todos los mazos de tarot (aunque empiecen con `rw-`). Mayores `rw-00` a `rw-21`; menores `rw-b01`…`rw-b10`, `rw-bpj` (paje), `rw-bcb` (caballero), `rw-brn` (reina), `rw-bry` (rey); la letra es el palo: **b**astos, **c**opas, **e**spadas, **o**ros.

Prioridad: tu mensaje > mensaje de IA > significado base de la carta.

## Mazos

- **Rider-Waite-Smith** (1909, alta calidad), **Tarot de Marsella** y **Tarot de Viéville** (c. 1650): todos de dominio público. Créditos en Usuario → "Créditos de los mazos".
- **Mazo favorito**: se elige en Usuario y es el que se usa por defecto (también para las cartas de la carta natal y el Arcano del año).
- **En cada tirada** hay un botón chico "Mazo: …" para cambiar de mazo solo esa vez.
- La **carta del día queda grabada con el mazo que la sacó** hasta medianoche, aunque cambies el favorito.
- Los mazos se descargan la primera vez que se eligen y quedan guardados para usar sin conexión.
- Marsella y Viéville tienen su propia numeración (en Marsella VIII = Justicia, XI = Fuerza; en Viéville VII = Justicia, VIII = Carro, IX = Fuerza, XI = Ermitaño); internamente cada carta conserva su id universal.
- Para agregar un mazo: imágenes en `img/decks/<id>/` (nombres `00`…`21`, `b01`…`b10`, `bpj`, `bcb`, `brn`, `bry`, y lo mismo para `c`, `e`, `o`), un `data/decks/<id>.json` y una entrada en `data/decks.json`.

## Barajar, cortar y elegir

Al tocar el mazo se baraja (solo movimientos laterales), el mazo se corta en dos y la persona elige uno; recién ahí se revelan las cartas.

## Menú: Arcano del año y Usuario

Los dos van siempre al final del menú (se definen en `data/spreads.json` con `kind: "year"` y `kind: "user"`).

- **Usuario**: pide nombre y fecha de nacimiento (se guardan **solo en el dispositivo**; se pueden editar o borrar). Muestra la **carta natal** en lista: cada fila dice, por ejemplo, "Arcano del Alma · 10 La Rueda de la Fortuna" y al tocarla se despliega el mensaje completo con luz y sombra. Calcula Alma, Personalidad, Don Divino, Vidas Pasadas y Misión de Vida (= Arcano Personal) y avisa si un arcano se repite.
- **Arcano del año**: sin barajar. Muestra la carta en grande, su palabra y un **mensaje fijo para el año** (campo `anio` de cada arcano en `data/arcanos.json`). Usa el año calendario en curso; si todavía no hay datos, los pide primero.
- Numeración de Marsella de tus apuntes (8 = Justicia, 11 = Fuerza), con arte Rider (en la lámina, Justicia lleva XI).
- Para cambiar un texto (esencia, luz, sombra o mensaje del año): copiá su bloque de `data/arcanos.json` a `data/human/arcanos.json` y editalo; el tuyo pisa al original.

## Diseño y fuentes

Tema terciopelo (violeta, dorado, negro, toque rubí) al final de `css/styles.css`: los colores están en las variables de `:root`. Fuentes guardadas en `fonts/`, todas con licencia OFL (uso comercial permitido, licencias incluidas): **Cinzel Decorative** (títulos), y **Cormorant Garamond** (mensajes y textos de apoyo).

## Animaciones

Si tu sistema tiene desactivadas las animaciones (Windows: Configuración → Accesibilidad → Efectos visuales), la app usa una versión suave con fundidos, sin giros ni desplazamientos.

## Arquitectura (pensada para crecer)

- **Jerarquía de mensajes** (`js/messages.js`): humano > IA pre-generado > IA en vivo (apagada).
- **Mazos y tiradas son datos**: agregar un mazo = JSON con el mismo id + carpeta de imágenes; el selector llega en Fase 2.
- **Fase 5 lista para enchufar**: `CONFIG.features` (login, premium, booking, liveAI) apagado; los mazos tienen campo `premium`.
- **Mensajes en vivo**: cuando llegue, va por un backend tuyo; **nunca** pongas una API key en el navegador.

## Seguridad incluida

- CSP estricta (solo recursos propios, sin scripts inline) en `index.html` y `_headers`.
- Todo texto se inserta con `textContent` (sin `innerHTML`): no hay inyección de HTML.
- Datos validados antes de usarse (mazo, tiradas, rutas de imagen, registro diario).
- Solo se guarda en el dispositivo la carta del día y tu perfil (nombre y fecha); sin cuentas, sin analítica, sin envío de datos. El perfil pasa por un único módulo (`storage.js`) para cambiarlo cuando haya login.
- El service worker solo toca recursos de tu mismo origen.

## Contenido y legal

- Ilustraciones: Rider-Waite-Smith (Pamela Colman Smith, 1909), dominio público. Textos: originales de este proyecto, escritos con tus apuntes como guía de enfoque.
- Aviso de entretenimiento en el pie de la app.


## v7
- Selector de mazo ("Mazo: X ▾") en todos los módulos: tirada, resultado ya sacado y Arcano del año. Arranca con el favorito de Usuario y se cambia por separado; cambia solo el diseño (la carta y el mensaje se mantienen).
- Usuario: datos centrados, texto del menú genérico, y la miniatura del arcano aparece arriba al centro al desplegar (siempre con el mazo favorito).
- sw.js VERSION v10.


## v8
- Mensajes de las 78 cartas reescritos: 10 por carta (5 al derecho + 5 invertidos), basados en TAROT - RESUMEN. Cinco ángulos fijos por orientación: mensaje central, otra cara, cierre poético, símbolo y acción del día. Sin predicciones de salud, dinero ni temas legales.
- Los mensajes son compartidos por los tres mazos (los símbolos de las cartas menores son neutros, sin escenas propias de un solo mazo).
- sw.js VERSION v11.


## v9
- Menú principal: Carta del día · Tiradas · Arcano del año · Usuario. "Tiradas" abre un submenú con las demás tiradas (hoy sin habilitar, se muestran como "Próximamente").
- Para sumar una tirada al submenú: agregala en data/spreads.json con "group": "tiradas". Para activarla, "enabled": true. El botón de volver desde una tirada del submenú regresa a Tiradas.
- sw.js VERSION v12.


## v10
- Nueva tirada "Sí o No" (dentro de Tiradas): una carta y una respuesta directa, sin mensaje. Escala: Sí · Probablemente sí · Quizás sí · Quizás · Todavía no · Probablemente no · No.
- Cada carta tiene su respuesta al derecho y al revés en data/answers/tarot.json (códigos: si, ps, qs, q, tn, pn, n).
- Tus respuestas propias van en data/human/answers.json (formato en el archivo) y pisan a las de la IA.
- sw.js VERSION v13.


## v11
- Respuestas de Sí o No rehechas a partir del significado de cada carta (fluido al derecho, estancado invertida), sin ajustar proporciones.
- Se agregó SUBIR-A-GITHUB.md con los pasos para publicar en GitHub Pages y verla desde el celular.
- sw.js VERSION v14.


## v12
- Administrador local con PIN (6 a 12 números) que se crea en cada dispositivo. Se entra con 5 toques seguidos en el título "Oráculo" o abriendo la dirección con `#admin`.
- Herramientas: reiniciar la carta del día, cambiar PIN, cerrar sesión. Con la sesión abierta, la carta del día muestra "Barajar de nuevo" (se quitó el modo `?dev=1`).
- El PIN se guarda con hash (PBKDF2-SHA256, sal propia) y hay espera tras 5 intentos fallidos. Es una protección local: no reemplaza cuentas reales con servidor.
- sw.js VERSION v15.


## v13
- Carga más rápida: las imágenes de las cartas ya no se descargan todas al instalar; se guardan a medida que se usan y el mazo elegido se baja en segundo plano. Código y datos abren desde el caché y se actualizan solos. Se piden en paralelo el mazo y los mensajes, y se precargan módulos y fuentes.
- "Para instalarla..." y "Instalar app" solo aparecen en la pantalla principal y en Usuario.
- Mazo favorito (Usuario) ahora es un desplegable: muestra solo el elegido con una flecha.
- Sí o No: la carta aparece directo al terminar de barajar (sin cortar el mazo). Se controla con `"cut": false` en data/spreads.json.
- sw.js VERSION v16.

## v14
- Mazo favorito: la lista del desplegable muestra solo los mazos que no están elegidos. sw.js VERSION v17.

## v19 · Tirada de 3 cartas con abanico
- Tiradas → "Tirada de 3 cartas": se elige el tema (Vida, Amor, Trabajo, Autoconocimiento, Mente cuerpo y espíritu), se baraja y aparece un abanico con las 78 cartas. Se desliza el dedo (o el mouse) para levantar una carta y al soltar queda elegida; se repite 3 veces. También hay botón "Que elija el azar" y control con teclado (flechas + Enter).
- Textos en `data/tiradas/tres-cartas.json` (posiciones, encuadres y cierres). Tus textos propios van en `data/human/tres-cartas.json` y pisan a los automáticos.
- Aviso "versión nueva": banner cuando el service worker se actualiza.
