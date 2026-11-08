// The gardener's notes for each course (#654). A course with no entry here
// fails the typecheck.

import type { PerLang } from "../nouns";
import type { WrittenNote } from "./note";
import { NOTES as de } from "./de";
import { NOTES as es } from "./es";

export const NOTES: PerLang<readonly WrittenNote[]> = { es, de };
