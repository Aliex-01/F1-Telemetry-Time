"""Punto de entrada de la API FastAPI."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import asyncio

from .config import CORS_ORIGIN_REGEX, init_cache
from .live.manager import manager
from .routers import api, live

app = FastAPI(
    title="F1 Telemetry API",
    version="0.1.0",
    description="Telemetria historica de F1 servida via FastF1. Ver /docs.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api.router)
app.include_router(live.router)


@app.on_event("startup")
def _startup() -> None:
    init_cache()
    # Guarda el loop para que los feeds puedan difundir desde otros hilos.
    manager.set_loop(asyncio.get_event_loop())


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "docs": "/docs"}
