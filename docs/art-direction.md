# Art direction: one style

Perennial has one look, in the app and in the garden. The garden looks as if the app drew it: **a quiet paper-craft diorama**. Read this before you draw anything new, in 2D or 3D.

## Where it comes from

The owner asked for "a retro 3D garden (flat sprite plants, Paper Mario/Doom style)" (docs/tracker-archive.md, item 30). The first build took the Doom half: a small framebuffer with hard pixels, pixel-art textures, a banded sky and a pixel font. The app took another way: warm paper, ink, soft round shapes. On 2026-11-14 the owner said the gap between the two was "too jarring" and chose one style (#1051). He does not want realism.

So the reference is now the **Paper Mario** half: flat paper cut-outs (plants, creatures, signs) that stand in a clean, softly lit 3D world. Edges are crisp. Colour is flat or gently graded. A cut-out has a thin paper edge or a soft shadow under it.

## The one style

- **Shapes:** simple and low-poly. Boxes, slopes and flat cut-outs. Simple shapes are cheap and they are the charm. Do not add detail to look "better".
- **Plants and creatures:** flat cut-outs that turn to face you. A plant in the garden is the same drawing as the plant on a card and on Today (`ui/plant.tsx`), only bigger.
- **Surfaces:** flat colour, or a soft, slow change of colour, like paper or gouache. No pixel noise, no hard speckles, no texture that shimmers when it is far away. Detail is a few crisp shapes a shade darker or lighter: a tuft, a pebble, a plank gap. Draw them big enough that a texel is smaller than a screen pixel up close, and use `paperTexture` (`web/src/garden/textures.ts`). Do not smooth-filter an old pixel texture: it looks blurred and cheap (#1091).
- **Light:** soft and even. Fog and a little aerial tint give depth: far things turn toward the sky's colour.
- **The HUD:** the app's own controls. The same typeface, tokens, radii, buttons and line icons as Today and a card (`web/src/index.css`, `web/src/ui/icons.tsx`).

## Palette

Every garden colour comes from one of the app's tokens in `web/src/index.css`, with less saturation and a warm lean. Use this table to pick a colour for a new thing.

| In the garden | Comes from | How |
|---|---|---|
| Grass, hills | `--leaf`, `--leaf-2`, `--leaf-soft` | between `--leaf` and `--leaf-2`; far hills toward `--leaf-soft` |
| Hedge, brambles, far trees | `--leaf`, `--stem` | darker, toward the ink |
| Paths, bare earth | `--soil-1`, `--soil-2` | as they are |
| Soil in the beds | `--soil-2` | much darker, still warm |
| Wood | `--stem-dry`, `--sun` | warm, not orange |
| Pale paint, paper, notes | `--paper`, `--card` | as they are |
| Water, day sky | `--sky`, `--sky-soft` | the sky fades to `--paper` at the horizon |
| Flowers, fruit, lanterns | `--petal-*`, `--sun`, `--persimmon` | the accents: small spots of colour |
| Night | the dark theme's `--paper` and `--card` | blue-grey ink, not navy |

Day, dusk and night keep their own moods. Day is paper and soft green. Dusk is warm: peach at the horizon, dusty rose above. Night is deep blue-grey ink, close to the dark theme's paper, so the HUD in the dark theme sits well on it.

## Do and don't

Do:
- Use the app's tokens for every HUD colour. At night the HUD uses the dark theme's tokens.
- Keep a plant's drawing the same in 2D and 3D.
- Keep strong accents small: a flower, a lantern, a fruit. Most of the screen is quiet.
- Check a new thing next to Today and a card: does it look like one product?

Don't:
- No pixel font, no pixel icons, no hard dark frames, no scanlines.
- No pixel-noise textures and no nearest-neighbour filtering on new surfaces.
- No saturated "game" green or blue.
- No realism: no photo textures, no detailed models, no heavy post-processing (bloom, depth of field). They cost speed (docs/performance.md) and they break the style.
- No colour as the only sign of a state (docs/accessibility.md).

## Three pictures

**By the pond, by day.** Soft green grass, almost flat, with slow paler patches. A path of warm sand-coloured earth. The pond is a calm blue, lighter at the edges. The sky is pale blue at the top and fades to the colour of paper at the hills. The far hills are pale sage. Near the hills everything is a little paler, as if seen through air. The bench is warm wood. The plants stand up like cut paper, each one the drawing from its card. The Back button, the counts and the sound button are the app's pale pills, with the app's typeface.

**A flower bed at dusk.** The sky goes from dusty rose to peach at the horizon. Everything has a warm tint. The soil in the bed is a deep warm brown. The flowers keep their colours but look a little warmer. A plant's name floats above it in the app's typeface, white with a soft shadow, not in a pixel font.

**The hill at night.** The sky is deep blue-grey, with small soft stars. The ground is dark and cool, but you can still see shapes. A lantern makes a warm round glow. The HUD uses the dark theme: dark cards, cream text. It looks like the dark theme of the app, with the garden behind it.

## How to check

Take pictures with the look tool or the screenshot script (docs/agents.md, "Checks") at a few spots, by day, at dusk and at night, on a phone and a desktop. Put them next to Today and a card. Ask: does it read as one product? Does the garden still have its charm?
