# How the garden plays

One section for each thing the learner can do in the garden walk. Each section is prose, written as the learner meets it: what they see, how they can tell what to do, each thing they can do and what happens, and what they can't do and how they can tell.

A feature's section is written and reviewed for friction before the feature is built, and kept true when it changes (CLAUDE.md, "Before merge"; docs/agents.md, "Play description review").

## The text becomes the tests

After the prose, each section lists its claims: short, checkable sentences, each with an id, for example:

- `stile.walk-over`: With n08 unlocked, holding W walks you up the stile's steps and down the other side.

Each claim has one e2e test whose title starts with its id, and the test plays it with the keyboard like the learner would. A claim that has no test is a missing test. A garden test that names no claim is either a claim missing from this file or a test to delete.

## Rules for every garden feature

What to build is in [direction.md](direction.md), section 3. The physics are in CLAUDE.md, "The garden is physical". The code's rules are in DESIGN.md, "Garden code". These rules hold for every feature in this file:

- **No instruction text in the walk (#334).** The world shows what can be done. The one action button is icon-only, and its accessible name says the action.
- **A glint is only late help (#689).** Use it only for a thing the learner has not found after a long time, like the key's glint. It never means "in reach", and it never shows on a thing already found or used.
- **Show the button's target quietly.** If the button could act on one of several things that look alike, mark that one with a small, steady change that fits the thing: a shed note lifts off the wall and hangs straight, a plant stands a little taller. Never flash or pulse it.
- **Nothing asks the learner to practise, and nothing is lost.** No scores, timers, currency or nags. Nothing withers.
- **Phones:** one thumb, sound off. Anything that uses sound also shows it.
- **Screen readers:** each verb works through the action button, which has a name, plus a short status line.
- **Words in the world are in the course language (#650)** and have a `lang` attribute. They are never quizzed. Text about the world (buttons, the status line) is English.
- **Privacy:** `garden_action` counts verbs by name only.
- **Art:** follow [art-direction.md](art-direction.md): the app's paper-craft style, not pixel art.
- **Tests:** unit tests of pure logic take a pinned `now`. An e2e test imports `test` from "./test", pins the clock and the viewport, picks the hour for day, evening or night, and pins the detail to low (`pinDetail` in `e2e/helpers.ts`). To open the walk in a browser: `/?demo=es:200#/garden`.

## The action button

The action button sits low on the screen. It shows only when it has something to act on: a plant just ahead of you, the bench, the stool, the door, the key, a pebble, a dandelion clock, a note, the diary, a lantern. Its picture changes with what it does, and a screen reader hears its name ("Shake the plant", "Sit on the bench"). Walk away from everything and the button goes away: on open ground there is no button. When you see it, there is something near you to use.

Each thing has a reach: how near you must come to it. The same rule holds for every thing. A thing comes into reach when you come that near. It stays in reach until you go a small step (about 30 cm) farther away. So when you stand at the edge of reach, or step a little back and forth there, the button does not blink on and off. And a press always acts on a thing that is still in reach. A plant must also be ahead of you, not beside or behind you. Here too there is a small margin: as you turn, the plant the button shows stays ahead of you until it is about 10° past that edge. The margins are only for the thing the button shows now. Any other thing comes into reach only when you come as near as its reach.

Between two beds, the path across has no plant on it. As you cross it, the plant behind you is out of reach and the next one is not yet in reach, so the button goes away for a moment, and comes back at the next bed. This is the open-ground rule: there is nothing there to shake.

While you hold a pebble, the button stays everywhere: it throws the pebble, so there is always something to do with it.

With the keyboard, Tab takes you to the button when it shows. If the button goes while it has focus, focus goes back to the garden, so the walk keys and Tab still work.

- `action.none`: On open ground away from everything, no action button shows. Walk up to the bench and the button shows, named "Sit on the bench".
- `action.reach-edge`: Come up to the bench until "Sit on the bench" shows. Step back 15 cm: it still shows. Step back 40 cm: it goes. Come forward to 15 cm back: still no button. Come forward 15 cm more, into reach: it shows again.

## The bench

The bench stands by the pond, its back to the garden and its seat facing the water. It is solid, like a bed (#1011): walk into it from the garden and you stop at its back; from the side, you stop at its end. Walk round either end and you can stand between the bench and the pond: there is just room for you there. A tap on the ground past the bench walks you round it.

By the bench, from any side, the action button says "Sit on the bench". Press it and you sit, facing the pond, and the eye sinks. The button now says "Stand up". Press it, or press a walk key, and you stand up a step in front of where you sat, between the bench and the pond. A tap on the ground stands you up there too, and walks you on to the spot.

- `bench.sit`: From the garden, holding W toward the bench stops you at its back, and the button says "Sit on the bench". Press it and you sit, facing the pond. Press "Stand up" and you stand in front of the bench; holding S there stops you at its front. Sit again, and a step stands you up too.

## Visitors

Visitors never stand in your way: you can walk through them. You never have to wait for one: walk on whenever you like.

**How a visitor goes anywhere.** A visitor never vanishes from one place and shows up in another. When one goes somewhere (home, to the bench, to wait by the key), you can watch it go: the dog and the cat walk or run on the ground, round the beds, the bench, the pond and the hedge, the same ways you can walk, and jump down from or up onto a seat or a step; the bird flies, up over things and down again. The gnome plays statues: while it is off your screen it walks, slowly, round the beds like the others; the moment it is on your screen it freezes. So a quick look back can catch it part of the way there. When the walk starts, each visitor is already in its place. With "reduce motion" on in your device, a visitor that goes somewhere is there at once: this is the one exception, for access.

**Who comes to sit with you on the bench** (#362). Sit still on the bench. After about ten seconds the bird flies over and lands on its back; after about twenty, the cat walks over and jumps up beside you; after about forty, the gnome comes to the grass past the far end, walking only while you are not looking at it. A screen reader hears each one when it has got there. Stand up and each goes back to its own place the same way it came.

**The frog talks back** (#902). The frog sits on the lily pad by the gate. By day it sleeps, and a tap shows only its tag, "la rana · frog". At dusk and night it is awake. Tap it and it puffs up its throat, you hear a real croak, and its speech bubble says its croak and one word you know: "croac… casa". Tap it again and it croaks another word. Tap it a third time and it gives up on croaking: in the same bubble, with the same croak sound, it says a short, dry line instead: "¿Otra vez tú?" ("You again?"). Each tap after that says its next line, in order. Its last line is always "No tengo más palabras." ("I have no more words."), and after it, for the rest of this walk, a tap gets only "croac…", with no word. The next walk it starts again from the first croak. The lines are deadpan jokes about being a frog that people tap and, in the old stories, kiss: "Nada de besos, por favor. Esas historias no son verdad." ("No kisses, please. Those stories are not true."), "No soy un príncipe." ("I am not a prince."). They are in the course language only, with no English, and like the thoughts every word is one you know: each line comes once you know as many words as it needs. Below about 370 known words (340 in German) the frog has no lines and only croaks words; more lines join, before the last one, as your words grow.

**How long it shows.** A croak shows about three seconds. A line shows at least six seconds, and half a second more for each word, so you can read it slowly. A tap while a bubble shows says the next thing, except in the first second and a half of a line: a tap then shows the same line again, so a double tap skips nothing.

Nothing points to the lines. The croak is answer enough for one tap; the lines are for the learner who keeps tapping. There is no count of taps, no mark on the frog, and no list of lines. A screen reader does not hear the frog's bubble yet, croaks or lines (#906).

- `visit.frog-jokes`: At dusk with 400 known words, the first two taps on the frog show a croak and a word ("croac… "); the third shows "¿Otra vez tú?"; a tap at once after it still shows "¿Otra vez tú?"; a tap two seconds later shows "No tengo más palabras."; the tap after that shows only "croac…". The line still shows 6 seconds after its tap.
- `visit.bench-walk`: Sitting on the bench, the bird and the cat come to sit with you: in each frame on the way each one is a short step from where it was in the frame before, and the cat is never inside a bed. Stand up and they go home the same way.
- `visit.gnome-statues`: Sitting on the bench, the gnome comes over: it never moves in a frame where it is on screen, and each frame it moves it goes a short step.

## The door in the hedge and the key

In the hedge on the gate side there is an old wooden door, shut. At dusk and night a warm light shows through its keyhole. Walk up to it and the action button (a hand) is "Try the door": press it and a quiet line over the door says it is locked ("Cerrado con llave."). No button opens it yet.

When the learner knows the word for key (llave), the key lies somewhere in the garden, always in the same place for this learner: half under the bench, among the stones at the pond's edge, at the foot of a lantern, by the back corner of a bed, or under the sunflower. It is small: a brass key lying on the ground. Walk near it (about two metres) and the action button is "Pick up the key", and a screen reader hears "The key is here." Press it, or tap the key, and the key is gone from the ground, into your hand, and a quiet line over the place says "Has encontrado la llave." A tap on the key from farther away walks you up to it first, and then picks it up. With the key in hand, by the door the button is "Open the door with the key". The door swings open into the orchard, and stays open for good.

**Help when the key waits a long time** (#334). The garden never says where the key is in words. If the key has waited three days or more, the dog (on a day it is here) waits by it instead of by the shed. It sits on the ground beside the key, a little under a metre away, never on top of it, and it looks at it: it turns its head to the key from wherever you see it. It sits on the side of the key away from the middle of the garden, where there is open ground, so from most of the garden you see the key in front of the dog. It wags its tail as you come near, as it does by the shed. It does not move off on its own. At dusk and night the bird (on a day it is here) waits on the ground by the key too, on the other side of it.

If the key has waited a week or more, it also glints: a small star of light on the key, on and off every few seconds, whenever you face it, from far away and up close. Like the key, it is hidden by whatever stands in front of it. On a day the dog waits by the key, the key does not glint: the dog is the help that day, and a star just in front of it reads as the dog sparkling.

A tap on the dog is a tap on the dog: its name shows, as anywhere. It does not pick up the key. Near the key the action button is still "Pick up the key", as it is wherever the key lies; it is the key that it picks up, and the found line shows low over the key, not on the dog.

**Once you have the key**, whoever waited by it has nothing left to watch. The dog stays a moment, wagging, as if pleased; after about two seconds it gets up and trots home to its place by the shed, round the beds and the pond. The bird flies up and back to its own perch. Neither one vanishes.

**What you can't do, and how you can tell.** The door does not open without the key: "Try the door" says it is locked. The dog does not bring you the key or lead you to it; it only waits by it. No button names the key until you are near it.

### Claims

- `key.dog-beside`: With the key left four days, the dog sits on open ground beside the key, between 0.6 and 1 metre from it, on the side away from the middle of the garden.
- `key.dog-looks`: Seen from either side of the dog, the dog's picture faces the key: its art is mirrored when the key is on the left of it on screen.
- `key.no-glint-with-dog`: With the key left eight days and the dog here, facing the key from the garden side, the key never glints; without the dog, it does.
- `key.tap-dog`: A tap on the dog by the key shows the dog's tag; the key stays on the ground.
- `key.dog-walks-home`: Picking up the key: the dog is still beside the key two seconds later, then trots home to the shed, a short step each frame, never inside a bed, and ends at its place.
- `key.bird-flies-home`: At dusk with the key left four days, picking up the key: the bird flies home, a short step each frame, and ends on its own perch.

## Back fence, stile and hill

The garden's back fence is a white picket fence, lower than your eyes. Right behind it, from one side of the garden to the other, brambles grow taller than you: dark leaves, thorny canes arching over the top. So the fence is the garden's edge, as the side fences are: walk into it and you stop. Over the brambles you can see the green top of a small hill.

### Before note n08: the brambles shut the way

When the first stile note comes (n05, at about 260 known words), a few notes lie on the path in front of the back fence, on the path left of the first bed's column, a flat stone on them. Behind them, in the fence, is an old wooden stile, but the brambles have grown through the fence there and over its steps. They come nearly a metre into the garden, a little wider than the stile: walking along the fence, you go round them. You see the stile's top board and its posts among the thorns.

Walk up to it with the keys, the stick or a tap. The brambles are solid: you stop at their edge, as you stop at a bed. The notes lie just in front of them, so you can stand by the notes without touching the thorns. Near the notes, the action button says "Read the note". Each press opens one note. When all are read, the button goes away, as it does wherever nothing is in reach. A note you have read stays at the stile for the rest of the walk. From the next walk it is gone from the stile and hangs on the shed's nails, where you can read it again. No button offers a way over, and nothing moves you.

How you can tell the way is shut: the thorns stand between you and the steps, and you can't get through them. The first note (n05) tells of the evening walk the gardener and she take to the stile, and of her joke that the brambles are faster than him. You read it in front of the brambles: they won.

### After note n08: the way is cut

Note n08 hangs in the shed once it has come (at about 500 known words). It says: past the brambles and the stile, a hill. From the next walk after it has come, the brambles round the stile are cut back. The cut canes lie in a heap beside the way. The stile stands clear: steps up on the garden side, a top board over the fence, steps down the other side, and a handrail on each side. Past it, a way about two metres wide is cut through the brambles, and an old path goes up the hill. Brambles, taller than you, stand on both sides of the way.

**Going over.** The steps are about a metre wide. Walk at their front, the same as you walk anywhere: W or the up arrow, the stick, or tap the ground past the stile. You go up the steps, a little slower than on flat ground, and your view rises. From the top board you look over the fence and up the old path. Keep walking and you go down the other side. You don't have to line up exactly: walk into the front of the steps a little to one side and you slide onto them, as you slide along a bed's edge. The handrails close the sides. You can't step on from the side, and on the steps A or D stops you at a rail. Stop on a step or on the top board and you stay there, at that height, until you walk on.

**The hill.** Walk on along the old path and the ground rises under you. The way opens onto the grassy top of the hill: open ground about eleven metres across, with brambles round its edge. On the top stand the old gardener's stool, facing the valley, and a lantern on a post a step in front of it. From the top you look over the brambles, across a valley, to a small house on the far hills. Beside that house stands a post with a lantern on it, like yours. At dusk and night both lanterns are lit: yours near you, and the far one, a small yellow light across the valley. The valley and the far hills are the view, past the brambles at the edge: like the sky, they are not a place to walk.

You can walk anywhere on the grass of the hilltop and the cut way. The brambles, the stool and the post are solid. Anywhere on the hill away from the stool and the post there is no button, unless you hold a pebble.

**The lantern.** It is the same as the lanterns in the garden. When it is lit, stand near its post and the action button says "Blow out the lantern": press it and the flame goes out. Press again ("Light the lantern") and it is lit again.

**The stool.** Its seat is a thick round of wood on three legs that spread out to the ground. The lantern's post stands a step in front of the stool and a little to the left, and the flat stone with the diary (below) about a metre and a half to its right. Walking up to the stool from the path, behind it, only the stool is in reach; by the post's far side only the lantern is, and by the stone only the diary. Walk up to the stool and the action button says "Sit on the stool". Press it and you sit, as on the bench: a cut to the seat, the eye sinks, and you face the far house. Your view narrows a little, so the far house and its lantern are nearer the middle of the screen. Your own lantern stands in front of you, a little to the left of the far house, even on a phone: your light near, the far light beyond it. Sit still, and time speeds up as it does on the bench, with one difference: on the stool it speeds up only until night, and then stays night while you sit. This is where the gardener waited for the dark. So even by day, dusk and the lit lanterns come in less than a minute. From the seat you can reach the lantern: while you sit and it is lit, the action button is "Blow out the lantern" or "Light the lantern", and pressing it does not stand you up. You see your flame go out and come back in front of you. By day, the button is "Stand up", as on the bench. Any move stands you up, as on the bench: a walk key, or a tap on the ground (which then walks you there). Then time runs back to now.

**The diary.** From note n09 (at about 570 known words), a small book lies on a flat stone beside the stool, on the side away from the post: the gardener's diary. The stone comes up to your waist, like a table, so standing by it you see the book on it in front of you. Its pages are the gardener's evenings on this hill. When it has a page you have not read, a red ribbon lies out of it on the stone. Stand by the stone and the action button says "Read the diary", as "Read the note" does at the stile. Press it and the diary opens on the oldest page you have not read, or on the last page when you have read them all; you can turn to the others. The diary has nine pages: n09, then seven short pages, then n12 (at about 890 known words) as its last page. Three of the short pages tell the same evening, a little changed each time (at about 610, 660 and 700 known words). Four smaller ones come before, between and after them (at about 560, 630, 690 and 780). These pages are only in the diary, not on the shed's nails. A new page counts as a new note: the pinned paper on Today's garden strip shows until you have read it.

**Two signals.** In n12 the gardener writes that they made two signals with the light, and the far light answered with two. Do the same, with the lantern lit: blow it out and light it again; that is one signal. There is no hurry between the steps. Make a second signal. From the stool this works any time, since sitting brings the night; standing by the post, only at real dusk or night. Before n12 the far light shines on, as it did for the gardener for eleven winters. From n12 on, about three seconds after each second signal, the far light goes out and comes back on, slowly, twice: about a second dark, a second lit, a second dark, then lit for good. A quiet line low on the screen says it in the course language ("El lucero contesta." / "Das Fünkchen antwortet."), so you know even if you were looking away. It has no speech bubble, since nothing near you says it: the words rise and fade, like the well's echo. Two more signals get another answer.

**Coming back.** Turn round and walk down the old path, through the cut, up the steps and down into the garden. Or tap a spot you can see in the garden, and you walk there the way you came, over the stile. Nothing takes you back on its own. When you stop, you stay where you are, on the hill or on the steps.

**What you can't do, and how you can tell.** You can't go into the brambles anywhere: they are tall, thorny and solid, the same before and after n08. Past the back fence, the only open ground is the cut way and the hilltop, and the brambles are what close everything else. No button moves you. For a screen reader, the hidden Next plant button still moves you to the next plant; from the hill, it takes you straight to that plant in the garden.

### Claims

- `fence.solid`: Walking with W into the back fence away from the stile stops you at the fence.
- `stile.shut`: Before n08, walking with W at the stile stops you at the brambles in front of it, and no button names a way over.
- `stile.notes`: Standing by the notes at the stile, "Read the note" opens them one at a time.
- `stile.walk-over`: With n08, holding W at the front of the stile takes you up its steps, over the top board and down onto the path past the fence. Your view rises on the way.
- `stile.stop-on-steps`: With n08, letting go of W on the top board leaves you there: two seconds later your place and height have not changed.
- `stile.slide-on`: With n08, walking with W into the front of the steps a little to one side puts you on them.
- `stile.sides-solid`: With n08, walking along the back fence with A or D, the stile stops you; on the steps, A or D stops you at a rail.
- `hill.walk-up`: With n08, holding W along the old path takes you up to the hilltop, and your view rises with the ground.
- `hill.brambles`: On the cut way and on the hilltop, walking into the brambles stops you.
- `hill.walk-back`: From the hilltop, walking back down the path takes you over the stile into the garden. When you stop, two seconds later your place has not changed.
- `hill.tap`: From the garden in front of the stile, tapping the hill's ground past the fence walks you there, over the stile.
- `hill.lantern`: At night, by the lantern's post on the hilltop, the button says "Blow out the lantern"; pressing it puts the flame out, and the button says "Light the lantern".
- `hill.sit`: By the stool, the button says "Sit on the stool". Pressing it seats you facing the far house. Pressing W stands you up.
- `hill.sit-night`: By day, sitting still on the stool, within 60 seconds it is dusk and the button is "Blow out the lantern"; it is then night, and 30 seconds later it is still night. Standing up, time runs back to day.
- `hill.diary`: With n09, standing by the stone beside the stool, the button says "Read the diary", and the diary opens on n09. Before n09 there is no diary.
- `hill.diary-new`: With a diary page not yet read, the diary shows its ribbon and opens on the oldest unread page; once every page is read, it shows no ribbon.
- `hill.no-answer`: At night, before n12, blowing out the lantern and lighting it again twice leaves the far light shining.
- `hill.answer`: With n12, by day, sitting on the stool until night and then signalling twice from the seat makes the far light go dark and lit twice, and the line under the garden says the answer. Two more signals get another answer.

## The mouse door and the last note

A step to the left of the old wooden door in the hedge, a tiny arched door sits at the foot of the hedge. It is about a hand high, in a stone frame, with a brass knob, and a small mat lies in front of it. Two of the gardener's notes speak of it: it is the mouse's door. For most of the course it is shut. A tap on it shows a quiet line over it, in the course language: it is locked, and you are the wrong size ("Cerrado. No es tu talla."). No action button acts on it.

**When it opens.** After about a year of 5 minutes a day, when you know about 920 words (930 in German), the gardener's last note comes, and the mouse door opens. From the next walk after that, the little door stands open, swung back against the hedge. Behind it is a low, dark doorway, and a folded paper lies half out of it, on the mat. At dusk and night a warm light shows in the doorway, like the light through the big door's keyhole. This is the only note that is not in the shed or on the hill. As with every new note, the pinned paper on Today's garden strip shows until you have read it.

Each walk starts just inside the gate, facing into the garden, with the hedge behind you. So the open mouse door is a few steps behind you when the walk opens: turn round and you see it. While the last note waits unread, the cat (once it lives in your garden) sits on the grass by the open mouse door on every walk, looking in, as it once watched Migas. Once you have read the note, the cat goes back to its usual places.

**Reading the note.** Walk up to the mouse door. On the mat in front of it, the action button says "Read the note". Press it, and the note opens on its card, like every other note. On the mat, the button always reads the note; step a little to the side, and the lantern or the big door has its button again. A tap on the paper or the open little door opens the note too; from farther away, a tap on them walks you up to the mat first, then opens it. A tap on the rest of the mat shows its name, as before.

**After you read it.** The paper stays on the mat, now the older paper of a note you have read, and the door stays open for good. You can come back and read the note again whenever you like. It never goes to the shed's nails. If you read this note before it moved here, when it hung in the shed, it is behind the mouse door now, and the door is open for you.

**After the ending.** The garden goes on: the plants grow, the visitors come, and the lanterns and the far light are lit every night. No note comes after this one.

**What you can't do, and how you can tell.** You can't go through the mouse door: it is a hand high, and the hedge stops you, as it always did. Before the last note comes, nothing opens it: there is no key for it, and a tap says it is locked, from near or far, without moving you. Once it is open, a tap no longer says it is locked; it opens the note.

### Claims

- `mousedoor.shut`: Before the last note, a tap on the mouse door shows "Cerrado. No es tu talla.", and on the mat in front of it the button never says "Read the note".
- `mousedoor.read`: With the last note, standing on the mat in front of the open mouse door, the button says "Read the note", and pressing it opens the last note.

## Thoughts: a tap on a thing

Tap a thing in the garden and its name shows on a small paper tag over it, as it always has: "el banco · bench". Some things also make you think something: the bench, the pond, the sunflower, the sundial, the far hills (the green ring round the garden, which you can tap from anywhere), the stool on the hill, the beds, the hedge, the grass, the stones, the cherry tree, the lanterns and the moon. Once you know enough words, a tap on one of them shows a short line under its name, in the course language: "Es para dos." It is what you notice when you look at the thing. It is not a person talking, it has no English, and it is never more than six words. Each line carries either a small, sad hint of the gardener's story ("Es para dos.") or a dry, quiet joke ("Hay un pez. O dos."). It is never just a plain fact about the thing: "El agua está fría." would not be a line.

**Every word is one you know.** Each has one to three lines, and each line comes when you know as many words as it needs: by then the course has taught you every word in it. A form counts when you know its word: "sentaba" when you know "sentar". The first line comes at about 100 to 750 known words, the later ones at about 450 to 1800; these numbers are rough. A tap shows the newest line you can read. So the same bench says something new as your words grow, and a line you read today is still there tomorrow, until a newer one takes its place. The lines notice small things about the garden and the person who kept it before you; they never explain. Before its first line, a tap on a thing shows only its name, as on every other thing. There is no count of lines and no mark for a new one: you find a new line by tapping the thing again some other day.

**How long it shows.** A tag with a line stays about ten seconds, long enough to read it slowly, then fades. A tag with only a name stays four seconds, as before. A tap on another thing shows that thing's tag instead. Tap the same thing again and it shows for ten more seconds. If you turn away and back while it shows, it is still there.

**Only when you tap.** Walking near a thing or standing by it shows no line. Nothing in the garden asks you to tap. A tap on a thing never moves you and never stands you up from the bench. A thought never stops you: while it shows, you can walk on, and the action button does what it did before ("Sit on the bench" by the bench). The tag stays over its thing as you walk, and goes from view when the thing does.

**From the bench.** Sitting on the bench is a good place to look round and tap. A tap from the seat meets the thing under your finger, as it does when you stand: the pond, the sunflower, the sundial, the hills. A tap on the seat or the back beside you names the bench. You stay sitting.

**What a line names is there.** When a line names a small thing, you can find it up close: two cup rings on the bench's seat, and two letters cut high in the sundial's pillar, on its garden side. They are small and quiet, and nothing points to them.

**Where a tap does something else,** it does that, and no thought shows. At night the sundial is closed ("Reloj de sol: cerrado hasta el amanecer."), so its line shows only by day. At dusk and at night a tap on a lantern takes you to it to blow it out or light it, so a lantern's line shows only by day too. Holding a pebble, a tap on the pond throws it in. A visitor on the bench takes a tap on it, and shows its own tag.

**For a screen reader**, after a tap the status says the thing's name and its line, in the course language. With sound on, a tap says the name aloud as before; the line itself is not read aloud. Like the names, thoughts come only from a tap for now; a way to hear them from the keyboard is #866.

**What you can't do, and how you can tell.** You can't open a list of thoughts, answer one or keep one. Other things show only their name, as before.

### Claims

- `thought.tap`: With 800 known words, a tap on the bench shows its tag, "el banco", and under it the bench's newest line; the status a screen reader hears says the name and the line; you have not moved.
- `thought.early`: With 3 known words, a tap on the bench shows only its name, with no line.
- `thought.grows`: A tap on the pond shows three different lines at 200, 700 and 1800 known words, in that order.
- `thought.only-tap`: With 800 known words, walking up to the bench and standing there 10 seconds shows no line. After a tap, while the line shows, holding W walks you on until the bench stops you, and the line and the button "Sit on the bench" still show.
- `thought.replace`: While the bench's line shows, a tap on the pond shows the pond's tag and line instead.
- `thought.seated`: Sitting on the bench, a tap on the pond shows the pond's tag and line, and you are still sitting.
- `thought.details`: Standing by the bench, the cup rings show on its seat; standing by the sundial, the letters show on its pillar.
- `thought.fades`: With no other input, the tag and its line still show 8 seconds after the tap and are gone 12 seconds after it.
- `thought.hills`: With 800 known words, a tap on the far hills shows their tag and a line.
- `thought.stool`: With 800 known words, on the hill, a tap on the stool shows its tag, "el taburete", and a line; you have not moved.
- `thought.sundial-night`: With 800 known words, by day a tap on the sundial shows its line; at night it says it is closed, with no line.
