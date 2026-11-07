// Animals never speak in the course voice (#739): each makes a real recorded
// sound, a short mono MP3 in ./sounds, built into the app.
// frog-croak.mp3: Pacific tree frogs by CVLTIV8R, CC0,
// https://freesound.org/people/CVLTIV8R/sounds/852657/
// (the full credit and how it was cut: ./sounds/SOURCES.txt).

import type { AnimalSound } from "../garden/kinds/kind";
import frogCroak from "./sounds/frog-croak.mp3";

export const ANIMAL_SOUNDS: Record<AnimalSound, string> = { frog: frogCroak };
