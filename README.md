# Pressure Census

A story-driven browser horror prototype: **Iron Lung-style pressure + DOORS-like room dread** in first-person 3D.

## Play
```bash
python -m http.server 8000
```
Open `http://localhost:8000/web/`.

## Controls
- `WASD`: move
- `Mouse`: look
- `E`: interact
- `Shift`: sprint (louder)
- `Space`: hide/unhide near lockers

## Story Flow
1. Find service key.
2. Open Bulkhead A.
3. Recover patient cassette.
4. Start generator.
5. Open Bulkhead B.
6. Recover 3 red archives.
7. Reach emergency elevator.

## Horror Design
- Multi-room facility with locked doors, progressive access, and distinct wings.
- Hideable locker spots and a roaming hunter behavior.
- Suspense-first pacing with phases: Calm → Pressure → Distortion → Hunt.
- Procedural immersive audio: ambient hull drone, directional creaks, footsteps, and scare stingers.
- Minimal on-screen UI: objective + subtitles only.
