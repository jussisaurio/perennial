import { expect, test } from "bun:test";
import { check, differences } from "./answer";

test("answer checking", () => {
  expect(check("Casa", "casa")).toBe("exact");
  expect(check("  casa! ", "casa")).toBe("exact");
  expect(check("esta", "está")).toBe("accent");
  expect(check("perro", "pero")).toBe("wrong"); // too short for typo leniency
  expect(check("casaa", "casas")).toBe("wrong"); // ending differs: a different form
  expect(check("escrubir", "escribir")).toBe("typo");
  expect(check("gato", "perro")).toBe("wrong");
  expect(check("", "x")).toBe("wrong");
  expect(check("si", "sí")).toBe("accent");
  expect(check("ni", "sí")).toBe("wrong"); // short words: no typo leniency
  expect(check("食べる", ["たべる", "食べる"])).toBe("exact");
});

test("Spanish and German specifics", () => {
  expect(check("ano", "año", "es")).toBe("accent"); // hard to type: accepted with a warning
  expect(check("cancion", "canción", "es")).toBe("accent");
  expect(check("schoen", "schön", "de")).toBe("exact"); // standard umlaut spelling
  expect(check("Strasse", "Straße", "de")).toBe("exact");
  expect(check("Mutter", "Mütter", "de")).toBe("accent"); // missing umlaut: accepted with a warning
  expect(check("schon", "schön", "de")).toBe("accent");
  expect(check("Mädschen", "Mädchen", "de")).toBe("typo"); // an ordinary slip
});

test("letters with marks are distinct letters where the language says so", () => {
  expect(check("saari", "sääri", "fi")).toBe("wrong");
  expect(check("esta", "está", "es")).toBe("accent");
  expect(check("kaikkx", "kaikki", "fi")).toBe("wrong"); // last letters: a case ending, not a typo
  expect(check("talon", "talot", "fi")).toBe("wrong");
  expect(check("kirjosto", "kirjasto", "fi")).toBe("typo");
});

test("differences point at the letters to look at", () => {
  expect([...differences("ano", "año")]).toEqual([1]);
  expect([...differences("cancion", "canción")]).toEqual([5]);
  expect([...differences("escrubir", "escribir")]).toEqual([4]);
});
