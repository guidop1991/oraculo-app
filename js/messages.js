// Jerarquía de mensajes: humano > IA pre-generado > IA en vivo (solo online, opcional).
import { CONFIG } from "./config.js";

function list(source, cardId, orientation) {
  const arr = source?.messages?.[cardId]?.[orientation];
  return Array.isArray(arr) ? arr.filter((t) => typeof t === "string" && t.trim()) : [];
}

// Devuelve { text, source } de forma determinística según idx (así es estable en el día).
export function resolveMessage({ human, ai }, cardId, reversed, idx) {
  const o = reversed ? "reversed" : "upright";

  const h = list(human, cardId, o);
  if (h.length) return { text: h[idx % h.length], source: "humano" };

  const a = list(ai, cardId, o);
  if (a.length) return { text: a[idx % a.length], source: "ia" };

  return { text: null, source: "none" };
}

// Cantidad de variantes disponibles (para elegir idx al sacar la carta).
export function variantCount({ human, ai }, cardId, reversed) {
  const o = reversed ? "reversed" : "upright";
  const h = list(human, cardId, o).length;
  return h || list(ai, cardId, o).length || 1;
}

// Capa 3 (futura): generación en vivo. Apagada por defecto; nunca bloquea la app.
export async function liveMessage(/* card, reversed */) {
  if (!CONFIG.features.liveAI || !navigator.onLine) return null;
  return null; // acá irá la llamada a tu backend (nunca la API key en el navegador)
}
