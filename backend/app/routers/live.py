"""Endpoints de tiempo real: WebSocket de streaming + control del directo."""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..live.auth import f1_auth_status
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
    # Validamos el token de F1TV ANTES de arrancar: si caducó, FastF1 no falla,
    # se cuelga esperando reautenticación en el navegador (ver live/auth.py). Si
    # no sirve, no tocamos el cliente y devolvemos el aviso para la UI.
    auth = f1_auth_status()
    if not auth["ok"]:
        return {"started": None, "auth": auth}
    await manager.start_feed(LiveFeed(manager))
    return {"started": "live", "auth": auth}


@router.get("/auth")
async def live_auth() -> dict:
    """Estado del token de F1TV, para avisar en la UI antes de que caduque."""
    return f1_auth_status()


@router.post("/stop")
async def live_stop() -> dict:
    await manager.stop_feed()
    return {"stopped": True}


@router.get("/status")
async def live_status() -> dict:
    return manager.status
