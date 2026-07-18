"""Fuente de datos en tiempo real: LiveFeed (directo oficial de la F1).

La repeticion historica ya NO se transmite por WebSocket: el frontend la descarga
completa (endpoint /replay) y la reproduce en local. Aqui solo queda el directo.

Formato de mensajes que publica por el LiveManager:
  meta:  { "type":"meta", "kind":"live", "session":str, "drivers":[...],
           "track":[...], "rotation":float, "corners":[...] }
  frame: { "type":"frame", "t":float, "cars": { "<num>": {speed,...,x,y} } }
"""
from __future__ import annotations

import base64
import json
import logging
import threading
import time
import zlib

from ..config import CACHE_DIR
from .manager import LiveManager
from .timing import build_race_control, build_rows, build_weather, merge

# Canales del stream CarData.z de la F1.
CH_RPM, CH_SPEED, CH_GEAR, CH_THROTTLE, CH_BRAKE, CH_DRS = "0", "2", "3", "4", "5", "45"

# Ritmo maximo de difusion por WebSocket. El feed de la F1 manda CarData a mucha
# mas frecuencia; reenviar cada mensaje satura el socket sin ganar nada visible.
BROADCAST_HZ = 10.0
_MIN_INTERVAL = 1.0 / BROADCAST_HZ

# TimingData llega desde que la sesion abre, pero CarData.z / Position.z solo cuando
# los coches salen a pista. Sin estos valores por defecto el frontend pintaria NaN.
CAR_DEFAULTS = {"speed": 0, "throttle": 0, "brake": 0, "gear": 0, "rpm": 0, "drs": 0}

# La torre de tiempos cambia mucho mas despacio que la telemetria: los sectores
# se refrescan cada ~30 s por piloto, asi que 1 Hz sobra y el mensaje es gordo
# (~40 KB: mini-sectores, mensajes de carrera, fotos...).
_TIMING_INTERVAL = 1.0
# El historial de vueltas va aparte y mucho mas espaciado: solo cambia cuando
# alguien cruza meta, y reenviarlo con cada torre dispara el ancho de banda.
_LAPS_INTERVAL = 5.0

# Cada cuanto, como mucho, registramos un error al procesar mensajes.
_ERROR_LOG_EVERY = 5.0

# Banderas de TrackStatus (el feed las manda como string).
TRACK_STATUS = {
    "1": "AllClear", "2": "Yellow", "4": "SafetyCar",
    "5": "Red", "6": "VSC", "7": "VSCEnding",
}


def _drivers_from_list(payload: dict, acc: dict[str, dict]) -> None:
    """Funde el topic DriverList sobre `acc` (num -> ficha del piloto).

    Es incremental: los mensajes sueltos traen solo los pilotos que cambian, asi
    que hay que acumular. Reemplazar aqui deja la parrilla con dos coches.
    """
    for num, d in payload.items():
        if not isinstance(d, dict) or not str(num).isdigit():
            continue
        cur = acc.setdefault(str(num), {"code": str(num), "number": int(num),
                                        "team": None, "teamColor": None,
                                        "name": None, "headshot": None})
        if d.get("Tla"):
            cur["code"] = d["Tla"]
        if d.get("TeamName"):
            cur["team"] = d["TeamName"]
        if d.get("TeamColour"):
            cur["teamColor"] = f"#{d['TeamColour']}"
        # Para el panel del piloto: nombre completo y foto oficial.
        if d.get("FullName"):
            cur["name"] = d["FullName"]
        if d.get("HeadshotUrl"):
            cur["headshot"] = d["HeadshotUrl"]


class BaseFeed:
    kind: str = "base"

    def __init__(self, manager: LiveManager) -> None:
        self.manager = manager

    async def start(self) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError

    async def stop(self) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError


