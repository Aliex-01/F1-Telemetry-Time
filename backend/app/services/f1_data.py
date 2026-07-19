"""Capa de acceso a datos: envuelve FastF1 y adelgaza los datos para el frontend.

Todo lo pesado (descargar/parsear sesiones) ocurre aqui y se cachea. El resto de
la app solo ve estructuras pequenas ya listas para serializar (ver DESIGN.md).
"""
from __future__ import annotations

import colorsys
import json
import threading
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd

from ..config import CACHE_DIR
from ..models.schemas import (
    CircuitInfo,
    CompareLap,
    CompareResponse,
    Corner,
    DeltaSeries,
    DriverInfo,
    EventInfo,
    LapInfo,
    LapRef,
    SessionInfo,
    Telemetry,
    WeatherSample,
)

# Numero de puntos al que remuestreamos cada vuelta antes de enviarla.
RESAMPLE_POINTS = 800

# Sesiones que intentamos exponer, en orden de fin de semana.
SESSION_ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
SESSION_NAMES = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "Q": "Qualifying",
    "R": "Race",
}


def _td_seconds(value) -> float | None:
    """Convierte un Timedelta/NaT de pandas a segundos (float) o None."""
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timedelta):
        return float(value.total_seconds())
    return float(value)


# Cache en proceso de sesiones cargadas. Guardamos si la telemetria esta cargada,
# porque la telemetria es lo mas pesado: para navegar (pilotos/vueltas) no hace falta.
_MAX_SESSIONS = 12
_sessions: dict[tuple[int, int, str], tuple[fastf1.core.Session, bool]] = {}
# Serializa las cargas para que el prefetch y abrir una vuelta no carguen dos veces.
_load_lock = threading.Lock()

# Micro-sectores ya calculados, por (año, ronda, sesion, tanda). Trocear la
# telemetria de todos los pilotos cuesta ~70 s aunque la sesion ya este en
# memoria, y el frontend vuelve a pedirlos en cada cambio de tanda: sin esta
# cache el navegador aborta la peticion antes de que llegue la respuesta.
_MAX_MICRO = 12
_micro_cache: dict[tuple[int, int, str, str], list[dict]] = {}
_micro_lock = threading.Lock()
# Ademas en disco: la cache en memoria se pierde al reiniciar el backend y volver
# a pagar ~10 s por tanda en cada arranque no tiene sentido, porque el resultado
# de una sesion pasada no cambia nunca.
_MICRO_DIR = CACHE_DIR / "micro-sectors"
# Version del formato en disco. Un JSON guardado no dice con que criterio se
# troceo: si cambia el numero de tramos o como se cortan, los archivos viejos
# seguirian sirviendose con el formato anterior y no habria forma de notarlo.
# Subir este numero deja atras los antiguos (y `_micro_sweep` los borra).
_MICRO_VERSION = 1


def _micro_path(key: tuple[int, int, str, str]) -> Path:
    year, rnd, session, part = key
    return _MICRO_DIR / f"v{_MICRO_VERSION}_{year}_{rnd}_{session}_{part or 'all'}.json"


def _micro_sweep() -> None:
    """Borra los micro-sectores en disco de versiones anteriores.

    La cache en memoria tiene tope (FIFO), pero la de disco crecia sin limite:
    cada tanda de cada sesion que se abra deja un archivo para siempre. Al menos
    los de formatos que ya no se leen no tienen por que quedarse.
    """
    try:
        for old in _MICRO_DIR.glob("*.json"):
            if not old.name.startswith(f"v{_MICRO_VERSION}_"):
                old.unlink(missing_ok=True)
    except OSError:  # la cache es prescindible: si no se puede limpiar, seguimos
        pass


def _micro_from_disk(key: tuple[int, int, str, str]) -> list[dict] | None:
    try:
        with _micro_path(key).open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):  # no existe o esta corrupto: se recalcula
        return None


#: El barrido de versiones viejas solo tiene sentido una vez por arranque.
_micro_swept = False


def _micro_to_disk(key: tuple[int, int, str, str], rows: list[dict]) -> None:
    global _micro_swept
    try:
        _MICRO_DIR.mkdir(parents=True, exist_ok=True)
        if not _micro_swept:  # se llama con `_micro_lock` tomado
            _micro_swept = True
            _micro_sweep()
        with _micro_path(key).open("w", encoding="utf-8") as fh:
            json.dump(rows, fh, separators=(",", ":"))
    except OSError:  # sin disco o sin permisos: seguimos con la cache en memoria
        pass


def _load_session(
    year: int, rnd: int, session: str, telemetry: bool = False
) -> fastf1.core.Session:
    """Carga una sesion cacheandola en proceso.

    telemetry=False (por defecto) solo carga vueltas + meteo -> navegacion rapida.
    telemetry=True carga ademas la telemetria (velocidad, X/Y, etc.) -> mas lento.
    Si ya esta cacheada con telemetria, se reutiliza aunque se pida sin ella.
    """
    key = (year, rnd, session)

    def _lookup() -> fastf1.core.Session | None:
        cached = _sessions.get(key)
        return cached[0] if cached is not None and (cached[1] or not telemetry) else None

    hit = _lookup()
    if hit is not None:
        return hit

    with _load_lock:
        # Re-comprobar dentro del lock: otro hilo pudo cargarla mientras esperabamos.
        hit = _lookup()
        if hit is not None:
            return hit

        ses = fastf1.get_session(year, rnd, session)
        ses.load(telemetry=telemetry, laps=True, weather=True)

        # Cap sencillo tipo FIFO para no acumular sesiones pesadas en memoria.
        if key not in _sessions and len(_sessions) >= _MAX_SESSIONS:
            _sessions.pop(next(iter(_sessions)))
        _sessions[key] = (ses, telemetry)
        return ses


def get_circuit_info(year: int, rnd: int, session: str) -> CircuitInfo:
    """Rotacion oficial + curvas del circuito, para orientar y anotar el mapa."""
    ses = _load_session(year, rnd, session)
    ci = ses.get_circuit_info()
    corners: list[Corner] = []
    for _, row in ci.corners.iterrows():
        corners.append(
            Corner(
                x=float(row["X"]),
                y=float(row["Y"]),
                number=int(row["Number"]),
                letter=str(row["Letter"]) if pd.notna(row["Letter"]) and row["Letter"] else None,
            )
        )
    return CircuitInfo(rotation=float(ci.rotation), corners=corners)


