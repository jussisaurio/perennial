# How the garden plays

One section for each thing the learner can do in the garden walk. Each section is prose, written as the learner meets it: what they see, how they can tell what to do, each thing they can do and what happens, and what they can't do and how they can tell.

A feature's section is written and reviewed for friction before the feature is built, and kept true when it changes (CLAUDE.md, "Before merge"; docs/agents.md, "Play description review").

## The text becomes the tests

After the prose, each section lists its claims: short, checkable sentences, each with an id, for example:

- `stile.walk-over`: With n08 unlocked, holding W walks you up the stile's steps and down the other side.

Each claim has one e2e test whose title starts with its id, and the test plays it with the keyboard like the learner would. A claim that has no test is a missing test. A garden test that names no claim is either a claim missing from this file or a test to delete.

## The action button

The action button sits low on the screen. It shows only when it has something to act on: a plant just ahead of you, the bench, the door, the key, a pebble, a dandelion clock, a note, a lantern. Its picture changes with what it does, and a screen reader hears its name ("Shake the plant", "Sit on the bench"). Walk away from everything and the button goes away: on open ground there is no button. When you see it, there is something near you to use. When you walk past beds, "Shake the plant" stays for half a second after the plant goes out of reach, so the button does not blink as you cross the small path between two beds.

While you hold a pebble, the button stays everywhere: it throws the pebble, so there is always something to do with it.

With the keyboard, Tab takes you to the button when it shows. If the button goes while it has focus, focus goes back to the garden, so the walk keys and Tab still work.

- `action.none`: On open ground away from everything, no action button shows. Walk up to the bench and the button shows, named "Sit on the bench".

## Visitors

Visitors never stand in your way: you can walk through them. You never have to wait for one: walk on whenever you like.

**How a visitor goes anywhere.** A visitor never vanishes from one place and shows up in another. When one goes somewhere (home, to the bench, to wait by the key), you can watch it go: the dog and the cat walk or run on the ground, round the beds, the pond and the hedge, the same ways you can walk, and jump down from or up onto a seat or a step; the bird flies, up over things and down again. The gnome plays statues: while it is off your screen it walks, slowly, round the beds like the others; the moment it is on your screen it freezes. So a quick look back can catch it part of the way there. When the walk starts, each visitor is already in its place. With "reduce motion" on in your device, a visitor that goes somewhere is there at once: this is the one exception, for access.

**Who comes to sit with you on the bench** (#362). Sit still on the bench. After about ten seconds the bird flies over and lands on its back; after about twenty, the cat walks over and jumps up beside you; after about forty, the gnome comes to the grass past the far end, walking only while you are not looking at it. A screen reader hears each one when it has got there. Stand up and each goes back to its own place the same way it came.

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

When the first stile note comes (n05, at about 250 known words), a few notes lie on the path in front of the back fence, on the path left of the first bed's column, a flat stone on them. Behind them, in the fence, is an old wooden stile, but the brambles have grown through the fence there and over its steps. They come nearly a metre into the garden, a little wider than the stile: walking along the fence, you go round them. You see the stile's top board and its posts among the thorns.

Walk up to it with the keys, the stick or a tap. The brambles are solid: you stop at their edge, as you stop at a bed. The notes lie just in front of them, so you can stand by the notes without touching the thorns. Near the notes, the action button says "Read the note". Each press opens one note. When all are read, the button goes away, as it does wherever nothing is in reach. A note you have read stays at the stile for the rest of the walk. From the next walk it is gone from the stile and hangs on the shed's nails, where you can read it again. No button offers a way over, and nothing moves you.

How you can tell the way is shut: the thorns stand between you and the steps, and you can't get through them. The first note (n05) says the gardener's old walk went over the stile, and that brambles taller than the gardener grow there now.

### After note n08: the way is cut

Note n08 hangs in the shed once it has come (at about 620 known words). It says: past the brambles and the stile, a hill. From the next walk after it has come, the brambles round the stile are cut back. The cut canes lie in a heap beside the way. The stile stands clear: steps up on the garden side, a top board over the fence, steps down the other side, and a handrail on each side. Past it, a way about two metres wide is cut through the brambles, and an old path goes up the hill. Brambles, taller than you, stand on both sides of the way.

**Going over.** The steps are about a metre wide. Walk at their front, the same as you walk anywhere: W or the up arrow, the stick, or tap the ground past the stile. You go up the steps, a little slower than on flat ground, and your view rises. From the top board you look over the fence and up the old path. Keep walking and you go down the other side. You don't have to line up exactly: walk into the front of the steps a little to one side and you slide onto them, as you slide along a bed's edge. The handrails close the sides. You can't step on from the side, and on the steps A or D stops you at a rail. Stop on a step or on the top board and you stay there, at that height, until you walk on.

**The hill.** Walk on along the old path and the ground rises under you. The way opens onto the grassy top of the hill: open ground about eleven metres across, with brambles round its edge. On the top stand the old gardener's stool and a lantern on a post. From the top you look over the brambles, across a valley, to a small house on the far hills. At night a light shines in its window. The valley and the far hills are the view, past the brambles at the edge: like the sky, they are not a place to walk.

You can walk anywhere on the grass of the hilltop and the cut way. The brambles, the stool and the post are solid. When the lantern is lit (from dusk), stand near its post and the action button says "Raise the lantern". Press it and the lantern rises on its post, holds for a moment, and comes down. Anywhere else on the hill there is no button, unless you hold a pebble.

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
- `hill.raise`: At night, by the lantern's post on the hilltop, the button says "Raise the lantern". Pressing it lifts the lantern, the line under the garden says "You raise the lantern", and the lantern comes back down.
- `hill.far-light`: At night, before note n12, raising the lantern leaves the far light shining. Once it answers (n12), the first raise of a walk makes it blink twice; later raises in that walk do not.