class LiveFeed(BaseFeed):
    """Se conecta al feed oficial de la F1 (SignalR). Solo funciona en directo.

    Envuelve el SignalRClient de FastF1 e intercepta cada mensaje CarData.z /
    Position.z para decodificarlo y reenviarlo por WebSocket. Corre en un hilo aparte.
    """

    kind = "live"

    def __init__(self, manager: LiveManager) -> None:
        super().__init__(manager)
        self._client = None
        self._thread: threading.Thread | None = None
        self._circuit_thread: threading.Thread | None = None
        # Marca que este feed ya se detuvo: el hilo de SignalR lo consulta para
        # dejar de difundir aunque su socket tarde en cerrarse.
        self._stopped = False
        # Se rellenan sobre la marcha (DriverList del feed / circuito del ano pasado)
        # y cada vez que cambian se reemite el meta.
        self._drivers: list[dict] = []
        self._circuit: dict = {}
        # Estado acumulado del cronometraje (el feed es incremental).
        self._timing: dict[str, dict] = {}
        self._stints: dict[str, list] = {}
        self._stats: dict[str, dict] = {}
        self._by_num: dict[str, dict] = {}
        self._session: dict = {}
        self._weather: dict = {}
        self._race_control: list = []
        # Vueltas cronometradas por piloto, para la grafica del panel del piloto.
        # El feed no da historial: hay que ir apuntandolo segun pasan.
        self._lap_history: dict[str, list] = {}
        # Si el piloto estaba en boxes al cerrarse su vuelta anterior. La vuelta
        # SIGUIENTE a una parada arrastra el tiempo parado, y cuando se cronometra
        # el coche ya no esta `InPit`: sin recordarlo se colaria en la grafica.
        self._pit_flag: dict[str, bool] = {}

    def _record_lap(self, num: str, line: dict) -> None:
        """Apunta la vuelta recien cronometrada de un piloto.

        El feed no manda historial, solo el ultimo tiempo, asi que lo vamos
        acumulando aqui. Usamos el nº de vuelta para no duplicar: LastLapTime
        se reenvia varias veces con el mismo valor.

        Se marcan las vueltas de boxes (`pit`) para poder excluirlas de la
        grafica: la de entrada acaba en el pit lane y la de salida arrastra todo
        el tiempo parado, asi que ninguna de las dos representa el ritmo real
        (una parada larga da "vueltas" de varios minutos).
        """
        last = line.get("LastLapTime")
        value = last.get("Value") if isinstance(last, dict) else None
        laps = line.get("NumberOfLaps")
        if not value or not isinstance(laps, int):
            return
        history = self._lap_history.setdefault(num, [])
        if history and history[-1]["lap"] == laps:
            return
        # Dos vueltas hay que descartar por cada parada:
        #  - la de ENTRADA, que acaba en el pit lane (`InPit` al cronometrarse);
        #  - la de SALIDA, la siguiente, que arrastra el tiempo parado.
        # La segunda no se puede detectar en su propio momento (el coche ya salio
        # y `PitOut` puede haberse limpiado), asi que la marca la deja puesta la
        # vuelta de entrada a traves de `_pit_flag`.
        in_pit = bool(line.get("InPit")) or bool(line.get("PitOut"))
        was_pit = bool(self._pit_flag.get(num))
        self._pit_flag[num] = in_pit
        history.append({
            "lap": laps,
            "time": str(value),
            "pit": in_pit or was_pit,
        })

    def _qualifying_part(self, info: dict) -> int | None:
        """Parte de la clasificacion (1, 2 o 3), deducida de los eliminados.

        El feed no publica en que parte va: `SessionInfo` dice "Qualifying" a
        secas. Pero `KnockedOut` marca a los eliminados en cuanto acaba cada
        parte, asi que el recuento da la parte sin ambiguedad.

        Los cortes se derivan del numero de coches en vez de fijarlos: en Q3
        quedan siempre 10, y de Q1 pasan `total - (total - 10) // 2`. Con 20
        coches son 15 (caen 5 por parte) y con 22 son 16 (caen 6). Asi no hay
        que tocar nada si cambia la parrilla.

        Se prefiere a contar transiciones de `SessionStatus` porque las banderas
        rojas dentro de una misma parte la dejarian mal contada.
        """
        if str(info.get("Type") or "") != "Qualifying":
            return None
        # `self._timing` va indexado por numero de coche (no bajo "Lines").
        total = len(self._timing)
        if not total:
            return 1
        out = sum(1 for line in self._timing.values() if line.get("KnockedOut"))
        # Eliminados acumulados al terminar cada parte.
        after_q1 = (total - 10 + 1) // 2  # 5 con 20 coches, 6 con 22
        after_q2 = total - 10
        if out >= after_q2:
            return 3
        if out >= after_q1:
            return 2
        return 1

    def _session_summary(self) -> dict:
        """Cabecera de la torre: sesion, estado de pista y tiempo restante."""
        info = self._session.get("SessionInfo", {}) or {}
        # El estado real esta en el topic SessionStatus; el de SessionInfo se
        # queda obsoleto (seguia diciendo "Started" con la sesion terminada).
        status_topic = self._session.get("SessionStatus", {}) or {}
        track = self._session.get("TrackStatus", {}) or {}
        clock = self._session.get("ExtrapolatedClock", {}) or {}
        laps = self._session.get("LapCount", {}) or {}
        meeting = info.get("Meeting", {}) or {}
        status = str(track.get("Status") or "")
        return {
            "name": info.get("Name"),
            "type": info.get("Type"),
            "meeting": meeting.get("Name"),
            "status": status_topic.get("Status") or info.get("SessionStatus"),
            "remaining": clock.get("Remaining"),
            # El feed manda ExtrapolatedClock de tanto en tanto; con este flag
            # nos dice que el reloj corre y que lo descontemos nosotros.
            "extrapolating": bool(clock.get("Extrapolating")),
            "trackStatus": TRACK_STATUS.get(status, track.get("Message")),
            "lap": laps.get("CurrentLap"),
            "totalLaps": laps.get("TotalLaps"),
            # 1/2/3 en clasificacion, None en el resto de sesiones.
            "part": self._qualifying_part(info),
        }

    def _meta(self) -> dict:
        return {
            "type": "meta", "kind": "live", "session": "Directo F1",
            "drivers": self._drivers, "tStart": 0.0, "tEnd": 0.0,
            "track": self._circuit.get("track", []),
            "rotation": self._circuit.get("rotation", 0.0),
            "corners": self._circuit.get("corners", []),
        }

    async def start(self) -> None:
        await self.manager.broadcast(self._meta())
        self._thread = threading.Thread(target=self._run_client, daemon=True)
        self._thread.start()
        # El trazado se descarga aparte: FastF1 puede tardar y no queremos
        # retrasar la conexion al directo.
        self._circuit_thread = threading.Thread(target=self._load_circuit, daemon=True)
        self._circuit_thread.start()

    async def stop(self) -> None:
        """Cierra de verdad la conexion SignalR.

        Antes esto solo soltaba la referencia y el cliente seguia vivo con su
        socket y su hilo `_supervise`. Cada arranque acumulaba otra conexion
        autenticada con el MISMO token F1TV; el servidor de la F1 iba echando a
        las anteriores (WinError 10053) y todas acababan muriendo por timeout.
        """
        self._stopped = True
        client, self._client = self._client, None
        if client is None:
            return
        try:
            # `_exit` cierra la conexion y el fichero de volcado. Es privado, pero
            # es el unico apagado que expone SignalRClient.
            client._exit()
        except Exception:  # noqa: BLE001 - si ya estaba caido, nos vale igual
            pass

    def _load_circuit(self) -> None:
        """Busca el trazado en la edicion anterior del mismo GP y reemite el meta."""
        try:
            from ..services.f1_data import get_live_circuit_meta

            circuit = get_live_circuit_meta()
        except Exception:  # noqa: BLE001 - el directo funciona sin trazado
            return
        # Cargar el trazado tarda; para cuando llega, el feed puede estar parado.
        if not circuit or self._stopped:
            return
        self._circuit = circuit
        self.manager.broadcast_threadsafe(self._meta())

    def _run_client(self) -> None:
        from fastf1.livetiming.client import SignalRClient

        feed = self
        manager = self.manager
        dump = str(CACHE_DIR / "_live_dump.txt")
        # Estado fusionado por coche: CarData y Position llegan en mensajes distintos.
        state: dict[str, dict] = {}
        t0 = time.time()
        last_sent = 0.0
        last_timing = 0.0
        last_laps = 0.0

        def _decode(payload: str) -> dict:
            return json.loads(zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS))

        log = logging.getLogger(__name__)
        errors = 0
        last_error_log = 0.0

        def _log_error() -> None:
            """Registra el fallo, pero como mucho una vez cada _ERROR_LOG_EVERY."""
            nonlocal errors, last_error_log
            errors += 1
            now = time.time()
            if now - last_error_log < _ERROR_LOG_EVERY:
                return
            last_error_log = now
            log.exception(
                "Error procesando un mensaje del directo (%d desde que arranco)", errors
            )

        timing_pending = False

        def _timing_dirty() -> None:
            nonlocal timing_pending
            timing_pending = True

        def _flush_timing() -> None:
            """Difunde la torre si toca. Ritmo propio: el cronometraje cambia
            mucho mas despacio que la telemetria."""
            nonlocal timing_pending, last_timing
            if not timing_pending:
                return
            now = time.time()
            if now - last_timing < _TIMING_INTERVAL:
                return
            last_timing = now
            timing_pending = False
            manager.broadcast_threadsafe({
                "type": "timing",
                "session": self._session_summary(),
                "rows": build_rows(self._timing, self._stints, self._by_num, self._stats),
                "weather": build_weather(self._weather),
                "raceControl": build_race_control(self._race_control),
            })

        def _flush_laps() -> None:
            """Historial de vueltas, a su propio ritmo (ver _LAPS_INTERVAL)."""
            nonlocal last_laps
            now = time.time()
            if now - last_laps < _LAPS_INTERVAL or not self._lap_history:
                return
            last_laps = now
            manager.broadcast_threadsafe(
                {"type": "laps", "history": {k: list(v) for k, v in self._lap_history.items()}}
            )

        def _apply(topic: str, payload) -> bool:
            """Funde un mensaje en `state`. Devuelve True si hay que difundir frame."""
            if topic == "CarData.z":
                for entry in _decode(payload).get("Entries", []):
                    for num, car in entry.get("Cars", {}).items():
                        ch = car.get("Channels", {})
                        state.setdefault(num, {}).update({
                            "speed": ch.get(CH_SPEED, 0),
                            "throttle": ch.get(CH_THROTTLE, 0),
                            "brake": ch.get(CH_BRAKE, 0),
                            "gear": ch.get(CH_GEAR, 0),
                            "rpm": ch.get(CH_RPM, 0),
                            "drs": ch.get(CH_DRS, 0),
                        })
                return True
            if topic == "Position.z":
                for item in _decode(payload).get("Position", []):
                    for num, p in item.get("Entries", {}).items():
                        state.setdefault(num, {}).update(
                            {"x": p.get("X", 0), "y": p.get("Y", 0)}
                        )
                return True
            if topic == "TimingData":
                # Feed incremental: solo trae los coches que cambian, y las listas
                # llegan como dicts indexados -> merge (ver live/timing.py).
                for num, line in (payload or {}).get("Lines", {}).items():
                    merged = merge(self._timing.get(num, {}), line)
                    self._timing[num] = merged
                    self._record_lap(num, merged)
                    pos = line.get("Position")
                    if pos not in (None, ""):
                        try:
                            state.setdefault(num, {})["pos"] = int(pos)
                        except (TypeError, ValueError):
                            pass
                _timing_dirty()
                return True
            if topic == "TimingStats":
                # Mejores sectores y velocidades punta (trampa de velocidad).
                for num, line in (payload or {}).get("Lines", {}).items():
                    self._stats[num] = merge(self._stats.get(num, {}), line)
                _timing_dirty()
                return False
            if topic == "WeatherData":
                self._weather = merge(self._weather, payload)
                _timing_dirty()
                return False
            if topic == "RaceControlMessages":
                # Banderas, tiempos borrados, investigaciones, penalizaciones.
                msgs = (payload or {}).get("Messages")
                if msgs is not None:
                    self._race_control = merge(self._race_control, msgs)
                    _timing_dirty()
                return False
            if topic == "TimingAppData":
                # De aqui salen los stints -> compuesto y vida del neumatico.
                for num, line in (payload or {}).get("Lines", {}).items():
                    stints = line.get("Stints")
                    if stints is not None:
                        self._stints[num] = merge(self._stints.get(num, []), stints)
                _timing_dirty()
                return False
            if topic in ("SessionInfo", "SessionStatus", "TrackStatus",
                         "ExtrapolatedClock", "LapCount"):
                self._session[topic] = merge(self._session.get(topic, {}), payload)
                _timing_dirty()
                return False
            if topic == "DriverList":
                # Codigos, equipos y colores. Sin esto la parrilla sale con el
                # numero crudo y sin color de equipo.
                before = len(self._by_num)
                _drivers_from_list(payload or {}, self._by_num)
                if self._by_num:
                    self._drivers = list(self._by_num.values())
                    if len(self._by_num) != before:
                        manager.broadcast_threadsafe(self._meta())
                    _timing_dirty()
                return False
            return False

        class _Client(SignalRClient):
            def _on_message(self, msg):  # type: ignore[override]
                # El supervisor del cliente base cierra la conexion si este sello
                # no se refresca antes de `timeout`. Lo primero y pase lo que pase.
                self._t_last_message = time.time()
                if feed._stopped:
                    # Feed reemplazado: su socket puede tardar en cerrarse, pero
                    # no debe seguir pisando el estado del feed nuevo.
                    return
                nonlocal last_sent
                try:
                    dirty = False
                    if isinstance(msg, list) and len(msg) >= 2:
                        dirty = _apply(msg[0], msg[1])
                    elif hasattr(msg, "result") and isinstance(msg.result, dict):
                        # Respuesta al Subscribe: snapshot inicial de todos los
                        # topics a la vez (aqui viene el DriverList de entrada).
                        for topic, payload in msg.result.items():
                            dirty = _apply(topic, payload) or dirty
                    else:
                        return

                    _flush_timing()
                    _flush_laps()
                    if not dirty:
                        return
                    now = time.time()
                    if now - last_sent < _MIN_INTERVAL:
                        return
                    last_sent = now
                    # Copia: el loop serializa en otro hilo mientras este sigue
                    # mutando `state`.
                    cars = {num: {**CAR_DEFAULTS, **car} for num, car in state.items()}
                    manager.broadcast_threadsafe(
                        {"type": "frame", "t": round(now - t0, 2), "cars": cars}
                    )
                except Exception:  # noqa: BLE001 - un mensaje malo no debe matar el feed
                    # Seguimos vivos, pero NO en silencio: antes esto era un
                    # `pass` y un fallo aqui dejaba la torre sin llegar sin una
                    # sola linea en el log. Limitado en frecuencia porque el feed
                    # manda cientos de mensajes por minuto y un error persistente
                    # inundaria la consola.
                    _log_error()

        # signalrcore anade un handler al logger en cada conexion; sin esto, tras
        # varios arranques cada linea sale repetida decenas de veces.
        sr_log = logging.getLogger("SignalRCoreClient")
        sr_log.handlers.clear()
        sr_log.propagate = False
        sr_log.addHandler(logging.NullHandler())

        client = _Client(filename=dump)
        if self._stopped:  # nos pararon mientras arrancabamos
            return
        self._client = client
        try:
            client.start()  # bloquea hasta que la conexion muere
        except Exception:  # noqa: BLE001 - el hilo no debe morir en silencio
            logging.getLogger(__name__).exception("El feed del directo se cayo")
        finally:
            if not self._stopped:
                # Murio solo (timeout / corte). Avisamos al frontend en vez de
                # dejarlo con el ultimo frame congelado para siempre.
                manager.broadcast_threadsafe({"type": "end"})