def warm_session(year: int, rnd: int, session: str) -> dict:
    """Precalienta la telemetria de una sesion (para prefetch en segundo plano).

    Aprovecha para dejar listos los micro-sectores de cada tanda: es el trabajo
    lento de la comparativa (~10 s) y hacerlo aqui lo saca del camino critico, de
    forma que cuando el usuario llegue a mirarla ya este calculada.
    """
    ses = _load_session(year, rnd, session, telemetry=True)
    parts: list[str | None] = [None]
    if _session_type(session) == "quali":
        prefix = "SQ" if session == "SQ" else "Q"
        try:
            found = ses.laps.split_qualifying_sessions()
        except Exception:  # noqa: BLE001
            found = []
        parts = [f"{prefix}{i}" for i, p in enumerate(found, start=1) if p is not None and len(p)]
    warmed = 0
    for part in parts:
        try:
            get_micro_sectors(year, rnd, session, part)
            warmed += 1
        except Exception:  # noqa: BLE001 - el prefetch nunca debe romper la peticion
            pass
    return {"warmed": True, "drivers": len(ses.drivers), "microParts": warmed}


def _circuit_meta(ses: fastf1.core.Session) -> tuple[float, list[dict], list[list[float]]]:
    """Rotacion, curvas y contorno del circuito (para dibujar el mapa)."""
    rotation, corners, track = 0.0, [], []
    try:
        ci = ses.get_circuit_info()
        rotation = float(ci.rotation)
        for _, row in ci.corners.iterrows():
            corners.append({
                "x": float(row["X"]), "y": float(row["Y"]),
                "number": int(row["Number"]),
                "letter": (str(row["Letter"]) if row["Letter"] else None),
            })
    except Exception:  # noqa: BLE001 - opcional
        pass
    try:
        fast = ses.laps.pick_fastest().get_pos_data()
        step = max(1, len(fast) // 250)
        track = [[float(x), float(y)] for x, y in
                 zip(fast["X"].to_numpy()[::step], fast["Y"].to_numpy()[::step])]
    except Exception:  # noqa: BLE001 - opcional
        pass
    return rotation, corners, track


def find_current_event(when: pd.Timestamp | None = None) -> tuple[int, int, str] | None:
    """El GP que se esta disputando ahora mismo -> (year, round, location).

    El fin de semana va de viernes a domingo y `EventDate` apunta al domingo, asi
    que aceptamos una ventana de -1/+4 dias alrededor de hoy.
    """
    now = when or pd.Timestamp.now()
    try:
        schedule = fastf1.get_event_schedule(now.year, include_testing=False)
    except Exception:  # noqa: BLE001 - sin red o temporada no publicada
        return None
    for _, row in schedule.iterrows():
        date = row.get("EventDate")
        if pd.isna(date) or int(row["RoundNumber"]) <= 0:
            continue
        delta = (pd.Timestamp(date).normalize() - now.normalize()).days
        if -1 <= delta <= 4:
            return int(now.year), int(row["RoundNumber"]), str(row.get("Location") or "")
    return None


def find_past_edition(location: str, before_year: int) -> tuple[int, int] | None:
    """La edicion mas reciente del mismo circuito antes de `before_year`.

    Devuelve (year, round) o None si el circuito es nuevo en el calendario.
    """
    if not location:
        return None
    target = location.strip().casefold()
    for year in range(before_year - 1, 2017, -1):
        try:
            schedule = fastf1.get_event_schedule(year, include_testing=False)
        except Exception:  # noqa: BLE001 - temporada no disponible
            continue
        for _, row in schedule.iterrows():
            if int(row["RoundNumber"]) <= 0:
                continue
            if str(row.get("Location") or "").strip().casefold() == target:
                return year, int(row["RoundNumber"])
    return None


def get_live_circuit_meta() -> dict | None:
    """Trazado + rotacion + curvas para el directo, sacados del ano anterior.

    El feed en vivo da posiciones X/Y pero no la geometria del circuito. Como el
    trazado no cambia de un ano a otro, reutilizamos la edicion pasada del mismo
    GP. Devuelve None si no se esta corriendo o si el circuito debuta este ano.
    """
    current = find_current_event()
    if current is None:
        return None
    year, _rnd, location = current
    past = find_past_edition(location, year)
    if past is None:
        return None
    past_year, past_rnd = past
    # La carrera es la que mas datos de posicion tiene; si fallara, probamos quali.
    for code in ("R", "Q"):
        try:
            ses = _load_session(past_year, past_rnd, code, telemetry=True)
        except Exception:  # noqa: BLE001 - sesion no disponible
            continue
        rotation, corners, track = _circuit_meta(ses)
        if track:
            return {
                "track": track, "rotation": rotation, "corners": corners,
                "source": f"{past_year} {location} ({code})",
            }
    return None


def get_replay_data(year: int, rnd: int, session: str, dt: float = 0.5) -> dict:
    """Toda la repeticion remuestreada a una rejilla temporal fija (para reproductor).

    El navegador descarga esto una vez y lo reproduce localmente (play/pausa/seek/
    velocidad instantaneos). Se adelgaza a ~2 muestras/seg y valores enteros.
    """
    ses = _load_session(year, rnd, session, telemetry=True)

    prepared: dict[str, tuple] = {}
    t_min, t_max = np.inf, -np.inf
    for num, cd in ses.car_data.items():
        pos = ses.pos_data.get(num)
        if pos is None or len(cd) == 0 or len(pos) == 0:
            continue
        ct = cd["SessionTime"].dt.total_seconds().to_numpy(dtype=float)
        pt = pos["SessionTime"].dt.total_seconds().to_numpy(dtype=float)
        prepared[num] = (cd, ct, pos, pt)
        t_min = min(t_min, float(ct[0]), float(pt[0]))
        t_max = max(t_max, float(ct[-1]), float(pt[-1]))

    grid = np.arange(t_min, t_max, dt)

    def as_int(a: np.ndarray) -> list[int]:
        return np.rint(a).astype(int).tolist()

    cars: dict[str, dict] = {}
    for num, (cd, ct, pos, pt) in prepared.items():
        brake = cd["Brake"].astype(float).to_numpy() * (100.0 if cd["Brake"].dtype == bool else 1.0)
        cars[num] = {
            "speed": as_int(np.interp(grid, ct, cd["Speed"].to_numpy(dtype=float))),
            "throttle": as_int(np.interp(grid, ct, cd["Throttle"].to_numpy(dtype=float))),
            "brake": as_int(np.interp(grid, ct, brake)),
            "gear": as_int(np.interp(grid, ct, cd["nGear"].to_numpy(dtype=float))),
            "x": as_int(np.interp(grid, pt, pos["X"].to_numpy(dtype=float))),
            "y": as_int(np.interp(grid, pt, pos["Y"].to_numpy(dtype=float))),
        }

    drivers = []
    for num in cars:
        try:
            info = ses.get_driver(num)
        except (KeyError, ValueError):
            info = {}
        drivers.append({
            "code": str(info.get("Abbreviation") or num),
            "number": int(num) if str(num).isdigit() else None,
            "team": str(info.get("TeamName") or "") or None,
            "teamColor": f"#{info['TeamColor']}" if info.get("TeamColor") else None,
        })

    rotation, corners, track = _circuit_meta(ses)
    return {
        "session": f"{year} R{rnd} {session}",
        "type": _session_type(session),
        "t0": float(grid[0]), "dt": dt, "n": int(len(grid)),
        "drivers": drivers, "cars": cars,
        "rotation": rotation, "corners": corners, "track": track,
        "standings": _race_standings(ses) if _session_type(session) == "race" else {},
        "pits": _pit_windows(ses) if _session_type(session) == "race" else {},
        "retirements": _retirements(ses) if _session_type(session) == "race" else [],
        "liveRanking": _timed_ranking(ses, session) if _session_type(session) != "race" else [],
        "flags": _flag_intervals(ses, float(grid[-1])),
        "safety": _safety_intervals(ses, float(grid[-1])),
        "rain": _rain_intervals(ses, float(grid[-1])),
    }


def _timed_ranking(ses: fastf1.core.Session, session: str) -> list[dict]:
    """Linea temporal de vueltas por 'tanda' para un ranking en vivo sincronizado con
    el reloj: practicas = 1 tanda; clasificacion = Q1/Q2/Q3 (o SQ1..). Cada evento es
    una vuelta cronometrada con su tiempo de sesion al completarla.
    """
    kind = _session_type(session)
    if kind == "quali":
        prefix = "SQ" if session == "SQ" else "Q"
        try:
            parts = ses.laps.split_qualifying_sessions()
        except Exception:  # noqa: BLE001
            parts = [ses.laps]
        named = [(f"{prefix}{i}", p) for i, p in enumerate(parts, start=1) if p is not None and len(p)]
    else:
        named = [("Sesión", ses.laps)]

    segments: list[dict] = []
    for name, part in named:
        events = []
        for _, r in part.iterrows():
            lt, t = r["LapTime"], r["Time"]
            if pd.isna(lt) or pd.isna(t):
                continue
            events.append({
                "t": round(t.total_seconds(), 2),
                "num": str(r["DriverNumber"]),
                "lapTime": round(lt.total_seconds(), 3),
                "compound": str(r["Compound"]) if pd.notna(r["Compound"]) else None,
            })
        if not events:
            continue
        events.sort(key=lambda e: e["t"])
        segments.append({
            "name": name, "start": events[0]["t"], "end": events[-1]["t"], "events": events,
        })
    return segments


#: Numero de micro-tramos por vuelta en la rejilla comparativa. La F1 usa ~20 por
#: sector; aqui se reparten sobre la vuelta entera para no depender de donde caen
#: los cortes de sector, que FastF1 no da por distancia.
MICRO_SEGMENTS = 24


def _micro_sectors(ses: fastf1.core.Session, lap: pd.Series, n: int) -> list[float] | None:
    """Tiempo (s) de cada micro-tramo de una vuelta, repartidos por distancia.

    FastF1 no expone los mini-sectores oficiales del feed en vivo, asi que se
    reconstruyen: se toma la telemetria de la vuelta, se reparte la distancia en
    `n` tramos iguales y se mide cuanto tardo el coche en cada uno.

    Devuelve None si la vuelta no tiene telemetria utilizable (habitual en vueltas
    de entrada a boxes o si la sesion se cargo sin telemetria).

    OJO con el coste: es una llamada a `get_telemetry()` por vuelta. Sirve para
    una vuelta suelta, pero NO para recorrer una tanda entera (cientos de
    vueltas) -eso cuelga la peticion-; para eso esta `_micros_from_sectors`.
    """
    try:
        tel = lap.get_telemetry().add_distance()
    except Exception:  # noqa: BLE001 - vuelta sin telemetria: se omite
        return None
    if tel.empty or "Distance" not in tel:
        return None
    dist = tel["Distance"].to_numpy(dtype=float)
    time_s = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    total = float(dist.max())
    if not np.isfinite(total) or total <= 0:
        return None
    # Tiempo acumulado en cada frontera de tramo -> diferencia = tiempo del tramo.
    edges = np.linspace(0.0, total, n + 1)
    at_edge = np.interp(edges, dist, time_s)
    return [round(float(d), 3) for d in np.diff(at_edge)]


def _micros_from_stint(
    tel: pd.DataFrame, start_s: float, end_s: float, n: int
) -> list[float] | None:
    """Micro-tramos reales de una vuelta, recortados de la telemetria del stint.

    `tel` es la telemetria continua de un piloto (una sola llamada para todas sus
    vueltas), con `SessionTime` y `Distance` acumulada. Aqui se recorta la ventana
    de una vuelta y se reparte SU distancia en `n` tramos iguales, midiendo cuanto
    tardo en cada uno.

    Es el mismo criterio que usan los mini-sectores del directo -tramos por
    distancia, no por tiempo-, y a diferencia de `_micro_sectors` no cuesta una
    llamada de telemetria por vuelta.
    """
    st = tel["_sess"].to_numpy(dtype=float)
    lo, hi = np.searchsorted(st, start_s), np.searchsorted(st, end_s)
    if hi - lo < n + 1:  # muestras insuficientes para trocear
        return None
    dist = tel["Distance"].to_numpy(dtype=float)[lo:hi]
    time_s = st[lo:hi]
    d0, d1 = float(dist[0]), float(dist[-1])
    if not np.isfinite(d0) or not np.isfinite(d1) or d1 <= d0:
        return None
    edges = np.linspace(d0, d1, n + 1)
    at_edge = np.interp(edges, dist, time_s)
    out = np.diff(at_edge)
    if not np.all(np.isfinite(out)) or np.any(out < 0):
        return None
    return [round(float(v), 3) for v in out]


def _micros_from_sectors(lap: pd.Series, n: int) -> list[float] | None:
    """Micro-tramos de una vuelta repartidos a partir de sus tiempos de sector.

    Alternativa barata a `_micro_sectors`: no toca la telemetria, asi que sirve
    para procesar todas las vueltas de una tanda en una sola peticion. Cada
    sector se divide en tramos proporcionales a su duracion, de forma que un
    sector lento reparte tramos mas lentos.

    Es menos fiel que la telemetria (dentro de un sector todos los tramos duran
    igual), pero conserva lo que importa para comparar: donde cada piloto gana o
    pierde respecto a los demas.
    """
    secs = []
    for col in ("Sector1Time", "Sector2Time", "Sector3Time"):
        v = lap.get(col)
        secs.append(v.total_seconds() if pd.notna(v) else None)
    if any(s is None or s <= 0 for s in secs):
        return None
    total = sum(secs)  # type: ignore[arg-type]
    if total <= 0:
        return None
    out: list[float] = []
    for i, s in enumerate(secs):
        # Tramos de este sector, proporcionales a su peso en la vuelta. Al menos
        # uno, y el ultimo sector absorbe el redondeo para que sumen `n`.
        k = max(1, round(n * (s / total))) if i < 2 else max(1, n - len(out))
        out.extend([round(s / k, 3)] * k)
    return out[:n]


def _micro_grid(ses: fastf1.core.Session, laps: pd.DataFrame) -> list[dict]:
    """Todas las vueltas cronometradas, troceadas en micro-tramos.

    Se mandan TODAS y no solo la mejor porque el frontend sigue el reloj del
    reproductor: en cada instante elige la vuelta que ese piloto esta dando. Por
    eso cada fila lleva su ventana temporal (`start`/`end`, tiempo de sesion).

    Cada fila lleva ademas los tres sectores, para pintar la barra agrupada bajo
    los tramos finos. El color lo decide el frontend comparando con el mejor de
    cada columna.
    """
    rows: list[dict] = []
    # Una sola llamada de telemetria POR PILOTO (no por vuelta): pedirla vuelta a
    # vuelta son cientos de llamadas y la peticion tardaba minutos. Con el stint
    # entero se trocean todas sus vueltas de una pasada.
    for num, grp in laps.groupby("DriverNumber"):
        tel = None
        try:
            t = grp.get_telemetry().add_distance()
            if not t.empty and "Distance" in t:
                t = t.copy()
                t["_sess"] = t["SessionTime"].dt.total_seconds()
                tel = t.sort_values("_sess")
        except Exception:  # noqa: BLE001 - sin telemetria se cae al reparto barato
            tel = None

        for _, lap in grp.iterrows():
            lt, end = lap["LapTime"], lap["Time"]
            if pd.isna(lt) or pd.isna(end):
                continue
            # Fuera las vueltas de boxes: la de entrada acaba en el pit lane y la
            # de salida arrastra el tiempo parado, asi que no son comparables (y
            # son mas de la mitad de la tanda: filtrarlas casi divide el trabajo).
            if pd.notna(lap.get("PitInTime")) or pd.notna(lap.get("PitOutTime")):
                continue
            end_s = end.total_seconds()
            start_s = end_s - lt.total_seconds()
            # Tramos reales por distancia (como el directo). Si esta vuelta no
            # tiene telemetria utilizable, se reparte desde los sectores.
            micros = (
                _micros_from_stint(tel, start_s, end_s, MICRO_SEGMENTS)
                if tel is not None
                else None
            )
            if micros is None:
                micros = _micros_from_sectors(lap, MICRO_SEGMENTS)
            if micros is None:
                continue

            def _sec(col: str, _lap=lap) -> float | None:
                v = _lap.get(col)
                return round(v.total_seconds(), 3) if pd.notna(v) else None

            rows.append({
                "num": str(num),
                "lapTime": round(lt.total_seconds(), 3),
                "lapNumber": int(lap["LapNumber"]) if pd.notna(lap["LapNumber"]) else None,
                "compound": str(lap["Compound"]) if pd.notna(lap["Compound"]) else None,
                "micros": micros,
                "sectors": [_sec("Sector1Time"), _sec("Sector2Time"), _sec("Sector3Time")],
                # Ventana en tiempo de sesion: `Time` es el instante de cruzar meta.
                "start": round(start_s, 2),
                "end": round(end_s, 2),
            })
    rows.sort(key=lambda r: r["start"])
    return rows


def _race_standings(ses: fastf1.core.Session) -> dict[str, list[dict]]:
    """Torre de tiempos por coche a lo largo de la carrera: posicion, gap al lider y al
    de delante, neumatico y su vida. Ademas de en meta, el gap se actualiza al cruzar
    los cortes de **sector 1 y 2** (`SectorNSessionTime`), para que no salte solo por
    meta. En los cortes intermedios se mantiene la posicion oficial de la vuelta (evita
    posiciones locales erroneas en coches doblados); solo refresca el gap.
    El frontend elige el ultimo registro con t <= tiempo de reproduccion.
    """
    standings: dict[str, list[dict]] = {}
    laps = ses.laps
    official_pos: dict[tuple[int, str], int] = {}  # (vuelta, num) -> posicion en meta

    # 1) Registro en meta (posicion oficial + gap por Time), como referencia.
    for lap_num in sorted(laps["LapNumber"].dropna().unique()):
        sub = laps[(laps["LapNumber"] == lap_num) & laps["Position"].notna() & laps["Time"].notna()]
        entries = []
        for _, r in sub.iterrows():
            entries.append((
                str(r["DriverNumber"]), int(r["Position"]),
                float(r["Time"].total_seconds()),
                str(r["Compound"]) if pd.notna(r["Compound"]) else None,
                float(r["TyreLife"]) if pd.notna(r["TyreLife"]) else None,
            ))
        if not entries:
            continue
        entries.sort(key=lambda e: e[1])  # por posicion
        leader_t = entries[0][2]
        prev_t = None
        for num, pos, t, comp, life in entries:
            official_pos[(int(lap_num), num)] = pos
            standings.setdefault(num, []).append({
                "t": round(t, 2), "lap": int(lap_num), "position": pos,
                "gapLeader": round(t - leader_t, 3),
                "gapAhead": round(t - prev_t, 3) if prev_t is not None else 0.0,
                "compound": comp, "tyreLife": round(life) if life is not None else None,
            })
            prev_t = t

    # 2) Cortes intermedios (S1, S2): mismo gap 'en la linea del corte', posicion oficial.
    for col in ("Sector1SessionTime", "Sector2SessionTime"):
        if col not in laps.columns:
            continue
        for lap_num in sorted(laps["LapNumber"].dropna().unique()):
            sub = laps[(laps["LapNumber"] == lap_num) & laps[col].notna()]
            entries = []
            for _, r in sub.iterrows():
                num = str(r["DriverNumber"])
                pos = official_pos.get((int(lap_num), num))
                if pos is None:
                    continue  # sin posicion oficial esa vuelta (p.ej. no la completo)
                entries.append((
                    num, pos, float(r[col].total_seconds()),
                    str(r["Compound"]) if pd.notna(r["Compound"]) else None,
                    float(r["TyreLife"]) if pd.notna(r["TyreLife"]) else None,
                ))
            if not entries:
                continue
            entries.sort(key=lambda e: e[2])  # por tiempo de cruce del corte
            leader_t = entries[0][2]
            prev_t = None
            for num, pos, t, comp, life in entries:
                standings[num].append({
                    "t": round(t, 2), "lap": int(lap_num), "position": pos,
                    "gapLeader": round(t - leader_t, 3),
                    "gapAhead": round(t - prev_t, 3) if prev_t is not None else 0.0,
                    "compound": comp, "tyreLife": round(life) if life is not None else None,
                })
                prev_t = t

    # Cada coche debe quedar ordenado cronologicamente (mezclamos meta + cortes).
    for recs in standings.values():
        recs.sort(key=lambda r: r["t"])
    return standings


def _pit_windows(ses: fastf1.core.Session) -> dict[str, list[dict]]:
    """Ventanas de boxes por piloto (`{start, end}`, tiempo de sesion), del instante en
    que cruza la entrada (`PitInTime`) al que cruza la salida (`PitOutTime`). Sirve para
    marcar 'BOX' en la torre solo mientras el coche esta dentro del pit lane.
    """
    windows: dict[str, list[dict]] = {}
    laps = ses.laps
    if laps is None or len(laps) == 0:
        return windows
    for num, dl in laps.groupby("DriverNumber"):
        events: list[tuple[float, str]] = []
        for v in dl["PitInTime"]:
            if pd.notna(v):
                events.append((float(v.total_seconds()), "in"))
        for v in dl["PitOutTime"]:
            if pd.notna(v):
                events.append((float(v.total_seconds()), "out"))
        events.sort()
        wins: list[dict] = []
        open_t: float | None = None
        for ts, kind in events:
            if kind == "in":
                open_t = ts
            else:  # out: cierra la ventana (o salida desde el pit lane sin entrada previa)
                start = open_t if open_t is not None else ts - 25.0
                wins.append({"start": round(start, 2), "end": round(ts, 2)})
                open_t = None
        if open_t is not None:  # entro y no salio (abandono en boxes)
            wins.append({"start": round(open_t, 2), "end": round(open_t + 30.0, 2)})
        if wins:
            windows[str(num)] = wins
    return windows


def _flag_intervals(ses: fastf1.core.Session, t_end: float) -> dict:
    """Intervalos de bandera para colorear el trazado en la repeticion.

    De los mensajes de direccion de carrera saca, en tiempo de sesion:
    - `yellow`: tramos {sector, start, end} donde un *sector de comisarios* estuvo
      en amarilla (o doble amarilla).
    - `red`: tramos {start, end} de bandera roja (afecta a toda la pista).
    - `sectorCount`: numero de sectores de comisarios (el maximo visto). El frontend
      reparte esos N sectores uniformemente sobre la longitud del trazado, porque
      FastF1 no da la posicion exacta de cada sector.
    """
    empty = {"sectorCount": 0, "yellow": [], "red": []}
    try:
        rcm = ses.race_control_messages
    except Exception:  # noqa: BLE001 - opcional
        return empty
    if rcm is None or len(rcm) == 0 or "Flag" not in rcm.columns:
        return empty

    has_sector = "Sector" in rcm.columns
    has_scope = "Scope" in rcm.columns
    # El campo Time puede venir como Timedelta (tiempo de sesion) o como Timestamp
    # absoluto; en ese caso lo referimos a t0_date (instante de SessionTime = 0).
    t0_date = getattr(ses, "t0_date", None)

    def secs(v) -> float | None:
        if pd.isna(v):
            return None
        if isinstance(v, pd.Timedelta):
            return float(v.total_seconds())
        if t0_date is not None:  # Timestamp absoluto
            return float((v - t0_date).total_seconds())
        return None

    sector_count = 0
    open_yellow: dict[int, float] = {}  # sector -> start
    red_start: float | None = None
    yellow: list[dict] = []
    red: list[dict] = []

    rows = rcm.sort_values("Time") if "Time" in rcm.columns else rcm
    for _, r in rows.iterrows():
        if str(r.get("Category")) != "Flag":
            continue
        t = secs(r.get("Time"))
        if t is None:
            continue
        flag = str(r.get("Flag") or "").strip().upper()
        scope = str(r.get("Scope") or "").strip() if has_scope else ""
        sec = None
        if has_sector and pd.notna(r.get("Sector")):
            sec = int(r["Sector"])
            sector_count = max(sector_count, sec)

        if flag in ("YELLOW", "DOUBLE YELLOW"):
            if scope == "Sector" and sec is not None and sec not in open_yellow:
                open_yellow[sec] = t
        elif flag in ("CLEAR", "GREEN"):
            if scope == "Sector" and sec is not None:
                if sec in open_yellow:
                    yellow.append({"sector": sec, "start": open_yellow.pop(sec), "end": t})
            else:  # verde/limpio de pista: cierra todo
                for s, st in open_yellow.items():
                    yellow.append({"sector": s, "start": st, "end": t})
                open_yellow.clear()
                if red_start is not None:
                    red.append({"start": red_start, "end": t})
                    red_start = None
        elif flag == "RED":
            # La roja afecta a toda la pista: cierra las amarillas locales.
            for s, st in open_yellow.items():
                yellow.append({"sector": s, "start": st, "end": t})
            open_yellow.clear()
            if red_start is None:
                red_start = t

    # Cierra lo que siga abierto al final de la sesion.
    for s, st in open_yellow.items():
        yellow.append({"sector": s, "start": st, "end": t_end})
    if red_start is not None:
        red.append({"start": red_start, "end": t_end})

    return {"sectorCount": sector_count, "yellow": yellow, "red": red}


def _retirements(ses: fastf1.core.Session) -> list[str]:
    """Numeros de los pilotos que ABANDONARON (accidente/averia): no completaron la
    distancia. Sirve para que en la torre caigan al fondo en vez de quedarse clavados
    con la posicion que tenian al abandonar.
    """
    try:
        res = ses.results
    except Exception:  # noqa: BLE001 - opcional
        return []
    if res is None or len(res) == 0:
        return []
    laps = ses.laps
    if laps is None or len(laps) == 0:
        return []
    max_lap = laps["LapNumber"].dropna().max()
    out: list[str] = []
    for _, r in res.iterrows():
        status = str(r.get("Status") or "")
        # "Finished" o "+N Lap(s)" = terminaron; el resto son abandonos.
        if status == "Finished" or "Lap" in status:
            continue
        num = str(r["DriverNumber"])
        done = laps[laps["DriverNumber"] == num]["LapNumber"].dropna()
        if len(done) == 0:
            continue  # no tomo la salida
        if int(done.max()) >= int(max_lap):
            continue  # completo la distancia (p.ej. descalificado tras acabar)
        out.append(num)
    return out


def _rain_intervals(ses: fastf1.core.Session, t_end: float) -> list[dict]:
    """Tramos de lluvia (`{start, end}`, tiempo de sesion) para el aviso del reproductor.

    Sale de `weather_data.Rainfall` (booleano, ~1 muestra/min, para toda la pista):
    FastF1 no da intensidad ni localizacion, solo llueve / no llueve.
    """
    try:
        wd = ses.weather_data
    except Exception:  # noqa: BLE001 - opcional
        return []
    if wd is None or len(wd) == 0 or "Rainfall" not in wd.columns or "Time" not in wd.columns:
        return []

    out: list[dict] = []
    start: float | None = None
    for _, r in wd.sort_values("Time").iterrows():
        t = r["Time"]
        if not isinstance(t, pd.Timedelta) or pd.isna(t):
            continue
        ts = float(t.total_seconds())
        raining = bool(r["Rainfall"])
        if raining and start is None:
            start = ts
        elif not raining and start is not None:
            out.append({"start": start, "end": ts})
            start = None
    if start is not None:
        out.append({"start": start, "end": t_end})
    return out


def _safety_intervals(ses: fastf1.core.Session, t_end: float) -> list[dict]:
    """Tramos de Safety Car / VSC (afectan a toda la pista), en tiempo de sesion.

    Sale de `track_status`, cuyos codigos son: 4 = Safety Car, 6 = VSC, 7 = VSC
    terminando. Devuelve {kind: 'SC'|'VSC', start, end} para avisar en el reproductor.
    """
    try:
        ts = ses.track_status
    except Exception:  # noqa: BLE001 - opcional
        return []
    if ts is None or len(ts) == 0 or "Status" not in ts.columns or "Time" not in ts.columns:
        return []

    def secs(v) -> float | None:
        return float(v.total_seconds()) if isinstance(v, pd.Timedelta) and pd.notna(v) else None

    out: list[dict] = []
    cur: tuple[str, float] | None = None  # (kind, start)
    for _, r in ts.sort_values("Time").iterrows():
        t = secs(r["Time"])
        if t is None:
            continue
        st = str(r["Status"]).strip()
        kind = "SC" if st == "4" else ("VSC" if st in ("6", "7") else None)
        if cur is not None and kind != cur[0]:
            out.append({"kind": cur[0], "start": cur[1], "end": t})
            cur = None
        if kind is not None and cur is None:
            cur = (kind, t)
    if cur is not None:
        out.append({"kind": cur[0], "start": cur[1], "end": t_end})
    return out


# ---------------------------------------------------------------- navegacion

def get_seasons() -> list[int]:
    # Telemetria detallada fiable desde ~2018 hasta la temporada actual.
    current = pd.Timestamp.now().year
    return list(range(2018, current + 1))


def get_events(year: int) -> list[EventInfo]:
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    events: list[EventInfo] = []
    for _, row in schedule.iterrows():
        events.append(
            EventInfo(
                round=int(row["RoundNumber"]),
                name=str(row["EventName"]),
                country=str(row.get("Country") or "") or None,
                circuit=str(row.get("Location") or "") or None,
                date=str(row["EventDate"].date()) if pd.notna(row.get("EventDate")) else None,
            )
        )
    return [e for e in events if e.round > 0]


def get_sessions(year: int, rnd: int) -> list[SessionInfo]:
    event = fastf1.get_event(year, rnd)
    now = pd.Timestamp.utcnow()
    available: list[SessionInfo] = []
    for i in range(1, 6):
        name = event.get(f"Session{i}")
        if not name or pd.isna(name):
            continue
        code = _session_code(str(name))
        if not code:
            continue
        # Fecha de inicio (UTC) de la sesion, para marcar las que aun no se han
        # disputado (no habra datos: evita pedirlas y dar un error feo).
        start = event.get(f"Session{i}DateUtc")
        date_iso, upcoming = None, False
        if pd.notna(start):
            start = pd.Timestamp(start)
            if start.tzinfo is None:
                start = start.tz_localize("UTC")
            date_iso = start.isoformat()
            upcoming = start > now
        available.append(SessionInfo(code=code, name=str(name), date=date_iso, upcoming=upcoming))
    # Ordena segun el orden natural del fin de semana.
    available.sort(key=lambda s: SESSION_ORDER.index(s.code) if s.code in SESSION_ORDER else 99)
    return available


def _session_code(name: str) -> str | None:
    mapping = {
        "Practice 1": "FP1",
        "Practice 2": "FP2",
        "Practice 3": "FP3",
        "Sprint Qualifying": "SQ",
        "Sprint Shootout": "SQ",
        "Sprint": "S",
        "Qualifying": "Q",
        "Race": "R",
    }
    return mapping.get(name)


def get_drivers(year: int, rnd: int, session: str) -> list[DriverInfo]:
    ses = _load_session(year, rnd, session)
    drivers: list[DriverInfo] = []
    for drv in ses.drivers:
        # Un numero puede estar en el timing pero no en los resultados (p. ej. reservas
        # en Libres): get_driver lanzaria KeyError. Lo manejamos con degradacion elegante.
        try:
            info = ses.get_driver(drv)
        except (KeyError, ValueError):
            drivers.append(DriverInfo(code=str(drv), number=int(drv) if str(drv).isdigit() else None, name=str(drv)))
            continue
        code = str(info.get("Abbreviation") or drv)
        drivers.append(
            DriverInfo(
                code=code,
                number=int(info["DriverNumber"]) if str(info.get("DriverNumber", "")).isdigit() else None,
                name=str(info.get("FullName") or code),
                team=str(info.get("TeamName") or "") or None,
                teamColor=f"#{info['TeamColor']}" if info.get("TeamColor") else None,
            )
        )
    return drivers


# ---------------------------------------------------------------- vueltas

def _qualifying_segments(ses: fastf1.core.Session, session: str, driver: str) -> dict[int, str]:
    """Mapa lapNumber -> 'Q1'/'Q2'/'Q3' (o 'SQ1'...) para el piloto, si es clasificacion."""
    if session not in ("Q", "SQ"):
        return {}
    prefix = "SQ" if session == "SQ" else "Q"
    try:
        parts = ses.laps.split_qualifying_sessions()
    except Exception:  # noqa: BLE001 - algunas sesiones no se pueden dividir
        return {}
    mapping: dict[int, str] = {}
    for i, part in enumerate(parts, start=1):
        if part is None:
            continue
        for num in part.pick_drivers(driver)["LapNumber"].tolist():
            if pd.notna(num):
                mapping[int(num)] = f"{prefix}{i}"
    return mapping


def get_laps(year: int, rnd: int, session: str, driver: str) -> list[LapInfo]:
    ses = _load_session(year, rnd, session)
    laps = ses.laps.pick_drivers(driver)
    best = laps["LapTime"].min()
    segments = _qualifying_segments(ses, session, driver)

    out: list[LapInfo] = []
    for _, lap in laps.iterlaps():
        lap_time = _td_seconds(lap["LapTime"])
        lap_num = int(lap["LapNumber"])
        out.append(
            LapInfo(
                lapNumber=lap_num,
                lapTime=lap_time,
                sector1=_td_seconds(lap["Sector1Time"]),
                sector2=_td_seconds(lap["Sector2Time"]),
                sector3=_td_seconds(lap["Sector3Time"]),
                compound=str(lap["Compound"]) if pd.notna(lap["Compound"]) else None,
                tyreLife=float(lap["TyreLife"]) if pd.notna(lap["TyreLife"]) else None,
                stint=int(lap["Stint"]) if pd.notna(lap["Stint"]) else None,
                segment=segments.get(lap_num),
                isPersonalBest=bool(pd.notna(best) and lap["LapTime"] == best),
                position=int(lap["Position"]) if pd.notna(lap["Position"]) else None,
            )
        )
    return out


# ---------------------------------------------------------------- clasificacion

def _session_type(session: str) -> str:
    if session in ("R", "S"):
        return "race"
    if session in ("Q", "SQ"):
        return "quali"
    return "practice"


# ---------------------------------------------------------------- telemetria

def _lap_telemetry_df(ses: fastf1.core.Session, driver: str, lap_number: int) -> pd.DataFrame:
    laps = ses.laps.pick_drivers(driver)
    lap = laps[laps["LapNumber"] == lap_number]
    if lap.empty:
        raise ValueError(f"Vuelta {lap_number} no encontrada para {driver}")
    tel = lap.iloc[0].get_telemetry().add_distance()
    return tel


def _resample_to_grid(tel: pd.DataFrame, grid: np.ndarray) -> dict[str, np.ndarray]:
    """Interpola las senales de telemetria a una rejilla comun de distancia."""
    dist = tel["Distance"].to_numpy(dtype=float)

    def interp(col: str) -> np.ndarray:
        return np.interp(grid, dist, tel[col].to_numpy(dtype=float))

    time_s = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    return {
        "speed": interp("Speed"),
        "throttle": interp("Throttle"),
        "brake": np.interp(grid, dist, tel["Brake"].astype(float).to_numpy()) * 100.0
        if tel["Brake"].dtype == bool
        else interp("Brake"),
        "gear": np.rint(interp("nGear")).astype(int),
        "rpm": interp("RPM"),
        "drs": np.rint(interp("DRS")).astype(int),
        "time": np.interp(grid, dist, time_s),
        "x": interp("X"),
        "y": interp("Y"),
    }


def get_telemetry(year: int, rnd: int, session: str, driver: str, lap_number: int) -> Telemetry:
    ses = _load_session(year, rnd, session, telemetry=True)
    tel = _lap_telemetry_df(ses, driver, lap_number)
    grid = np.linspace(0.0, float(tel["Distance"].max()), RESAMPLE_POINTS)
    r = _resample_to_grid(tel, grid)
    return Telemetry(
        distance=grid.tolist(),
        speed=r["speed"].tolist(),
        throttle=r["throttle"].tolist(),
        brake=r["brake"].tolist(),
        gear=r["gear"].tolist(),
        rpm=r["rpm"].tolist(),
        drs=r["drs"].tolist(),
        time=r["time"].tolist(),
        x=r["x"].tolist(),
        y=r["y"].tolist(),
    )


# ---------------------------------------------------------------- comparacion

# Paleta de reserva cuando un piloto no tiene color de equipo.
_FALLBACK_COLORS = ["#e10600", "#00c853", "#2962ff", "#ff9100", "#aa00ff", "#00e5ff"]
# Desplazamientos de luminosidad para distinguir vueltas del mismo color de equipo
# (mismo piloto o companeros) sin perder el tono del equipo.
_LIGHTNESS_OFFSETS = [0.0, 0.20, -0.20, 0.35, -0.35, 0.48]


def _adjust_lightness(hex_color: str, delta: float) -> str:
    """Desplaza la luminosidad de un color hex manteniendo tono y saturacion."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    light = max(0.15, min(0.9, light + delta))
    r, g, b = colorsys.hls_to_rgb(hue, light, sat)
    return f"#{int(round(r * 255)):02X}{int(round(g * 255)):02X}{int(round(b * 255)):02X}"


def _lap_colors(sessions_and_refs: list[tuple[fastf1.core.Session, LapRef]]) -> list[str]:
    """Asigna a cada vuelta el color de su equipo; si varias comparten color (mismo
    piloto o companeros), ajusta el brillo para diferenciarlas conservando el equipo.
    """
    base: list[str] = []
    for i, (ses, ref) in enumerate(sessions_and_refs):
        try:
            tc = ses.get_driver(ref.driver).get("TeamColor")
        except (KeyError, ValueError):
            tc = None
        base.append(f"#{tc}" if tc else _FALLBACK_COLORS[i % len(_FALLBACK_COLORS)])

    seen: dict[str, int] = {}
    out: list[str] = []
    for color in base:
        key = color.upper()
        n = seen.get(key, 0)
        seen[key] = n + 1
        offset = _LIGHTNESS_OFFSETS[min(n, len(_LIGHTNESS_OFFSETS) - 1)]
        out.append(color if n == 0 else _adjust_lightness(color, offset))
    return out


def compare_laps(refs: list[LapRef]) -> CompareResponse:
    if not refs:
        raise ValueError("Se requiere al menos una vuelta")

    # Rejilla comun: usamos la distancia maxima mas corta entre todas las vueltas
    # para no extrapolar mas alla del final de la vuelta mas corta.
    tels: list[tuple[LapRef, pd.DataFrame]] = []
    sess_refs: list[tuple[fastf1.core.Session, LapRef]] = []
    for ref in refs:
        ses = _load_session(ref.year, ref.round, ref.session, telemetry=True)
        tels.append((ref, _lap_telemetry_df(ses, ref.driver, ref.lap)))
        sess_refs.append((ses, ref))

    colors = _lap_colors(sess_refs)
    max_dist = min(float(t["Distance"].max()) for _, t in tels)
    grid = np.linspace(0.0, max_dist, RESAMPLE_POINTS)

    laps_out: list[CompareLap] = []
    resampled: list[dict[str, np.ndarray]] = []
    for i, (ref, tel) in enumerate(tels):
        r = _resample_to_grid(tel, grid)
        resampled.append(r)
        laps_out.append(
            CompareLap(
                label=f"{ref.driver} {ref.session} L{ref.lap}",
                color=colors[i],
                speed=r["speed"].tolist(),
                throttle=r["throttle"].tolist(),
                brake=r["brake"].tolist(),
                gear=r["gear"].tolist(),
                rpm=r["rpm"].tolist(),
                x=r["x"].tolist(),
                y=r["y"].tolist(),
            )
        )

    # Delta vs. la primera vuelta (referencia): diferencia de tiempo por distancia.
    ref_time = resampled[0]["time"]
    deltas: list[DeltaSeries] = []
    for i in range(1, len(resampled)):
        values = (resampled[i]["time"] - ref_time).tolist()
        deltas.append(DeltaSeries(label=laps_out[i].label, values=values))

    return CompareResponse(grid=grid.tolist(), laps=laps_out, delta=deltas)


# ---------------------------------------------------------------- meteorologia

def get_micro_sectors(year: int, rnd: int, session: str, part: str | None = None) -> list[dict]:
    """Micro-sectores de todas las vueltas cronometradas de la tanda.

    Se devuelven todas (no solo la mejor) con su ventana temporal, para que el
    frontend pueda mostrar la vuelta que cada piloto esta dando en el instante
    del reproductor sin volver a pedir nada.

    `part` acota a una tanda de clasificacion ("Q1", "Q2"...); sin ella se usa la
    sesion entera.

    Los tramos se cortan de la telemetria (como los mini-sectores del directo),
    con UNA llamada por piloto y no por vuelta. Si un piloto no tiene telemetria
    utilizable se cae al reparto por tiempos de sector.
    """
    key = (year, rnd, session, part or "")
    cached = _micro_cache.get(key)
    if cached is not None:
        return cached

    with _micro_lock:
        # Re-comprobar dentro del lock: otro hilo pudo calcularlo mientras
        # esperabamos, y son ~10 s de trabajo que no conviene repetir.
        cached = _micro_cache.get(key)
        if cached is not None:
            return cached

        # En disco sobrevive al reinicio del backend: una sesion pasada no cambia.
        from_disk = _micro_from_disk(key)
        if from_disk is not None:
            _micro_cache[key] = from_disk
            return from_disk

        ses = _load_session(year, rnd, session, telemetry=True)
        laps = ses.laps
        if part and _session_type(session) == "quali":
            try:
                parts = ses.laps.split_qualifying_sessions()
            except Exception:  # noqa: BLE001
                parts = []
            prefix = "SQ" if session == "SQ" else "Q"
            for i, p in enumerate(parts, start=1):
                if p is not None and len(p) and f"{prefix}{i}" == part:
                    laps = p
                    break
        rows = _micro_grid(ses, laps)
        if len(_micro_cache) >= _MAX_MICRO:  # FIFO, como la cache de sesiones
            _micro_cache.pop(next(iter(_micro_cache)))
        _micro_cache[key] = rows
        _micro_to_disk(key, rows)
        return rows


def get_weather(year: int, rnd: int, session: str) -> list[WeatherSample]:
    ses = _load_session(year, rnd, session)
    wd = ses.weather_data
    out: list[WeatherSample] = []
    for _, row in wd.iterrows():
        out.append(
            WeatherSample(
                time=_td_seconds(row["Time"]) or 0.0,
                airTemp=float(row["AirTemp"]) if pd.notna(row["AirTemp"]) else None,
                trackTemp=float(row["TrackTemp"]) if pd.notna(row["TrackTemp"]) else None,
                humidity=float(row["Humidity"]) if pd.notna(row["Humidity"]) else None,
                windSpeed=float(row["WindSpeed"]) if pd.notna(row["WindSpeed"]) else None,
                rainfall=bool(row["Rainfall"]) if pd.notna(row["Rainfall"]) else None,
            )
        )
    return out
