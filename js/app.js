import { CONFIG, answersPaths, DECKS_PATH, deckPath, messagePaths, SPREADS_PATH, ARCANOS_PATH, ARCANOS_HUMAN_PATH } from "./config.js";
import {
  readDaily, writeDaily, clearDaily, readFavoriteDeck, writeFavoriteDeck,
  readProfile, writeProfile, clearProfile, cleanName
} from "./storage.js";
import { carta, arcanoDelAnio, repetidos, NUMBER_TO_CARD, label, parseBirth } from "./natal.js";
import { resolveMessage, variantCount } from "./messages.js";
import * as admin from "./admin.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const IMG_OK = /^img\/[\w\-\/]+\.(webp|png|jpg)$/; // solo imágenes propias del proyecto
const ID_OK = /^[\w\-]+$/;
const SHUFFLE_MS = 1700;
const DEFAULT_AR = [250, 429]; // proporción de carta si el mazo no indica otra

let decksMeta = [];           // lista del selector (data/decks.json)
let defaultDeckId = null;     // mazo favorito (o el que indica decks.json)
const deckCache = new Map();  // id -> mazo ya cargado y validado
const msgCache = new Map();   // family -> { ai, human }
let spreads = [];
let arcanos = { ai: null, human: null }; // textos de la Carta natal (humano > IA)
let current = null; // { spread, deck, data, picks }
let answersData = null; // { ai, human } respuestas sí/no (se cargan al abrir esa tirada)
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
    (x.kind === "year" || x.kind === "user" || x.kind === "group" || (Array.isArray(x.positions) && x.positions.length > 0 &&
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
  if (answersData) return answersData;
  const p = answersPaths(family);
  const [ai, human] = await Promise.all([getJSON(p.ai, true), getJSON(p.human, true)]);
  answersData = { ai, human };
  return answersData;
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

// Proporción de las cartas del mazo (cada mazo tiene la suya).
function applyDeckLook(deck) {
  const [w, h] = validAspect(deck.aspect) ? deck.aspect : DEFAULT_AR;
  document.documentElement.style.setProperty("--card-ar", `${w} / ${h}`);
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
function renderDeckOptions(container, selectedId, onPick) {
  container.replaceChildren(...decksMeta.map((m) => {
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

async function openSpread(spread) {
  const defaultDeck = deckCache.get(defaultDeckId);
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
  if (spread.answer) {
    try { await loadAnswers(defaultDeck.family); }
    catch { showError("No pudimos cargar las respuestas. Revisá tu conexión y volvé a intentar."); return; }
  }
  applyDeckLook(defaultDeck);
  const n = spread.positions.length;
  resetDeckView();
  $("deck-title").textContent = spread.name;
  $("deck-lead").textContent = typeof spread.lead === "string" ? spread.lead : n === 1
    ? "Respirá, pensá en tu día y tocá el mazo."
    : `Pensá en lo que querés consultar y tocá el mazo. Vas a sacar ${n} cartas.`;
  $("btn-draw").textContent = n === 1 ? "Barajar y sacar carta" : `Barajar y sacar ${n} cartas`;
  setChip("deck", current.deck.id);
  showView("deck");
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
  renderDeckOptions($(p.opts), pickerCurrent[key](), (id) => pickerAction[key](id));
  $(p.panel).hidden = false;
  $(p.btn).setAttribute("aria-expanded", "true");
}

function flash(msg) {
  showError(msg);
  setTimeout(() => { $("error").hidden = true; }, 4000);
}

async function pickDeckForSpread(id) {
  hidePickers();
  if (!current || id === current.deck.id) return;
  const lead = $("deck-lead");
  const prev = lead.textContent;
  lead.textContent = "Cargando mazo…";
  try {
    const d = await loadDeck(id);
    current.deck = d;
    current.data = await loadMessages(d.family);
    applyDeckLook(d);
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
  });
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
  back.src = IMG_OK.test(deck.back) ? deck.back : "";
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
  const reversedPct = Math.round(CONFIG.reversedChance * 100);
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
  deckEl.classList.add("shuffling");

  setTimeout(() => {
    deckEl.classList.remove("shuffling");
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

function messageFor(pick) {
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
  back.src = IMG_OK.test(deck.back) ? deck.back : "";
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
    slot.append(el("blockquote", "message", messageFor(pick)));
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
  $("slots").className = "slots" + (multi ? " multi" : "");
  $("slots").replaceChildren(...spread.positions.map((pos, i) => makeSlot(spread, pos, picks[i], i, animate)));
  $("come-back").textContent = spread.answer
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
    return spread.answer ? `${c.name}${p.reversed ? " (invertida)" : ""} · ${answerFor(p).text}` : `${head}\n“${messageFor(p)}”`;
  });
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
    navigator.serviceWorker.register("sw.js").catch(() => { /* la app funciona igual online */ });
  }
}

// ---------- arranque ----------
async function init() {
  setupPwa();
  $("deck").addEventListener("click", draw);
  $("btn-draw").addEventListener("click", draw);
  for (const key of Object.keys(PICKERS)) $(PICKERS[key].btn).addEventListener("click", () => togglePicker(key));
  $("btn-share").addEventListener("click", share);
  $("btn-again").addEventListener("click", again);
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
