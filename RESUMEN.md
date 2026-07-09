# Resumen del proyecto — F1 Telemetry

Guía de referencia rápida: qué es cada carpeta y cada archivo, y para qué sirve.
Pensado para orientarte rápido sin tener que releer todo el código.

> Para el **diseño**, el contrato de la API y el plan por fases, mira
> [DESIGN.md](DESIGN.md). Esto es un mapa del código en sí.

---

## 1. Cómo está montada la app, en una frase

Son **dos apps separadas**: un **backend Python (FastAPI)** que obtiene los datos de
F1 con la librería **FastF1** y los sirve como JSON, y un **frontend React** (Vite +
TypeScript) que los pinta. A diferencia de un sitio estático, aquí **los datos sí se
piden en vivo** a la API: el backend descarga cada sesión de la fuente oficial de F1
(la primera vez), la cachea en disco y en memoria, la adelgaza y la manda al navegador.

```
Navegador (React)
      │
      ├─→ fetch  http://127.0.0.1:8080/api/*     (REST/JSON: sesiones, vueltas, telemetría…)
      └─→ WebSocket  /api/live/ws                 (tiempo real: directo de un GP)
                        │
                        ▼
             Backend FastAPI (puerto 8080)
                        │
                        ▼
                     FastF1  ──→  API oficial de F1 (live timing) + caché en disco
```

**Puertos en desarrollo:** backend en **8080** (el 8000 está reservado en Windows y da
`WinError 10013`), frontend Vite en **5173**. Entorno de Python gestionado con **uv**.

---

## 2. Mapa de carpetas

| Carpeta | Qué hay |
|---|---|
| `backend/` | La API en Python (FastAPI + FastF1). |
| `backend/app/` | Todo el código del backend. |
| `backend/app/routers/` | Los endpoints (REST y WebSocket). |
| `backend/app/services/` | La lógica: envuelve FastF1 y adelgaza los datos. |
| `backend/app/models/` | Los esquemas Pydantic = el contrato de datos. |
| `backend/app/live/` | El motor de tiempo real (WebSocket + cliente del directo F1). |
| `frontend/` | La app React (Vite + TypeScript). |
| `frontend/src/` | Todo el código del frontend. |
| `frontend/src/components/` | Piezas de UI reutilizables (gráficas, tabla, mapa, selector…). |
| `frontend/src/live/` | Todo lo de la pestaña "Tiempo real" (reproductor + directo). |
| `frontend/src/api/` | El cliente tipado que habla con el backend. |
| `frontend/src/types/` | Los `interface` de TypeScript, espejo del contrato del backend. |

---

## 3. Backend — `backend/app/`

### 3.1 Arranque y configuración

| Archivo | Qué hace |
|---|---|
| `main.py` | Crea la app FastAPI, activa **CORS**, incluye los dos routers (`api` y `live`) y, al arrancar, inicializa la caché de FastF1 y guarda el *event loop* para el tiempo real. Expone `/` (ping) y la documentación automática en **`/docs`**. |
| `config.py` | Define el directorio de caché en disco (`.fastf1-cache/`), la regex de **CORS** (acepta cualquier puerto de `localhost` en dev) y `init_cache()` (activa la caché de FastF1). |

### 3.2 `routers/` — los endpoints

**`routers/api.py`** — API REST. Cada endpoint delega en `services/f1_data.py`. Un
helper `_guard` traduce los errores a HTTP (404 si no hay datos, 502 si falla FastF1).

| Método y ruta | Qué devuelve |
|---|---|
| `GET /api/seasons` | Años disponibles (2018 → temporada actual). |
| `GET /api/{year}/events` | Los GPs de una temporada (ronda, nombre, circuito, fecha). |
| `GET /api/{year}/{rnd}/sessions` | Sesiones del GP (FP1-3, SQ, S, Q, R). |
| `GET /api/{year}/{rnd}/{session}/drivers` | Pilotos de la sesión (código, número, equipo, color). |
| `GET /api/{year}/{rnd}/{session}/{driver}/laps` | Vueltas del piloto (tiempo, sectores, neumático, stint, segmento Q1/Q2/Q3…). |
| `GET /api/.../{driver}/lap/{n}/telemetry` | Telemetría de una vuelta remuestreada (velocidad, acelerador, freno, marcha, RPM, DRS, X/Y). |
| `GET /api/{year}/{rnd}/{session}/weather` | Meteorología por muestra (aire, pista, humedad, viento, lluvia). |
| `GET /api/{year}/{rnd}/{session}/circuit` | Rotación oficial + curvas del circuito (para orientar y anotar el mapa). |
| `GET /api/{year}/{rnd}/{session}/replay` | La sesión **completa** remuestreada, para el reproductor local (incluye torre de tiempos de carrera y ranking en vivo de prácticas/quali). |
| `POST /api/{year}/{rnd}/{session}/prefetch` | Precalienta la telemetría de la sesión en segundo plano (se llama al elegir piloto). |
| `POST /api/compare` | Compara varias vueltas: canales alineados por distancia, delta acumulado y color de equipo por vuelta. |

