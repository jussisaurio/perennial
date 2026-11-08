// What the garden's things make you think, Spanish (#864). Written in Spanish,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 100, text: "Es para dos.", forms: { es: "ser" } },
  { thing: "bench", unlockAt: 841, text: "Alguien se sentaba aquí cada tarde.", forms: { sentaba: "sentar" }, assumes: ["she-is-gone"] },
  { thing: "bench", unlockAt: 1350, text: "Dos marcas de taza, juntas.", forms: { marcas: "marca", juntas: "junto" } },

  // The bench's first line, the other way round ("caber" is in no deck): the hill was for waiting alone.
  { thing: "stool", unlockAt: 130, text: "Es para uno.", forms: { es: "ser" } },
  { thing: "stool", unlockAt: 496, text: "Muy usado. Muchas noches.", forms: { muchas: "mucho", noches: "noche", usado: "usar" }, assumes: ["the-far-light"] },

  { thing: "pond", unlockAt: 180, text: "Hay un pez. O dos.", forms: { hay: "haber" } },
  { thing: "pond", unlockAt: 602, text: "Los peces miran quién viene.", forms: { los: "el", peces: "pez", miran: "mirar", viene: "venir" } },
  { thing: "pond", unlockAt: 959, text: "Los peces aún esperan su pan.", forms: { los: "el", peces: "pez", esperan: "esperar" }, assumes: ["she-is-gone"] },

  { thing: "sunflower", unlockAt: 355, text: "Mira al sol. A ti, no.", forms: { mira: "mirar", al: "a", ti: "tú" } },
  { thing: "sunflower", unlockAt: 515, text: "Ella sabe cómo se llama.", forms: { sabe: "saber", llama: "llamar" }, assumes: ["learning-the-language"] },
  { thing: "sunflower", unlockAt: 786, text: "Ella lo miraba cada mañana.", forms: { lo: "él", miraba: "mirar" }, assumes: ["she-is-gone"] },

  { thing: "sundial", unlockAt: 473, text: "Sin sol, no hay hora.", forms: { hay: "haber" } },
  { thing: "sundial", unlockAt: 821, text: "Ya nadie mira la hora.", forms: { mira: "mirar", la: "el" }, assumes: ["she-is-gone"] },
  { thing: "sundial", unlockAt: 1750, text: "En la piedra, dos letras pequeñas.", forms: { la: "el", letras: "letra", "pequeñas": "pequeño" } },

  { thing: "hills", unlockAt: 351, text: "De allí no viene nadie.", forms: { viene: "venir" } },
  { thing: "hills", unlockAt: 503, text: "Desde allí, esto se ve pequeño.", forms: { ve: "ver" } },
  { thing: "hills", unlockAt: 896, text: "Allí hay alguien que tampoco duerme.", forms: { duerme: "dormir", hay: "haber" }, assumes: ["the-light-answers"] },

  { thing: "bed", unlockAt: 395, text: "Dos lados. Gana el de ella.", forms: { gana: "ganar", lados: "lado" }, assumes: ["her-garden"] },
  { thing: "bed", unlockAt: 812, text: "El lado de ella. Sigue ganando.", forms: { ganando: "ganar", sigue: "seguir" }, assumes: ["her-side"] },

  { thing: "hedge", unlockAt: 444, text: "El perro tiene mucho que decir.", forms: { tiene: "tener" } },
  { thing: "hedge", unlockAt: 857, text: "Cada mañana, menos agua.", assumes: ["water-for-the-mouse"] },

  { thing: "grass", unlockAt: 240, text: "Más y más. Solo eso." },

  { thing: "stone", unlockAt: 307, text: "Aquí antes que nadie. Sabe cosas.", forms: { cosas: "cosa", sabe: "saber" } },

  { thing: "cherry", unlockAt: 325, text: "Fiesta, una semana. Espera un año.", forms: { espera: "esperar", una: "un" } },

  // Only by day: at dusk and night a tap on a lantern blows it out or lights it (#361).
  { thing: "lantern", unlockAt: 615, text: "Cada noche, amigos. Siempre los mismos.", forms: { amigos: "amigo", los: "el", mismos: "mismo" } },

  { thing: "moon", unlockAt: 732, text: "Otra vez a su hora.", forms: { otra: "otro" } },];
