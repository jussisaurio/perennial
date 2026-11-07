// The gardener's notes, Spanish (#654, story in #639). Written in Spanish, not
// translated. Gardener words no deck teaches: puertecilla (the mouse door),
// Migas (the mouse), saltavallas (the stile), lucero (the far light).

import type { Note } from "./note";

export const NOTES: readonly Note[] = [
  {
    id: "n01",
    beat: "early",
    unlockAt: 60,
    text: "Esta es la casa. El jardín no es mío. Es de ella.\nNo me gustan los caracoles.\nElla dice que eso no es razón.",
    forms: { caracoles: "caracol", dice: "decir", es: "ser", esta: "este", gustan: "gustar", la: "el", los: "el" },
  },
  {
    id: "n02",
    beat: "early",
    unlockAt: 70,
    text: "Ella dice el nombre de una flor.\nYo también lo digo.\nMañana ya no lo sé.\nLa flor sí lo sabe.",
    forms: { dice: "decir", digo: "decir", la: "el", sabe: "saber", "sé": "saber", una: "un" },
  },
  {
    id: "n03",
    beat: "early",
    unlockAt: 120,
    text: "Hoy ~~soy~~ estoy en el jardín todo el día.\nLas plantas no hablan.\nYo tampoco. Todavía.",
    forms: { estoy: "estar", hablan: "hablar", las: "el", plantas: "planta" },
  },
  {
    id: "n04",
    beat: "early",
    unlockAt: 160,
    text: "En la pared hay una puertecilla. No es para mí.\nEs para Migas. Migas se come nuestro pan\ny no pide perdón.\nEl gato mira a Migas. Migas mira al gato.\nNadie hace nada.",
    forms: { al: "a", come: "comer", es: "ser", hace: "hacer", hay: "haber", la: "el", mira: "mirar", pide: "pedir", una: "un" },
  },
  {
    id: "n05",
    beat: "stile",
    unlockAt: 250,
    text: "Cada tarde, el mismo paseo: hasta el fondo del jardín.\nElla salta el saltavallas sin mirar.\nYo, despacio, con cuidado.\nElla me espera al otro lado. Siempre.",
    forms: { al: "a", del: "de", espera: "esperar", salta: "saltar" },
  },
  {
    id: "n06",
    beat: "stile",
    unlockAt: 330,
    text: "Su silla de madera es demasiado baja. Se lo repito cada mañana.\nElla dice que es cómoda, y que el problema son mis rodillas.\nPuede ser.\nPero la silla es suya.",
    forms: { baja: "bajo", "cómoda": "cómodo", dice: "decir", es: "ser", la: "el", mis: "mi", puede: "poder", repito: "repetir", rodillas: "rodilla", son: "ser", suya: "suyo" },
  },
  {
    id: "n07",
    beat: "stile",
    unlockAt: 420,
    text: "Hoy, una frase larga, entera, sin errores.\nElla se ha reído hasta llorar.\nNo por la frase: se la había dicho al perro del vecino.",
    forms: { al: "a", del: "de", dicho: "decir", entera: "entero", errores: "error", ha: "haber", "había": "haber", la: "el", larga: "largo", "reído": "reír", una: "un" },
  },
  {
    id: "n08",
    beat: "lookout",
    unlockAt: 620,
    text: "Tras el saltavallas, una colina.\nDesde la cima, a medianoche: el lucero,\nuna luz amarilla al otro lado del valle.\nNunca se apaga, ni en invierno.\nElla no pregunta.",
    forms: { al: "a", amarilla: "amarillo", apaga: "apagar", del: "de", la: "el", una: "un" },
  },
  {
    id: "n09",
    beat: "lookout",
    unlockAt: 760,
    text: "El lucero: alguien que no me habla. Orgullo, por ambas partes.\nUna discusión absurda, hace once inviernos.\nEntonces no sabía pedir disculpas en ninguna lengua.\nAhora, en dos. Valor, en ninguna.",
    forms: { absurda: "absurdo", ambas: "ambos", disculpas: "disculpa", habla: "hablar", hace: "hacer", inviernos: "invierno", ninguna: "ninguno", partes: "parte", "sabía": "saber", una: "un" },
  },
  {
    id: "n10",
    beat: "late",
    unlockAt: 1100,
    text: "A tus rosas también les he echado agua.\nPor pura costumbre.",
    forms: { echado: "echar", he: "haber", les: "le", pura: "puro", rosas: "rosa", tus: "tu" },
  },
  {
    id: "n11",
    beat: "late",
    unlockAt: 1250,
    text: "Dos tazas en la mesa de madera. Una, vacía.\nLa dejo junto a la puertecilla, con agua fresca. Migas tiene sed.\nRayo, el caracol: lento, quieto, paciente.\nMe escucha sin interrumpir.",
    forms: { dejo: "dejar", escucha: "escuchar", fresca: "fresco", la: "el", tazas: "taza", tiene: "tener", una: "un", "vacía": "vacío" },
  },
  {
    id: "n12",
    beat: "late",
    unlockAt: 1420,
    text: "Anoche, a medianoche, apagué dos veces la luz del pasillo.\nEl lucero respondió: dos veces.\nNadie ha cruzado el valle.\nUn saludo breve. Suficiente.",
    forms: { "apagué": "apagar", cruzado: "cruzar", del: "de", ha: "haber", la: "el", "respondió": "responder", veces: "vez" },
  },
  {
    id: "n13",
    beat: "door",
    unlockAt: 1600,
    text: "Última nota, breve: el jardín es tuyo.\nTe dejo herramientas, guantes secos, una docena de caracoles sanos.\nY el lucero, desde la cima de la colina.\nAprende lentamente, como Rayo.\nLos caracoles no son razón.",
    forms: { aprende: "aprender", caracoles: "caracol", dejo: "dejar", es: "ser", guantes: "guante", herramientas: "herramienta", la: "el", los: "el", sanos: "sano", secos: "seco", son: "ser", una: "un", "última": "último" },
  },
];
