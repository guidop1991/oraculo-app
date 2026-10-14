// Administrador local: herramientas de prueba protegidas con un PIN que se crea en este dispositivo.
// IMPORTANTE: es una protección local (sin servidor). Sirve para que solo vos accedas a las herramientas
// de esta app instalada; no reemplaza una cuenta real. Las cuentas reales (login, premium, turnos) van con
// un servicio de autenticación, más adelante.
import { load, save, remove } from "./storage.js";

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SESSION_KEY = "oraculo:v1:admin-session";
const PIN_RE = /^\d{6,12}$/;
const ITER = 150000;

async function derive(pin, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
}

export const validPin = (pin) => PIN_RE.test(pin);

export function hasPin() {
  const p = load("admin:pin");
  return !!(p && typeof p.salt === "string" && typeof p.hash === "string");
}

export function isUnlocked() {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}

export function lock() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nada */ }
}

function unlock() {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* nada */ }
}

export async function setPin(pin) {
  if (!validPin(pin)) return false;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  const ok = save("admin:pin", { salt: toB64(salt), hash: toB64(hash), v: 1 });
  if (ok) { remove("admin:fail"); unlock(); }
  return ok;
}

// Devuelve { ok, wait }: wait = segundos de espera si hay demasiados intentos fallidos.
export async function verifyPin(pin) {
  const fail = load("admin:fail") || { n: 0, until: 0 };
  const now = Date.now();
  if (fail.until > now) return { ok: false, wait: Math.ceil((fail.until - now) / 1000) };
  const p = load("admin:pin");
  if (!p || !validPin(pin)) return { ok: false, wait: 0 };
  let same = false;
  try {
    const h = new Uint8Array(await derive(pin, fromB64(p.salt)));
    const ref = fromB64(p.hash);
    same = h.length === ref.length && h.every((b, i) => b === ref[i]);
  } catch { same = false; }
  if (same) { remove("admin:fail"); unlock(); return { ok: true, wait: 0 }; }
  const n = (fail.n || 0) + 1;
  const wait = n >= 5 ? Math.min(600, 30 * (n - 4)) : 0;
  save("admin:fail", { n, until: wait ? now + wait * 1000 : 0 });
  return { ok: false, wait };
}

export function resetPin() {
  remove("admin:pin");
  remove("admin:fail");
  lock();
}
