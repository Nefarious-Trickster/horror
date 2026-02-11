# The Echo Census: Block 13

A browser-based **3D first-person horror game prototype** with suspense buildup, dynamic audio, and jumpscares.

## Play
```bash
python -m http.server 8000
```
Open `http://localhost:8000/web/`.

## Controls
- `WASD`: move
- `Mouse`: look
- `E`: interact
- `Shift`: sprint (louder, increases danger)

## Objective Loop
1. Find the **fuse key**.
2. Power the **generator**.
3. Recover all **3 red archive records**.
4. Reach the **elevator** and extract.

## Systems
- Raycast-rendered 3D maze with improved visual detail and themed interactables.
- Multi-stage suspense model: Quiet → Unease → Manifest → Hunt.
- Dynamic procedural audio: ambient drone, pulses, creaks, and scare stingers.
- Behavior-driven tension via noise and repeated route patterns.
- Scripted atmosphere beats before high-intensity scare events.
