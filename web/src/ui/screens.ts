// The screens other than Today, each in its own chunk, so the script that draws
// Today first is smaller and quicker to start (#481). preloadScreens fetches them
// once Today is up, so opening a tab does not wait for the network.

import { lazy } from "react";

const session = () => import("./Session");
const walk = () => import("./GardenWalk");
const words = () => import("./Words");
const settings = () => import("./Settings");

export const SessionScreen = lazy(() => session().then((m) => ({ default: m.SessionScreen })));
export const LearnerGardenWalk = lazy(() => walk().then((m) => ({ default: m.LearnerGardenWalk })));
export const GardenWalk = lazy(() => walk().then((m) => ({ default: m.GardenWalk })));
export const WordsScreen = lazy(() => words().then((m) => ({ default: m.WordsScreen })));
export const SettingsScreen = lazy(() => settings().then((m) => ({ default: m.SettingsScreen })));

export function preloadScreens() {
  for (const load of [session, walk, words, settings])
    // A failed preload is not an error yet: opening the screen imports it again and shows that error.
    load().catch(() => {});
}
