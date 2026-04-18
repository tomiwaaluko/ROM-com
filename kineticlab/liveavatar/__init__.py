"""liveavatar package — HeyGen LiveAvatar Lite BYOLLM integration."""
import os

from kineticlab.liveavatar.client import LiveAvatarClient
from kineticlab.liveavatar.mock import MockLiveAvatarClient


def get_avatar_client() -> LiveAvatarClient | MockLiveAvatarClient:
    """Return MockLiveAvatarClient if MOCK_MODE=true, else LiveAvatarClient."""
    if os.environ.get("MOCK_MODE", "false").lower() == "true":
        return MockLiveAvatarClient()
    return LiveAvatarClient()


__all__ = ["get_avatar_client"]
