// Service worker: la app funciona sin conexión.
// IMPORTANTE: cada vez que publiques cambios, subí el número de VERSION.
const VERSION = "v15";
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
  ...Array.from({ length: 22 }, (_, i) => `img/decks/rider-waite/${String(i).padStart(2, "0")}.webp`),
  ...["b", "c", "e", "o"].flatMap((s) =>
    [...Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0")), "pj", "cb", "rn", "ry"].map((r) => `img/decks/rider-waite/${s}${r}.webp`)
  ),
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
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

  // Navegación: red primero con respaldo offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("index.html")));
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

  // Código y datos: red primero (así ves tus cambios al instante) y, sin conexión, el caché.
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
