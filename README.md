# Lattice Paradox

A completely original precision platformer prototype built in plain HTML5 Canvas.

## Play
```bash
python -m http.server 8000
```
Open `http://localhost:8000/web/`.

## Controls
- Move: `A/D` or `←/→`
- Jump: `W`, `↑`, or `Space`
- Dash: `Shift`
- Record Echo Trail: `R`
- Deploy / Recall Echo Clone: `F`

## What's new
- **3 distinct levels** with increasing puzzle-platform challenge.
- **Echo Trail system** (original mechanic): record your movement and deploy a replay clone that can hold pressure plates to open doors.
- **Gravity inversion zones** that flip gravity for a limited time.
- **Bounce blooms** for high vertical routing.
- **Core-gated exits** that require exploration and risk.
- Death tracking, campaign timer, animated particles, and stylized HUD.

## Core loop
1. Navigate a level using movement tech (dash, wall interactions, double jump).
2. Collect enough cores to unlock exit requirements.
3. Use Echo replay to solve door/plate traversal puzzles.
4. Survive hazards and spikes, then reach the portal.
5. Advance through all 3 zones to finish the campaign.
