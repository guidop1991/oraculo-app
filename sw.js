// Service worker: la app funciona sin conexión.
// IMPORTANTE: cada vez que publiques cambios, subí el número de VERSION.
const VERSION = "v17";
const CACHE = `oraculo-${VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/config.js",
  "js/storage.js",
  "js/admin.js",
  "js/messages.js",
  "js/natal.js",
  "data/decks.json",
  "data/decks/rider-waite.json",
  "data/decks/marsella.json",
  "data/decks/vieville.json",
  "data/messages/tarot.json",
  "data/human/tarot.json",
  "data/answers/tarot.json",
  "data/human/answers.json",
  "data/spreads.json",
  "data/arcanos.json",
  "data/human/arcanos.json",
  "fonts/CinzelDecorative-Bold.woff",
  "fonts/CormorantGaramond.woff",
  "fonts/CormorantGaramond-Italic.woff",
  "img/back.webp",
  // Las imágenes de las cartas NO se descargan al instalar (así la app abre más rápido):
  // se guardan solas a medida que se usan y el mazo elegido se baja en segundo plano.
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("oraculo-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // nunca tocamos terceros

  // Navegación: la página guardada abre al instante y se actualiza en segundo plano.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("index.html").then((hit) => {
        const net = fetch("index.html", { cache: "no-cache" })
          .then((res) => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); }
            return res;
          })
          .catch(() => hit || Response.error());
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net;
      })
    );
    return;
  }

  const isMedia = /\.(webp|png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname);

  // Imágenes: del caché (no cambian seguido).
  if (isMedia) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Código y datos: del caché al instante y, en segundo plano, se actualiza para la próxima vez
  // (cada publicación sube VERSION, y eso renueva todo de una).
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => hit || Response.error());
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })
  );
});
