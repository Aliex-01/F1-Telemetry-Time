# CLAUDE.md

Guía para Claude Code al trabajar en este repositorio.

## Proyecto

**F1 Telemetry** — visor de telemetría y tiempo real de F1. Son **dos apps separadas**:
- **Backend**: Python (FastAPI) que obtiene datos con **FastF1**, los cachea en disco, los adelgaza y los sirve como JSON/WebSocket. Vive en `backend/`. Entorno gestionado con **uv**.
- **Frontend**: React (Vite + TypeScript, gráficas con Recharts) que los pinta. Vive en `frontend/`.

Los datos se piden **en vivo** a la API (a diferencia de un sitio estático): el backend descarga cada sesión de la fuente oficial de F1 la primera vez, la cachea en `backend/.fastf1-cache/` y la reutiliza después.

**Puertos en desarrollo:** backend en **8080** (el 8000 da `WinError 10013` en Windows), frontend Vite en **5173**.

## Orientación en el repo

- Antes de explorar el repo, consulta **RESUMEN.md** para ubicar dónde vive cada cosa (mapa archivo por archivo, backend y frontend).
- No leas todo el repo salvo que se pida explícitamente. Si RESUMEN.md ya dice dónde está algo, ve directo a ese archivo.
- Para el diseño, contrato de la API y plan por fases, mira `DESIGN.md`.

## Trabajo con FastF1 / pandas — CRÍTICO para el coste

El backend maneja DataFrames enormes (una sesión son cientos de MB; la telemetría se remuestrea a ~800 puntos por vuelta). Volcar esos datos al chat dispara el consumo de tokens. Por tanto:

- **NUNCA** imprimas DataFrames enteros ni telemetría cruda: nada de `print(df)`, `df.head()` sobre telemetría, `df.to_string()`, ni volcar al chat respuestas JSON grandes de endpoints como `/replay`, `/telemetry` o `/compare`.
- Para inspeccionar un DataFrame usa solo lo mínimo: `df.shape`, `df.columns`, `df.dtypes`. Nunca el contenido completo.
- Al depurar errores de pandas/FastF1, **resume** el traceback y el error; no vuelques series, tablas ni objetos completos al chat.
- **No arranques el backend** (`uvicorn`) ni descargues sesiones nuevas de FastF1 para "probar" un cambio, salvo que lo pida explícitamente. Descargar una sesión es lento y llena el contexto. Asume que la caché en disco ya existe.

## Verificación (sin ejecutar ni abrir navegador)

- **Backend**: `uv run ruff check` para lint. No levantes el servidor para verificar salvo que lo pida.
- **Frontend**: `npx tsc --noEmit` para typecheck y el linter del proyecto. **No abras el navegador ni el preview** para verificar visualmente; la comprobación visual la hago yo con `npm run dev`.

## Comandos

```bash
# Backend (puerto 8080)
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8080   # solo cuando YO lo pida
uv run ruff check                                   # lint

# Frontend (puerto 5173)
cd frontend
npm install
npm run dev        # solo cuando YO lo pida; la verificación visual la hago yo
npx tsc --noEmit   # typecheck
```

## Arquitectura (resumen)

- **`backend/app/services/f1_data.py`** es el cerebro: envuelve FastF1, cachea sesiones (dos niveles, tope de 12 en memoria FIFO) y **adelgaza** los datos antes de enviarlos. Es el archivo más pesado y delicado; toca solo la función concreta que haga falta, no lo reescribas entero.
- **`backend/app/routers/api.py`** — endpoints REST (navegación, telemetría, meteo, circuito, replay, compare).
- **`backend/app/routers/live.py`** + **`backend/app/live/`** — tiempo real por WebSocket (solo durante un GP en directo).
- **`backend/app/models/schemas.py`** — el contrato de datos (Pydantic). Si cambias la forma de una respuesta, actualiza aquí Y el espejo en `frontend/src/types/api.ts`.
- **`frontend/src/App.tsx`** — el corazón de la UI (pestañas, selectores en cascada, estado). Archivo grande; localiza la parte concreta antes de tocar.
- **`frontend/src/api/client.ts`** — cliente tipado de la API.

## Convenciones

- El **contrato backend↔frontend** vive en dos sitios que deben ir sincronizados: `backend/app/models/schemas.py` (Pydantic) y `frontend/src/types/api.ts` (interfaces TS). Cambio en uno = cambio en el otro.
- El backend **adelgaza** siempre los datos antes de enviarlos; no muevas ese trabajo al frontend.
- No cambies los puertos (8080 backend, 5173 frontend) sin motivo — hay dependencias en `client.ts` y notas de Windows.

## Git

- No hagas `git push` nunca. Puedes preparar cambios y hacer `git add` + `git commit` con un buen mensaje **cuando yo lo pida**; el push lo hago yo tras verificar.
- **Sin coautoría**: los commits van solo con mi autoría. No añadas el trailer `Co-Authored-By: Claude ...` al mensaje; termina en la última línea de contenido.
- **Actualiza RESUMEN.md en CADA cambio**, sin que te lo pida y antes de terminar la tarea. No solo al crear, mover o renombrar archivos: también cuando cambies el **comportamiento** de algo ya documentado (un endpoint, una función, cómo se ve o se calcula algo). Una ficha que describe un diseño anterior engaña más que no tenerla — si rediseñas una vista o cambias de enfoque a mitad, vuelve atrás y corrige lo que ya habías escrito.