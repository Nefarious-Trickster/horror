# The Echo Census: Night Shift

A browser-based **3D first-person horror prototype** with jumpscares.

## Play
```bash
python -m http.server 8000
```
Open `http://localhost:8000/web/`.

## Controls
- `WASD`: move
- `Mouse`: look
- `E`: interact
- `Shift`: sprint (raises threat)

## Objective
1. Collect all **3 ritual records**.
2. Survive escalating threat and jumpscare events.
3. Reach the elevator and extract.

## Horror systems included
- Raycast-rendered 3D maze exploration.
- Triggered and dynamic jumpscares (zone-based + threat-based).
- Sanity meter that drains under pressure.
- Threat model that punishes loud and repetitive routeing.
- Lore note pickups revealing the building's census protocol.