**`routers/live.py`** — tiempo real (solo el **directo**, que únicamente da datos
durante un GP en vivo). La repetición histórica NO pasa por aquí; la sirve `/replay`.

| Ruta | Qué hace |
|---|---|
| `WebSocket /api/live/ws` | Canal por el que se transmiten los fotogramas del directo. |
| `POST /api/live/live/start` | Arranca el cliente del directo oficial de F1. |
| `POST /api/live/stop` | Detiene el feed activo. |
| `GET /api/live/status` | Estado (feed activo, nº de clientes conectados). |

### 3.3 `services/f1_data.py` — el cerebro del backend

Todo lo pesado (descargar/parsear sesiones de FastF1) ocurre aquí, y aquí se
**adelgazan** los datos antes de enviarlos. Puntos clave:

- **Caché de sesiones de dos niveles** (`_load_session`): para *navegar* (pilotos,
  vueltas, meteo) carga solo lo ligero; la **telemetría** pesada solo se carga cuando
  de verdad se abre una vuelta o se compara. Con un *lock* para que el prefetch y abrir
  una vuelta a la vez no carguen dos veces. Tope de 12 sesiones en memoria (FIFO).
- **Remuestreo**: cada vuelta se interpola a ~800 puntos por distancia; la repetición
  completa se remuestrea a 2 muestras/seg.

| Función | Qué hace |
|---|---|
| `get_seasons` / `get_events` / `get_sessions` / `get_drivers` / `get_laps` | La **navegación** en cascada. `get_drivers` degrada con elegancia si un número está en el *timing* pero no en resultados (reservas en Libres). `get_laps` etiqueta cada vuelta con su segmento **Q1/Q2/Q3** (vía `split_qualifying_sessions`). |
| `get_telemetry` | Extrae la telemetría de una vuelta y la remuestrea por distancia (velocidad, throttle, brake, gear, RPM, DRS, tiempo, X/Y). |
| `compare_laps` | Alinea varias vueltas a una rejilla común de distancia, calcula el **delta** acumulado vs. la de referencia y asigna a cada vuelta el **color de su equipo** (ajustando el brillo cuando son del mismo piloto/compañeros para distinguirlas sin perder el equipo). |
| `get_weather` | Serie meteorológica de la sesión. |
| `get_circuit_info` | Rotación oficial + curvas (de `get_circuit_info()` de FastF1). |
| `get_replay_data` | Empaqueta la sesión entera para el reproductor local: posición X/Y y canales de cada coche en una rejilla temporal fija, contorno del circuito, —según el tipo— la **torre de tiempos de carrera** (`_race_standings`) o el **ranking cronometrado** de prácticas/quali (`_timed_ranking`), los **intervalos de bandera** (`_flag_intervals`), **SC/VSC** (`_safety_intervals`), **lluvia** (`_rain_intervals`), **abandonos** (`_retirements`) y **ventanas de boxes** (`_pit_windows`). |
| `_race_standings` | Torre de tiempos por coche: posición, gap al líder/al de delante, neumático y vida. El **gap se refresca en S1, S2 y meta** (`SectorNSessionTime`), no solo al pasar por meta; en los cortes intermedios mantiene la posición oficial de la vuelta (para no descuadrar doblados). |
| `_flag_intervals` | De `race_control_messages` saca los tramos de **amarilla por sector de comisarios** y de **roja** (toda la pista), con su tiempo de sesión, para colorear el trazado en la repetición. Devuelve además `sectorCount` (nº de sectores; el frontend los reparte uniformemente sobre el trazado, porque FastF1 no da su posición exacta). |
| `_safety_intervals` | De `track_status` saca los tramos de **Safety Car** y **VSC** (`{kind, start, end}`, tiempo de sesión) para el aviso del reproductor. |
| `_rain_intervals` | De `weather_data.Rainfall` (booleano) saca los tramos de **lluvia** (`{start, end}`, tiempo de sesión) para el aviso del reproductor. |
| `_retirements` | De `ses.results` saca los pilotos que **abandonaron** (no completaron la distancia). El reproductor los baja al fondo de la torre en vez de dejarlos clavados con la posición del abandono. |
| `_pit_windows` | Ventanas en el **pit lane** por piloto (`{start, end}`, de `PitInTime` a `PitOutTime`) para marcar **BOX** en la torre solo mientras el coche está dentro. |
| `warm_session` | Fuerza la carga completa (telemetría) de una sesión — lo usa el prefetch. |

