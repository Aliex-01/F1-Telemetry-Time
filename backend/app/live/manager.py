"""Gestor de tiempo real: mantiene las conexiones WebSocket y el feed activo.

Solo hay un feed activo a la vez (replay o live). Arrancar uno detiene el anterior.
Tanto ReplayFeed como LiveFeed publican por aqui, con el mismo formato de mensajes,
asi que el frontend no distingue de donde vienen los datos.
"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket

if TYPE_CHECKING:
    from .feeds import BaseFeed


class LiveManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._feed: BaseFeed | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        # Ultimo mensaje "meta" para enviarlo a clientes que se conectan tarde.
        self._last_meta: dict[str, Any] | None = None

    # ---- ciclo de vida del loop (lo fija el arranque de la app) ----
    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def loop(self) -> asyncio.AbstractEventLoop | None:
        return self._loop

    # ---- conexiones ----
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        if self._last_meta is not None:
            await ws.send_json(self._last_meta)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    # ---- difusion ----
    async def broadcast(self, message: dict[str, Any]) -> None:
        if message.get("type") == "meta":
            self._last_meta = message
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - cliente caido
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def broadcast_threadsafe(self, message: dict[str, Any]) -> None:
        """Difunde desde un hilo ajeno al loop (lo usa LiveFeed / SignalR)."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    # ---- feeds ----
    async def start_feed(self, feed: "BaseFeed") -> None:
        await self.stop_feed()
        self._feed = feed
        self._last_meta = None
        await feed.start()

    async def stop_feed(self) -> None:
        if self._feed is not None:
            await self._feed.stop()
            self._feed = None
            self._last_meta = None

    @property
    def status(self) -> dict[str, Any]:
        return {
            "active": self._feed is not None,
            "kind": self._feed.kind if self._feed else None,
            "clients": len(self._clients),
        }


manager = LiveManager()
