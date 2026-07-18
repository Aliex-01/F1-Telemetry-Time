"""Torre de tiempos en vivo a partir del cronometraje oficial (sin telemetria).

Los canales CarData.z / Position.z (velocidad, X/Y) requieren suscripcion F1TV de
pago. Con una cuenta gratuita el feed si entrega el cronometraje completo, que es
lo que reconstruimos aqui: posiciones, gaps, sectores y neumaticos.

Dos detalles del feed que condicionan todo este modulo:

1. Es **incremental**: cada mensaje trae solo lo que cambia, asi que hay que
   fusionar sobre el estado acumulado en vez de reemplazarlo.
2. En los mensajes incrementales, las **listas llegan como diccionarios indexados
   por posicion** ({"0": {...}, "2": {...}}), no como listas. En el snapshot
   inicial, en cambio, son listas de verdad. `merge` normaliza ambos casos.
"""
from __future__ import annotations

import re
from typing import Any

# Estado de cada mini-sector (Sectors[].Segments[].Status). Deducido de los
# valores reales del feed: 2048 domina (la mayoria de tramos no son mejores),
# 2049 aparece bastante menos y 2051 es rarisimo, que es justo el reparto que
# cabe esperar de amarillo / verde / morado.
SEGMENT_STATUS = {
    0: None,        # aun no ha pasado por ahi
    2048: "yellow",  # mas lento que su mejor
    2049: "green",   # mejor personal
    2051: "purple",  # mejor de la sesion
    2064: "pit",     # pit lane
}


def merge(dst: Any, src: Any) -> Any:
    """Fusiona un mensaje incremental sobre el estado acumulado.

    Devuelve el nuevo valor de `dst`. Trata los dicts con claves numericas como
    parches sobre listas (ver nota 2 del modulo).
    """
    if isinstance(src, dict) and isinstance(dst, list):
        # Parche indexado sobre una lista: {"1": {...}} -> dst[1]
        for key, val in src.items():
            try:
                idx = int(key)
            except (TypeError, ValueError):
                continue
            while len(dst) <= idx:
                dst.append({})
            dst[idx] = merge(dst[idx], val)
        return dst
    if isinstance(src, dict) and isinstance(dst, dict):
        for key, val in src.items():
            dst[key] = merge(dst.get(key), val)
        return dst
    if isinstance(src, list):
        return [merge({}, item) for item in src]
    return src


def _text(value: Any) -> str | None:
    """Normaliza un campo que puede venir como str o como {'Value': str}."""
    if isinstance(value, dict):
        value = value.get("Value")
    if value in (None, ""):
        return None
    return str(value)


def _segments(sec: dict) -> list[str | None]:
    """Los mini-sectores de un sector, ya traducidos a color."""
    raw = sec.get("Segments")
    items = raw.values() if isinstance(raw, dict) else (raw or [])
    out: list[str | None] = []
    for sg in items:
        status = sg.get("Status") if isinstance(sg, dict) else None
        out.append(SEGMENT_STATUS.get(status))
    return out


def _sector(sec: Any) -> dict:
    if not isinstance(sec, dict):
        return {"value": None, "personalFastest": False, "overallFastest": False,
                "segments": []}
    return {
        "value": _text(sec.get("Value")),
        "personalFastest": bool(sec.get("PersonalFastest")),
        "overallFastest": bool(sec.get("OverallFastest")),
        "segments": _segments(sec),
    }


def _stat(entry: Any) -> dict | None:
    """Un {Value, Position} de TimingStats -> {value, position}."""
    if not isinstance(entry, dict):
        return None
    value = _text(entry.get("Value"))
    if value is None:
        return None
    pos = entry.get("Position")
    return {"value": value, "position": int(pos) if isinstance(pos, int) else None}


def _stints(stints: Any) -> list[dict]:
    """Historial completo de neumaticos (para la barra de estrategia)."""
    if not isinstance(stints, list):
        return []
    out = []
    for s in stints:
        if not isinstance(s, dict) or not s.get("Compound"):
            continue
        laps = s.get("TotalLaps")
        out.append({
            "compound": str(s["Compound"]),
            "laps": int(laps) if isinstance(laps, (int, float)) else 0,
            "new": str(s.get("New")).lower() == "true" if s.get("New") else None,
        })
    return out


def _tyre(stints: Any) -> dict:
    """Ultimo stint = neumatico calzado ahora."""
    if not isinstance(stints, list) or not stints:
        return {"compound": None, "tyreLaps": None, "tyreNew": None}
    last = stints[-1] if isinstance(stints[-1], dict) else {}
    compound = last.get("Compound")
    laps = last.get("TotalLaps")
    return {
        "compound": str(compound) if compound else None,
        "tyreLaps": int(laps) if isinstance(laps, (int, float)) else None,
        "tyreNew": str(last.get("New")).lower() == "true" if last.get("New") else None,
    }


