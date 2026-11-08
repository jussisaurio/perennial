import { expect, test } from "bun:test";
import { NOTES } from "../garden/notes";
import { INTENDED } from "./intended";

test("every note of both courses says how it should land, and no other id does", () => {
  for (const notes of [NOTES.es, NOTES.de]) expect(Object.keys(INTENDED).sort()).toEqual(notes.map((n) => n.id).sort());
});
