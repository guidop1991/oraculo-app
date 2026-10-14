// Acceso seguro a localStorage: nunca rompe la app y valida lo que lee.
import { CONFIG } from "./config.js";
import { parseBirth } from "./natal.js";

const key = (k) => CONFIG.storagePrefix + k;

export function load(k) {
  try {
    const raw = localStorage.getItem(key(k));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function save(k, value) {
  try {
    localStorage.setItem(key(k), JSON.stringify(value));
    return true;
  } catch {
    return false; // modo privado o cuota llena: la app sigue funcionando
  }
}

export function remove(k) {
  try { localStorage.removeItem(key(k)); } catch { /* nada */ }
}

// Fecha local en formato AAAA-MM-DD (lo "del día" cambia a medianoche local).
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dailyKey = (spreadId) => `daily:${spreadId}`;

const ID_OK = /^[\w\-]+$/;

// Lee el resultado guardado de una tirada "del día": { deckId, picks } o null.
// Queda grabado con el mazo que lo sacó; la app valida las cartas contra ese mazo.
export function readDaily(spread) {
  const v = load(dailyKey(spread.id));
  if (!v || typeof v !== "object" || v.date !== today()) return null;
  if (typeof v.deckId !== "string" || !ID_OK.test(v.deckId)) return null;
  if (!Array.isArray(v.picks) || v.picks.length !== spread.positions.length) return null;
  const ok = v.picks.every((p) =>
    p && typeof p.cardId === "string" && ID_OK.test(p.cardId) && typeof p.reversed === "boolean" &&
    Number.isInteger(p.idx) && p.idx >= 0 && p.idx <= 1000);
  return ok ? { deckId: v.deckId, picks: v.picks } : null;
}

export function writeDaily(deckId, spread, picks) {
  return save(dailyKey(spread.id), { date: today(), deckId, picks });
}

// Mazo favorito (por defecto) de la persona.
export function readFavoriteDeck() {
  const v = load("deck:default");
  return typeof v === "string" && ID_OK.test(v) ? v : null;
}
export function writeFavoriteDeck(id) {
  return ID_OK.test(id) && save("deck:default", id);
}

// Dorso de las cartas: "deck" (el de cada mazo) o uno propio. Solo se aceptan valores conocidos.
const BACKS_OK = ["deck", "yinyang", "luna", "sol"];
export function readBack() {
  const v = load("back:pref");
  return typeof v === "string" && BACKS_OK.includes(v) ? v : "deck";
}
export function writeBack(id) {
  return BACKS_OK.includes(id) && save("back:pref", id);
}

export function clearDaily(spread) {
  remove(dailyKey(spread.id));
}

// ---------- Perfil (nombre + fecha de nacimiento) ----------
// Único punto de acceso a los datos personales. Hoy viven solo en este dispositivo;
// cuando se sume login (Fase 5), solo hay que cambiar estas tres funciones.
export const cleanName = (s) =>
  String(s).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

export function readProfile() {
  const v = load("profile");
  if (!v || typeof v !== "object" || typeof v.name !== "string" || typeof v.birth !== "string") return null;
  const name = cleanName(v.name);
  const birth = parseBirth(v.birth);
  return name && birth ? { name, iso: v.birth, birth } : null;
}

export function writeProfile(name, iso) {
  const n = cleanName(name);
  if (!n || !parseBirth(iso)) return false;
  return save("profile", { name: n, birth: iso });
}

export function clearProfile() {
  remove("profile");
}
