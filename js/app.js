import { CONFIG, answersPaths, DECKS_PATH, deckPath, messagePaths, SPREADS_PATH, ARCANOS_PATH, ARCANOS_HUMAN_PATH, TRES_HUMAN_PATH } from "./config.js";
import {
  readDaily, writeDaily, clearDaily, readFavoriteDeck, writeFavoriteDeck, readBack, writeBack,
  readProfile, writeProfile, clearProfile, cleanName
} from "./storage.js";
import { carta, arcanoDelAnio, repetidos, NUMBER_TO_CARD, label, parseBirth } from "./natal.js";
import { resolveMessage, variantCount } from "./messages.js";
import * as admin from "./admin.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const IMG_OK = /^img\/[\w\-\/]+\.(webp|png|jpg|svg)$/; // solo imágenes propias del proyecto
const ID_OK = /^[\w\-]+$/;
const BACK_OK = /^img\/backs\/[\w\-]+\.svg$/; // dorsos propios del proyecto
const SHUFFLE_MS = 1700;
const DEFAULT_AR = [250, 429]; // proporción de carta si el mazo no indica otra

let decksMeta = [];           // lista del selector (data/decks.json)
let defaultDeckId = null;     // mazo favorito (o el que indica decks.json)
const deckCache = new Map();  // id -> mazo ya cargado y validado
const msgCache = new Map();   // family -> { ai, human }
let spreads = [];
let arcanos = { ai: null, human: null }; // textos de la Carta natal (humano > IA)
let current = null; // { spread, deck, data, picks }
let answersData = null; // { ai, human } respuestas sí/no del mazo en uso
const answersCache = new Map(); // family -> { ai, human }
const tresCache = new Map();    // family -> { ai, human } textos de la Tirada de 3 cartas
const tresNow = () => tresCache.get(current?.deck?.family);
let fanState = null;  // estado del abanico mientras se eligen las cartas
let yearState = null; // { profile, deck } del Arcano del año

// ---------- utilidades ----------
async function getJSON(url, optional = false) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

// Entero aleatorio uniforme en [0, n) con crypto (sin sesgo).
function randInt(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}

const validAspect = (a) => Array.isArray(a) && a.length === 2 && a.every((n) => Number.isFinite(n) && n > 0 && n < 100000);

const validDeck = (d) =>
  d && typeof d.id === "string" && ID_OK.test(d.id) && typeof d.family === "string" && ID_OK.test(d.family) &&
  Array.isArray(d.cards) && d.cards.length > 0 &&
  (d.aspect === undefined || validAspect(d.aspect)) &&
  d.cards.every((c) => c && typeof c.id === "string" && ID_OK.test(c.id) && typeof c.name === "string" &&
    typeof c.meaning === "string" && typeof c.reversed === "string" &&
    Array.isArray(c.keywords) && typeof c.image === "string" && IMG_OK.test(c.image));

const validDecksMeta = (m) =>
  m && Array.isArray(m.decks) && m.decks.length > 0 &&
  m.decks.every((x) => x && typeof x.id === "string" && ID_OK.test(x.id) && typeof x.name === "string" &&
    typeof x.short === "string" && (x.description === undefined || typeof x.description === "string") &&
    (x.credit === undefined || typeof x.credit === "string")) &&
  typeof m.default === "string" && m.decks.some((x) => x.id === m.default);

const validSpreads = (s) =>
  s && Array.isArray(s.spreads) && s.spreads.length > 0 &&
  s.spreads.every((x) => x && typeof x.id === "string" && /^[\w\-]+$/.test(x.id) &&
    typeof x.name === "string" &&
    (x.kind === "year" || x.kind === "user" || x.kind === "group" ||
      (typeof x.themesFile === "string" && /^data\/[\w\-\/]+\.json$/.test(x.themesFile)) || (Array.isArray(x.positions) && x.positions.length > 0 &&
      x.positions.length <= 78 &&
      x.positions.every((p) => p && typeof p.label === "string"))));

function showError(msg) {
  const e = $("error");
  e.textContent = msg;
  e.hidden = false;
}

const cardIn = (deck, id) => deck.cards.find((c) => c.id === id);
const wordFor = (card, reversed) =>
  (reversed ? card.wordReversed : card.word) || card.keywords[0] || "";
const metaOf = (id) => decksMetaById(id) || { short: id, name: id };
const decksMetaById = (id) => decksMeta.find((m) => m.id === id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ---------- mazos ----------
const earlyDecks = new Map(); // pedidos adelantados (en paralelo) durante el arranque

async function loadDeck(id) {
  if (deckCache.has(id)) return deckCache.get(id);
  if (!decksMetaById(id)) throw new Error("mazo desconocido");
  let d = earlyDecks.has(id) ? await earlyDecks.get(id) : null;
  if (!d) d = await getJSON(deckPath(id));
  if (!validDeck(d) || d.id !== id) throw new Error("mazo inválido");
  deckCache.set(id, d);
  return d;
}

const ANSWERS = {
  si: { text: "Sí", tone: "yes" },
  ps: { text: "Probablemente sí", tone: "yes" },
  qs: { text: "Quizás sí", tone: "maybe" },
  q:  { text: "Quizás", tone: "maybe" },
  tn: { text: "Todavía no", tone: "maybe" },
  pn: { text: "Probablemente no", tone: "no" },
  n:  { text: "No", tone: "no" }
};

async function loadAnswers(family) {
  if (answersCache.has(family)) return answersCache.get(family);
  const p = answersPaths(family);
  const [ai, human] = await Promise.all([getJSON(p.ai, true), getJSON(p.human, true)]);
  const a = { ai, human };
  answersCache.set(family, a);
  return a;
}

// Jerarquía igual que los mensajes: tu respuesta > la de la IA > "Quizás".
function answerFor(pick) {
  const o = pick.reversed ? "reversed" : "upright";
  for (const src of [answersData?.human, answersData?.ai]) {
    const code = src?.answers?.[pick.cardId]?.[o];
    if (typeof code === "string" && Object.hasOwn(ANSWERS, code)) return ANSWERS[code];
  }
  return ANSWERS.q;
}

async function loadMessages(family) {
  if (msgCache.has(family)) return msgCache.get(family);
  const p = messagePaths(family);
  const [ai, human] = await Promise.all([getJSON(p.ai, true), getJSON(p.human, true)]);
  const m = { ai, human };
  msgCache.set(family, m);
  return m;
}

// Dorso de las cartas: el de cada mazo o uno de los propios (preferencia guardada en el dispositivo).
const BACK_CHOICES = [
  { id: "deck", name: "El de cada mazo", desc: "Cada mazo con su dorso original." },
  { id: "yinyang", name: "Yin Yang", desc: "Blanco y negro." },
  { id: "luna", name: "Luna y estrellas", desc: "Violeta y dorado." },
  { id: "sol", name: "Sol", desc: "Dorado sobre noche profunda." }
];
let backPref = "deck";
const ownBack = (id) => `img/backs/${id}.svg`;
function backPath(deck) {
  const p = backPref !== "deck" && BACK_CHOICES.some((c) => c.id === backPref) ? ownBack(backPref) : deck.back;
  return BACK_OK.test(p) ? p : "img/back.webp";
}

// Proporción de las cartas del mazo (cada mazo tiene la suya) y dorso a usar.
function applyDeckLook(deck) {
  const [w, h] = validAspect(deck.aspect) ? deck.aspect : DEFAULT_AR;
  const root = document.documentElement.style;
  root.setProperty("--card-ar", `${w} / ${h}`);
  root.setProperty("--back-url", `url("${new URL(backPath(deck), location.href).href}")`);
}

// Deja las imágenes del mazo guardadas para usarlo sin conexión (de a pocas por vez).
async function prefetchDeck(deck) {
  if (!navigator.onLine) return;
  const urls = deck.cards.map((c) => c.image);
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try { await fetch(u); } catch { /* sin conexión: se reintenta otro día */ }
    }
  };
  await Promise.all([worker(), worker()]);
}

