# The Tall One

A first-person horror game in a private biocontainment facility. You work the C-14 rotation at Halversen Site 41. Two specimens breach containment; you recapture one, and the second disappears into the unfinished Wing D. The game has a prologue, five chapters and several endings. The story bible is in [docs/STORY.md](docs/STORY.md).

**Built so far:**
- **Prologue (Intake):** fully playable.
- **Chapter One (The Build-Out):** fully playable, about 10 to 15 minutes. B is loose on an unfinished construction floor in the dark, and it hunts you. Find diesel, start the generator, close three zone breakers (it won't walk into the light), find Lind's lift key, then survive until the freight lift arrives. Hide in lockers, crouch to stay quiet, and flash it with the halide lamp when it gets close. Dying sends you back to your last checkpoint.
- **Chapter Two (Pump Level):** fully playable. The freight lift lets you out onto a flooded service sublevel, knee-deep and dark. Start three drainage pumps in order (prime each one and close the bleed valve while the gauge needle is in the green; too late and the relief valve bangs). Every step splashes and B is in the water with you: you'll see its wake before its body. Sgt. Halloran is pinned in the cable gallery, and freeing him is loud. Save him or leave him; it's remembered.
- **Chapter Three (The Archive):** fully playable. The records vault and the old observation theatre. The mine lift code is on microfiche in the vault's restricted cage, behind mobile shelving you have to crank open (loudly) while B hunts the stacks. The reading room runs off the theatre's circuit, so you climb the seating to the projection booth. The LANTERN reel can be threaded and run: the trial footage is projected onto the screen, and B comes to watch it. Then the choice: burn the files as Okafor orders, or upload them to the audit relay.
- **Creature study:** a room for watching the monster's animations.
- **Chapters 4 and 5:** in development.

## Run it

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Add `?level=chapter1`, `?level=chapter2` or `?level=chapter3` to jump straight to a chapter. It needs a WebGL2 browser with internet access (three.js and the fonts load from CDNs). Headphones are recommended: all sound is synthesized live (`js/audio.js`).

| Input | Action |
| --- | --- |
| WASD / arrows | walk |
| Mouse | look (click to capture; click-drag also works) |
| Shift | run |
| C | crouch (quieter, harder to see) |
| E | use / interact / hide in a locker |
| Esc | pause menu and settings (mouse sensitivity, invert Y, field of view, quality, FPS counter) |
| F | flashlight |
| Right mouse / Q | flash the halide lamp (once you have it). Aim for the chest, up close. It works less each time in quick succession; by the third flash it covers its eyes and charges |
| Touch | left thumb walks, right thumb looks; on-screen buttons for use, flash, light and crouch |

In the creature study you can also use: L inspection light, P freeze, and the number keys 1–0 and R for the actions below (Esc frees the mouse so you can click the panel instead).

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
index.html              entry page: title menu, import map → three@0.170.0
js/main.js              boots the game, menu, level loading
js/engine/              game core: input, player, UI, interaction, story director, asset loading
js/levels/intro.js      the prologue: Wing C lab, specimens, tests, breach, recapture
js/levels/testroom.js   creature study room
js/lab/architecture.js  Wing C building (walls, floors, cells, glass), merged per material
js/lab/props.js         procedural lab equipment (consoles, desks, doors, benches, signs...)
js/creature.js          creature loader, skin shader, teeth, eyes, claws
js/anim.js              procedural animation: actions, gait planner, IK, gaze
js/audio.js             synthesized sound: ambience, music, creature voice, radio, effects
js/room.js              the creature study room's procedural surfaces
js/post.js              post-processing chain (clinical and horror grades)
js/save.js              local progress / story choices
docs/STORY.md           story bible: chapters, endings, tracked choices
tools/                  creature generator, asset fetcher
assets/                 creature model, CC0 textures (ambientCG), HDRI (Poly Haven)
```

## Assets and credits

- The creature, lab equipment, sound and room surfaces are generated in code.
- Textures come from [ambientCG](https://ambientcg.com), and the hospital lighting environment from [Poly Haven](https://polyhaven.com). Both are CC0, and `tools/fetch_assets.py` re-downloads them.
