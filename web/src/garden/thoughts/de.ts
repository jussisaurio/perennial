// What the garden's things make you think, German (#864). Written in German,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 180, text: "Sie ist für zwei.", forms: { ist: "sein" } },
  { thing: "bench", unlockAt: 510, text: "Hier saß jeden Abend jemand.", forms: { "saß": "sitzen", jeden: "jeder" } },
  { thing: "bench", unlockAt: 1400, text: "Zwei Ringe im Holz. Von Tassen.", forms: { im: "in", ringe: "ring", tassen: "tasse" } },

  { thing: "pond", unlockAt: 180, text: "Da ist ein Fisch. Oder zwei.", forms: { ist: "sein" } },
  { thing: "pond", unlockAt: 400, text: "Die Fische schauen, wer da kommt.", forms: { die: "der", fische: "fisch", kommt: "kommen" } },
  { thing: "pond", unlockAt: 1200, text: "Die Fische warten noch auf Brot.", forms: { die: "der", fische: "fisch" } },

  { thing: "sunflower", unlockAt: 120, text: "Sie mag die Sonne. Nicht dich.", forms: { mag: "mögen", die: "der", dich: "du" } },
  { thing: "sunflower", unlockAt: 600, text: "Sie lebt nur ein Jahr.", forms: { lebt: "leben" } },
  { thing: "sunflower", unlockAt: 1000, text: "Das war ihre Blume.", forms: { war: "sein", ihre: "ihr" } },

  { thing: "sundial", unlockAt: 350, text: "Ohne Sonne keine Zeit.", forms: { keine: "kein" } },
  { thing: "sundial", unlockAt: 600, text: "Niemand sieht mehr auf die Uhr.", forms: { sieht: "sehen", die: "der" } },
  { thing: "sundial", unlockAt: 1500, text: "Im Stein zwei kleine Zeichen.", forms: { im: "in", kleine: "klein" } },

  { thing: "hills", unlockAt: 310, text: "Von dort kommt nie jemand.", forms: { kommt: "kommen" } },
  { thing: "hills", unlockAt: 460, text: "Du kommst nie bis dort.", forms: { kommst: "kommen" } },
  { thing: "hills", unlockAt: 1000, text: "Auf der anderen Seite wohnt jemand.", forms: { anderen: "andere", wohnt: "wohnen" } },
];
