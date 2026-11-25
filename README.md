# The Tall One

A horror game in progress. Step one: the monster. This build is a **creature study**: one ruined basement room you can walk around in, with the creature standing in the corner under a flickering bulb.

## Run it

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It needs a WebGL2 browser with internet access (three.js loads from jsDelivr).

| Input | Action |
| --- | --- |
| WASD / arrows | walk |
| Mouse | look (click to capture; click-drag also works) |
| Shift | run |
| F | flashlight on/off |
| L | work light: bright, neutral inspection light for studying the model |
| P | freeze the creature |
| H | hide the help text |
| 1–0, R | make the creature perform (see below); Esc frees the mouse so you can click the panel instead |
| Touch | left thumb walks, right thumb looks |

### Creature actions (test panel, top right)

| Key | Action | What it does |
| --- | --- | --- |
| 1 | Idle | stands in place and stares; leans in and reaches when you get close |
| 2 | Walk | patrols a loop around the room, arms swinging, never taking its eyes off you |
| 3 | Stalk | crouches and creeps toward you with its hands raised, then stops about 2 m away and waits |
| 4 | Crawl | drops onto all fours and patrols on long splayed limbs, head craned up at you |
| 5 | Chase | sprints at you, lunges with its arms out, then screams in your face |
| 6 | Leap | crouches, then pounces flat through the air toward you and lands in a crouch |
| 7 | Look around | sniffs and scans the room, turning its head far past what a person could |
| 8 | Break door | walks to the plank door in the back wall and beats it apart with overhead blows |
| 9 | Scream | rears back, then thrusts its head and spread claws at you, trembling |
| 0 | Convulse | a violent fit of jerks and flailing |
| R | Reset | puts it back in its corner and repairs the door |

All of these are procedural (`js/anim.js`). Feet and hands are planted on the floor by a step planner and reached with two-bone IK, so nothing slides. Each action writes a target pose that is smoothed per bone, so switching actions blends instead of snapping. The gaze layer keeps the head and eyes on you through everything.

## The creature

About 2.4 m tall, emaciated and hunched. The arms reach past its knees, the fingers are three times too long and end in claws, and it has no nose or lips. Its eyes are pinpricks deep inside black orbits that catch your flashlight.

What it does:

- **Watches you.** It holds a stare unnaturally long, then snaps its gaze to you or turns slowly toward you. The neck turns far past what a person's could, and the eyes always track you.
- **Tilts its head**, curious, and twitches: a sudden jerk of the head or a single finger.
- **Breathes** with a slow, ragged ribcage, faster when you are near.
- **Never closes its mouth.** The jaw trembles open now and then.
- **Up close**, it leans down at you, the jaw gapes, the arms lift and the hands open.

### How it's made

No downloaded assets. The creature is generated from code:

- `tools/creature-def.mjs` defines the anatomy as about 330 signed-distance-field primitives: a ribcage with nine pairs of ribs, a spine with vertebrae that show through the back, a skull with carved orbits, a nasal cavity and a lipless mouth, two-bone forearms, knuckles, and so on.
- `tools/build-creature.mjs` turns that into a mesh at 5 mm resolution using narrow-band sampling and surface nets, with every vertex projected onto the exact surface. It then:
  - rigs a 56-bone skeleton, with weights derived from which primitive each vertex belongs to;
  - bakes ambient occlusion, flesh thickness, curvature and paint masks (gums, eye bruising, necrotic fingertips, blood drip paths) into vertex data;
  - writes `assets/creature.glb`, a standard skinned glTF that you can also open in Blender.
- `js/creature.js` handles everything at runtime:
  - the skin shader: mottled grey dead skin, raised veins, creases, pores, bruising, wet patches, dried blood;
  - rotten teeth placed along the gum line, claws, and the eyes, which have a reflective tapetum;
  - the procedural "behaviour" animation.

Rebuild the model after editing the anatomy:

```bash
node tools/build-creature.mjs
```

The build takes about 25 s.

### The room

Everything in the room is procedural too: shader-generated tiles, peeling paint, water damage, mould, cracked concrete with puddles, a dried stain and drag mark, and claw marks gouged into the wall. The props are a rusted bed frame, an overturned chair, a barred window letting in cold light, pipes and a drain. Lighting is a hand-held flashlight with a projected beam pattern, a flickering shaded bulb, and moonlight through the bars. Post-processing adds GTAO, bloom, lens aberration, vignette and film grain.

## Layout

```
index.html            entry page (import map → three@0.170.0)
js/main.js            renderer, player controller, lights, loop
js/creature.js        creature loader, skin shader, teeth, eyes, claws
js/anim.js            procedural animation: actions, gait planner, IK, gaze
js/room.js            room geometry + procedural surface shaders + dust
js/post.js            post-processing chain
js/noise.glsl.js      shared GLSL noise
tools/                creature generator (Node, no dependencies)
assets/creature.glb   generated model
```
