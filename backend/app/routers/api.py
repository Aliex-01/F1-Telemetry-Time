"""Endpoints REST. Cada uno delega en la capa de servicio (f1_data)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.schemas import (
    CircuitInfo,
    CompareRequest,
    CompareResponse,
    DriverInfo,
    EventInfo,
    LapInfo,
    SessionInfo,
    Telemetry,
    WeatherSample,
)
from ..services import f1_data

router = APIRouter(prefix="/api")


def _guard(fn, *args):
    """Ejecuta una llamada al servicio traduciendo errores a HTTP."""
    try:
        return fn(*args)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - superficie de error controlada
        raise HTTPException(status_code=502, detail=f"Error obteniendo datos F1: {exc}") from exc


@router.get("/seasons", response_model=list[int])
def seasons() -> list[int]:
    return f1_data.get_seasons()


@router.get("/{year}/events", response_model=list[EventInfo])
def events(year: int) -> list[EventInfo]:
    return _guard(f1_data.get_events, year)


@router.get("/{year}/{rnd}/sessions", response_model=list[SessionInfo])
def sessions(year: int, rnd: int) -> list[SessionInfo]:
    return _guard(f1_data.get_sessions, year, rnd)


@router.get("/{year}/{rnd}/{session}/drivers", response_model=list[DriverInfo])
def drivers(year: int, rnd: int, session: str) -> list[DriverInfo]:
    return _guard(f1_data.get_drivers, year, rnd, session)


@router.get("/{year}/{rnd}/{session}/{driver}/laps", response_model=list[LapInfo])
def laps(year: int, rnd: int, session: str, driver: str) -> list[LapInfo]:
    return _guard(f1_data.get_laps, year, rnd, session, driver)


@router.get(
    "/{year}/{rnd}/{session}/{driver}/lap/{lap_number}/telemetry",
    response_model=Telemetry,
)
def telemetry(year: int, rnd: int, session: str, driver: str, lap_number: int) -> Telemetry:
    return _guard(f1_data.get_telemetry, year, rnd, session, driver, lap_number)


@router.get("/{year}/{rnd}/{session}/micro-sectors")
def micro_sectors(year: int, rnd: int, session: str, part: str | None = None) -> list[dict]:
    """Rejilla comparativa: mejor vuelta de cada piloto troceada en micro-tramos."""
    return _guard(f1_data.get_micro_sectors, year, rnd, session, part)


@router.get("/{year}/{rnd}/{session}/weather", response_model=list[WeatherSample])
def weather(year: int, rnd: int, session: str) -> list[WeatherSample]:
    return _guard(f1_data.get_weather, year, rnd, session)


@router.get("/{year}/{rnd}/{session}/circuit", response_model=CircuitInfo)
def circuit(year: int, rnd: int, session: str) -> CircuitInfo:
    return _guard(f1_data.get_circuit_info, year, rnd, session)


@router.post("/{year}/{rnd}/{session}/prefetch")
def prefetch(year: int, rnd: int, session: str) -> dict:
    # Precalienta la telemetria de la sesion en segundo plano (llamado al elegir piloto).
    return _guard(f1_data.warm_session, year, rnd, session)


@router.get("/{year}/{rnd}/{session}/replay")
def replay(year: int, rnd: int, session: str) -> dict:
    # Repeticion completa remuestreada, para el reproductor local del frontend.
    return _guard(f1_data.get_replay_data, year, rnd, session)


@router.post("/compare", response_model=CompareResponse)
def compare(req: CompareRequest) -> CompareResponse:
    return _guard(f1_data.compare_laps, req.laps)
