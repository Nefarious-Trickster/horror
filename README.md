# Pressure Census — Block 13

A first-person horror game for the browser, built with Three.js and WebGL. You play a census enumerator sent to count the 41 registered residents of a sanitarium wing sealed under a city reservoir. Something down there is also counting.

Everything is generated at load time: the models, PBR textures, lighting rigs and every sound. The repo contains no image, model or audio files. Three.js is vendored under `web/vendor/`, so the game runs offline.

## Play

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/web/>. Use a desktop browser with WebGL2 (Chrome, Edge or Firefox). Headphones are strongly recommended because the sound is spatialised with HRTF.

The first load builds about 30 PBR texture sets in Web Workers, which takes a few seconds. The textures are then cached in IndexedDB, so later loads are close to instant.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / mouse | Move / look |
| `Shift` | Run. It's loud. |
| `C` / `Ctrl` | Crouch. Quiet, and harder to see. |
| `E` | Interact: doors, lockers, items, notes |
| `F` | Flashlight on/off |
| `LMB` | Throw a bottle. The noise draws it away. |
| `Space` / `RMB` (hold) | Hold your breath while hiding |
| `Tab` | Show the current objective |
| `Esc` | Pause and settings |

## What's in it

**The creature.** The Tallyman is a procedurally rigged, digitigrade, eyeless thing.
- Its legs use IK to keep the feet planted.
- Its fingers are far too long and twitch on their own.
- Its jaw opens past 110° to show rows of needle teeth.
- Its head snaps at random, the way a listening animal's does.

**The AI.** It hunts by sound and by light.
- A sight model accounts for room lighting, your flashlight beam, crouching and line of sight.
- It hears footsteps, doors, bottles and alarms. Walls muffle what it hears.
- States: patrol → investigate → search → chase.
- It bashes doors open, checks the lockers it saw you run into, and listens at closed lockers. Hold your breath.
- A pacing director moves it toward you when things go quiet and pulls it back after a close call.

**Rendering.**
- ACES tone mapping and PCF-soft shadows from a flashlight that has a lens cookie.
- A fake volumetric beam with dust motes that show up only inside the light.
- GTAO ambient occlusion and bloom.
- A custom film pass that adds grain, chromatic aberration, a fear-driven vignette and signal tearing when the creature is near.
- Pooled point lights driven by about 70 flickering fluorescent, emergency and work-lamp fixtures.
- A real mirror.

**Procedural assets.**
- Tileable PBR sets (albedo, normal, ORM): peeling two-tone plaster, cracked glazed tile, wet mosaic floor, worn linoleum, cinderblock, concrete, acoustic ceiling, chipped and rusting paint, brushed steel, wood, stained fabric and creature skin.
- About 50 parametric models: hospital beds with draped sheets, restraints, curtains, lockers with see-through louvres, wheelchairs, gurneys, IV stands, claw-foot hydrotherapy tubs, a diesel generator, pumps, morgue drawer banks, shelving, desks with CRTs and more.

**Audio.** Everything is synthesised with WebAudio.
- Convolution reverb, plus occlusion that low-passes any source you can't see.
- Surface-dependent footsteps for you and the creature.
- Pressure groans, drips, fluorescent hum and a generator.
- Creature clicks, whispered counting, growls and screeches.
- A tension score that follows the danger.

**Story.** A seven-zone facility with an objective chain:
1. Find two fuses.
2. Restore the generator.
3. Open the security gate.
4. Find a keycard in cold storage.
5. Work out the pump interlock code from the clues.
6. Drain the lift pit.
7. Survive until the freight lift arrives.

Ten documents and a tape recording tell the rest. Scares are contextual and scripted, not random: the corridor glimpse, the curtain silhouette, the mirror, the tub, drawer 12.

## Graphics settings

Pick Low, Medium, High or Ultra on the title screen. The setting controls texture resolution (512 or 1024), shadow-map size, MSAA, GTAO and the number of pooled lights. Brightness, mouse sensitivity and volume can also be changed from the pause menu.

## Debug URL parameters

These are useful for development:

- `?autostart&skip`: skip the menus.
- `?quality=low`
- `?debug`: show FPS, draw calls and AI state.
- `?tp=x,z,yaw`: teleport.
- `?power`: start with the generator running.
- `?gate`: start with the gate open.
- `?lit=2`: flat debug lighting.

## Layout

```
web/
  index.html, css/style.css
  js/main.js              game loop, input, HUD, lockers, death/ending flow
  js/engine/              renderer + post FX, procedural audio
  js/gfx/                 texture synthesis (worker), canvas decals/signs, materials
  js/world/               map, level geometry/collision/A*, props (models), set dressing, lights, doors
  js/entities/            player controller, creature model/rig, creature AI
  js/game/story.js        notes, objectives, interactions, scripted events
  vendor/three/           three.js r170 (MIT)
legacy/index.html         the earlier 2D raycaster prototype
src/, tests/              the original Python text prototype (The Echo Census)
```
