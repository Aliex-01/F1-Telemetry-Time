# F1 Telemetry — Backend

API FastAPI que sirve telemetria de F1 usando [FastF1](https://docs.fastf1.dev).

## Requisitos
- Python >= 3.11
- [uv](https://docs.astral.sh/uv/)

## Puesta en marcha
```bash
cd backend
uv sync                       # crea el entorno e instala dependencias
uv run uvicorn app.main:app --reload --port 8080
```

Luego abre **http://127.0.0.1:8080/docs** para la documentacion interactiva.

> El puerto oficial del proyecto es **8080**. En Windows el 8000 suele estar en un
> rango reservado (WSL/Hyper-V) y da `WinError 10013`.

## Notas
- La primera carga de una sesion descarga datos (lento); despues va de `.fastf1-cache/`.
- Telemetria detallada disponible de forma fiable desde ~2018.

## Ejemplo rapido (Monaco 2024, Qualifying)
```
GET /api/2024/events
GET /api/2024/8/sessions
GET /api/2024/8/Q/drivers
GET /api/2024/8/Q/VER/laps
GET /api/2024/8/Q/VER/lap/1/telemetry
```
