"""Avatar narration scripts and score branching for session flow."""
from kineticlab.narration.scripts import SCRIPTS, get_script
from kineticlab.narration.scoring import select_score_key, score_narration_payload

__all__ = ["SCRIPTS", "get_script", "select_score_key", "score_narration_payload"]
