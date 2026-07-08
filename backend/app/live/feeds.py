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
import threading
import zlib

from ..config import CACHE_DIR
from .manager import LiveManager

# Canales del stream CarData.z de la F1.
CH_RPM, CH_SPEED, CH_GEAR, CH_THROTTLE, CH_BRAKE, CH_DRS = "0", "2", "3", "4", "5", "45"


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

    async def start(self) -> None:
        await self.manager.broadcast({
            "type": "meta", "kind": "live", "session": "Directo F1",
            "drivers": [], "tStart": 0.0, "tEnd": 0.0, "track": [],
            "rotation": 0.0, "corners": [],
        })
        self._thread = threading.Thread(target=self._run_client, daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        # SignalRClient no expone un stop limpio; el hilo es daemon y muere con el feed.
        self._client = None

    def _run_client(self) -> None:
        from fastf1.livetiming.client import SignalRClient

        manager = self.manager
        dump = str(CACHE_DIR / "_live_dump.txt")
        # Estado fusionado por coche: CarData y Position llegan en mensajes distintos.
        state: dict[str, dict] = {}

        def _decode(payload: str) -> dict:
            return json.loads(zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS))

        class _Client(SignalRClient):
            def _on_message(self, msg):  # type: ignore[override]
                try:
                    if not (isinstance(msg, list) and len(msg) >= 2):
                        return
                    topic, payload = msg[0], msg[1]

                    if topic == "CarData.z":
                        for entry in _decode(payload).get("Entries", []):
                            for num, car in entry.get("Cars", {}).items():
                                ch = car.get("Channels", {})
                                s = state.setdefault(num, {})
                                s.update({
                                    "speed": ch.get(CH_SPEED, 0),
                                    "throttle": ch.get(CH_THROTTLE, 0),
                                    "brake": ch.get(CH_BRAKE, 0),
                                    "gear": ch.get(CH_GEAR, 0),
                                    "rpm": ch.get(CH_RPM, 0),
                                    "drs": ch.get(CH_DRS, 0),
                                })
                    elif topic == "Position.z":
                        for item in _decode(payload).get("Position", []):
                            for num, p in item.get("Entries", {}).items():
                                s = state.setdefault(num, {})
                                s.update({"x": p.get("X", 0), "y": p.get("Y", 0)})
                    else:
                        return

                    manager.broadcast_threadsafe(
                        {"type": "frame", "t": 0.0, "cars": state}
                    )
                except Exception:  # noqa: BLE001 - no romper el hilo por un mensaje
                    pass

        self._client = _Client(filename=dump)
        self._client.start()
