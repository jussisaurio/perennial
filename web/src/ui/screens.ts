// The screens other than Today, each in its own chunk, so the script that draws
// Today first is smaller and quicker to start (#481). They are fetched before they
// are opened (App.tsx), so opening a tab does not wait for the network: the
// Session screen first, with the deck's sentences, as a session needs both.

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

// A failed preload is not an error yet: opening the screen imports it again and shows that error.
export const preloadSession = () => void session().catch(() => {});

export function preloadScreens() {
  for (const load of [session, walk, words, settings]) load().catch(() => {});
}
