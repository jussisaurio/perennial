# Accessibility

Rules for every screen. Code reviews check them. Each rule names its source. When a rule and a design idea do not agree, the rule wins.

## 1. A choice is not a button

A button does something. A choice shows a state. They must not look the same.

- **An action** (Download, Start, Delete) is a pill button with a verb. It has an icon when that helps, for example the download arrow.
- **One choice from two to five options** is a segmented control: a sunken track, with the chosen option raised, in bold and with a check. In code: `Segmented` in `web/src/ui/arrows.tsx`. Its roles are `radiogroup` and `radio`, with `aria-checked`. Tab goes into the group once, and the arrow keys move the choice. On a phone, long options stack as a short list. Sources: [APG radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/); [Material 3 segmented buttons](https://m3.material.io/components/segmented-buttons/guidelines) (a check marks the chosen segment); Apple HIG, segmented controls (five or fewer on a phone).
- **A setting that is on or off, and works at once,** is a switch: `Switch` in `arrows.tsx`, role `switch` with `aria-checked`. Space and Enter flip it. Sources: [APG switch](https://www.w3.org/WAI/ARIA/apg/patterns/switch/); [NN/g, toggle switch guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/).
- **A choice that is part of a form or a long list** (the course language at the start) uses real radio inputs. Source: [GOV.UK radios](https://design-system.service.gov.uk/components/radios/).
- **An icon button in a toolbar that turns something on or off** (sound and growing plants in the session bar) is a toggle button with `aria-pressed`. Its label does not change; only the state does. Source: [APG button](https://www.w3.org/WAI/ARIA/apg/patterns/button/).

Do not make "X on" and "X off" two side-by-side buttons. A reader cannot tell if the marked one is the state now or the thing a tap will do. A switch label says what the setting does ("Speak words aloud"). It does not say "on" or "off", and it never changes with the state. Sources: APG switch ("the label on a switch does not change when its state changes"); NN/g toggle switches.

## 2. The state is never shown by color alone

The chosen, checked, on, wrong or new state also has a shape, a mark, a word or a position: a check, a moved switch thumb, bold text, "here now". Test it: in grayscale, can you still tell? Sources: [WCAG 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html); [Apple, On/Off Labels](https://support.apple.com/en-us/111773) (iOS adds marks to switches for the same reason).

The mark that shows a state, and the edge of a control, have a contrast of 3:1 or more against what is next to them, in light and dark. Text has 4.5:1. Text in an accent colour uses the accent's ink token (`--leaf-ink`, `--sky-ink`, `--persimmon-ink`, `--sun-ink` in `index.css`): on the light paper the plain accent is too faint for text. Source: [WCAG 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## 3. Focus is always visible

Every control shows a clear ring when it has keyboard focus: the persimmon outline from `:focus-visible` in `index.css`. Do not remove it without a ring of the same strength (3:1 against the page). Nothing (the tab bar, a toast, a sheet) may cover the focused control. Sources: [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html); [WCAG 2.4.11 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

## 4. Targets are big enough

A tap target is at least 24 by 24 CSS pixels, or has 24 pixels of space around it. Aim for 44 for the main controls, as Apple asks. Make the whole row the target where you can, as the switch row is. Sources: [WCAG 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html); Apple HIG, layout.

## 5. The device's setting wins, and the screen says so

When the device asks for something (less motion, dark colors, sound off), we follow it. If one of our settings cannot work because of it, do not show it as on while it does nothing. Show it off and blocked, and say why in its help line. Keep it focusable (`aria-disabled`, not `disabled`), so a screen reader still hears the reason. Example: with reduced motion, the growing plants switch shows off and says "Your device asks for less motion". Sources: [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html); [APG, focusability of disabled controls](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#focusabilityofdisabledcontrols).

## 6. Motion is small, and reduced motion stops it

Motion is never needed to understand a screen. With `prefers-reduced-motion: reduce`, transitions end at once (`index.css`), the growing moment does not play, and the garden's sway and glow stop. A new animation must check this too. Source: WCAG 2.3.3.

## 7. The garden walk has another way in

The 3D walk is for joy, not for learning. Everything you need to learn (your words, how well you know them) is also in Today, Words and the field guide, which work with a keyboard and a screen reader. The walk has keyboard controls and named buttons, and a status line tells a screen reader what is near. A Next plant button opens a plant's card; it is hidden until Tab reaches it, because others find plants by walking. A new garden feature that carries information must say it in text too. Source: [WCAG 1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html).

## 8. Sound has words, and sound off is a real choice

Every word and sentence that is spoken is also shown as text, at the latest after the answer. Listening exercises test hearing on purpose, so they are the one exception; with sound off they do not come. Nothing plays by itself for more than a few seconds. Sources: [WCAG 1.2.1 Audio-only](https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html); [WCAG 1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html).

## 9. Course-language text has its language

Every word or sentence in the course language has `lang` set to it (`<span lang={tag}>`), so a screen reader reads it with the right voice, and the browser picks the right font and hyphens. English UI text needs nothing. Source: [WCAG 3.1.2 Language of Parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html).

## Places that break a rule now

- **Course words without `lang`** (rule 9): the big word on a new card (`Intro` in `Session.tsx`), the word list rows (`Words.tsx`) and the field guide. Issue #692.
- **Word colors in Add words** (rule 2): "new" and "learning" words differ only by background color, and a screen reader does not hear the state. Picked and added words already have a check. Issue #693.
- **Focus on text fields and the slider** (rules 3, 2): the focus halo is a pale sun color, about 1.1:1 on the paper. A field's border also darkens, but the slider's thumb only gets the halo. Issue #694.
