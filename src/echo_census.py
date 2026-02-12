"""Minimal playable prototype for The Echo Census.

Run:
    python -m src.echo_census
"""

from __future__ import annotations

from dataclasses import dataclass, field
from random import Random
from typing import Dict, List, Optional, Tuple

Room = str
Action = str


FLOOR_GRAPH: Dict[Room, List[Room]] = {
    "Lobby": ["Hallway A", "Stairwell B"],
    "Hallway A": ["Lobby", "Laundry", "Unit 101"],
    "Laundry": ["Hallway A", "Unit 102"],
    "Unit 101": ["Hallway A", "Unit 102"],
    "Unit 102": ["Laundry", "Unit 101", "Stairwell B"],
    "Stairwell B": ["Lobby", "Unit 102", "Elevator"],
    "Elevator": ["Stairwell B"],
}

OBJECTIVES = ["Inspect Unit 101 meter", "Collect wet footprint sample", "Submit floor report"]


@dataclass
class EchoModel:
    """Learns player habits and predicts vulnerable next moves."""

    route_counts: Dict[Tuple[Room, Room], int] = field(default_factory=dict)
    hide_counts: Dict[Room, int] = field(default_factory=dict)
    action_counts: Dict[Action, int] = field(default_factory=dict)

    def learn_transition(self, prev_room: Room, next_room: Room) -> None:
        key = (prev_room, next_room)
        self.route_counts[key] = self.route_counts.get(key, 0) + 1

    def learn_action(self, room: Room, action: Action) -> None:
        self.action_counts[action] = self.action_counts.get(action, 0) + 1
        if action == "hide":
            self.hide_counts[room] = self.hide_counts.get(room, 0) + 1

    def predict_room(self, current_room: Room, neighbors: List[Room]) -> Optional[Room]:
        if not neighbors:
            return None
        scored = [(self.route_counts.get((current_room, room), 0), room) for room in neighbors]
        scored.sort(reverse=True)
        if scored[0][0] == 0:
            return None
        return scored[0][1]


@dataclass
class GameState:
    room: Room = "Lobby"
    objectives: List[str] = field(default_factory=lambda: OBJECTIVES.copy())
    completed: List[str] = field(default_factory=list)
    tension: int = 0
    alive: bool = True
    won: bool = False

    def complete_objective(self, text: str) -> None:
        if text in self.objectives:
            self.objectives.remove(text)
            self.completed.append(text)


class EchoCensusGame:
    def __init__(self, seed: int = 7) -> None:
        self.state = GameState()
        self.echo = EchoModel()
        self.random = Random(seed)
        self.last_room = self.state.room

    def available_actions(self) -> List[str]:
        exits = FLOOR_GRAPH[self.state.room]
        return [f"move:{room}" for room in exits] + ["hide", "inspect", "wait", "sprint"]

    def step(self, action: str) -> str:
        if not self.state.alive or self.state.won:
            return "Run has ended. Start a new game."

        self.echo.learn_action(self.state.room, action)

        if action.startswith("move:"):
            return self._handle_move(action.split(":", 1)[1])
        if action == "hide":
            self.state.tension += 1
            return self._resolve_echo_event("You hide and count your breathing.")
        if action == "inspect":
            return self._handle_inspect()
        if action == "wait":
            self.state.tension += 2
            return self._resolve_echo_event("You wait. Pipes answer in the walls.")
        if action == "sprint":
            self.state.tension += 3
            return self._resolve_echo_event("You sprint loudly, teaching the building your panic rhythm.")

        return "Unknown action."

    def _handle_move(self, destination: Room) -> str:
        if destination not in FLOOR_GRAPH[self.state.room]:
            return f"You cannot reach {destination} from {self.state.room}."

        prediction = self.echo.predict_room(self.state.room, FLOOR_GRAPH[self.state.room])

        prev = self.state.room
        self.state.room = destination
        self.echo.learn_transition(prev, destination)
        self.last_room = prev

        text = f"You move to {destination}."
        if prediction == destination and self.random.random() < 0.7:
            self.state.tension += 4
            text += " Your own footsteps arrive one room ahead of you."

        if destination == "Elevator" and not self.state.objectives:
            self.state.won = True
            return text + " Report submitted. Census cycle interrupted."

        return self._resolve_echo_event(text)

    def _handle_inspect(self) -> str:
        room = self.state.room
        if room == "Unit 101":
            self.state.complete_objective("Inspect Unit 101 meter")
            return "Meter inspected. Someone already circled your name in red ink."
        if room == "Laundry":
            self.state.complete_objective("Collect wet footprint sample")
            return "Sample bagged. The footprint depth matches your own weight."
        if room == "Elevator" and not self.state.objectives:
            self.state.complete_objective("Submit floor report")
            self.state.won = True
            return "You submit the report. The tablet asks if you consent to profile retention."

        self.state.tension += 1
        return self._resolve_echo_event("Nothing useful to inspect here.")

    def _resolve_echo_event(self, base_text: str) -> str:
        # passive tension curve
        self.state.tension += 1

        haunt = self._haunt_line()
        if self.state.tension >= 12 and self.random.random() < 0.3:
            self.state.alive = False
            return f"{base_text} {haunt} The lights cut out. Something finishes your sentence for you."
        return f"{base_text} {haunt}"

    def _haunt_line(self) -> str:
        room = self.state.room
        hide_count = self.echo.hide_counts.get(room, 0)
        if hide_count >= 2:
            return "The nearest hiding spot is already open, waiting."

        top_action = max(self.echo.action_counts.items(), key=lambda x: x[1])[0] if self.echo.action_counts else None
        if top_action == "sprint":
            return "A breathy imitation of your sprint cadence echoes behind you."
        if top_action == "wait":
            return "Somebody in the next room waits at the exact same tempo as you."

        atmospheric = [
            "The compliance tablet vibrates before your hand touches it.",
            "Moist footprints appear beside yours for three steps, then stop.",
            "Your recorded whisper plays from an impossible angle.",
        ]
        return self.random.choice(atmospheric)


def render(game: EchoCensusGame) -> str:
    state = game.state
    objectives = "\n".join(f"- {o}" for o in state.objectives) or "- None"
    actions = ", ".join(game.available_actions())
    return (
        f"\n== THE ECHO CENSUS (Prototype) ==\n"
        f"Location: {state.room}\n"
        f"Tension: {state.tension}\n"
        f"Objectives:\n{objectives}\n"
        f"Actions: {actions}\n"
    )


def run_cli() -> None:
    game = EchoCensusGame()
    print("You are an overnight inspector. Type actions exactly as shown.")

    while game.state.alive and not game.state.won:
        print(render(game))
        action = input("> ").strip()
        if action == "quit":
            print("Inspection terminated.")
            return
        print(game.step(action))

    if game.state.won:
        print("\nEnding: You escaped the floor, but your pattern remains.")
    else:
        print("\nEnding: Your Echo completed the inspection in your place.")


if __name__ == "__main__":
    run_cli()