### 3.4 `models/schemas.py` — el contrato de datos

Los `BaseModel` de Pydantic que definen exactamente qué forma tienen las respuestas:
`EventInfo`, `SessionInfo`, `DriverInfo`, `LapInfo`, `Telemetry`, `Corner`,
`CircuitInfo`, `WeatherSample`, y los de comparación (`LapRef`, `CompareRequest`,
`CompareLap`, `DeltaSeries`, `CompareResponse`).

### 3.5 `live/` — motor de tiempo real (directo)

| Archivo | Qué hace |
|---|---|
| `manager.py` | `LiveManager`: mantiene las conexiones WebSocket, difunde mensajes a todos los clientes, y gestiona el ciclo de vida del feed activo (solo uno a la vez). Guarda el último "meta" para clientes que se conectan tarde. |
| `feeds.py` | `BaseFeed` (interfaz) y `LiveFeed`: envuelve el `SignalRClient` de FastF1, decodifica los mensajes `CarData.z` / `Position.z` y lee la posición de carrera de `TimingData`, y los reenvía por el manager. Corre en un hilo aparte. Solo funciona durante un GP en directo. |

---

## 4. Frontend — `frontend/src/`

### 4.1 Arranque y estado

| Archivo | Qué hace |
|---|---|
| `main.tsx` | Punto de entrada: monta `<App>` en el `#root`. |
| `App.tsx` | El corazón de la UI. Define las **3 pestañas** (Análisis · Comparación · Tiempo real), los **selectores en cascada** (Año → GP → Sesión → Piloto → Vuelta), y todo el estado: carga encadenada desde la API, telemetría de la vuelta, cesta de comparación, hover sincronizado con el mapa y **prefetch** al elegir piloto. En Análisis, el layout es una **fila superior** (tabla de vueltas + mapa de pista, con la tabla ajustada al alto del mapa) y, debajo, las **gráficas de telemetría a lo ancho de toda la página**. |
| `api/client.ts` | El **cliente tipado** de la API (un método por endpoint) y el WebSocket. La **URL base se resuelve en tiempo de ejecución** (`getApiBase`): localStorage → `VITE_API_BASE` → `127.0.0.1:8080`. Así el frontend estático (Cloudflare Pages) puede apuntar a un backend remoto por túnel. `getWsUrl`, `setApiBase`, `getStoredApiBase`. |
| `types/api.ts` | Los `interface` de TypeScript, **espejo exacto** del contrato del backend (`Telemetry`, `LapInfo`, `CompareResponse`, `ReplayData`, `CircuitInfo`, etc.). |

### 4.2 `components/` — piezas reutilizables

