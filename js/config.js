// Configuración central. Cambiá valores acá, no en el resto del código.
export const CONFIG = Object.freeze({
  appName: "Oráculo",
  reversedChance: 0.25,          // probabilidad de carta invertida (0 a 1)
  storagePrefix: "oraculo:v1:",  // versionar permite migrar datos más adelante
  // Banderas para fases futuras. Todas apagadas en el MVP.
  features: Object.freeze({
    liveAI: false,    // Fase 3+: mensaje generado en vivo (solo online)
    login: false,     // Fase 5: cuentas de usuario
    premium: false,   // Fase 5: mazos/tiradas de pago
    booking: false    // Fase 5: reserva de turnos
  })
});

// Rutas de datos. Los mensajes (IA y tuyos) se comparten entre mazos de la misma "family" (ej. "tarot"),
// porque cada carta tiene el mismo id en todos los mazos de tarot.
export const DECKS_PATH = "data/decks.json";
export const deckPath = (deckId) => `data/decks/${deckId}.json`;
export const messagePaths = (family) => ({
  ai: `data/messages/${family}.json`,
  human: `data/human/${family}.json`
});

export const SPREADS_PATH = "data/spreads.json";

export const ARCANOS_PATH = "data/arcanos.json";
export const ARCANOS_HUMAN_PATH = "data/human/arcanos.json";

export const answersPaths = (family) => ({
  ai: `data/answers/${family}.json`,
  human: "data/human/answers.json"
});
