// Cálculo de la Carta natal arcana. Funciones puras (sin DOM), fáciles de probar.
// Reglas de tus apuntes: se reduce por suma teosófica hasta llegar a 22 inclusive.
// El Loco puede ser 0 o 22: acá usamos 22.

export const sumDigits = (n) => String(Math.abs(n)).split("").reduce((a, d) => a + Number(d), 0);

export function reduce(n) {
  if (n === 0) return 22;
  while (n > 22) n = sumDigits(n);
  return n;
}

// Los apuntes usan numeración de Marsella (8 = Justicia, 11 = Fuerza).
// El mazo Rider las tiene invertidas (8 = Fuerza, 11 = Justicia): por eso este mapa al id de carta.
export const NUMBER_TO_CARD = Object.freeze({
  1: "rw-01", 2: "rw-02", 3: "rw-03", 4: "rw-04", 5: "rw-05", 6: "rw-06", 7: "rw-07",
  8: "rw-11", 9: "rw-09", 10: "rw-10", 11: "rw-08", 12: "rw-12", 13: "rw-13", 14: "rw-14",
  15: "rw-15", 16: "rw-16", 17: "rw-17", 18: "rw-18", 19: "rw-19", 20: "rw-20", 21: "rw-21",
  22: "rw-00"
});

export const label = (n) => (n === 22 ? "0 / 22" : String(n));

// birth = { d, m, y } (números). Devuelve los 5 arcanos absolutos.
export function carta({ d, m, y }) {
  return {
    alma: reduce(d),                            // día de nacimiento
    personalidad: reduce(m),                    // mes de nacimiento
    don: reduce(sumDigits(y % 100)),            // suma de los dos últimos dígitos del año
    vidaPasada: reduce(sumDigits(y)),           // suma de los dígitos del año
    mision: reduce(sumDigits(d) + sumDigits(m) + sumDigits(y)) // fecha completa, dígito a dígito (= arcano personal)
  };
}

// Arcano del año: igual que el personal, pero con el año en curso en lugar del de nacimiento.
export function arcanoDelAnio({ d, m }, year) {
  return reduce(sumDigits(d) + sumDigits(m) + sumDigits(year));
}

// Arcanos que se repiten entre los 5 absolutos: { número: veces } (solo los repetidos).
export function repetidos(c) {
  const count = {};
  for (const n of Object.values(c)) count[n] = (count[n] || 0) + 1;
  return Object.fromEntries(Object.entries(count).filter(([, v]) => v > 1));
}

// Valida "AAAA-MM-DD": fecha real, entre 1900 y hoy. Devuelve { d, m, y } o null.
export function parseBirth(iso, now = new Date()) {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!mt) return null;
  const y = Number(mt[1]), m = Number(mt[2]), d = Number(mt[3]);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  if (y < 1900 || dt > now) return null;
  return { d, m, y };
}
