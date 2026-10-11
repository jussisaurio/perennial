// Seeds a course with many words at varied memory strength, for garden tests and screenshots.
import type { Page } from "@playwright/test";

const WORDS: [string, string, string][] = (
  "casa:house:noun perro:dog:noun gato:cat:noun agua:water:noun libro:book:noun mesa:table:noun día:day:noun noche:night:noun ciudad:city:noun amigo:friend:noun tiempo:time:noun mundo:world:noun vida:life:noun mano:hand:noun ojo:eye:noun hombre:man:noun mujer:woman:noun niño:child:noun calle:street:noun puerta:door:noun árbol:tree:noun flor:flower:noun sol:sun:noun luna:moon:noun cielo:sky:noun mar:sea:noun pan:bread:noun leche:milk:noun café:coffee:noun tren:train:noun " +
  "ser:to be:verb estar:to be:verb tener:to have:verb hacer:to do:verb ir:to go:verb ver:to see:verb dar:to give:verb saber:to know:verb querer:to want:verb llegar:to arrive:verb pasar:to pass:verb deber:to owe:verb poner:to put:verb parecer:to seem:verb quedar:to stay:verb creer:to believe:verb hablar:to speak:verb llevar:to carry:verb dejar:to leave:verb seguir:to follow:verb encontrar:to find:verb llamar:to call:verb venir:to come:verb pensar:to think:verb salir:to go out:verb volver:to return:verb comer:to eat:verb " +
  "bueno:good:adj grande:big:adj nuevo:new:adj pequeño:small:adj mismo:same:adj largo:long:adj viejo:old:adj alto:tall:adj feliz:happy:adj bonito:pretty:adj rojo:red:adj verde:green:adj " +
  "muy:very:adv bien:well:adv aquí:here:adv ahora:now:adv siempre:always:adv nunca:never:adv también:also:adv " +
  "el:the:det de:of:prep que:that:conj y:and:conj en:in:prep un:a:det por:for:prep con:with:prep para:for:prep pero:but:conj yo:I:pron tú:you:pron " +
  "por favor:please:phrase de nada:you're welcome:phrase buenos días:good morning:phrase"
)
  .split(" ")
  .reduce<string[]>((acc, w) => {
    // re-join multi-word phrases split on spaces
    if (acc.length && !acc[acc.length - 1].match(/:[^:]+:[a-z]+$/)) acc[acc.length - 1] += " " + w;
    else acc.push(w);
    return acc;
  }, [])
  .map((w) => w.split(":") as [string, string, string]);

export async function seedGarden(page: Page, extra = 0) {
  await page.goto("/");
  await page.evaluate(
    async ({ words, extra }) => {
      const { db } = await import("/src/db/db.ts");
      const now = Date.now();
      const courseId = "seed-es";
      await db.courses.put({ id: courseId, lang: "es", native: "English", minutes: 7, retention: 0.9, createdAt: now });
      const all = [...words];
      for (let i = 0; i < extra; i++) all.push([`palabra${i}`, `word ${i}`, ["noun", "verb", "adj"][i % 3]]);
      let i = 0;
      const lexemes = [];
      const memory = [];
      for (const [lemma, gloss, pos] of all) {
        const id = `lx${i}`;
        lexemes.push({ id, courseId, lemma, gloss, pos, rank: i, forms: [lemma], addedAt: now });
        // A spread of strengths: sprouts, buds and blooms, some a little thirsty.
        const s = [0.6, 2, 4, 8, 15, 30, 60, 120][(i * 7) % 8];
        const ago = ((i * 13) % 9) * 86400000 * (s > 10 ? 3 : 0.4);
        memory.push({ key: `${id}:read`, courseId, lexemeId: id, skill: "read", s, d: 5, lastTs: now - ago, due: now + 86400000, reps: 3, lapses: 0 });
        i++;
      }
      await db.lexemes.bulkPut(lexemes);
      await db.memory.bulkPut(memory);
      await db.meta.put({ k: "course", v: courseId });
    },
    { words: WORDS, extra },
  );
}
