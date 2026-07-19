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
| `main.py` | Crea la app FastAPI, activa **CORS**, un middleware que añade **`Cache-Control`** (1 h) a las respuestas GET de datos (excluye `/api/live`) para que el navegador no las repida, incluye los dos routers (`api` y `live`) y, al arrancar, inicializa la caché de FastF1 y guarda el *event loop* para el tiempo real. Expone `/` (ping) y la documentación automática en **`/docs`**. |
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
| `GET /api/{year}/{rnd}/{session}/micro-sectors` | Micro-sectores de **todas** las vueltas cronometradas (sin las de boxes), para la comparativa del reproductor. `?part=Q1` acota a una tanda. Cada vuelta trae sus tramos (cortados de la telemetría **por distancia**, como los mini-sectores del directo), sus tres sectores y su ventana `start`/`end` en tiempo de sesión, para que el frontend elija la vuelta que cada piloto está dando. Cachea en memoria **y en disco** (`.fastf1-cache/micro-sectors/`). |
| `POST /api/{year}/{rnd}/{session}/prefetch` | Precalienta la telemetría de la sesión en segundo plano (se llama al elegir piloto). Además deja **calculados los micro-sectores** de cada tanda, que es el trabajo lento (~10 s), para sacarlo del camino crítico. |
| `POST /api/compare` | Compara varias vueltas: canales alineados por distancia, delta acumulado y color de equipo por vuelta. |

**`routers/live.py`** — tiempo real (solo el **directo**, que únicamente da datos
durante un GP en vivo). La repetición histórica NO pasa por aquí; la sirve `/replay`.

| Ruta | Qué hace |
|---|---|
| `WebSocket /api/live/ws` | Canal del directo. Mensajes: `meta` (sesión, pilotos, trazado), `frame` (telemetría por coche; **solo con suscripción F1TV**), `timing` (torre + meteo + dirección de carrera; funciona con cuenta gratuita, **1 Hz** porque el mensaje ronda los 40 KB), `laps` (historial de vueltas por piloto, **cada 5 s**: crece toda la sesión y no tiene sentido reenviarlo con cada torre) y `end` (el feed se cayó). |
| `POST /api/live/live/start` | Arranca el cliente del directo oficial de F1. **Antes valida el token de F1TV** (`live/auth.py`): si caducó/falta, NO arranca (FastF1 se colgaría reautenticando) y devuelve `{started:null, auth}` para que la UI avise. |
| `POST /api/live/stop` | Detiene el feed activo. |
| `GET /api/live/status` | Estado (feed activo, nº de clientes conectados). |
| `GET /api/live/auth` | Estado del token de F1TV (`ok`/`state`/`expiresAt`/`message`), para avisar en la UI antes de que caduque. |

