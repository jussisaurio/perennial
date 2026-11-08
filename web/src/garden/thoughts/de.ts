// What the garden's things make you think, German (#864). Written in German,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 180, text: "Sie ist für zwei.", forms: { ist: "sein" } },
  { thing: "bench", unlockAt: 731, text: "Hier saß jeden Abend jemand.", forms: { "saß": "sitzen", jeden: "jeder" }, assumes: ["she-is-gone"] },
  { thing: "bench", unlockAt: 1400, text: "Zwei Ringe im Holz. Von Tassen.", forms: { im: "in", ringe: "ring", tassen: "tasse" } },

  // The bench's first line, the other way round: the hill was for waiting alone.
  { thing: "stool", unlockAt: 100, text: "Er ist für einen.", forms: { ist: "sein", einen: "ein" } },

  { thing: "pond", unlockAt: 195, text: "Da ist ein Fisch. Oder zwei.", forms: { ist: "sein" } },
  { thing: "pond", unlockAt: 450, text: "Die Fische schauen, wer da kommt.", forms: { die: "der", fische: "fisch", kommt: "kommen" } },
  { thing: "pond", unlockAt: 1250, text: "Die Fische warten noch auf Brot.", forms: { die: "der", fische: "fisch" }, assumes: ["she-is-gone"] },

  { thing: "sunflower", unlockAt: 275, text: "Sie mag die Sonne. Nicht dich.", forms: { mag: "mögen", die: "der", dich: "du" } },
  { thing: "sunflower", unlockAt: 563, text: "Sie lebt nur ein Jahr.", forms: { lebt: "leben" } },
  { thing: "sunflower", unlockAt: 815, text: "Das war ihre Blume.", forms: { war: "sein", ihre: "ihr" }, assumes: ["she-is-gone"] },

  { thing: "sundial", unlockAt: 380, text: "Ohne Sonne keine Zeit.", forms: { keine: "kein" } },
  { thing: "sundial", unlockAt: 704, text: "Niemand sieht mehr auf die Uhr.", forms: { sieht: "sehen", die: "der" }, assumes: ["she-is-gone"] },
  { thing: "sundial", unlockAt: 1500, text: "Im Stein zwei kleine Zeichen.", forms: { im: "in", kleine: "klein" } },

  { thing: "hills", unlockAt: 361, text: "Von dort kommt nie jemand.", forms: { kommt: "kommen" } },
  { thing: "hills", unlockAt: 510, text: "Von dort bist du ganz klein.", forms: { bist: "sein" } },];
