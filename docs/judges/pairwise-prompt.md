This is a blind test of judges for issue #1004 in the Perennial repo: can an agent tell which of two versions of a screen is better?

Folder: {DIR}
It holds two versions, A and B, of the same screen of an app, or of the same few moments in it: A-1.png, A-2.png, ... and B-1.png, B-2.png, ... (A-n and B-n show the same moment). For some moments it also holds A-n-zoom.png and B-n-zoom.png: the same part of A-n and B-n, enlarged so that small text can be read. A zoom does not say whether that part differs. It also holds `steps.txt` (what each picture shows, and which input came before it) and `rules.md` (the product's rules). Read rules.md and steps.txt, then look at every PNG with the Read tool. Use nothing else: do not read other files, run commands, search the web or start agents.

The two versions may be the same, or differ in a few places. First find every difference: compare A-n with B-n part by part (top bar, headings, text, buttons, spacing, colours, objects in the 3D world). Then decide which version the app's owner would rather ship. The owner is hard to please and judges by:
- the rules in rules.md;
- a premium, calm look: edges line up, spacing is even, fonts and sizes are consistent, text has good contrast, nothing is cut off or overlaps, sibling buttons match;
- text that is plain and useful: no jokes or asides; text drawn inside the 3D world is in the language the learner studies;
- controls whose purpose and current state you can tell from looking.

Do not prefer a version because it looks newer, or has more or fewer things, or because of the A/B order. A difference only in which word, card or plant is shown (data, not design) does not count. If no difference matters, answer same.

Write exactly one line into {DIR}/verdict.txt, and reply with the same line:
`<A|B|same> | <the difference that decided it, in one sentence>`