**`live/auth.py`** — comprueba **offline** (decodifica el JWT sin verificar firma, sin red) el token de F1TV que FastF1 cachea en `f1auth.json`: mira `exp` y devuelve estado + caducidad + mensaje. Existe porque si el token caduca FastF1 no falla, sino que **bloquea** el hilo del directo esperando reautenticación en el navegador. Renovar: `uv run python -m fastf1 auth f1tv --authenticate`.

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
| `get_seasons` / `get_events` / `get_sessions` / `get_drivers` / `get_laps` | La **navegación** en cascada. `get_sessions` marca cada sesión con su fecha y un flag **`upcoming`** (aún no disputada → el frontend no pide datos). `get_drivers` degrada con elegancia si un número está en el *timing* pero no en resultados (reservas en Libres). `get_laps` etiqueta cada vuelta con su segmento **Q1/Q2/Q3** (vía `split_qualifying_sessions`). |
| `get_telemetry` | Extrae la telemetría de una vuelta y la remuestrea por distancia (velocidad, throttle, brake, gear, RPM, DRS, tiempo, X/Y). |
| `compare_laps` | Alinea varias vueltas a una rejilla común de distancia, calcula el **delta** acumulado vs. la de referencia y asigna a cada vuelta el **color de su equipo** (ajustando el brillo cuando son del mismo piloto/compañeros para distinguirlas sin perder el equipo). |
| `get_micro_sectors` | Trocea las vueltas de una tanda en **micro-tramos por distancia** para la comparativa. La telemetría se saca **una vez por piloto** (`grp.get_telemetry()`) y de ahí se recortan todas sus vueltas: pedirla vuelta a vuelta eran cientos de llamadas y la petición tardaba minutos. Descarta las vueltas de boxes y, si un piloto no tiene telemetría utilizable, cae al reparto por tiempos de sector (`_micros_from_sectors`). Cachea el resultado en memoria y **en disco**, porque una sesión pasada no cambia. Los archivos en disco van **versionados** (`v1_…json`, constante `_MICRO_VERSION`): si cambia el criterio de troceado basta subir la versión para dejar atrás los antiguos, que se borran en el primer guardado tras arrancar (`_micro_sweep`). |
| `get_weather` | Serie meteorológica de la sesión. |
| `get_circuit_info` | Rotación oficial + curvas (de `get_circuit_info()` de FastF1). |
| `find_current_event` | El GP que se está disputando ahora → `(year, round, location)`. Ventana de -1/+4 días sobre `EventDate` (que apunta al domingo), para que valga desde el viernes de libres. |
| `find_past_edition` | La edición más reciente del **mismo circuito** (por `Location`) antes de un año dado. `None` si el circuito debuta. |
| `get_live_circuit_meta` | Trazado + rotación + curvas para el **directo**: el feed en vivo da posiciones X/Y pero no la geometría, así que la saca de la edición del año pasado del mismo GP (el trazado no cambia). Carga la carrera **con telemetría** (`_circuit_meta` necesita `get_pos_data()`); si falla, prueba la quali. |
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
| `timing.py` | **Torre de tiempos en vivo** a partir del cronometraje oficial (sin telemetría). `merge` funde los mensajes **incrementales** sobre el estado acumulado y normaliza un detalle traicionero del feed: en los incrementales **las listas llegan como dicts indexados** (`{"0": {...}}`), mientras que en el snapshot inicial son listas de verdad. `build_rows` arma las filas (posición, gap, intervalo, mejor/última, sectores con morado/verde, **mini-sectores**, neumático, **mejores sectores + vuelta ideal**, **velocidades punta**, **stints**, ficha del piloto); cubre prácticas/quali (`TimeDiffToFastest`) y carrera (`GapToLeader`). `build_race_control` normaliza los mensajes de dirección de carrera y extrae los **coches citados** (`"CAR 87 (BEA)"` → `["87"]`) para poder filtrarlos por piloto. `build_weather` pasa la meteo (que el feed manda como texto) a números. `SEGMENT_STATUS` traduce los códigos de mini-sector (`2048`=amarillo, `2049`=verde, `2051`=morado, `2064`=boxes, `0`=sin pasar), deducidos de las frecuencias reales del feed. |
| `feeds.py` | `BaseFeed` (interfaz) y `LiveFeed`: envuelve el `SignalRClient` de FastF1, decodifica los mensajes `CarData.z` / `Position.z`, lee la posición de carrera de `TimingData` y los códigos/equipos/colores de `DriverList` (que llega en el **snapshot inicial**, un `CompletionMessage`, no una lista) para publicar el `meta`. Su `_on_message` **refresca `_t_last_message`** siempre: el supervisor del cliente base cierra la conexión si ese sello no se toca antes de `timeout` (60 s). Difunde como mucho a **10 Hz** (`BROADCAST_HZ`) y manda una copia del estado (el loop serializa en otro hilo). El **trazado** lo carga en un **hilo aparte** (`_load_circuit` → `get_live_circuit_meta`, del año pasado) para no retrasar la conexión, y **reemite el `meta`** cuando llega. `stop()` **cierra la conexión de verdad** (`client._exit()`) y marca `_stopped`: antes solo soltaba la referencia y el `SignalRClient` seguía vivo, así que cada arranque acumulaba otra conexión con el **mismo token F1TV** y el servidor de la F1 las iba echando (`WinError 10053` → timeout a los 60 s, en cascada). Corre en un hilo aparte. Solo funciona durante un GP en directo, **y requiere suscripción F1TV para `CarData.z`/`Position.z`** (con cuenta gratuita solo llega el cronometraje → `timing`). En clasificación deduce la **parte** (`_qualifying_part` → campo `part`: 1/2/3): el feed no la publica (`SessionInfo` dice «Qualifying» a secas), así que se cuenta cuántos pilotos llevan `KnockedOut` y los umbrales se derivan del nº de coches — con 22 caen 6 por parte, con 20 caen 5. Se prefiere a contar transiciones de `SessionStatus`, que las banderas rojas dentro de una misma parte dejarían mal contadas. Al apuntar cada vuelta (`_record_lap`) marca las de **boxes** (`pit`): la de entrada acaba en el pit lane y la de salida arrastra el tiempo parado, así que falseaban la gráfica del piloto (aparecían «vueltas» de varios minutos). La de salida no se detecta en su propio momento —el coche ya salió y `PitOut` puede haberse limpiado—, así que la marca la deja puesta la vuelta de entrada. |