| Archivo | Qué es |
|---|---|
| `BackendConfig.tsx` | Botón **⚙ Backend** en la cabecera: abre un panel para pegar la **URL del backend** (el túnel), la guarda en el navegador (`setApiBase`) y recarga. Para el despliegue: frontend en Pages + backend en el PC con URL cambiante. |
| `Select.tsx` | Desplegable **personalizado** (no el `<select>` nativo) para poder tematizar también la lista que se abre: fondo oscuro, hover, selección resaltada, scroll, cierre con clic fuera / Escape. Lo usan Análisis y el reproductor. |
| `LapsTable.tsx` | La tabla de vueltas de un piloto: tiempo, sectores, fase (Q1/Q2/Q3), neumático (solo el **círculo de color** con la inicial; el compuesto completo va en el `title`) y vida. Clic en una fila selecciona la vuelta (con **destello y barra roja** animados). Compacta para no tener scroll horizontal. |
| `TelemetryChart.tsx` | Las gráficas de una vuelta (velocidad, acelerador, freno, marcha, RPM, DRS), alineadas por distancia, con **relleno degradado**, rejilla, **glow** del color del canal en la línea, remates redondeados, grosor jerárquico (velocidad más gruesa) y punto activo con halo. Al abrir una vuelta las líneas se **trazan progresivamente** (animación de Recharts; no se re-dispara en el hover porque el componente está memoizado y `onHover` es estable). Reporta el punto bajo el ratón para sincronizar la bolita del mapa. Oculta el DRS si está plano a 0 (temporada 2026). Memoizada. |
| `CompareChart.tsx` | Las mismas gráficas pero **superpuestas** para varias vueltas, más la gráfica de **delta** acumulado (con **relleno degradado** bajo cada serie). Usa el color de equipo de cada vuelta, con glow suave, remates redondeados, punto activo con halo y **trazado progresivo** al recomponer la comparación. Memoizada. |
| `TrackMap.tsx` | Dibuja el circuito en SVG a partir de las coordenadas X/Y (no hay imagen precargada): calcula límites, escala manteniendo proporción, **rota** con el ángulo oficial y anota las **curvas**. Muestra bolitas de posición sincronizadas con el hover de las gráficas. La geometría está memoizada para que el hover sea fluido. |
| `WeatherPanel.tsx` | Panel de meteorología: resumen (aire/pista/humedad/viento), gráfica de temperaturas con degradado, y una **franja de lluvia** que marca en qué minutos llovió (intervalos fusionados). |
| `ProgressBar.tsx` | Barra de progreso **indeterminada** (franja animada) para las cargas de datos. Se usa en Análisis/Comparación, en la Repetición y en la meteorología, sustituyendo a los textos de "Cargando/Descargando…". Es indeterminada porque el backend descarga y adelgaza la sesión antes de responder, así que no hay % real. |

### 4.3 `live/` — la pestaña Tiempo real

| Archivo | Qué hace |
|---|---|
| `LivePanel.tsx` | Contenedor con el conmutador **Repetición / Directo**; monta uno u otro. Recibe `active` (si la pestaña Tiempo real está visible) y lo pasa al `ReplayPlayer`. En `App.tsx` se **mantiene montado siempre** (oculto con `display:none` cuando no está activo) para conservar la sesión cargada y el momento de la repetición al cambiar de pestaña; el reproductor **pausa** su avance mientras está oculto. |
| `ReplayPlayer.tsx` | El **reproductor de repeticiones**: descarga la sesión completa (`/replay`) una vez y la reproduce **en local** con reloj `requestAnimationFrame` — play/pausa, ±10 s, barra de tiempo (seek), velocidad, todo instantáneo. Interpola las posiciones para un movimiento fluido. **Mapa a la derecha y torre a la izquierda** (como en TV): la torre de carrera lleva gap al de delante/líder, neumático, **BOX** solo mientras está en el pit lane, **🏁** al cruzar meta en la última vuelta y baja al fondo a los **abandonos** (OUT); el ranking de prácticas/quali va cambiando de Q1→Q2→Q3 y marca con una **línea de corte** roja (y el nº de posición en rojo) la **zona de eliminación** de la tanda (Q1: P16+, Q2: P11+). Cuando un piloto adelanta a otro, la fila **se desliza** a su nueva posición con una animación **FLIP** (solo actúa al cambiar el orden, no lee layout en cada frame). Muestra el **nº de vuelta del líder** en la barra, avisos en la esquina del mapa (**amarilla/roja** en el trazado, **SC/VSC** y **lluvia**) y, al elegir piloto, su **detalle en vivo** (velocidad/marcha/gas/freno) + **gráfica de velocidad de la vuelta en curso** (acotada a la vuelta que está dando ese piloto, con playhead; en prácticas/quali sin datos de vuelta cae a una ventana móvil de ~45 s). La parrilla de coches se ordena por **equipos** (`orderByTeam`, ver `gridOrder.ts`) con un orden **estático** según la **clasificación final** de la sesión (`finalPosByNum`: en carrera la posición del último registro, abandonos al fondo; en prácticas/quali la mejor vuelta de toda la sesión), así no salta durante la reproducción; cada tarjeta muestra posición, velocidad, marcha y barras de acelerador/freno etiquetadas. |
| `LiveDirect.tsx` | La vista del **directo real** por WebSocket (solo funciona durante un GP en vivo): mapa + parrilla de coches + detalle del piloto. La parrilla se ordena por **equipos** de forma estable (`orderByTeam` de `gridOrder.ts`: suma de posiciones de los pilotos → mejor posición → nº de piloto; compañeros juntos, el mejor clasificado primero) y cada tarjeta muestra posición, velocidad, marcha, RPM, DRS y barras de acelerador/freno etiquetadas. |
| `gridOrder.ts` | Utilidad compartida `orderByTeam`: ordena la parrilla de coches por equipos de forma estable (no salta con la velocidad). La usan tanto `LiveDirect` como `ReplayPlayer`. |
| `LiveTrackMap.tsx` | El mapa de circuito para tiempo real: contorno + una **bolita por piloto** en su posición, rotado y con curvas (mismo tratamiento que en Análisis). En la repetición además **colorea el trazado**: el tramo del sector en **amarilla** (repartiendo los sectores de comisarios por la longitud del circuito) o **todo en rojo** si hay bandera roja. |
| `useLiveFeed.ts` | Hook que gestiona la conexión WebSocket del directo y mantiene el estado en vivo (metadatos, último fotograma, historial del piloto seleccionado). |

