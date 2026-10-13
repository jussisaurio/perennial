import { expect, test } from "bun:test";
import { parseGift } from "./gift";

test("a seed link holds a deck word id of a course language, and nothing else (#213)", () => {
  expect(parseGift("es.w.93eb423hjf")).toEqual({ lang: "es", wordId: "es.w.93eb423hjf" });
  expect(parseGift("de.w.1107t4p6be")).toEqual({ lang: "de", wordId: "de.w.1107t4p6be" });
  expect(parseGift("fr.w.93eb423hjf")).toBeNull(); // not a course here
  expect(parseGift("es.u.93eb423hjf")).toBeNull(); // not a deck word
  expect(parseGift("es.w.93eb<script>")).toBeNull();
  expect(parseGift("")).toBeNull();
  expect(parseGift(null)).toBeNull();
});