// Opciones de mazo (radios) para el selector de tirada y para "Mazo favorito".
// 'family' limita la lista a mazos de esa familia (ej. el favorito y el Arcano del año son solo de tarot).
const familyOfMeta = (m) => m.family || "tarot";
function renderDeckOptions(container, selectedId, onPick, hideSelected = false, family = null) {
  container.replaceChildren(...decksMeta.filter((m) => !m.hidden && !(hideSelected && m.id === selectedId) && (!family || familyOfMeta(m) === family)).map((m) => {
    const b = el("button", "deck-option");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === selectedId));
    b.dataset.deck = m.id;
    b.append(el("span", "deck-option-name", m.short), el("span", "deck-option-desc", m.description || ""));
    b.addEventListener("click", () => onPick(m.id));
    return b;
  }));
}

// ---------- vistas ----------
function showView(name, keepScroll = false) {
  hidePickers();
  $("install-box").hidden = !(name === "menu" || name === "user");
  const group = current?.spread?.group && spreads.find((s) => s.id === current.spread.group);
  for (const b of document.querySelectorAll("[data-go='origin']")) b.textContent = group ? `← ${group.name}` : "← Inicio";
  for (const v of ["menu", "group", "deck", "result", "profile", "user", "year", "admin"]) $("view-" + v).hidden = v !== name;
  if (!keepScroll) window.scrollTo(0, 0);
}

function menuItem(s) {
  const li = el("li");
  const b = el("button", "menu-item");
  b.type = "button";
  b.disabled = !s.enabled;
  const n = s.positions ? s.positions.length : 0;
  const count = s.kind === "group" ? spreads.filter((x) => x.group === s.id).length : 0;
  const meta = !s.enabled ? "Próximamente"
    : s.kind === "year" ? `Todo ${new Date().getFullYear()}`
    : s.kind === "user" ? "Guardado solo en tu dispositivo"
    : s.kind === "group" ? `${count} ${count === 1 ? "tirada" : "tiradas"}`
    : typeof s.meta === "string" ? s.meta
    : `${n} ${n === 1 ? "carta" : "cartas"}`;
  if (s.kind === "user") b.classList.add("menu-user");
  b.append(
    el("span", "menu-name", s.name),
    el("span", "menu-desc", s.description || ""),
    el("span", "menu-meta", meta)
  );
  if (s.enabled) {
    b.addEventListener("click", () =>
      s.kind === "user" ? openUser() : s.kind === "year" ? openYear() : s.kind === "group" ? openGroup(s) : openSpread(s));
  }
  li.append(b);
  return li;
}

function renderMenu() {
  current = null;
  $("menu").replaceChildren(...spreads.filter((s) => !s.group).map(menuItem));
  showView("menu");
}

function openGroup(group) {
  $("group-title").textContent = group.name;
  $("group-lead").textContent = group.description || "";
  $("group-menu").replaceChildren(...spreads.filter((s) => s.group === group.id).map(menuItem));
  showView("group");
}

// ---------- administrador local ----------
function openAdmin() {
  for (const id of ["admin-setup", "admin-login", "admin-panel"]) $(id).hidden = true;
  for (const id of ["admin-setup-error", "admin-login-error"]) $(id).hidden = true;
  for (const id of ["admin-pin-new", "admin-pin-new2", "admin-pin"]) $(id).value = "";
  $("admin-msg").textContent = "";
  if (!admin.hasPin()) $("admin-setup").hidden = false;
  else if (!admin.isUnlocked()) $("admin-login").hidden = false;
  else $("admin-panel").hidden = false;
  showView("admin");
}

function fieldError(id, msg) {
  const e = $(id);
  e.textContent = msg;
  e.hidden = false;
}

async function submitAdminSetup(ev) {
  ev.preventDefault();
  const a = $("admin-pin-new").value, b = $("admin-pin-new2").value;
  if (!admin.validPin(a)) return fieldError("admin-setup-error", "El PIN tiene que ser de 6 a 12 números.");
  if (a !== b) return fieldError("admin-setup-error", "Los dos PIN no coinciden.");
  if (!(await admin.setPin(a))) return fieldError("admin-setup-error", "No pudimos guardar el PIN en este dispositivo.");
  openAdmin();
}

async function submitAdminLogin(ev) {
  ev.preventDefault();
  const res = await admin.verifyPin($("admin-pin").value.trim());
  if (res.ok) return openAdmin();
  $("admin-pin").value = "";
  fieldError("admin-login-error", res.wait ? `Demasiados intentos. Probá de nuevo en ${res.wait} segundos.` : "PIN incorrecto.");
}

function adminRedraw() {
  for (const s of spreads) if (s.daily) clearDaily(s);
  $("admin-msg").textContent = "Listo: la carta del día se reinició. Ya podés sacar una nueva.";
}

function adminForgot() {
  if (!confirm("Se borra el PIN de este dispositivo y vas a poder crear uno nuevo. ¿Seguimos?")) return;
  admin.resetPin();
  openAdmin();
}

// Acceso discreto: 5 toques seguidos en el título, o abrir la dirección con #admin.
let titleTaps = [];
function titleTap() {
  const now = Date.now();
  titleTaps = titleTaps.filter((t) => now - t < 3000).concat(now);
  if (titleTaps.length >= 5) { titleTaps = []; openAdmin(); }
}

function goBack() {
  const gid = current?.spread?.group;
  const group = gid && spreads.find((s) => s.id === gid);
  if (group) openGroup(group); else renderMenu();
}

// ---------- Tirada de 3 cartas: primero se elige el tema ----------
const validTres = (t) =>
  t && Array.isArray(t.themes) && t.themes.length > 0 && t.themes.every((th) =>
    th && ID_OK.test(th.id) && typeof th.name === "string" &&
    Array.isArray(th.positions) && th.positions.length > 0 && th.positions.length <= 12 &&
    th.positions.every((p) => p && ID_OK.test(p.key) && typeof p.label === "string" &&
      ["up", "rev", "lens"].every((k) => typeof p[k] === "string")) &&
    typeof th.join === "string" &&
    th.closing && ["fluid", "mixed", "tense"].every((k) => Array.isArray(th.closing[k]) && th.closing[k].length > 0 &&
      th.closing[k].every((x) => typeof x === "string")));

