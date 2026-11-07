// The gardener's notes, German (#654, story in #639). Written in German, not
// translated. Gardener words no deck teaches: Türchen (the mouse door),
// Krümel (the mouse), Zauntreppe (the stile), Fünkchen (the far light).

import type { Note } from "./note";

export const NOTES: readonly Note[] = [
  {
    id: "n01",
    beat: "early",
    unlockAt: 65,
    text: "Das ist das Haus. Der Garten ist nicht mein Garten. Er ist ihr Garten.\nIch mag keine Schnecken.\nSie sagt, das ist kein Grund.",
    forms: { ist: "sein", keine: "kein", mag: "mögen", sagt: "sagen", schnecken: "schnecke" },
  },
  {
    id: "n02",
    beat: "early",
    unlockAt: 70,
    text: "Sie sagt mir den Namen von einer Blume.\nIch sage ihn auch.\nMorgen weiß ich ihn nicht mehr.\nDie Blume schon.",
    forms: { den: "der", die: "der", einer: "ein", ihn: "er", mir: "ich", namen: "name", sage: "sagen", sagt: "sagen" },
  },
  {
    id: "n03",
    beat: "early",
    unlockAt: 120,
    text: "Heute bin ich den ganzen Tag im Garten.\n~~Der~~ Die Schnecke auch.\nDie Blumen sprechen nicht.\nIch auch nicht. Noch nicht.",
    forms: { bin: "sein", blumen: "blume", den: "der", die: "der", ganzen: "ganz", im: "in" },
  },
  {
    id: "n04",
    beat: "early",
    unlockAt: 140,
    text: "In der Mauer ist ein Türchen. Nicht für mich.\nFür Krümel. Krümel isst unser Brot\nund sagt nie Entschuldigung.\nDie Katze sieht Krümel an. Krümel sieht die Katze an.\nNiemand tut etwas.",
    forms: { die: "der", isst: "essen", ist: "sein", mich: "ich", sagt: "sagen", sieht: "sehen", tut: "tun" },
  },
  {
    id: "n05",
    beat: "stile",
    unlockAt: 250,
    text: "Jeden Abend derselbe Weg: bis ans Ende vom Garten.\nSie geht über die Zauntreppe, ohne zu schauen.\nIch: langsam, vorsichtig.\nSie wartet drüben. Immer.",
    forms: { ans: "an", die: "der", geht: "gehen", jeden: "jeder", vom: "von", wartet: "warten" },
  },
  {
    id: "n06",
    beat: "stile",
    unlockAt: 330,
    text: "Auf ihrem Stuhl aus Holz sitzt man zu tief. Und er ist schief. Das sage ich ihr dauernd.\nSie sagt, er ist bequem, und das Problem sind meine Knie.\nVielleicht.\nAber es ist ihr Stuhl.",
    forms: { ihrem: "ihr", ist: "sein", meine: "mein", sage: "sagen", sagt: "sagen", sind: "sein", sitzt: "sitzen" },
  },
  {
    id: "n07",
    beat: "stile",
    unlockAt: 420,
    text: "Heute ein ganzer Satz, ohne Fehler.\nSie hat Tränen gelacht.\nNicht über den Satz: Ich habe ihn dem dicken Hund von nebenan gesagt.",
    forms: { dem: "der", den: "der", dicken: "dick", ganzer: "ganz", gelacht: "lachen", gesagt: "sagen", habe: "haben", hat: "haben", ihn: "er", "tränen": "träne" },
  },
  {
    id: "n08",
    beat: "lookout",
    unlockAt: 560,
    text: "Hinter der Zauntreppe ein kleiner Berg, rund und grün.\nVon oben, nachts: das Fünkchen,\nein warmes Licht, fern, auf der anderen Seite.\nEs geht nie aus, nicht einmal im Winter.\nSie fragt nicht.",
    forms: { anderen: "andere", fragt: "fragen", geht: "gehen", im: "in", kleiner: "klein", warmes: "warm" },
  },
  {
    id: "n09",
    beat: "lookout",
    unlockAt: 800,
    text: "Das Fünkchen: jemand, der nicht mit mir redet. Stolz, auf beiden Seiten.\nEin dummer Streit, vor elf Wintern.\nDamals konnte ich mich in keiner Sprache entschuldigen.\nJetzt in zwei. Mutig in keiner.",
    forms: { beiden: "beide", dummer: "dumm", keiner: "kein", konnte: "können", mich: "ich", mir: "ich", redet: "reden", seiten: "seite", wintern: "winter" },
  },
  {
    id: "n10",
    beat: "late",
    unlockAt: 1100,
    text: "Deine Blumen an der Mauer bekommen frisches Wasser.\nTäglich.",
    forms: { blumen: "blume", deine: "dein", frisches: "frisch" },
  },
  {
    id: "n11",
    beat: "late",
    unlockAt: 1250,
    text: "Zwei Tassen auf dem runden Tisch. Eine bleibt leer.\nIch stelle sie ans Türchen. Frisches Wasser, ein Schluck für Krümel.\nSturm, die Schnecke, hört mir stets zu und schweigt.",
    forms: { ans: "an", bleibt: "bleiben", dem: "der", die: "der", eine: "ein", frisches: "frisch", "hört": "hören", mir: "ich", runden: "rund", schweigt: "schweigen", stelle: "stellen", tassen: "tasse" },
  },
  {
    id: "n12",
    beat: "late",
    unlockAt: 1420,
    text: "Neulich nachts, in der dunklen Küche: zweimal das Licht aus und an.\nDas Fünkchen antwortete, fern: zweimal.\nNiemand ist über den Berg gekommen.\nKurz grüßen. Das genügt.",
    forms: { antwortete: "antworten", den: "der", dunklen: "dunkel", gekommen: "kommen", "genügt": "genügen", ist: "sein" },
  },
  {
    id: "n13",
    beat: "door",
    unlockAt: 1600,
    text: "Zuletzt: Der Garten ist deiner.\nIch lasse dir den bequemen Stuhl, eine weiche, warme Decke, ein Dutzend gesunde Schnecken.\nUnd das Fünkchen, fern.\nLern langsam, wie Sturm. Wiederholen, üben, ausruhen. Dreimal täglich.\nSchnecken sind kein Grund.",
    forms: { bequemen: "bequem", deiner: "dein", den: "der", dir: "du", eine: "ein", gesunde: "gesund", ist: "sein", lasse: "lassen", lern: "lernen", schnecken: "schnecke", sind: "sein", warme: "warm", weiche: "weich" },
  },
];
