# F1 Telemetry & Time

Visor de **telemetría y tiempo real de Fórmula 1**. Descarga las sesiones oficiales con
[FastF1](https://docs.fastf1.dev/), las adelgaza en el servidor y las pinta en el navegador:
análisis de vueltas, comparación entre pilotos, mapa de pista, meteorología y un
reproductor de repeticiones con torre de tiempos estilo TV.

> A diferencia de un sitio estático, los datos se piden **en vivo** a la API: la primera vez
> que se abre una sesión, el backend la descarga de la fuente oficial de F1, la cachea en
> disco y la reutiliza después.

---

## Características

- **Análisis de vueltas** — telemetría remuestreada (velocidad, acelerador, freno, marcha,
  RPM, DRS) alineada por distancia, con mapa de pista sincronizado al pasar el ratón.
- **Comparación** — varias vueltas superpuestas y **delta acumulado** (tiempo ganado/perdido
  metro a metro), con el color de equipo de cada piloto.
- **Meteorología** — aire, pista, humedad, viento y una franja que marca cuándo llovió.
- **Reproductor de repeticiones** — reproduce la sesión completa **en local** (play/pausa,
  ±10 s, seek, velocidad), con torre de tiempos que reordena en directo, avisos de
  bandera/SC/VSC/lluvia y, en clasificación, la **zona de eliminación** (Q1/Q2/Q3).
- **Tiempo real** — durante un GP en vivo, mapa y parrilla por WebSocket.

## Stack

| | |
|---|---|
| **Backend** | Python · [FastAPI](https://fastapi.tiangolo.com/) · [FastF1](https://docs.fastf1.dev/) · pandas · entorno con [uv](https://docs.astral.sh/uv/) |
| **Frontend** | [React 19](https://react.dev/) · [Vite](https://vite.dev/) · TypeScript · [Recharts](https://recharts.org/) |

Son **dos apps separadas**: el backend obtiene y adelgaza los datos y los sirve como
JSON/WebSocket; el frontend los pinta.

```
Navegador (React)
      │  fetch  /api/*        (REST/JSON)
      │  WebSocket  /api/live/ws   (directo)
      ▼
Backend FastAPI (:8080)  ──→  FastF1  ──→  API oficial de F1 + caché en disco
```

## Puesta en marcha (local)

Requisitos: [uv](https://docs.astral.sh/uv/) (Python) y Node.js.

```bash
# Terminal 1 — backend (puerto 8080)
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8080
#   → API en http://127.0.0.1:8080 · documentación en /docs

# Terminal 2 — frontend (puerto 5173)
cd frontend
npm install
npm run dev
#   → app en http://localhost:5173
```

> **Puertos:** backend en **8080** (el 8000 está reservado en Windows y da `WinError 10013`),
> frontend Vite en **5173**.
>
> La **primera** vez que se abre una sesión, FastF1 la **descarga** (lento, inevitable).
> A partir de ahí va de la caché en disco (`backend/.fastf1-cache/`).
> El **directo** solo transmite datos durante un GP en vivo; para sesiones pasadas se usa
> la **Repetición**.

## Despliegue

Frontend estático en **Cloudflare Pages** + backend en tu PC expuesto por **túnel** de
Cloudflare (la URL del backend es configurable en tiempo de ejecución desde la UI). Los pasos
están en [DEPLOY.md](DEPLOY.md); `start-online.bat` arranca backend y túnel de un tirón.

## Documentación del repo

| Archivo | Qué es |
|---|---|
| [RESUMEN.md](RESUMEN.md) | Mapa del código archivo por archivo (backend y frontend). |
| [DESIGN.md](DESIGN.md) | Arquitectura, contrato de la API y plan por fases. |
| [DEPLOY.md](DEPLOY.md) | Guía de despliegue (Cloudflare Pages + túnel). |

## Licencia

Proyecto personal. Los datos de F1 se obtienen vía FastF1 (fuente oficial de F1); respeta sus
términos de uso.
