# Horror Game Concept: **The Echo Census**

You’re not being hunted by a monster.

You are being **measured**.

## One-line pitch
A first-person psychological horror game where every sound you make teaches the house how to imitate and outmaneuver you.

## Core original hook
The game tracks your behavior and builds a fake “you” (an Echo) in real time. The Echo copies your route choices, hiding habits, and panic responses—then starts appearing in places *before* you get there.

You don’t know if you heard yourself from the past, the future, or something wearing your patterns.

## Setting
A condemned apartment complex being audited overnight by a municipal worker (you). You have a clipboard app, floor plans, and mandated checkpoints. The building is dark, flooded in places, and occupied by “residents” that never appear directly on camera.

Each floor has a social identity (family floor, student floor, elderly floor) and environmental storytelling that feels mundane at first, then wrong in subtle ways.

## Fear design principles

### 1) Threat uncertainty > constant chase
There are long quiet stretches where nothing attacks you.
The horror comes from noticing that the world has adapted to your habits.

### 2) The game weaponizes your own comfort strategies
If you always hide in bathrooms, the next bathroom already contains signs of forced entry.
If you always use stairwell B, doors near stairwell B start opening *before* you arrive.

### 3) Audio betrayal
Your own footsteps, breathing, and whispers get replayed from impossible directions at near-miss timing.
The player is trained to trust sound first, then punished for it.

### 4) No safe room permanence
Safe rooms decay if overused. Lighting flickers lower each visit; save terminal text mutates.

## Gameplay loop
1. Receive 2–3 required inspection objectives per floor.
2. Traverse, map hazards, collect records, and decide riskier shortcuts vs. slower routes.
3. Make noise management choices: move fast and teach the Echo, or move slow and risk environmental events.
4. Reach elevator and submit floor report.
5. Between floors, a “compliance score” screen gives neutral bureaucratic feedback that is increasingly invasive and personal.

## Systems that make it scary

### Echo Learning System
Tracks:
- Route preference heatmap
- Hide spot frequency
- Reaction latency after scares
- Door interaction rhythm
- Flashlight usage pattern

Effects:
- The Echo can pre-position fake audio cues.
- It can trigger events where your typical escape path is blocked.
- Late game: it can perform “anticipation scares” exactly one room ahead of your likely destination.

### Presence Without Monster Visibility
You rarely see a body. Instead:
- Wet footprints appear beside yours.
- Newly written notes in your own phrasing.
- Elevator arrives at floors you didn’t select.

The player fills the gaps with imagination, increasing dread.

### Bureaucratic Cosmic Horror
The building isn’t haunted—it is an instrument. Your inspections are ritual data collection. The “city system” expected this outcome.

## Story structure

### Act 1: Procedure
Routine inspections, subtle impossible details, mild anomalies.

### Act 2: Mimicry
The Echo starts mirroring your behavior and intercepting your plans.

### Act 3: Census Complete
You discover prior inspectors all produced Echoes; only one profile is kept. Endgame choices revolve around deleting your profile, replacing it with another, or joining the system.

## Example scare sequence (why it works)
- You hide in a laundry room after hearing movement.
- Silence for 30 seconds. Relief sets in.
- From the hallway: your exact voice, whispering your own habitual self-talk (“okay, left then stairs”).
- You peek out. Empty hall.
- The laundry basket behind you shifts.

This layers anticipation, self-recognition, and delayed threat in one beat.

## Minimal prototype plan (4 weeks)
- Week 1: One floor blockout + audio occlusion + objective loop.
- Week 2: Behavior tracking + simple Echo prediction model.
- Week 3: 8–10 adaptive scare events triggered by learned habits.
- Week 4: Vertical slice with intro, one full floor, and a climactic Echo encounter.

## Why this concept stands out
Most horror games ask, “Can you survive the monster?”
This asks, “What happens when the game learns what *you* do when you’re afraid—and uses that against you?”

## Programming started: terminal prototype
A first playable prototype is now in `src/echo_census.py`. It includes:
- Room navigation on a small floor graph.
- Adaptive Echo learning for movement and hiding habits.
- Dynamic haunt lines influenced by repeated behavior.
- Objective flow for inspection gameplay.

### Run
```bash
python -m src.echo_census
```

### Test
```bash
pytest -q
```


## Play in your browser (HTML)
If you want an HTML version, open:
- `web/index.html`

Quick start from repo root:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000/web/`.


### Controls
- Move: `WASD` or arrow keys
- Interact / collect: `E`
- Sprint (higher noise): hold `Shift`

### What is now playable
- Real-time movement on a top-down tile map.
- Fog-of-war style visibility around the player.
- A stalking mimic that reacts to your noise and can kill you.
- Collectible objectives (wet samples + fuse key), then elevator extraction.
- Lore pickups that reveal the building's "census" backstory.