---

## 4. Frontend — `frontend/src/`

### 4.1 Arranque y estado

| Archivo | Qué hace |
|---|---|
| `main.tsx` | Punto de entrada: monta `<App>` en el `#root`. |
| `App.tsx` | El corazón de la UI. Define las **3 pestañas** (Análisis · Comparación · Tiempo real), los **selectores en cascada** (Año → GP → Sesión → Piloto → Vuelta), y todo el estado: carga encadenada desde la API, telemetría de la vuelta, cesta de comparación, hover sincronizado con el mapa y **prefetch** al elegir piloto. En Análisis, el layout es una **fila superior** (tabla de vueltas + mapa de pista, con la tabla ajustada al alto del mapa) y, debajo, las **gráficas de telemetría a lo ancho de toda la página**. Las pestañas llevan un **subrayado rojo deslizante** (un único indicador que mide el botón activo y anima `left/width`) y la página cierra con un **footer** (descripción, tecnología, enlaces a GitHub/FastF1 y aviso de proyecto no oficial). La selección (año/GP/sesión/piloto/vuelta/pestaña) se **sincroniza con la URL** (enlaces compartibles: `?y=..&gp=..&s=..&d=..&lap=..`) y se **recuerda entre visitas** (localStorage); al recuperar un deep-link, la cascada se restaura nivel a nivel. Las **sesiones futuras** (sin datos) se marcan «· próximamente» en el selector y muestran un aviso en vez de pedir datos. La pestaña **Tiempo real se carga con `React.lazy`** (code-splitting). |
| `api/client.ts` | El **cliente tipado** de la API (un método por endpoint) y el WebSocket. La **URL base se resuelve en tiempo de ejecución** (`getApiBase`): localStorage → `VITE_API_BASE` → `127.0.0.1:8080`. Así el frontend estático (Cloudflare Pages) puede apuntar a un backend remoto por túnel. `getWsUrl`, `setApiBase`, `getStoredApiBase`. |
| `types/api.ts` | Los `interface` de TypeScript, **espejo exacto** del contrato del backend (`Telemetry`, `LapInfo`, `CompareResponse`, `ReplayData`, `CircuitInfo`, etc.). |

### 4.2 `components/` — piezas reutilizables

