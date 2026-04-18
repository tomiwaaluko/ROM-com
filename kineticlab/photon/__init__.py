"""photon package — Photon Spectrum iMessage integration."""
import os

from kineticlab.photon.client import PhotonClient
from kineticlab.photon.mock import MockPhotonClient


def get_photon_client() -> PhotonClient | MockPhotonClient:
    """Return MockPhotonClient if MOCK_MODE=true, else PhotonClient."""
    if os.environ.get("MOCK_MODE", "false").lower() == "true":
        return MockPhotonClient()
    return PhotonClient()


__all__ = ["get_photon_client"]