### 4.4 Estilo

| Archivo | Qué es |
|---|---|
| `index.css` | El tema visual base: variables de color (paleta *motorsport* con rojo F1), fondo con degradados sutiles, scrollbars, fuente **Titillium Web**. |
| `App.css` | El grueso de los estilos: cabecera, pestañas, selectores y el desplegable custom, tarjetas de sección, tabla de vueltas, mapas, gráficas, torre de tiempos, meteo, reproductor, etc. Incluye las **animaciones de UI** (entrada escalonada de secciones al cambiar de pestaña, destello de la vuelta seleccionada, línea de corte de la quali) y un bloque **`prefers-reduced-motion`** que las anula si el usuario pide menos movimiento. |

---

## 5. Los 3 conceptos clave (por qué funciona así)

1. **Alineación por distancia, no por tiempo.** Para comparar vueltas se alinean por
   distancia recorrida en pista (metro 0 = meta), porque una vuelta es más rápida que
   otra. Así el mismo metro es la misma curva en ambas.
2. **El delta = tiempo acumulado.** En cada punto de la pista, cuánto tiempo llevas
   ganado/perdido respecto a la vuelta de referencia.
3. **El backend adelgaza los datos.** Una sesión son cientos de MB; el navegador solo
   recibe lo pedido, remuestreado.

---

## 6. Otros archivos

| Archivo | Qué es |
|---|---|
| `README.md` (raíz) | Portada del repo en GitHub: qué es, características, stack, puesta en marcha, despliegue y punteros a RESUMEN/DESIGN/DEPLOY. |
| `DESIGN.md` | El documento de diseño: arquitectura, contrato de la API, plan por fases y notas técnicas. |
| `DEPLOY.md` | Guía de despliegue: frontend en **Cloudflare Pages** + backend en tu PC expuesto por **túnel** de Cloudflare. Pasos, CORS y flujo de la URL configurable. |
| `start-online.bat` | Arranca el backend (`uvicorn :8080`) y el **túnel** `cloudflared` de un tirón, para poner el backend online desde tu PC. |
| `backend/pyproject.toml` | Dependencias del backend (FastAPI, uvicorn, fastf1, pandas, numpy, pydantic) y config de ruff. Entorno con **uv** (`uv sync`, `uv run`). |
| `backend/README.md` | Cómo levantar el backend (`uv run uvicorn app.main:app --reload --port 8080`) y notas sobre la caché. |
| `frontend/package.json` | Dependencias del frontend (React, Vite, TypeScript, **Recharts** para las gráficas) y scripts (`npm run dev`, `build`). |
| `frontend/index.html` | HTML base: carga la fuente Titillium Web, enlaza `favicon.svg` y monta `src/main.tsx`. |
| `frontend/public/favicon.svg` | Favicon propio: cuadrado oscuro redondeado con una traza de telemetría en rojo F1. |
| `frontend/vite.config.ts` | Config de Vite (plugin de React; respeta la variable `PORT`). |
| `.gitignore` (raíz) | Ignora la caché de FastF1, `node_modules`, entornos, etc. |

---

## 7. Cómo levantarlo en local

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

> La **primera** vez que se abre una sesión nunca vista, FastF1 la **descarga** (lento,
> inevitable). A partir de ahí va de la caché en disco (`backend/.fastf1-cache/`).
> El **directo** solo transmite datos durante un GP en vivo; para sesiones pasadas se
> usa la **Repetición**.
