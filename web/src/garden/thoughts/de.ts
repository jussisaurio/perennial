// What the garden's things make you think, German (#864). Written in German,
// not translated. They notice; they never explain (the story is #639's).

import type { Thought } from "./thought";

export const THOUGHTS: readonly Thought[] = [
  { thing: "bench", unlockAt: 180, text: "Sie ist für zwei.", forms: { ist: "sein" } },
  { thing: "bench", unlockAt: 731, text: "Hier saß jeden Abend jemand.", forms: { "saß": "sitzen", jeden: "jeder" }, assumes: ["she-is-gone"] },
  { thing: "bench", unlockAt: 1400, text: "Zwei Ringe im Holz. Von Tassen.", forms: { im: "in", ringe: "ring", tassen: "tasse" } },

  // The bench's first line, the other way round: the hill was for waiting alone.
  { thing: "stool", unlockAt: 100, text: "Er ist für einen.", forms: { ist: "sein", einen: "ein" } },
  { thing: "stool", unlockAt: 504, text: "Er kennt viele Nächte.", forms: { kennt: "kennen", "nächte": "nacht", viele: "viel" }, assumes: ["the-far-light"] },

  { thing: "pond", unlockAt: 195, text: "Da ist ein Fisch. Oder zwei.", forms: { ist: "sein" } },
  { thing: "pond", unlockAt: 450, text: "Die Fische schauen, wer da kommt.", forms: { die: "der", fische: "fisch", kommt: "kommen" } },
  { thing: "pond", unlockAt: 1250, text: "Die Fische warten noch auf Brot.", forms: { die: "der", fische: "fisch" }, assumes: ["she-is-gone"] },

  { thing: "sunflower", unlockAt: 275, text: "Sie mag die Sonne. Nicht dich.", forms: { mag: "mögen", die: "der", dich: "du" } },
  // "Das Ding", not "sie": "sie" could be the flower, and the line means her (#936).
  { thing: "sunflower", unlockAt: 563, text: "Sie weiß, wie das Ding heißt.", forms: { das: "der", "heißt": "heißen", "weiß": "wissen" }, assumes: ["learning-the-language"] },
  { thing: "sunflower", unlockAt: 815, text: "Das war ihre Blume.", forms: { war: "sein", ihre: "ihr" }, assumes: ["she-is-gone"] },

  { thing: "sundial", unlockAt: 380, text: "Ohne Sonne keine Zeit.", forms: { keine: "kein" } },
  { thing: "sundial", unlockAt: 704, text: "Niemand sieht mehr auf die Uhr.", forms: { sieht: "sehen", die: "der" }, assumes: ["she-is-gone"] },
  { thing: "sundial", unlockAt: 1500, text: "Im Stein zwei kleine Zeichen.", forms: { im: "in", kleine: "klein" } },

  { thing: "hills", unlockAt: 361, text: "Von dort kommt nie jemand.", forms: { kommt: "kommen" } },
  { thing: "hills", unlockAt: 510, text: "Von dort bist du ganz klein.", forms: { bist: "sein" } },
  { thing: "hills", unlockAt: 813, text: "Dort schläft auch jemand nicht.", forms: { "schläft": "schlafen" }, assumes: ["the-light-answers"] },

  { thing: "bed", unlockAt: 369, text: "Zwei Seiten. Ihre ist schöner.", forms: { ihre: "ihr", ist: "sein", "schöner": "schön", seiten: "seite" }, assumes: ["her-garden"] },
  { thing: "bed", unlockAt: 726, text: "Ihre Seite. Immer noch schöner.", forms: { ihre: "ihr", "schöner": "schön" }, assumes: ["her-side"] },

  { thing: "hedge", unlockAt: 475, text: "Der Hund erklärt etwas. Sehr lange.", forms: { "erklärt": "erklären" } },
  { thing: "hedge", unlockAt: 771, text: "Jeden Morgen weniger Wasser.", forms: { jeden: "jeder", weniger: "wenig" }, assumes: ["water-for-the-mouse"] },

  { thing: "grass", unlockAt: 244, text: "Will immer mehr. Nur das.", forms: { will: "wollen" } },

  { thing: "stone", unlockAt: 318, text: "Schon immer hier. Er weiß viel.", forms: { "weiß": "wissen" } },

  { thing: "cherry", unlockAt: 402, text: "Eine Woche Party, ein Jahr warten.", forms: { eine: "ein" } },

  // Only by day: at dusk and night a tap on a lantern blows it out or lights it (#361).
  { thing: "lantern", unlockAt: 589, text: "Jede Nacht Freunde. Immer dieselben.", forms: { dieselben: "derselbe", freunde: "freund", jede: "jeder" } },

  { thing: "moon", unlockAt: 658, text: "Wieder da. Auf die Minute genau.", forms: { die: "der" } },];