| Archivo | Qué es |
|---|---|
| `BackendConfig.tsx` | Botón **⚙ Backend** en la cabecera: abre un panel para pegar la **URL del backend** (el túnel), la guarda en el navegador (`setApiBase`) y recarga. Para el despliegue: frontend en Pages + backend en el PC con URL cambiante. |
| `Select.tsx` | Desplegable **personalizado** (no el `<select>` nativo) para poder tematizar también la lista que se abre: fondo oscuro, hover, selección resaltada, scroll, cierre con clic fuera / Escape. Lo usan Análisis y el reproductor. |
| `LapsTable.tsx` | La tabla de vueltas de un piloto: tiempo, sectores, fase (Q1/Q2/Q3), neumático (solo el **círculo de color** con la inicial; el compuesto completo va en el `title`) y vida. Marca en **púrpura** la mejor vuelta del piloto y su mejor tiempo en cada sector. Clic en una fila selecciona la vuelta (con **destello y barra roja** animados). Compacta para no tener scroll horizontal. |
| `TelemetryChart.tsx` | Las gráficas de una vuelta (velocidad, acelerador, freno, marcha, RPM, DRS), alineadas por distancia, con **relleno degradado**, rejilla, **glow** del color del canal en la línea, remates redondeados, grosor jerárquico (velocidad más gruesa) y punto activo con halo. Al abrir una vuelta las líneas se **trazan progresivamente** (animación de Recharts; no se re-dispara en el hover porque el componente está memoizado y `onHover` es estable). Reporta el punto bajo el ratón para sincronizar la bolita del mapa. Oculta el DRS si está plano a 0 (temporada 2026). Memoizada. |
| `CompareChart.tsx` | Las mismas gráficas pero **superpuestas** para varias vueltas, más la gráfica de **delta** acumulado (con **relleno degradado** bajo cada serie). Con exactamente 2 vueltas, el mapa de pista de la vista de Comparación se convierte en un **mapa de dominancia** (cada tramo del color de la vuelta más rápida ahí; se calcula en `App.tsx` y se pinta con `TrackMap` vía `segColors`, reutilizando el mismo bloque, sin duplicar la pista). Usa el color de equipo de cada vuelta, con glow suave, remates redondeados, punto activo con halo y **trazado progresivo** al recomponer la comparación. Memoizada. |
| `TrackMap.tsx` | Dibuja el circuito en SVG a partir de las coordenadas X/Y (no hay imagen precargada): calcula límites, escala manteniendo proporción, **rota** con el ángulo oficial y anota las **curvas**. Colorea por velocidad (`mode="speed"`) o, con `segColors` (color por punto), pinta el **mapa de dominancia** de la comparación. Muestra bolitas de posición sincronizadas con el hover de las gráficas. La geometría está memoizada para que el hover sea fluido. |
| `WeatherPanel.tsx` | Panel de meteorología: resumen (aire/pista/humedad/viento), gráfica de temperaturas con degradado, y una **franja de lluvia** que marca en qué minutos llovió (intervalos fusionados). |
| `ErrorBoundary.tsx` | **Barrera de errores** (componente de clase: los hooks no capturan errores de render). Si un hijo revienta al pintar, en vez de dejar la página en blanco muestra el error y un botón de reintentar. La usa `LiveDirect` alrededor de la torre. |
| `tyres.ts` | El mapa **compuesto → color** (código oficial F1), en un solo sitio. Estaba duplicado en **cuatro** componentes y las copias ya habían empezado a divergir. Lo usan `LapsTable`, `TyreStrategy`, `ReplayPlayer`, `LiveTiming` y `DriverDetail`. |
| `DriverHeader.tsx` | La **ficha de identidad del piloto**, compartida por el detalle del directo (`DriverDetail`) y la traza de velocidad del reproductor (`ReplayPlayer`): franja del color del equipo, foto (si la hay), nombre, equipo · dorsal, un dato grande a la derecha y la ✕ de cerrar. Solo lleva lo **común**: las dos vistas manejan datos distintos —el directo tiene foto y posición pero no telemetría, el reproductor al revés—, así que lo propio de cada una va debajo, fuera de este componente. Sin foto la cabecera se compacta sola (el reproductor no la recibe: `/replay` no trae `headshot`), y el hueco de la posición lo aprovecha para el **nº de vuelta en curso**. |
| `MicroSectorGrid.tsx` | **Rejilla comparativa de micro-sectores**: una fila por piloto con **la vuelta que está dando en ese instante** (el reproductor pasa el reloj y el componente elige la vuelta cuya ventana lo contiene; si no está en pista, la última completada). Sirve para ver de un vistazo quién gana tiempo en cada parte del circuito — la torre solo da un número por vuelta. Cada fila lleva dos bandas: arriba los micro-tramos finos y abajo la barra por sector, **más alta** y con el **tiempo del sector dentro**. Ambas se dividen en los mismos tres grupos con idéntico `flex-grow` (el nº de tramos de cada sector), que es lo que hace que los cortes caigan en el mismo píxel. El color compara con el mejor de cada columna: morado el más rápido, verde a menos de 0,1 s, amarillo el resto. El morado es **exclusivo del piloto que posee ese mejor tiempo** (`bestMicro`/`bestSector` guardan el valor **y su dueño**), no de todo el que iguale el mínimo: comparando solo valores, con varios pilotos rodando a la vez cada uno mejoraba al anterior y el mínimo de ese instante siempre lo tenía alguien ya pintado de morado, así que **la rejilla acababa entera morada**. Cuando a un piloto le bajan su tiempo, su tramo pasa a verde o amarillo. El empate lo conserva quien lo marcó primero (se recorre `base`, que llega ordenado por `start`, y solo lo arrebata un tiempo estrictamente menor). Ese mejor sale de **todas las vueltas terminadas de la tanda** (prop `reference`), no solo de las filas visibles: con las visibles el morado significaba "el mejor de los que ruedan ahora" y cambiaba según quién estuviera en pista. **Mientras no haya ninguna vuelta terminada** (el arranque de la tanda) se cae a comparar las filas visibles entre sí: si no, no había con qué comparar y la rejilla salía entera en gris hasta que alguien cruzaba meta. El orden de las filas es **fijo**, por orden de aparición en la tanda (`microOrder`, un ref con `num → posición`): la rejilla sirve para seguir la vuelta de un piloto y ordenarla por tiempo hacía que las filas saltasen de sitio con cada vuelta. A un piloto se le asigna su hueco la primera vez que aparece, y ya no se mueve; los que entran a la vez se ordenan por el `start` de esa vuelta, para que mover el reproductor **hacia atrás** no genere un orden distinto. El mapa **se vacía al cambiar de tanda**, o Q2 heredaría las posiciones de Q1. **Lo aún no recorrido va en gris**, sin color ni tooltip, para no adelantar cómo va a quedar el tramo. Los micro-tramos **se reconstruyen desde la telemetría** en el backend (`_micros_from_stint`), porque FastF1 no expone los mini-sectores oficiales del feed en vivo. |
| `icons.tsx` | Set de **iconos SVG en línea** monocromos (heredan `currentColor`) que sustituyen a los emojis de colores para que cuadren con la paleta: controles del reproductor (inicio/±10 s/play/pausa/stop), descarga (cargar repetición), cronómetro, bandera de meta, coche (SC/VSC), sol y lluvia. El "directo" es un punto rojo con latido (`.live-dot`, CSS). |
| `TyreStrategy.tsx` | **Estrategia de neumáticos** del piloto: una barra horizontal con los stints (tramos con el mismo compuesto), de ancho proporcional a sus vueltas y coloreados por compuesto. Deriva de las vueltas ya cargadas. |
| `ProgressBar.tsx` | Barra de progreso **indeterminada** (franja animada) para las cargas de datos. Se usa en Análisis/Comparación, en la Repetición y en la meteorología, sustituyendo a los textos de "Cargando/Descargando…". Es indeterminada porque el backend descarga y adelgaza la sesión antes de responder, así que no hay % real. |

