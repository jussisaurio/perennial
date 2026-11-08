// What the garden's things make you think, Spanish (#864). Written in Spanish,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 100, text: "Es para dos.", forms: { es: "ser" } },
  { thing: "bench", unlockAt: 860, text: "Alguien se sentaba aquí cada tarde.", forms: { sentaba: "sentar" }, assumes: ["she-is-gone"] },
  { thing: "bench", unlockAt: 1350, text: "Dos marcas de taza, juntas.", forms: { marcas: "marca", juntas: "junto" } },

  // The bench's first line, the other way round ("caber" is in no deck): the hill was for waiting alone.
  { thing: "stool", unlockAt: 130, text: "Es para uno.", forms: { es: "ser" } },

  { thing: "pond", unlockAt: 180, text: "Hay un pez. O dos.", forms: { hay: "haber" } },
  { thing: "pond", unlockAt: 605, text: "Los peces miran quién viene.", forms: { los: "el", peces: "pez", miran: "mirar", viene: "venir" } },
  { thing: "pond", unlockAt: 905, text: "Los peces aún esperan su pan.", forms: { los: "el", peces: "pez", esperan: "esperar" }, assumes: ["she-is-gone"] },

  { thing: "sunflower", unlockAt: 355, text: "Mira al sol. A ti, no.", forms: { mira: "mirar", al: "a", ti: "tú" } },
  { thing: "sunflower", unlockAt: 530, text: "Ella sabe cómo se llama.", forms: { sabe: "saber", llama: "llamar" }, assumes: ["learning-the-language"] },
  { thing: "sunflower", unlockAt: 785, text: "Ella lo miraba cada mañana.", forms: { lo: "él", miraba: "mirar" }, assumes: ["she-is-gone"] },

  { thing: "sundial", unlockAt: 380, text: "Sin sol, no hay hora.", forms: { hay: "haber" } },
  { thing: "sundial", unlockAt: 825, text: "Ya nadie mira la hora.", forms: { mira: "mirar", la: "el" }, assumes: ["she-is-gone"] },
  { thing: "sundial", unlockAt: 1750, text: "En la piedra, dos letras pequeñas.", forms: { la: "el", letras: "letra", "pequeñas": "pequeño" } },

  { thing: "hills", unlockAt: 290, text: "De allí no viene nadie.", forms: { viene: "venir" } },
  { thing: "hills", unlockAt: 460, text: "Desde allí, esto se ve pequeño.", forms: { ve: "ver" } },];
