"""Esquemas Pydantic = contrato de datos backend <-> frontend (ver DESIGN.md)."""
from __future__ import annotations

from pydantic import BaseModel


class EventInfo(BaseModel):
    round: int
    name: str
    country: str | None = None
    circuit: str | None = None
    date: str | None = None


class SessionInfo(BaseModel):
    code: str  # FP1, FP2, FP3, SQ, S, Q, R
    name: str
    date: str | None = None  # ISO (UTC) de inicio de la sesion, si se conoce
    upcoming: bool = False  # True si la sesion aun no se ha disputado (no hay datos)


class DriverInfo(BaseModel):
    code: str
    number: int | None = None
    name: str
    team: str | None = None
    teamColor: str | None = None


class LapInfo(BaseModel):
    lapNumber: int
    lapTime: float | None = None  # segundos
    sector1: float | None = None
    sector2: float | None = None
    sector3: float | None = None
    compound: str | None = None
    tyreLife: float | None = None
    stint: int | None = None
    segment: str | None = None  # Q1/Q2/Q3 (o SQ1/SQ2/SQ3) en clasificaciones
    isPersonalBest: bool = False
    position: int | None = None
    gapToLeader: float | None = None
    gapToAhead: float | None = None


class Telemetry(BaseModel):
    distance: list[float]
    speed: list[float]
    throttle: list[float]
    brake: list[float]
    gear: list[int]
    rpm: list[float]
    drs: list[int]
    time: list[float]  # s desde inicio de vuelta
    x: list[float]
    y: list[float]


class Corner(BaseModel):
    x: float
    y: float
    number: int
    letter: str | None = None


class CircuitInfo(BaseModel):
    rotation: float  # grados, para orientar el trazado como el mapa oficial
    corners: list[Corner]


class WeatherSample(BaseModel):
    time: float
    airTemp: float | None = None
    trackTemp: float | None = None
    humidity: float | None = None
    windSpeed: float | None = None
    rainfall: bool | None = None


# ---- Comparacion de vueltas ----

class LapRef(BaseModel):
    year: int
    round: int
    session: str
    driver: str
    lap: int


class CompareRequest(BaseModel):
    laps: list[LapRef]


class CompareLap(BaseModel):
    label: str
    color: str | None = None
    speed: list[float]
    throttle: list[float]
    brake: list[float]
    gear: list[int]
    rpm: list[float]
    x: list[float]
    y: list[float]


class DeltaSeries(BaseModel):
    label: str
    values: list[float]  # s vs. vuelta de referencia (+ = mas lento)


class CompareResponse(BaseModel):
    grid: list[float]
    laps: list[CompareLap]
    delta: list[DeltaSeries]
