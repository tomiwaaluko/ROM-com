from pydantic import BaseModel


class BaseMessage(BaseModel):
    type: str
    payload: dict
    timestamp: float


class GestureMessage(BaseModel):
    name: str
    confidence: float
    normalized_rom: float


class CalibrationMessage(BaseModel):
    user_id: str
    rom_profile: dict


class ExerciseEvent(BaseModel):
    target_hit: str
    accuracy: float


class ErrorMessage(BaseModel):
    code: str
    message: str