// Textos de la tirada según la familia del mazo (tarot o Lenormand).
async function loadTres(spread, family) {
  if (tresCache.has(family)) return tresCache.get(family);
  const path = spread.themesFiles?.[family] || spread.themesFile;
  const humanPath = family === "tarot" ? TRES_HUMAN_PATH : `data/human/tres-cartas-${family}.json`;
  const [ai, human] = await Promise.all([getJSON(path), getJSON(humanPath, true)]);
  if (!validTres(ai)) throw new Error("tirada inválida");
  const t = { ai, human };
  tresCache.set(family, t);
  return t;
}

async function openThemes(spread) {
  current = { spread, deck: deckCache.get(defaultDeckId), data: null, picks: null };
  try { await loadTres(spread, current.deck.family); }
  catch { showError("No pudimos cargar esta tirada. Revisá tu conexión y volvé a intentar."); return; }
  $("group-title").textContent = spread.name;
  $("group-lead").textContent = "Elegí el tema de tu consulta.";
  $("group-menu").replaceChildren(...tresNow().ai.themes.map((th) => {
    const li = el("li");
    const b = el("button", "menu-item");
    b.type = "button";
    b.append(
      el("span", "menu-name", th.name),
      el("span", "menu-desc", th.description || ""),
      el("span", "menu-meta", th.positions.map((p) => p.label).join(" · "))
    );
    b.addEventListener("click", () => startTheme(spread, th));
    li.append(b);
    return li;
  }));
  showView("group");
}

// Arma la tirada de un tema. Guarda la tirada original ('base') para poder cambiar de familia de mazo.
function themedSpread(spread, theme) {
  const { themesFile, themesFiles, meta, ...rest } = spread;
  return {
    ...rest,
    base: spread,
    id: `${spread.id}-${theme.id}`,
    name: `${spread.name} · ${theme.name}`,
    theme,
    cut: false,
    lead: "Pensá en tu consulta y tocá el mazo. Después vas a elegir tus cartas del abanico.",
    positions: theme.positions.map((p) => ({ key: p.key, label: p.label }))
  };
}

const startTheme = (spread, theme) => openSpread(themedSpread(spread, theme));

async function openSpread(spread) {
  if (spread.themesFile) return openThemes(spread);
  let defaultDeck = deckCache.get(defaultDeckId);
  if (spread.fixedDeck) { // tirada con su propio mazo (Lenormand): no usa el favorito ni el selector
    try { defaultDeck = await loadDeck(spread.fixedDeck); }
    catch { showError("No pudimos cargar este mazo. Revisá tu conexión y volvé a intentar."); return; }
  }
  current = { spread, deck: defaultDeck, data: null, picks: null };

  // Carta "del día": queda grabada con el mazo que la sacó, aunque después cambies de mazo.
  const saved = spread.daily ? readDaily(spread) : null;
  if (saved) {
    try {
      const d = await loadDeck(saved.deckId);
      if (saved.picks.every((p) => cardIn(d, p.cardId))) {
        current = { spread, deck: d, data: await loadMessages(d.family), picks: saved.picks };
        applyDeckLook(d);
        renderResult(false);
        return;
      }
    } catch { /* ese mazo no está disponible ahora: se arma una tirada nueva */ }
  }

  current.data = await loadMessages(defaultDeck.family);
  if (spread.reading) {
    try { await loadReading(); }
    catch { showError("No pudimos cargar esta tirada. Revisá tu conexión y volvé a intentar."); return; }
  }
  if (spread.answer) {
    try { answersData = await loadAnswers(defaultDeck.family); }
    catch { showError("No pudimos cargar las respuestas. Revisá tu conexión y volvé a intentar."); return; }
  }
  showDeckView();
}

// Pantalla del mazo para barajar (con el mazo y la tirada que estén en 'current').
function showDeckView() {
  const { spread, deck } = current;
  applyDeckLook(deck);
  const n = spread.positions.length;
  resetDeckView();
  $("deck-title").textContent = spread.name;
  $("deck-lead").textContent = typeof spread.lead === "string" ? spread.lead : n === 1
    ? "Respirá, pensá en tu día y tocá el mazo."
    : `Pensá en lo que querés consultar y tocá el mazo. Vas a sacar ${n} cartas.`;
  $("btn-draw").textContent = n === 1 ? "Barajar y sacar carta" : spread.fan ? `Barajar y elegir ${n} cartas` : `Barajar y sacar ${n} cartas`;
  setChip("deck", deck.id);
  syncKindSwitch();
  showView("deck");
}

// Carta del día y Sí o No pueden hacerse con tarot o con Lenormand (otro tipo de mazo, con su propia lógica).
// El Lenormand no se elige en el selector de mazos: se elige acá.
function syncKindSwitch() {
  const { spread, deck } = current;
  const sw = $("kind-switch");
  sw.hidden = !spread.altDeck;
  for (const b of sw.querySelectorAll(".kind-opt")) b.setAttribute("aria-checked", String((b.dataset.kind === "lenormand") === (deck.family === "lenormand")));
  $("btn-deck").hidden = deck.family !== "tarot"; // los mazos de tarot se eligen en el selector; el Lenormand es uno solo
}

async function pickKind(kind) {
  if (!current?.spread.altDeck || (kind === "lenormand") === (current.deck.family === "lenormand")) return;
  hidePickers();
  const lead = $("deck-lead");
  const prev = lead.textContent;
  lead.textContent = "Cargando mazo…";
  try {
    const d = await loadDeck(kind === "lenormand" ? current.spread.altDeck : defaultDeckId);
    await adoptDeck(d);
    setChip("deck", d.id);
    prefetchDeck(d);
    syncKindSwitch();
  } catch {
    flash("No pudimos cargar ese mazo. Probá de nuevo con conexión.");
  }
  lead.textContent = prev;
}

// ---------- selector de mazo (en la tirada, en el resultado y en el Arcano del año) ----------
// Cada módulo arranca con el mazo favorito (Usuario) y se puede cambiar por separado.
// Cambiar el mazo cambia el diseño; la carta y el mensaje se mantienen (los ids son universales).
const PICKERS = {
  deck:   { btn: "btn-deck",        panel: "deck-picker",   opts: "deck-options" },
  result: { btn: "btn-deck-result", panel: "result-picker", opts: "result-options" },
  year:   { btn: "btn-deck-year",   panel: "year-picker",   opts: "year-options" }
};
const pickerCurrent = {
  deck: () => current?.deck.id,
  result: () => current?.deck.id,
  year: () => yearState?.deck.id
};
const pickerAction = { deck: pickDeckForSpread, result: changeResultDeck, year: changeYearDeck };

const setChip = (key, deckId) => { $(PICKERS[key].btn).textContent = `Mazo: ${metaOf(deckId).short} ▾`; };

function hidePickers() {
  for (const p of Object.values(PICKERS)) {
    $(p.panel).hidden = true;
    $(p.btn).setAttribute("aria-expanded", "false");
  }
}

