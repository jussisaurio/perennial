// What the garden's things make you think, Spanish (#864). Written in Spanish,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 100, text: "Es para dos.", forms: { es: "ser" } },
  { thing: "bench", unlockAt: 450, text: "Alguien se sentaba aquí cada tarde.", forms: { sentaba: "sentar" } },
  { thing: "bench", unlockAt: 1350, text: "Dos marcas de taza, juntas.", forms: { marcas: "marca", juntas: "junto" } },

  { thing: "pond", unlockAt: 180, text: "Hay un pez. O dos.", forms: { hay: "haber" } },
  { thing: "pond", unlockAt: 660, text: "Los peces suben cuando llega alguien.", forms: { los: "el", peces: "pez", suben: "subir", llega: "llegar" } },
  { thing: "pond", unlockAt: 900, text: "Los peces aún esperan su pan.", forms: { los: "el", peces: "pez", esperan: "esperar" } },

  { thing: "sunflower", unlockAt: 120, text: "Siempre mira al sol.", forms: { mira: "mirar", al: "a" } },
  { thing: "sunflower", unlockAt: 600, text: "Cada año, en el mismo sitio." },
  { thing: "sunflower", unlockAt: 1000, text: "Alguien le puso un nombre.", forms: { puso: "poner" } },

  { thing: "sundial", unlockAt: 100, text: "Sabe qué hora es.", forms: { sabe: "saber", es: "ser" } },
  { thing: "sundial", unlockAt: 400, text: "Sin sol, no hay hora.", forms: { hay: "haber" } },
  { thing: "sundial", unlockAt: 1750, text: "En la piedra, dos letras pequeñas.", forms: { la: "el", letras: "letra", "pequeñas": "pequeño" } },

  { thing: "hills", unlockAt: 200, text: "¿Qué hay allí?", forms: { hay: "haber" } },
  { thing: "hills", unlockAt: 450, text: "De allí no viene nadie.", forms: { viene: "venir" } },
  { thing: "hills", unlockAt: 1000, text: "Al otro lado vive alguien.", forms: { al: "a", vive: "vivir" } },
];
