# How the garden plays

One section for each thing the learner can do in the garden walk. Each section is prose, written as the learner meets it: what they see, how they can tell what to do, each thing they can do and what happens, and what they can't do and how they can tell.

A feature's section is written and reviewed for friction before the feature is built, and kept true when it changes (CLAUDE.md, "Before merge"; docs/agents.md, "Play description review").

## The text becomes the tests

After the prose, each section lists its claims: short, checkable sentences, each with an id, for example:

- `stile.walk-over`: With n08 unlocked, holding W walks you up the stile's steps and down the other side.

Each claim has one e2e test whose title starts with its id, and the test plays it with the keyboard like the learner would. A claim that has no test is a missing test. A garden test that names no claim is either a claim missing from this file or a test to delete.

## Calling a visitor

With nothing in reach, the action button shows a whistle, and its name is "Call". Press it, or press and hold on open ground, to whistle. Each visitor you can see answers in its own way, and a screen reader hears what each one did.

The dog comes. It gets up from its place by the shed and runs to you, wagging its tail. It goes the way you would walk: round the beds, round the pond, and through the door in the hedge when you are in the orchard. It never goes over or through them. It stops a short way from you and sits there for a few seconds. Then it trots home the same way and sits down in its place again. It runs to where you stood when you whistled: if you walk off, you find it waiting there. Whistle again and it comes to you again, from wherever it is.

Everywhere you can stand, the dog can reach on foot: the door in the hedge never shuts once it is open, and before that you cannot be on the far side of it. If a later change makes a place you can stand that the dog cannot reach, the dog comes as near as it can and waits there; that change must say so here. The stile and the hill past the back fence are such places (#770): call from there, and the dog comes to the back fence near the stile and waits there.

The cat almost never comes: it flicks one ear. Rarely, it gets up and walks over the same way the dog does, stops the same short way from you, and stares at you until you walk away. The heron takes one slow step back from you, and never into the pond. The other visitors answer where they are: they fly, swim, or call back.

Visitors never stand in your way: you can walk through them. You never have to wait for one: walk on whenever you like.

- `call.dog-round`: With a bed between you and the dog, the dog runs round the bed to you and is never on the bed.
- `call.dog-home`: A few seconds after it reaches you, the dog trots back to its own place by the shed, again never over a bed.

## Back fence, stile and hill

The garden's back fence is a white picket fence, lower than your eyes. Right behind it, from one side of the garden to the other, brambles grow taller than you: dark leaves, thorny canes arching over the top. So the fence is the garden's edge, as the side fences are: walk into it and you stop. Over the brambles you can see the green top of a small hill.

### Before note n08: the brambles shut the way

When the first stile note comes (n05, at about 250 known words), a few notes lie on the path in front of the back fence, on the path left of the first bed's column, a flat stone on them. Behind them, in the fence, is an old wooden stile, but the brambles have grown through the fence there and over its steps. They come nearly a metre into the garden, a little wider than the stile: walking along the fence, you go round them. You see the stile's top board and its posts among the thorns.

Walk up to it with the keys, the stick or a tap. The brambles are solid: you stop at their edge, as you stop at a bed. The notes lie just in front of them, so you can stand by the notes without touching the thorns. Near the notes, the action button says "Read the note". Each press opens one note. When all are read, the button says what it says elsewhere ("Call"). A note you have read stays at the stile for the rest of the walk. From the next walk it is gone from the stile and hangs on the shed's nails, where you can read it again. No button offers a way over, and nothing moves you.

How you can tell the way is shut: the thorns stand between you and the steps, and you can't get through them. The first note (n05) says the gardener's old walk went over the stile, and that brambles taller than the gardener grow there now.

### After note n08: the way is cut

Note n08 hangs in the shed once it has come (at about 620 known words). It says: past the brambles and the stile, a hill. From the next walk after it has come, the brambles round the stile are cut back. The cut canes lie in a heap beside the way. The stile stands clear: steps up on the garden side, a top board over the fence, steps down the other side, and a handrail on each side. Past it, a way about two metres wide is cut through the brambles, and an old path goes up the hill. Brambles, taller than you, stand on both sides of the way.

**Going over.** The steps are about a metre wide. Walk at their front, the same as you walk anywhere: W or the up arrow, the stick, or tap the ground past the stile. You go up the steps, a little slower than on flat ground, and your view rises. From the top board you look over the fence and up the old path. Keep walking and you go down the other side. You don't have to line up exactly: walk into the front of the steps a little to one side and you slide onto them, as you slide along a bed's edge. The handrails close the sides. You can't step on from the side, and on the steps A or D stops you at a rail. Stop on a step or on the top board and you stay there, at that height, until you walk on.

**The hill.** Walk on along the old path and the ground rises under you. The way opens onto the grassy top of the hill: open ground about eleven metres across, with brambles round its edge. On the top stand the old gardener's stool and a lantern on a post. From the top you look over the brambles, across a valley, to a small house on the far hills. At night a light shines in its window. The valley and the far hills are the view, past the brambles at the edge: like the sky, they are not a place to walk.

You can walk anywhere on the grass of the hilltop and the cut way. The brambles, the stool and the post are solid. When the lantern is lit (from dusk), stand near its post and the action button says "Raise the lantern". Press it and the lantern rises on its post, holds for a moment, and comes down. Anywhere else on the hill, the button says what it says in the garden when nothing is in reach ("Call").

**Coming back.** Turn round and walk down the old path, through the cut, up the steps and down into the garden. Or tap a spot you can see in the garden, and you walk there the way you came, over the stile. Nothing takes you back on its own. When you stop, you stay where you are, on the hill or on the steps.

**What you can't do, and how you can tell.** You can't go into the brambles anywhere: they are tall, thorny and solid, the same before and after n08. Past the back fence, the only open ground is the cut way and the hilltop, and the brambles are what close everything else. No button moves you. For a screen reader, the hidden Next plant button still moves you to the next plant; from the hill it goes back over the stile.

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