function togglePicker(key) {
  const p = PICKERS[key];
  const open = $(p.panel).hidden;
  hidePickers();
  if (!open) return;
  const family = key === "year" ? "tarot" : null; // el Arcano del año usa las cartas del tarot
  renderDeckOptions($(p.opts), pickerCurrent[key](), (id) => pickerAction[key](id), false, family);
  $(p.panel).hidden = false;
  $(p.btn).setAttribute("aria-expanded", "true");
}

function flash(msg) {
  showError(msg);
  setTimeout(() => { $("error").hidden = true; }, 4000);
}

// Pasa la tirada actual a otro mazo. Si es de otra familia (tarot <-> Lenormand) cambian los textos,
// las respuestas Sí/No y el tema de la tirada de 3 cartas; las cartas sacadas no se pueden conservar.
async function adoptDeck(d) {
  const data = await loadMessages(d.family);
  let spread = current.spread;
  if (d.family !== current.deck.family) {
    if (spread.answer) answersData = await loadAnswers(d.family);
    if (spread.theme) {
      const t = await loadTres(spread.base, d.family);
      spread = themedSpread(spread.base, t.ai.themes.find((x) => x.id === spread.theme.id) || t.ai.themes[0]);
    }
  }
  current.spread = spread;
  current.deck = d;
  current.data = data;
  applyDeckLook(d);
}

async function pickDeckForSpread(id) {
  hidePickers();
  if (!current || id === current.deck.id) return;
  const lead = $("deck-lead");
  const prev = lead.textContent;
  lead.textContent = "Cargando mazo…";
  try {
    const d = await loadDeck(id);
    await adoptDeck(d);
    setChip("deck", d.id);
    prefetchDeck(d);
  } catch {
    flash("No pudimos cargar ese mazo. Probá de nuevo con conexión.");
  }
  lead.textContent = prev;
}

async function changeResultDeck(id) {
  hidePickers();
  if (!current?.picks || id === current.deck.id) return;
  try {
    const d = await loadDeck(id);
    if (d.family !== current.deck.family) {
      const ok = window.confirm(`${d.name} es un mazo de otro tipo: sus cartas y sus mensajes son distintos, así que hay que barajar de nuevo y esta tirada se reemplaza. ¿Querés continuar?`);
      if (!ok) return;
      await adoptDeck(d);
      current.picks = null;
      prefetchDeck(d);
      showDeckView();
      return;
    }
    const data = await loadMessages(d.family);
    if (!current.picks.every((p) => cardIn(d, p.cardId))) throw new Error("falta una carta");
    current.deck = d;
    current.data = data;
    applyDeckLook(d);
    if (current.spread.daily) writeDaily(d.id, current.spread, current.picks); // queda grabada con el último mazo elegido
    prefetchDeck(d);
    renderResult(false, true);
  } catch {
    flash("No pudimos cargar ese mazo. Probá de nuevo con conexión.");
  }
}

async function changeYearDeck(id) {
  hidePickers();
  if (!yearState || id === yearState.deck.id) return;
  try {
    const d = await loadDeck(id);
    prefetchDeck(d);
    renderYear(yearState.profile, d, true);
  } catch {
    flash("No pudimos cargar ese mazo. Probá de nuevo con conexión.");
  }
}

// ---------- Usuario, carta natal y arcano del año ----------
const arcanoInfo = (n) => ({ ...(arcanos.ai?.arcanos?.[n] || {}), ...Object.fromEntries(
  Object.entries(arcanos.human?.arcanos?.[n] || {}).filter(([, v]) => typeof v === "string" && v.trim())) });
const roleInfo = (key) => ({ ...(arcanos.ai?.roles?.[key] || {}), ...Object.fromEntries(
  Object.entries(arcanos.human?.roles?.[key] || {}).filter(([, v]) => typeof v === "string" && v.trim())) });

let afterProfile = "user"; // a dónde ir después de guardar los datos

// El arcano de la carta natal se muestra con el mazo favorito (las cartas comparten id entre mazos).
const natalCard = (n) => cardIn(deckCache.get(defaultDeckId), NUMBER_TO_CARD[n]);

// Fila desplegable: cerrada muestra "Arcano del Alma · 10 La Rueda de la Fortuna"; abierta, el mensaje completo.
function natalAcc(roleKey, number) {
  const card = natalCard(number);
  const info = arcanoInfo(number);
  const role = roleInfo(roleKey);
  const d = el("details", "acc");
  const s = el("summary", "acc-sum");
  const txt = el("span", "acc-txt");
  txt.append(el("span", "natal-role", role.title || roleKey), el("span", "acc-name", `${label(number)} · ${card.name}`));
  s.append(txt, el("span", "acc-chev"));

  const panel = el("div", "acc-panel");
  const art = el("img", "acc-art");
  art.src = card.image;
  art.alt = card.name;
  art.loading = "lazy";
  art.width = 250;
  art.height = 429;
  panel.append(art);
  if (role.intro) panel.append(el("p", "natal-intro", role.intro));
  if (info.esencia) panel.append(el("p", "natal-essence", info.esencia));
  for (const [k, t] of [["luz", "Luz"], ["sombra", "Sombra"]]) {
    if (!info[k]) continue;
    const p = el("p", "natal-line");
    p.append(el("strong", "", t + ": "), document.createTextNode(info[k]));
    panel.append(p);
  }
  d.append(s, panel);
  return d;
}

