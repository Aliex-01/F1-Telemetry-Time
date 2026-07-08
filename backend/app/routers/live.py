"""Endpoints de tiempo real: WebSocket de streaming + control del directo."""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..live.feeds import LiveFeed
from ..live.manager import manager

router = APIRouter(prefix="/api/live")


@router.websocket("/ws")
async def live_ws(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            # No esperamos entrada del cliente; solo mantenemos viva la conexion.
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


@router.post("/live/start")
async def live_start() -> dict:
    # Solo funciona durante un GP en directo real.
    await manager.start_feed(LiveFeed(manager))
    return {"started": "live"}


@router.post("/stop")
async def live_stop() -> dict:
    await manager.stop_feed()
    return {"stopped": True}


@router.get("/status")
async def live_status() -> dict:
    return manager.status