### 4.3 `live/` — la pestaña Tiempo real

| Archivo | Qué hace |
|---|---|
| `LivePanel.tsx` | Contenedor con el conmutador **Repetición / Directo**; monta uno u otro. Recibe `active` (si la pestaña Tiempo real está visible) y lo pasa al `ReplayPlayer`. En `App.tsx` se **mantiene montado siempre** (oculto con `display:none` cuando no está activo) para conservar la sesión cargada y el momento de la repetición al cambiar de pestaña; el reproductor **pausa** su avance mientras está oculto. |
| `ReplayPlayer.tsx` | El **reproductor de repeticiones**: descarga la sesión completa (`/replay`) una vez y la reproduce **en local** con reloj `requestAnimationFrame` — play/pausa, ±10 s, barra de tiempo (seek), velocidad, todo instantáneo. Interpola las posiciones para un movimiento fluido. **Mapa a la derecha y torre a la izquierda** (como en TV): la torre de carrera lleva gap al de delante/líder, neumático, **BOX** solo mientras está en el pit lane, **🏁** al cruzar meta en la última vuelta y baja al fondo a los **abandonos** (OUT); el ranking de prácticas/quali va cambiando de Q1→Q2→Q3 y marca con una **línea de corte** roja (y el nº de posición en rojo) la **zona de eliminación** de la tanda (Q1: P16+, Q2: P11+). Cuando un piloto adelanta a otro, la fila **se desliza** a su nueva posición con una animación **FLIP** (solo actúa al cambiar el orden, no lee layout en cada frame). Muestra el **nº de vuelta del líder** en la barra, avisos en la esquina del mapa (**amarilla/roja** en el trazado, **SC/VSC** y **lluvia**) y, al elegir piloto, su **ficha de identidad** (`DriverHeader`, la misma que el detalle del directo, con el nº de vuelta en curso en el hueco de la posición) + **estado en carrera** (`selState`: posición, gap al líder, intervalo, paradas —contadas por ventanas de pit ya cerradas, con aviso de **en boxes**— y neumático con su vida; sale de `standings`/`pits`, que ya viajan en `/replay`, y **solo se muestra en carrera**, porque en prácticas/quali los gaps y las paradas no significan nada) + **detalle en vivo** (velocidad/marcha/gas/freno) + **gráfica de velocidad de la vuelta en curso** (acotada a la vuelta que está dando ese piloto, con playhead; en prácticas/quali sin datos de vuelta cae a una ventana móvil de ~45 s). La parrilla de coches se ordena por **equipos** (`orderByTeam`, ver `gridOrder.ts`) con un orden **estático** según la **clasificación final** de la sesión (`finalPosByNum`: en carrera la posición del último registro, abandonos al fondo; en prácticas/quali la mejor vuelta de toda la sesión), así no salta durante la reproducción; cada tarjeta muestra posición, velocidad, marcha y barras de acelerador/freno etiquetadas. **Atajos de teclado** (con la pestaña visible): espacio = play/pausa, ← → = ±10 s, ↑ ↓ = velocidad, Inicio = al principio. Bajo el mapa monta la **comparativa de micro-sectores** (`MicroSectorGrid`), que sigue a la **tanda activa** y se carga aparte con su propia barra de progreso (el cálculo es lento la primera vez). |
| `LiveTiming.tsx` | La **torre de tiempos en vivo** (mensaje `timing` del WebSocket): cabecera con GP/sesión/estado de pista/tiempo restante y tabla con posición, gap, intervalo, mejor y última vuelta, los tres sectores como una **banda continua** (`SectorBand`) al estilo de la rejilla del reproductor —**mini-tramos arriba y la barra por sector debajo**, partidas en los mismos tres grupos con idéntico `flex-grow` para que los cortes coincidan—, trampa de velocidad, vueltas y neumático. **Ojo con la diferencia frente a `MicroSectorGrid`**: en directo el feed solo manda un **color de estado** por mini-tramo, no un tiempo, así que el ancho de cada sector sale del **nº de segmentos** que da el feed (no de tiempos) y el color va **al fondo del bloque** (con el tiempo dentro en negro, como `.micro-sectors`) y lo decide el propio feed: **morado** = mejor de la sesión, **verde** = mejor personal, **gris claro** el resto — no una comparación calculada en el frontend. Ese gris claro (`SECTOR_PLAIN`) existe porque aquí, a diferencia del reproductor, un sector normal no tiene color propio y sobre el fondo oscuro de la torre el texto negro no se leería. Un sector aún no completado va **neutro y sin texto**, lo que marca hasta dónde ha llegado la vuelta. El **tiempo restante lo descuenta en local** (`useCountdown`): el feed solo manda `ExtrapolatedClock` de vez en cuando y con el flag `Extrapolating` pide justo eso. La base se refija con cada mensaje usando su **hora de llegada** (`recvAt`, que viaja en el propio mensaje) y **no** el momento de aplicarlo: con el retraso activo median minutos entre ambos, y tomar `Date.now()` al aplicar volvía a poner el reloj en hora real, anulando el retraso que sí tenía la torre. Se usa hora local y no el `Utc` del feed, para no depender de que el reloj del PC esté sincronizado. En **clasificación** muestra la parte (**Q1/Q2/Q3**), en Q2/Q3 **oculta a los ya eliminados** y marca con una **línea de corte** roja (y el nº en rojo) a quien caería si la tanda acabase ahora; los cortes se derivan del nº de coches (con 22 pasan 16 de Q1). Los coches fuera de la sesión llevan **OUT** en la misma ranura que el BOX. Comparte animaciones con la repetición (`towerAnim.ts`): la fila **se desliza** al reordenarse y **destella** al mejorar — verde el mejor personal, **morado** el mejor de la sesión. Al **pinchar una fila** se abre el `DriverDetail`. Es lo único que el feed oficial entrega con una **cuenta F1 gratuita**. |
| `DriverDetail.tsx` | **Panel del piloto** seleccionado en la torre. La cabecera (foto, nombre, equipo, posición, ✕) es `DriverHeader`, **compartida con el reproductor**; el resto es propio: un bloque **Carrera/Sesión** (hueco al líder, intervalo, paradas y neumático con sus vueltas — datos que ya venían en `TimingRow` y solo se veían en la torre; el mismo bloque existe en el reproductor), mejor/última/**ideal**, **mejores sectores** y **velocidades** (trampa, meta, intermedios) con su puesto en la sesión, barra de **estrategia** de neumáticos, **gráfica de evolución de vueltas** y los **mensajes de dirección de carrera que le citan**. |
| `RaceControl.tsx` | Dos paneles del directo: `RaceControlPanel` (banderas, tiempos borrados, investigaciones y sanciones, coloreados por tipo y con la hora pasada a local — el feed la da en UTC sin zona) y `LiveWeatherPanel` (aire, pista, humedad, viento y lluvia en vivo). |
| `LiveDirect.tsx` | La vista del **directo real** por WebSocket (solo funciona durante un GP en vivo): torre de tiempos + —si hay telemetría— mapa + parrilla de coches + detalle del piloto. Calcula `hasTelemetry` (¿algún coche con `x`/`y` o `speed`?) porque **`CarData.z`/`Position.z` requieren suscripción F1TV de pago**: sin ella el `frame` solo trae la posición de carrera, así que oculta mapa y parrilla y explica por qué en la UI. Lleva un **control de retraso** (−5s / +5s hasta `MAX_DELAY_SECS`) que se pasa a `useLiveFeed` para **cuadrar la torre con el retardo de tu emisión de TV**. Separa el valor que ajustas del que está aplicado: para arrancar hay que pulsar **Aplicar** y entonces sale una **cuenta atrás de sincronización** (la torre se queda congelada mientras la cola se llena, así que sin el contador parecía que no hacía nada). Con el retraso ya activo los **reajustes se aplican al momento**, sin confirmar: subirlo solo espera por los segundos añadidos y bajarlo es inmediato (el `drain` suelta de golpe lo que ya cumplió el nuevo tiempo). El botón de reset se llama **«Quitar retraso»** — antes ponía «en vivo» y se entendía como «aplicar», con lo que cancelaba el retraso justo al intentar activarlo. La torre va envuelta en un **`ErrorBoundary`**: si el cronometraje llega con forma inesperada, muestra un aviso en vez de dejar la pestaña en blanco. Consulta `GET /live/auth` al abrir y muestra un **`AuthBanner`** con el estado del **token de F1TV** (válido + caducidad, ámbar si caduca en <24 h, o cómo renovarlo si ya no sirve); al conectar, si el backend no arrancó el feed por token caducado, enseña ese aviso. La parrilla se ordena por **equipos** de forma estable (`orderByTeam` de `gridOrder.ts`: suma de posiciones de los pilotos → mejor posición → nº de piloto; compañeros juntos, el mejor clasificado primero) y cada tarjeta muestra posición, velocidad, marcha, RPM, DRS y barras de acelerador/freno etiquetadas. |
| `gridOrder.ts` | Utilidad compartida `orderByTeam`: ordena la parrilla de coches por equipos de forma estable (no salta con la velocidad). La usan tanto `LiveDirect` como `ReplayPlayer`. |
| `towerAnim.ts` | Las dos animaciones que comparten las torres de tiempos (`LiveTiming` y `ReplayPlayer`): **`useTowerFlip`** desliza las filas a su nueva posición cuando alguien adelanta (técnica FLIP; devuelve la ref del `<tbody>` y solo actúa al cambiar el orden, no en cada frame) y **`useImproved`** marca a quien acaba de bajar su tiempo para **destellar la fila en verde** ~0,7 s. Recibe un mapa `nº → tiempo`, así cada torre decide qué campo cuenta como su mejor vuelta. |
| `LiveTrackMap.tsx` | El mapa de circuito para tiempo real: contorno + una **bolita por piloto** en su posición, rotado y con curvas (mismo tratamiento que en Análisis). En la repetición además **colorea el trazado**: el tramo del sector en **amarilla** (repartiendo los sectores de comisarios por la longitud del circuito) o **todo en rojo** si hay bandera roja. |
| `useLiveFeed.ts` | Hook que gestiona la conexión WebSocket del directo y mantiene el estado en vivo (metadatos, último fotograma, torre, historial del piloto seleccionado). Acepta un **`delaySecs`**: con retraso, los mensajes pasan por una **cola** y no se aplican hasta cumplir ese tiempo (así la torre cuadra con el stream de TV, que va por detrás del cronometraje oficial). El retraso vive en el navegador —cosa de cada espectador—, no en el backend. El reloj de la sesión se ajusta solo: cada mensaje trae el tiempo restante que era cierto al emitirse y, además, **la hora en que llegó** (`recvAt`, sellada en `ws.onmessage` y conservada al salir de la cola). `LiveTiming` descuenta desde ese instante y no desde el momento de aplicar el mensaje, que es lo que hacía que el reloj volviese a la hora real y **anulase el retraso** aunque la torre sí fuese retrasada. |

### 4.4 Estilo

| Archivo | Qué es |
|---|---|
| `index.css` | El tema visual base: variables de color (paleta *motorsport* con rojo F1), fondo con degradados sutiles, scrollbars, fuente **Titillium Web**. |
| `App.css` | El grueso de los estilos: cabecera, pestañas, selectores y el desplegable custom, tarjetas de sección, tabla de vueltas, mapas, gráficas, torre de tiempos, meteo, reproductor, etc. Incluye las **animaciones de UI** (entrada escalonada de secciones al cambiar de pestaña, subrayado deslizante de las pestañas, destello de la vuelta seleccionada, línea de corte de la quali), los estilos del **footer** y un bloque **`prefers-reduced-motion`** que anula las animaciones si el usuario pide menos movimiento. |

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
| `start-online.bat` | Arranca el backend (`uvicorn :8080`) y lo expone con **Tailscale Funnel** (URL fija `https://<equipo>.<tailnet>.ts.net`) de un tirón, para poner el backend online desde tu PC. Antes de arrancar **comprueba el token de F1TV** (`python -m app.live.auth`) y, solo si falta o le quedan <24 h, lanza la reautenticación (`fastf1 auth f1tv --authenticate`, abre el navegador). Si el token aguanta, no pide nada. |
| `start-online-cloudflare.bat` | Alternativa antigua: backend + **quick tunnel de Cloudflare** (`cloudflared`, URL que cambia en cada arranque). Se conserva por si se quiere volver a ese método. Comprueba/renueva el token de F1TV igual que `start-online.bat`. |
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
