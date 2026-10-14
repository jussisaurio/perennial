// A field guide page as a picture to share (#225): the pressed flower, the word,
// its Latin name and meaning, a rare mark, and where it grew. Always the light
// paper look, whatever the app's theme, so it reads the same wherever it goes.
// No counts, no streaks, nothing about the learner.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlantStage } from "../core/memory";
import { growthOf } from "../garden/plants";
import { FORM, PlantForm, plantFrame } from "./plant";
import { loadImage } from "./files";

const W = 1080;
const H = 1350;
/** Text stays this wide, inside the 880px card. */
const TEXT_W = 760;
// The light theme's colours and fonts, from index.css: the picture keeps them whatever the app's theme.
const PAPER = "#f3eee4";
const CARD = "#fbf8f1";
const LINE = "#ddd3c1";
const INK = "#1d1b16";
const MUTED = "#6f685b";
const PERSIMMON = "#dc5636";
const SOIL = "#d9ccb2";
const DISPLAY = '"Gloock", "Iowan Old Style", Palatino, Georgia, serif';
const BODY = '"Onest Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

export interface PageImage {
  lemma: string;
  gloss: string;
  latin?: string;
  rare?: string;
  s: number;
  stage: PlantStage;
}

/** The plant as an image: an SVG with literal colours (CSS variables do not resolve inside an image). */
function plantSvg(p: PageImage, size: number): string {
  const side = plantFrame(p.lemma, p.s, p.stage);
  const plant = renderToStaticMarkup(createElement(PlantForm, { word: p.lemma, growth: growthOf(p.s), form: FORM[p.stage], scale: 1.05 }));
  // A little room below the soil line, so the soil's mound is whole.
  const below = side * 0.1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * (1 + below / side)}" viewBox="${-side / 2} ${-(side - 8)} ${side} ${side + below}"><ellipse cx="0" cy="3" rx="${side * 0.3}" ry="${side * 0.06}" fill="${SOIL}"/>${plant}</svg>`;
}

/** At most `max` lines of at most `width` px, broken between words. Text that needs more ends in "…". */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= max) return lines;
  let end = lines[max - 1];
  while (end.includes(" ") && ctx.measureText(`${end}…`).width > width) end = end.slice(0, end.lastIndexOf(" "));
  return [...lines.slice(0, max - 1), `${end}…`];
}

/** The picture, as a PNG. */
export async function pageImage(p: PageImage): Promise<Blob> {
  // Web fonts: load the letters this page uses, or they fall back to Georgia and system-ui. Most words have no Latin name.
  await Promise.all([document.fonts.load(`400 120px ${DISPLAY}`, p.lemma + (p.latin ?? "")), document.fonts.load(`400 44px ${BODY}`, p.gloss)]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  // The page, mounted with a slight tilt, as in the field guide.
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.012);
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = CARD;
  ctx.fillRect(-440, -580, 880, 1160);
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(-440, -580, 880, 1160);
  ctx.restore();

  const plant = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(plantSvg(p, 600))}`);
  ctx.drawImage(plant, (W - 600) / 2, 100, 600, plant.height);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  // A long word ("definitivamente") gets a smaller size, so it stays on the card.
  ctx.font = `400 132px ${DISPLAY}`;
  ctx.font = `400 ${Math.min(132, Math.floor((132 * TEXT_W) / ctx.measureText(p.lemma).width))}px ${DISPLAY}`;
  ctx.fillText(p.lemma, W / 2, 860);
  let y = 860;
  if (p.latin) {
    ctx.fillStyle = MUTED;
    ctx.font = `italic 46px ${DISPLAY}`;
    ctx.fillText(p.latin, W / 2, (y += 72));
  }
  ctx.fillStyle = INK;
  ctx.font = `400 44px ${BODY}`;
  y += 22;
  // Three lines fit above the footer; deck meanings need at most two.
  for (const line of wrap(ctx, p.gloss, TEXT_W, 3)) ctx.fillText(line, W / 2, (y += 58));
  if (p.rare) {
    ctx.fillStyle = PERSIMMON;
    ctx.font = `600 30px ${BODY}`;
    ctx.fillText(p.rare.toUpperCase(), W / 2, (y += 66));
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 30px ${BODY}`;
  // On the paper below the card, clear of a long meaning.
  ctx.fillText(`Grown in Perennial · ${location.host}`, W / 2, H - 34);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the picture could not be made"))), "image/png"));
}
