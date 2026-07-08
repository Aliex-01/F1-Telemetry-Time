"""Configuracion global del backend y arranque de la cache de FastF1."""
from __future__ import annotations

from pathlib import Path

import fastf1

# Directorio de cache de FastF1 (grande: descargas de sesiones). En .gitignore.
CACHE_DIR = Path(__file__).resolve().parent.parent / ".fastf1-cache"

# Origenes permitidos para CORS:
# - dev: cualquier puerto de localhost (Vite puede usar 5173 u otro).
# - prod: el frontend en Cloudflare Pages (produccion y despliegues de preview *.pages.dev).
CORS_ORIGIN_REGEX = (
    r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    r"|https://([a-z0-9-]+\.)?f1-telemetry-time\.pages\.dev"
)


def init_cache() -> None:
    """Crea el directorio de cache y lo activa en FastF1. Idempotente."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))
