from src.echo_census import EchoCensusGame, EchoModel


def test_echo_predicts_frequent_route():
    echo = EchoModel()
    for _ in range(3):
        echo.learn_transition("Lobby", "Hallway A")
    echo.learn_transition("Lobby", "Stairwell B")

    prediction = echo.predict_room("Lobby", ["Hallway A", "Stairwell B"])
    assert prediction == "Hallway A"


def test_objective_completion_path():
    game = EchoCensusGame(seed=1)

    # Reach Unit 101 and inspect.
    game.step("move:Hallway A")
    game.step("move:Unit 101")
    text = game.step("inspect")

    assert "Meter inspected" in text
    assert "Inspect Unit 101 meter" not in game.state.objectives


def test_invalid_move_rejected():
    game = EchoCensusGame(seed=1)
    text = game.step("move:Elevator")
    assert "cannot reach Elevator" in text
    assert game.state.room == "Lobby"