const fmtBirth = ({ d, m, y }) => `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;

function renderUser() {
  const profile = readProfile();
  $("user-profile").hidden = !profile;
  $("user-empty").hidden = !!profile;
  $("user-actions").hidden = !profile;
  if (profile) {
    const c = carta(profile.birth);
    $("user-name").textContent = profile.name;
    $("user-birth").textContent = `Nacimiento: ${fmtBirth(profile.birth)}`;
    const roles = ["alma", "personalidad", "don", "vidaPasada", "mision"];
    $("natal-list").replaceChildren(...roles.map((r) => natalAcc(r, c[r])));
    const rep = repetidos(c);
    const note = $("natal-repeat");
    const parts = Object.entries(rep).map(([n, v]) => `${natalCard(n).name} aparece ${v} veces`);
    note.hidden = parts.length === 0;
    note.textContent = parts.length ? `${parts.join(" · ")}: su energía se vive con más intensidad en vos.` : "";
  }
  renderFavorite();
  renderBackOptions();
  $("credits-list").replaceChildren(...decksMeta.map((m) => {
    const li = el("li");
    li.append(el("strong", "", m.short + ": "), document.createTextNode(`${m.credit || ""} ${m.license ? "(" + m.license + ")" : ""}`.trim()));
    return li;
  }));
  showView("user");
}

function renderFavorite() {
  const box = $("fav-options");
  const m = metaOf(defaultDeckId);
  const toggle = el("button", "deck-option deck-select");
  toggle.type = "button";
  toggle.id = "fav-toggle";
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "fav-list");
  toggle.append(el("span", "deck-option-name", m.short), el("span", "deck-option-desc", m.description || ""), el("span", "select-chev"));
  const list = el("div", "deck-options");
  list.id = "fav-list";
  list.hidden = true;
  toggle.addEventListener("click", () => {
    list.hidden = !list.hidden;
    toggle.setAttribute("aria-expanded", String(!list.hidden));
  });
  renderDeckOptions(list, defaultDeckId, async (id) => {
    if (id === defaultDeckId) { list.hidden = true; toggle.setAttribute("aria-expanded", "false"); return; }
    try {
      const d = await loadDeck(id);
      defaultDeckId = id;
      writeFavoriteDeck(id);
      prefetchDeck(d);
      renderUser(); // vuelve a dibujar con las cartas del nuevo mazo favorito
    } catch {
      showError("No pudimos cargar ese mazo. Probá de nuevo con conexión.");
    }
  }, true, "tarot"); // el elegido ya se ve arriba; el favorito es de tarot porque la carta natal usa sus cartas
  box.replaceChildren(toggle, list);
}

// Dorso de las cartas (Usuario): desplegable igual al del mazo favorito.
// Arriba se ve el elegido; al desplegar, la lista muestra solo los otros.
function renderBackOptions() {
  const deck = deckCache.get(defaultDeckId);
  const box = $("back-options");
  const cur = BACK_CHOICES.find((c) => c.id === backPref) || BACK_CHOICES[0];
  const toggle = el("button", "deck-option deck-select");
  toggle.type = "button";
  toggle.id = "back-toggle";
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "back-list");
  toggle.append(el("span", "deck-option-name", cur.name), el("span", "deck-option-desc", cur.desc), el("span", "select-chev"));
  const list = el("div", "deck-options");
  list.id = "back-list";
  list.hidden = true;
  toggle.addEventListener("click", () => {
    list.hidden = !list.hidden;
    toggle.setAttribute("aria-expanded", String(!list.hidden));
  });
  list.replaceChildren(...BACK_CHOICES.filter((c) => c.id !== backPref).map((c) => {
    const b = el("button", "deck-option");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.append(el("span", "deck-option-name", c.name), el("span", "deck-option-desc", c.desc));
    b.addEventListener("click", () => {
      backPref = c.id;
      writeBack(c.id);
      applyDeckLook(deck);
      renderBackOptions();
    });
    return b;
  }));
  box.replaceChildren(toggle, list);
}

// Arcano del año: sin barajar. La carta, su palabra y un mensaje fijo para todo el año.
function renderYear(profile, deck = deckCache.get(defaultDeckId), keepScroll = false) {
  const year = new Date().getFullYear();
  const n = arcanoDelAnio(profile.birth, year);
  yearState = { profile, deck };
  const card = cardIn(deck, NUMBER_TO_CARD[n]);
  const info = arcanoInfo(n);
  applyDeckLook(deck);
  $("year-title").textContent = `Arcano del año ${year}`;
  $("year-sub").textContent = `Para ${profile.name}`;

  const slot = el("article", "slot");
  const scene = el("div", "card-scene");
  const flip = el("div", "card-flip flipped instant");
  const back = el("img", "card-face back");
  const front = el("img", "card-face front");
  back.src = backPath(deck);
  back.alt = "";
  front.src = card.image;
  front.alt = card.name;
  for (const im of [back, front]) { im.width = 250; im.height = 429; }
  flip.append(back, front);
  scene.append(flip);

  const word = el("p", "card-word");
  word.append(el("span", "", wordFor(card, false)));
  slot.append(scene, el("p", "slot-label", `Arcano ${label(n)}`), el("h3", "card-name", card.name), word,
    el("blockquote", "message", info.anio || info.esencia || card.meaning));
  for (const [k, t] of [["luz", "Luz"], ["sombra", "Sombra"]]) {
    if (!info[k]) continue;
    const p = el("p", "natal-line year-line");
    p.append(el("strong", "", t + ": "), document.createTextNode(info[k]));
    slot.append(p);
  }
  $("year-slot").replaceChildren(slot);
  setChip("year", deck.id);
  showView("year", keepScroll);
}

function showProfileForm(prefill, next) {
  afterProfile = next || "user";
  $("profile-name").value = prefill ? prefill.name : "";
  $("profile-birth").value = prefill ? prefill.iso : "";
  $("profile-birth").max = new Date().toISOString().slice(0, 10);
  $("profile-error").hidden = true;
  showView("profile");
}

function openUser() { renderUser(); }

function openYear() {
  const profile = readProfile();
  if (profile) renderYear(profile);
  else showProfileForm(null, "year");
}

function submitProfile(e) {
  e.preventDefault();
  const name = cleanName($("profile-name").value);
  const iso = $("profile-birth").value;
  const err = $("profile-error");
  if (!name) { err.textContent = "Escribí tu nombre."; err.hidden = false; return; }
  if (!parseBirth(iso)) { err.textContent = "Revisá la fecha de nacimiento."; err.hidden = false; return; }
  if (!writeProfile(name, iso)) { err.textContent = "No pudimos guardar tus datos en este dispositivo."; err.hidden = false; return; }
  if (afterProfile === "year") renderYear(readProfile()); else renderUser();
}

function deleteProfile() {
  if (!window.confirm("¿Borrar tu nombre y tu fecha de nacimiento de este dispositivo?")) return;
  clearProfile();
  renderUser();
}

// ---------- sacar cartas ----------
function drawPicks(n) {
  const { deck, data } = current;
  const pool = deck.cards.map((_, i) => i);
  const reversedPct = deck.reversible === false ? 0 : Math.round(CONFIG.reversedChance * 100); // el Lenormand no se lee invertido
  const picks = [];
  for (let k = 0; k < n; k++) {
    const card = deck.cards[pool.splice(randInt(pool.length), 1)[0]]; // sin repetir
    const reversed = randInt(100) < reversedPct;
    picks.push({ cardId: card.id, reversed, idx: randInt(variantCount(data, card.id, reversed)) });
  }
  return picks;
}

// Vista del mazo en su estado inicial (mazo entero, sin corte).
function resetDeckView() {
  $("deck").hidden = false;
  $("deck").disabled = false;
  $("deck").classList.remove("shuffling");
  $("btn-draw").hidden = false;
  $("btn-draw").disabled = false;
  $("btn-deck").hidden = false;
  $("cut").hidden = true;
  $("fan-wrap").hidden = true;
  $("btn-fan-random").hidden = false;
  fanState = null;
  $("cut").classList.remove("split", "picked");
  document.querySelectorAll(".pile").forEach((p) => { p.classList.remove("chosen", "other"); p.disabled = false; });
}

// 1) baraja (animación)  2) corta el mazo en dos  3) la persona elige uno  4) se revelan las cartas
function draw() {
  const deckEl = $("deck");
  const btn = $("btn-draw");
  hidePickers();
  btn.disabled = true;
  deckEl.disabled = true;
  $("btn-deck").hidden = true; // no se cambia de mazo en medio del barajado
  $("kind-switch").hidden = true;
  deckEl.classList.add("shuffling");

  const cur = current;
  setTimeout(() => {
    deckEl.classList.remove("shuffling");
    if (current !== cur) return; // la persona salió de la tirada mientras se barajaba
    if (cur.spread.fan) { startFan(); return; }
    if (current?.spread?.cut === false) { // tirada sin corte: la carta aparece directo al terminar de barajar
      current.picks = drawPicks(current.spread.positions.length);
      renderResult(true);
      return;
    }
    deckEl.hidden = true;
    btn.hidden = true;
    $("deck-lead").textContent = "Elegí uno.";
    $("cut").hidden = false;
    $("cut").classList.add("split");
  }, reduceMotion ? 1400 : SHUFFLE_MS);
}

function pickPile(i) {
  if (!current || $("cut").classList.contains("picked")) return;
  const { spread } = current;
  $("cut").classList.add("picked");
  document.querySelectorAll(".pile").forEach((p, k) => {
    p.disabled = true;
    p.classList.add(k === i ? "chosen" : "other");
  });
  setTimeout(() => {
    current.picks = drawPicks(spread.positions.length);
    if (spread.daily) writeDaily(current.deck.id, spread, current.picks);
    renderResult(true);
  }, reduceMotion ? 900 : 750);
}

// Tirada de 3 cartas: tu texto (si existe) > encuadre de la posición + significado de la carta.
function slotText(spread, i, pick) {
  const theme = spread.theme;
  const pos = theme.positions[i];
  const card = cardIn(current.deck, pick.cardId);
  const h = tresNow()?.human?.slots?.[`${theme.id}.${pos.key}.${card.id}.${pick.reversed ? "rev" : "up"}`];
  if (typeof h === "string" && h.trim()) return h;
  const frame = (pick.reversed ? pos.rev : pos.up)
    .replaceAll("{carta}", card.name).replaceAll("{palabra}", wordFor(card, pick.reversed));
  return `${frame} ${pick.reversed ? card.reversed : card.meaning} ${pos.lens}`;
}

// ---------- Tirada de 3 del Lenormand ----------
// Las tres cartas se leen como una historia en el orden en que salen: la 1 es el tema y la 2 lo modifica
// (primera frase); la 2 pasa a ser el tema y la 3 lo modifica (segunda frase). Así la carta del medio
// es la bisagra que une las dos frases. Si una pareja no tiene texto escrito se usa el marco propio de la
// primera carta con la palabra de la segunda.
let readingData = null; // { cfg, combos, human }
async function loadReading() {
  if (readingData) return readingData;
  const [cfg, combos, human] = await Promise.all([
    getJSON("data/tiradas/lenormand-3.json"), getJSON("data/combos/lenormand.json"), getJSON("data/human/lenormand-3.json", true)]);
  if (!cfg?.closing || !combos?.pairs || !combos?.frames) throw new Error("tirada inválida");
  readingData = { cfg, combos, human };
  return readingData;
}

const polarity = (c) => (c.polarity === "positiva" ? 1 : c.polarity === "negativa" ? -1 : 0);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function pairClause(a, b) {
  const { combos, human } = readingData;
  const key = `${a.number}>${b.number}`;
  for (const src of [human?.pairs, combos.pairs]) {
    const t = src?.[key];
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  const f = combos.frames[String(a.number)];
  const s = polarity(b);
  const tpl = f && (s > 0 ? f.p : s < 0 ? f.n : f.z);
  const bare = b.mod || (b.keywords[0] || b.name).toLowerCase();
  return typeof tpl === "string" ? tpl.replaceAll("{m}", bare).replaceAll("{M}", b.modd || bare) : "";
}

function lenormandReading(picks) {
  const cards = picks.map((p) => cardIn(current.deck, p.cardId));
  const { cfg, human } = readingData;
  const key = picks.map((p) => p.cardId).join(",");
  const h = human?.conjunto?.[key];
  if (typeof h === "string" && h.trim()) return { hilo: "", lead: "", text: h, title: "Lectura de las tres cartas" };
  const [s1, s2, s3] = cards.map(polarity);
  const first = pairClause(cards[0], cards[1]);
  const second = pairClause(cards[1], cards[2]);
  const join = s2 * s3 < 0 ? cfg.joinFlip : cfg.joinSame;
  const tone = [s1, s2, s3].every((x) => x >= 0) ? "fluid" : [s1, s2, s3].every((x) => x <= 0) ? "tense"
    : s3 > s1 ? "rising" : s3 < s1 ? "falling" : "mixed";
  const arr = cfg.closing[tone] || cfg.closing.mixed;
  return { hilo: "", lead: `${cap(first)}. ${join ? join + second : cap(second)}.`, text: arr[picks[0].idx % arr.length], title: "Lectura de las tres cartas" };
}

// Cierre de las tres cartas: tu texto para esa combinación > hilo + cierre según cuántas "pesan" (invertidas en tarot, de polaridad negativa en Lenormand).
function overallFor(spread, picks) {
  if (spread.reading) return lenormandReading(picks);
  const theme = spread.theme;
  const h = tresNow()?.human?.conjunto?.[`${theme.id}:${picks.map((p) => p.cardId).join(",")}`];
  const cards = picks.map((p) => cardIn(current.deck, p.cardId));
  if (typeof h === "string" && h.trim()) return { hilo: "", lead: "", text: h };
  let hilo = theme.join;
  picks.forEach((p, i) => { hilo = hilo.replaceAll(`{w${i + 1}}`, wordFor(cards[i], p.reversed)); });
  const rev = picks.filter((p) => p.reversed).length;
  const tone = rev === 0 ? "fluid" : rev === picks.length ? "tense" : "mixed";
  const arr = theme.closing[tone];
  return { hilo, lead: "", text: arr[picks[0].idx % arr.length] };
}

function messageFor(pick, i = 0) {
  if (current.spread.theme) return slotText(current.spread, i, pick);
  const card = cardIn(current.deck, pick.cardId);
  const m = resolveMessage(current.data, card.id, pick.reversed, pick.idx);
  return m.text || (pick.reversed ? card.reversed : card.meaning);
}

function makeSlot(spread, pos, pick, i, animate) {
  const { deck } = current;
  const card = cardIn(deck, pick.cardId);
  const multi = spread.positions.length > 1;
  const slot = el("article", "slot");
  if (multi) slot.append(el("p", "slot-label", pos.label));

  const scene = el("div", "card-scene");
  const flip = el("div", "card-flip");
  const back = el("img", "card-face back");
  const front = el("img", "card-face front" + (pick.reversed ? " reversed" : ""));
  back.src = backPath(deck);
  back.alt = "";
  front.src = card.image;
  front.alt = card.name + (pick.reversed ? " (invertida)" : "");
  for (const im of [back, front]) { im.width = 250; im.height = 429; }
  flip.append(back, front);
  scene.append(flip);

  const meta = pick.reversed ? el("p", "card-orientation", "Invertida") : null;
  slot.append(scene, el("h3", "card-name", card.name));
  if (meta) slot.append(meta);
  if (spread.answer) {
    const ans = answerFor(pick);
    slot.append(el("p", `answer answer-${ans.tone}`, ans.text));
  } else {
    const word = el("p", "card-word");
    word.append(el("span", "", wordFor(card, pick.reversed)));
    slot.insertBefore(word, meta);
    if (!spread.reading) slot.append(el("blockquote", "message", messageFor(pick, i))); // en el Lenormand la lectura es una sola, abajo
  }

  if (animate) {
    setTimeout(() => flip.classList.add("flipped"), 120 + i * 450);
  } else {
    flip.classList.add("flipped", "instant");
  }
  return slot;
}

function renderResult(animate, keepScroll = false) {
  const { spread, picks, deck } = current;
  const multi = spread.positions.length > 1;
  $("result-title").textContent = spread.name;
  setChip("result", deck.id);
  $("btn-deck-result").hidden = deck.family !== "tarot";
  $("slots").className = "slots" + (multi ? " multi" : "");
  $("slots").replaceChildren(...spread.positions.map((pos, i) => makeSlot(spread, pos, picks[i], i, animate)));
  const ov = $("overall");
  if (spread.theme || spread.reading) {
    const o = overallFor(spread, picks);
    ov.replaceChildren(el("h3", "overall-title", o.title || "En conjunto"), ...(o.hilo ? [el("p", "overall-hilo", o.hilo)] : []),
      ...(o.lead ? [el("p", "overall-text", o.lead)] : []), el("p", "overall-text", o.text));
    ov.hidden = false;
  } else ov.hidden = true;
  $("come-back").textContent = spread.theme || spread.reading
    ? "Lectura orientativa y de entretenimiento. No reemplaza la consulta con profesionales de la salud, legales ni financieros."
    : spread.answer
    ? "Respuesta orientativa y de entretenimiento. No la uses para decidir sobre salud, dinero o temas legales."
    : spread.daily
    ? "Mañana te espera una nueva. Volvé a leerla cuando quieras."
    : "Tomate un momento para leer cada carta con calma.";
  $("btn-again").textContent = spread.daily ? "Barajar de nuevo (administrador)" : "Nueva tirada";
  $("btn-again").hidden = spread.daily ? !admin.isUnlocked() : false;
  showView("result", keepScroll);
}

function again() {
  if (!current) return;
  if (current.spread.daily) clearDaily(current.spread);
  openSpread(current.spread);
}

async function share() {
  if (!current?.picks) return;
  const { spread, picks, deck } = current;
  const multi = spread.positions.length > 1;
  const lines = picks.map((p, i) => {
    const c = cardIn(deck, p.cardId);
    const head = `${multi ? spread.positions[i].label + ": " : ""}${c.name}${p.reversed ? " (invertida)" : ""} · ${wordFor(c, p.reversed)}`;
    return spread.answer ? `${c.name}${p.reversed ? " (invertida)" : ""} · ${answerFor(p).text}`
      : spread.reading ? head : `${head}\n“${messageFor(p, i)}”`;
  });
  if (spread.theme || spread.reading) {
    const o = overallFor(spread, picks);
    lines.push(`${o.title || "En conjunto"}\n${o.hilo ? o.hilo + " " : ""}${o.lead ? o.lead + " " : ""}${o.text}`);
  }
  const title = `${spread.name} · Oráculo`;
  const text = `${title}\nMazo: ${metaOf(deck.id).name}\n\n${lines.join("\n\n")}`;
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
    } else {
      await navigator.clipboard.writeText(`${text}\n\n${url}`);
      $("btn-share").textContent = "¡Copiado!";
      setTimeout(() => ($("btn-share").textContent = "Compartir"), 1800);
    }
  } catch { /* el usuario canceló */ }
}

// ---------- Abanico: se eligen las cartas deslizando el dedo ----------
function startFan() {
  const { deck, spread } = current;
  const n = spread.positions.length;
  const order = deck.cards.map((c) => c.id);
  for (let i = order.length - 1; i > 0; i--) { const j = randInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }

  $("deck").hidden = true;
  $("btn-draw").hidden = true;
  $("cut").hidden = true;
  $("fan-wrap").hidden = false;

  const tray = $("fan-tray");
  tray.replaceChildren(...spread.positions.map((pos) => {
    const li = el("li", "fan-slot");
    const img = el("img", "fan-slot-back");
    img.src = backPath(deck);
    img.alt = "";
    li.append(img, el("span", "fan-slot-label", pos.label));
    return li;
  }));

  const fan = $("fan");
  const W = fan.clientWidth || 320;
  const [aw, ah] = validAspect(deck.aspect) ? deck.aspect : DEFAULT_AR;
  const cw = Math.min(92, Math.round(W * 0.2));
  const ch = Math.round(cw * ah / aw);
  const P = ch * 1.2;                       // distancia del pivote al borde inferior de las cartas
  const R = P + ch * 0.6;                   // radio donde "toca" el dedo
  const A = Math.asin(Math.min(0.95, (W / 2 - cw / 2 - 6) / (P + ch))); // media apertura (rad)
  const lift = Math.round(ch * 0.3);
  const N = order.length;
  fan.style.setProperty("--cw", `${cw}px`);
  fan.style.setProperty("--ch", `${ch}px`);
  fan.style.setProperty("--ty", `${-lift}px`);
  fan.style.height = `${ch + lift + 16}px`;
  fan.className = "fan";

  const els = order.map((_, i) => {
    const im = el("img", "fan-card");
    im.src = backPath(deck);
    im.alt = "";
    im.draggable = false;
    im.style.setProperty("--o", `50% ${ch + P}px`);
    im.style.setProperty("--d", `${reduceMotion ? 0 : Math.round(i * 7)}ms`);
    im.style.setProperty("--a", "0deg");
    return im;
  });
  fan.replaceChildren(...els);
  fanState = { cur: current, order, els, gone: new Set(), chosen: [], lifted: -1, ptr: null, busy: false, N, A, R, n };
  fanPrompt();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    els.forEach((im, i) => im.style.setProperty("--a", `${((-A + (2 * A * i) / (N - 1)) * 180 / Math.PI).toFixed(3)}deg`));
    setTimeout(() => fan.classList.add("ready"), reduceMotion ? 0 : 1100);
  }));
}

function fanPrompt() {
  const f = fanState;
  const k = f.chosen.length;
  $("deck-lead").textContent = `Carta ${k + 1} de ${f.n} · ${current.spread.positions[k].label}. Deslizá el dedo sobre el abanico y soltá para elegirla.`;
}

function fanNearest(clientX) {
  const f = fanState;
  const rect = $("fan").getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const ang = Math.asin(Math.max(-1, Math.min(1, dx / f.R)));
  const idx = ((ang + f.A) / (2 * f.A)) * (f.N - 1);
  let best = -1, bd = Infinity;
  for (let i = 0; i < f.N; i++) {
    if (f.gone.has(i)) continue;
    const d = Math.abs(i - idx);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function fanLift(i) {
  const f = fanState;
  if (!f || f.lifted === i) return;
  if (f.lifted >= 0) f.els[f.lifted].classList.remove("up");
  f.lifted = i;
  if (i >= 0) f.els[i].classList.add("up");
}

function fanChoose(i) {
  const f = fanState;
  if (!f || f.busy || i < 0 || f.gone.has(i)) return;
  const k = f.chosen.length;
  f.gone.add(i);
  f.chosen.push(f.order[i]);
  f.els[i].classList.remove("up");
  f.els[i].classList.add("gone");
  f.lifted = -1;
  $("fan-tray").children[k].classList.add("filled");
  if (f.chosen.length < f.n) { fanPrompt(); return; }
  f.busy = true;
  $("btn-fan-random").hidden = true;
  $("deck-lead").textContent = "Listo. Las cartas están elegidas.";
  const { data } = current;
  const pct = current.deck.reversible === false ? 0 : Math.round(CONFIG.reversedChance * 100);
  setTimeout(() => {
    if (current !== f.cur) return;
    current.picks = f.chosen.map((cardId) => {
      const reversed = randInt(100) < pct;
      return { cardId, reversed, idx: randInt(variantCount(data, cardId, reversed)) };
    });
    renderResult(true);
  }, reduceMotion ? 500 : 900);
}

function setupFan() {
  const fan = $("fan");
  const end = (e, choose) => {
    const f = fanState;
    if (!f || f.ptr !== e.pointerId) return;
    f.ptr = null;
    if (choose) fanChoose(f.lifted); else fanLift(-1);
  };
  fan.addEventListener("pointerdown", (e) => {
    const f = fanState;
    if (!f || f.busy || !fan.classList.contains("ready")) return;
    f.ptr = e.pointerId;
    try { fan.setPointerCapture(e.pointerId); } catch { /* ya no está activo */ }
    fanLift(fanNearest(e.clientX));
  });
  fan.addEventListener("pointermove", (e) => {
    const f = fanState;
    if (!f || f.busy || !fan.classList.contains("ready")) return;
    if (f.ptr === e.pointerId || (f.ptr === null && e.pointerType === "mouse")) fanLift(fanNearest(e.clientX));
  });
  fan.addEventListener("pointerup", (e) => end(e, true));
  fan.addEventListener("pointercancel", (e) => end(e, false));
  fan.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && fanState?.ptr === null) fanLift(-1); });
  fan.addEventListener("keydown", (e) => {
    const f = fanState;
    if (!f || f.busy || !fan.classList.contains("ready")) return;
    const alive = [...Array(f.N).keys()].filter((i) => !f.gone.has(i));
    if (!alive.length) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const pos = alive.indexOf(f.lifted);
      const nx = pos < 0 ? Math.floor(alive.length / 2) : Math.max(0, Math.min(alive.length - 1, pos + (e.key === "ArrowRight" ? 1 : -1)));
      fanLift(alive[nx]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (f.lifted < 0) fanLift(alive[Math.floor(alive.length / 2)]); else fanChoose(f.lifted);
    }
  });
  $("btn-fan-random").addEventListener("click", () => {
    const f = fanState;
    if (!f || f.busy || !fan.classList.contains("ready")) return;
    const alive = [...Array(f.N).keys()].filter((i) => !f.gone.has(i));
    const i = alive[randInt(alive.length)];
    fanLift(i);
    setTimeout(() => { if (fanState === f) fanChoose(i); }, reduceMotion ? 120 : 380);
  });
}

// ---------- instalación, estado de red, service worker ----------
function setupPwa() {
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    $("btn-install").hidden = false;
  });
  $("btn-install").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $("btn-install").hidden = true;
  });
  window.addEventListener("appinstalled", () => ($("btn-install").hidden = true));

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("ios-hint").hidden = !(ios && !standalone);

  const net = () => ($("net").hidden = navigator.onLine);
  window.addEventListener("online", net);
  window.addEventListener("offline", net);
  net();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // Aviso de versión nueva: solo si la app ya estaba instalada y se descargó una actualización.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) $("update-banner").hidden = false;
    });
    $("btn-update").addEventListener("click", () => location.reload());
    $("btn-update-later").addEventListener("click", () => ($("update-banner").hidden = true));
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => { /* la app funciona igual online */ });
  }
}

// ---------- arranque ----------
async function init() {
  setupPwa();
  $("deck").addEventListener("click", draw);
  $("btn-draw").addEventListener("click", draw);
  document.querySelectorAll(".kind-opt").forEach((b) => b.addEventListener("click", () => pickKind(b.dataset.kind)));
  for (const key of Object.keys(PICKERS)) $(PICKERS[key].btn).addEventListener("click", () => togglePicker(key));
  $("btn-share").addEventListener("click", share);
  $("btn-again").addEventListener("click", again);
  setupFan();
  document.querySelectorAll(".pile").forEach((p) => p.addEventListener("click", () => pickPile(Number(p.dataset.pile))));
  $("profile-form").addEventListener("submit", submitProfile);
  $("btn-add-profile").addEventListener("click", () => showProfileForm(null, "user"));
  $("btn-edit-profile").addEventListener("click", () => showProfileForm(readProfile(), "user"));
  $("btn-delete-profile").addEventListener("click", deleteProfile);
  document.querySelectorAll("[data-go='menu']").forEach((b) => b.addEventListener("click", renderMenu));
  document.querySelector(".brand").addEventListener("click", titleTap);
  $("admin-setup").addEventListener("submit", submitAdminSetup);
  $("admin-login").addEventListener("submit", submitAdminLogin);
  $("btn-admin-forgot").addEventListener("click", adminForgot);
  $("btn-admin-redraw").addEventListener("click", adminRedraw);
  $("btn-admin-pin").addEventListener("click", () => { admin.lock(); admin.resetPin(); openAdmin(); });
  $("btn-admin-lock").addEventListener("click", () => { admin.lock(); renderMenu(); });
  document.querySelectorAll("[data-go='origin']").forEach((b) => b.addEventListener("click", goBack));

  try {
    const guess = readFavoriteDeck();
    const guessId = typeof guess === "string" && /^[\w\-]+$/.test(guess) ? guess : "rider-waite";
    earlyDecks.set(guessId, getJSON(deckPath(guessId), true));
    loadMessages("tarot").catch(() => {});
    const [meta, sp, arAi, arHuman] = await Promise.all([
      getJSON(DECKS_PATH), getJSON(SPREADS_PATH), getJSON(ARCANOS_PATH, true), getJSON(ARCANOS_HUMAN_PATH, true)
    ]);
    if (!validDecksMeta(meta)) throw new Error("lista de mazos inválida");
    decksMeta = meta.decks;
    backPref = readBack();
    const fav = readFavoriteDeck();
    defaultDeckId = fav && decksMetaById(fav) ? fav : meta.default;
    let d;
    try { d = await loadDeck(defaultDeckId); }
    catch (e) { // si el favorito no se pudo cargar, se usa el de la lista
      defaultDeckId = meta.default;
      d = await loadDeck(defaultDeckId);
    }
    await loadMessages(d.family);
    if (!validSpreads(sp)) throw new Error("tiradas inválidas");
    spreads = sp.spreads;
    arcanos = { ai: arAi, human: arHuman };
    applyDeckLook(d);
    setTimeout(() => prefetchDeck(d), 8000); // en segundo plano, sin competir con lo que estás viendo
  } catch {
    showError("No pudimos cargar el mazo. Revisá tu conexión y volvé a intentar.");
    return;
  }

  renderMenu();
  if (location.hash === "#admin") openAdmin();
}

init();
