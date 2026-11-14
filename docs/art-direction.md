# Art direction: one style

Perennial has one look, in the app and in the garden. The garden looks as if the app drew it: **a quiet paper-craft diorama**. Read this before you draw anything new, in 2D or 3D.

## Where it comes from

The owner asked for "a retro 3D garden (flat sprite plants, Paper Mario/Doom style)" (docs/tracker-archive.md, item 30). The first build took the Doom half: a small framebuffer with hard pixels, pixel-art textures, a banded sky and a pixel font. The app took another way: warm paper, ink, soft round shapes. On 2026-11-14 the owner said the gap between the two was "too jarring" and chose one style (#1051). He does not want realism.

So the reference is now the **Paper Mario** half: flat paper cut-outs (plants, creatures, signs) that stand in a clean, softly lit 3D world. Edges are crisp. Colour is flat or gently graded. A cut-out has a thin paper edge or a soft shadow under it.

## The one style

- **Shapes:** simple and low-poly. Boxes, slopes and flat cut-outs. Simple shapes are cheap and they are the charm. Do not add detail to look "better".
- **Plants and creatures:** flat cut-outs that turn to face you. A plant in the garden is the same drawing as the plant on a card and on Today (`ui/plant.tsx`), only bigger.
- **Leaves in a mass** (a hedge): rows of paper sheets, each cut along its top into leaves, each row a little behind the row below, as in a paper model (`web/src/garden/hedge.ts`, #1164). Each leaf has a thin pale cut edge and a soft shadow on the leaves behind it. Not round blobs with leaves painted on.
- **Surfaces:** paper and card. Every surface and cut-out shows the same paper grain (`web/src/garden/paper.ts`, #1164): fine fibres that catch the light from the upper left, and soft, slow changes of tone. A material made with `c.mat` gets it through `paperMaterial`; a sprite or plant shader gets it through `paper()` in `SHADE`. So paint a surface as flat colour, or a soft, slow change of colour, like gouache on card, and do not paint a grain of your own. No pixel noise, no hard speckles, no texture that shimmers when it is far away. Detail is a few crisp shapes a shade darker or lighter: a tuft, a pebble, a plank gap. Draw them big enough that a texel is smaller than a screen pixel up close, and use `paperTexture` (`web/src/garden/textures.ts`). Do not smooth-filter an old pixel texture: it looks blurred and cheap (#1091).
- **Animals and small props:** cut from a few sheets of coloured paper with a sharp knife, laid back to front (`web/src/garden/visitorArt.ts`, #1164). A bold, simple outline shape. A small palette: a base colour, a lighter one, a darker one and one accent. No dark outline: parts stand apart by tone and by overlap. Each part shades the parts under it and shows a thin pale cut edge on its upper left (`LAYER`), the same in the walk and in the app (`web/src/ui/cutout.tsx`). A detail is a crisp cut shape (a stripe as a wedge, a notch in a wing), or a short line for an eye or a mouth in the one near-black. A part that moves turns on a hinge (`turned`), like a paper puppet.
- **Light:** soft and even. Fog and a little aerial tint give depth: far things turn toward the sky's colour. The garden has no scene lights: a solid shows its shape by vertex colours from the one sun (`shade` in `web/src/garden/sceneSprites.ts`), so a face turned from the light is a shade darker. A wooden box is a `woodBox`, so its planks are the same size on every face.
- **The HUD:** the app's own controls. The same typeface, tokens, radii, buttons and line icons as Today and a card (`web/src/index.css`, `web/src/ui/icons.tsx`).

## Plants: cut from coloured paper

A plant (`web/src/ui/plant.tsx`) looks cut from coloured paper with a sharp knife and stacked, back to front (#1164). The references: Matisse's late cut-outs (bold shapes cut straight from colour), Charley Harper's nature prints (few shapes, each one clear), the folded paper flowers of Paper Mario: The Origami King (a light side and a dark side), and the cut-paper flowers of picture books.

- **Few, bold pieces.** Each part is one clean shape: a leaf, a petal, a bud. Curves are smooth and tips are sharp, as a knife cuts them. No wobble, and no small bits that turn to noise far away.
- **No outlines.** A piece stops where its paper stops. To set a piece apart from the one behind it, use a lighter or darker paper, never a dark line around it.
- **Folded down the middle.** A leaf or a petal is folded along its middle line, and the half that faces the light (from the upper left) is a shade lighter. This one fold is the only shading: no gradient on a piece.
- **A small palette for each plant.** At most four tones of the flower's colour: the base, its lit half, a shade for the pieces behind, and one accent in the heart. The leaves and the stem are two muted greens between `--leaf` and `--leaf-2`.
- **Back to front.** The back petals are in the shade tone, the front petals lie over them, and the heart is on top. The leaves are behind the stem, the flowers in front of it.
- **Each family has its own outline.** Far away, in one colour, you can still tell them apart: a daisy is a ring of notched petals; a star has five to seven broad points; a cup is a tulip; a bell hangs from an arch; a cluster is a round dome of florets; a spike is a tapering spire; a pom is a round rosette.
- **The stage shows in the shape.** A sprout is a short stem with two round seed leaves. A bud is a green teardrop in its green cup, so the flower's colour is a surprise. A bloom is the open head. A state is never shown by colour alone (docs/accessibility.md).
- **The flower is the accent.** It is the one strong colour. The green is quiet and holds the plant's weight at its foot.
- **One path per tone.** All the pieces of one tone go into one SVG path (`Cut`, `web/src/ui/plantShapes.ts`), so a plant is about a dozen paths, not hundreds.

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