def _ideal_lap(best_sectors: list[dict | None]) -> str | None:
    """Vuelta ideal = suma de los mejores sectores. None si falta alguno."""
    total = 0.0
    for s in best_sectors:
        if not s or not s.get("value"):
            return None
        try:
            total += float(s["value"])
        except (TypeError, ValueError):
            return None
    minutes, secs = divmod(total, 60)
    return f"{int(minutes)}:{secs:06.3f}"


def build_rows(
    timing: dict[str, dict],
    stints: dict[str, list],
    drivers: dict[str, dict],
    stats: dict[str, dict] | None = None,
) -> list[dict]:
    """Arma las filas de la torre, ya ordenadas por posicion.

    El historial de vueltas NO va aqui a proposito: crece toda la sesion y esto
    se reenvia varias veces por segundo. Viaja en su propio mensaje (`laps`).
    """
    stats = stats or {}
    rows: list[dict] = []
    for num, line in timing.items():
        if not str(num).isdigit():
            continue
        st = stats.get(num, {})
        best_sectors = [_stat(s) for s in (st.get("BestSectors") or [])][:3]
        speeds = st.get("BestSpeeds") or {}
        try:
            pos = int(line.get("Position") or 0)
        except (TypeError, ValueError):
            pos = 0
        info = drivers.get(num, {})
        sectors = line.get("Sectors")
        rows.append({
            "num": str(num),
            "code": info.get("code") or str(num),
            "name": info.get("name"),
            "headshot": info.get("headshot"),
            "team": info.get("team"),
            "teamColor": info.get("teamColor"),
            "pos": pos,
            # En practicas/quali el feed manda TimeDiff*; en carrera, Gap/Interval.
            "gap": _text(line.get("TimeDiffToFastest") or line.get("GapToLeader")),
            "interval": _text(
                line.get("TimeDiffToPositionAhead")
                or line.get("IntervalToPositionAhead")
            ),
            "last": _text(line.get("LastLapTime")),
            "lastPersonalBest": bool(
                isinstance(line.get("LastLapTime"), dict)
                and line["LastLapTime"].get("PersonalFastest")
            ),
            "lastOverallBest": bool(
                isinstance(line.get("LastLapTime"), dict)
                and line["LastLapTime"].get("OverallFastest")
            ),
            "best": _text(line.get("BestLapTime")),
            "sectors": [_sector(s) for s in (sectors if isinstance(sectors, list) else [])][:3],
            "laps": line.get("NumberOfLaps"),
            "pitStops": line.get("NumberOfPitStops"),
            "inPit": bool(line.get("InPit")),
            "pitOut": bool(line.get("PitOut")),
            "retired": bool(line.get("Retired")),
            "stopped": bool(line.get("Stopped")),
            "knockedOut": bool(line.get("KnockedOut")),
            **_tyre(stints.get(num)),
            # --- detalle del piloto (panel al pinchar la fila) ---
            "stints": _stints(stints.get(num)),
            "bestSectors": best_sectors,
            "idealLap": _ideal_lap(best_sectors),
            # Velocidades: I1/I2 son los intermedios, FL meta y ST la trampa de
            # velocidad. Cada una con su puesto en el ranking de la sesion.
            "bestSpeeds": {k: _stat(speeds.get(k)) for k in ("I1", "I2", "FL", "ST")},
        })
    # Sin posicion (0) al fondo; el feed la deja a 0 hasta que marcan tiempo.
    rows.sort(key=lambda r: (r["pos"] == 0, r["pos"]))
    return rows


# Los mensajes citan al coche como "CAR 87 (BEA)"; asi sabemos a quien afectan.
_CAR_RE = re.compile(r"CAR (\d+)")


def build_race_control(messages: Any, limit: int = 40) -> list[dict]:
    """Mensajes de direccion de carrera, del mas reciente al mas antiguo."""
    items = messages.values() if isinstance(messages, dict) else (messages or [])
    out: list[dict] = []
    for m in items:
        if not isinstance(m, dict):
            continue
        text = m.get("Message")
        if not text:
            continue
        cars = _CAR_RE.findall(str(text))
        out.append({
            "utc": m.get("Utc"),
            "category": m.get("Category"),
            "message": str(text).strip(),
            "flag": m.get("Flag"),
            "scope": m.get("Scope"),
            "sector": m.get("Sector"),
            "lap": m.get("Lap"),
            # Numeros de coche citados, para filtrar el panel de un piloto.
            "cars": cars,
        })
    out.reverse()  # el feed los da en orden cronologico
    return out[:limit]


def build_weather(data: Any) -> dict | None:
    """Meteo en vivo. El feed manda todo como texto."""
    if not isinstance(data, dict) or not data:
        return None

    def num(key: str) -> float | None:
        try:
            return float(data[key])
        except (KeyError, TypeError, ValueError):
            return None

    return {
        "airTemp": num("AirTemp"),
        "trackTemp": num("TrackTemp"),
        "humidity": num("Humidity"),
        "pressure": num("Pressure"),
        "windSpeed": num("WindSpeed"),
        "windDirection": num("WindDirection"),
        "rainfall": str(data.get("Rainfall") or "0") not in ("0", "", "false"),
    }
