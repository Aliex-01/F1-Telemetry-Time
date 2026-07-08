# F1 Telemetry — Documento de diseño

App web para revisar telemetría de F1: vueltas de clasificación y carrera (histórico) y,
más adelante, tiempo real durante un GP en directo. Permite ver velocidad por tramo, %
de acelerador, % de freno, marcha, etc., y **comparar varias vueltas** entre sí.

Estado: **Fases 1 y 2 completas y verificadas**. Backend FastF1 + API REST; frontend
Vite/React con cascada de selectores, tabla de vueltas (tiempos, sectores, neumático,
stint) y gráficos de velocidad/acelerador/freno/marcha/RPM/DRS alineados por distancia.
**Fase 3 (comparación) completa**: cesta de vueltas (misma sesión, varios pilotos),
canales superpuestos, delta acumulado vs. referencia y mapa de pista X/Y (coloreado por
velocidad en una vuelta; trazadas superpuestas al comparar).

**Fase 4 (tiempo real) implementada**: WebSocket (`/api/live/ws`) con dos feeds que comparten
formato de mensajes — **ReplayFeed** (reproduce un GP histórico "como si fuera en vivo",
verificado con Mónaco 2024 Q, 20 coches) y **LiveFeed** (cliente SignalR del feed oficial F1;
solo funciona durante un GP en directo, no probado en vivo aún). Frontend: panel con
resumen de todos los coches (velocidad/marcha/acelerador/freno) + detalle deslizante del
piloto seleccionado. Control: `POST /api/live/replay/start`, `/live/live/start`, `/stop`.

**Las 4 fases del plan están completas.** Pendiente: fase de pulido visual (incl. ocultar
canal DRS cuando es todo 0 en 2026) y probar LiveFeed en un GP real.
Nota: mejoras visuales aparcadas hasta cerrar fases.

---

## 1. Decisiones tomadas

| Tema            | Decisión                                              |
|-----------------|-------------------------------------------------------|
| Fuente de datos | **FastF1** (API oficial F1 live timing + Ergast)      |
| Backend         | **Python 3.13 + FastAPI**, entorno con **uv**         |
| Frontend        | **Vite + React + TypeScript**, gráficos con Recharts/uPlot |
| Enfoque         | **Histórico primero**, tiempo real en fase posterior  |
| Sesiones        | **Todas**: FP1-3, Sprint, Sprint Quali, Q, R          |
| Comunicación    | REST/JSON (WebSocket sólo para tiempo real, fase 4)   |

---

## 2. Arquitectura

```
F1/
├── DESIGN.md            # este documento
├── backend/             # Python + FastAPI
│   ├── app/
│   │   ├── main.py          # arranque FastAPI + CORS
│   │   ├── routers/         # endpoints agrupados
│   │   ├── services/        # lógica FastF1 (carga sesión, extrae telemetría)
│   │   ├── models/          # esquemas Pydantic (contrato de datos)
│   │   └── cache/           # utilidades de caché
│   ├── .fastf1-cache/       # caché en disco de FastF1 (grande, en .gitignore)
│   └── pyproject.toml       # dependencias (uv)
└── frontend/            # Vite + React + TS
    ├── src/
    │   ├── api/             # cliente tipado de la API
    │   ├── components/      # gráficos, selectores, mapa de pista
    │   ├── pages/           # vistas (análisis, comparación)
    │   └── types/           # tipos TS espejo del contrato
    └── package.json
```

**Flujo:** el navegador nunca toca FastF1. El backend carga la sesión (cacheada en disco),
extrae sólo lo pedido, lo **remuestrea a ~500-1000 puntos** y devuelve JSON pequeño.
El frontend sólo pide, recibe arrays y dibuja.

---

## 3. Los 3 conceptos clave

1. **Alineación por distancia, no por tiempo.** Para comparar vueltas se alinean por
   *distancia recorrida en pista* (metro 0 = meta), no por tiempo, porque una vuelta es
   más rápida que otra. Así el metro 5000 es la misma curva en ambas.

2. **Delta = tiempo acumulado.** La gráfica más útil: en cada punto de la pista, cuánto
   tiempo llevo ganado/perdido respecto a otra vuelta. Se interpolan ambas vueltas a una
   rejilla común de distancia y se acumula la diferencia de tiempo.

3. **El backend adelgaza los datos.** Una sesión son cientos de MB; el navegador recibe
   sólo la(s) vuelta(s) pedida(s), remuestreada(s).

---

## 4. Contrato de la API (REST/JSON)

### Navegación
```
GET /api/seasons
    → [2018, ..., 2024, 2025]

GET /api/{year}/events
    → [{ round, name, country, circuit, date }]

GET /api/{year}/{round}/sessions
    → [{ code:"Q", name:"Qualifying" }, { code:"R", name:"Race" }, ...]
      # códigos: FP1, FP2, FP3, SQ (Sprint Quali), S (Sprint), Q, R

GET /api/{year}/{round}/{session}/drivers
    → [{ code:"VER", number:1, name, team, teamColor:"#3671C6" }]
```

### Vueltas de un piloto
```
GET /api/{year}/{round}/{session}/{driver}/laps
    → [{
        lapNumber, lapTime,               // segundos
        sector1, sector2, sector3,        // segundos
        compound, tyreLife, stint,        # [Neumáticos y stints]
        isPersonalBest,
        position,                          # [Posición en carrera] (null en clasi/libres)
        gapToLeader, gapToAhead            # [Gaps]
      }]
```

### Telemetría de una vuelta
```
GET /api/{year}/{round}/{session}/{driver}/lap/{n}/telemetry
    → {
        distance: [0, 5, 10, ...],        // eje X común (m)
        speed:    [...],                  // km/h
        throttle: [...],                  // 0-100 %
        brake:    [...],                  // 0-100 % (o 0/1)
        gear:     [...],                  // 1-8
        rpm:      [...],
        drs:      [...],                  // abierto/cerrado
        time:     [...],                  // s desde inicio de vuelta (para delta)
        x: [...], y: [...]                // trazada en pista (mapa)
      }
```

### Comparación de varias vueltas
```
POST /api/compare
    body: { laps: [{ year, round, session, driver, lap }, ...] }
    → {
        grid: [0, 5, 10, ...],            // rejilla común de distancia
        laps: [{
           label:"VER Q L18",
           color,
           speed:[...], throttle:[...], brake:[...], gear:[...], rpm:[...],
           x:[...], y:[...]
        }],
        delta: [                          // vs. la primera vuelta (referencia)
           { label:"LEC Q L20", values:[0, -0.02, -0.05, ...] }  // s (+ = más lento)
        ],
        miniSectors: [                    # [Micro/mini-sectores]
           { from, to, fastestLabel }     // quién es más rápido en cada tramo
        ]
      }
```

### Meteorología
```
GET /api/{year}/{round}/{session}/weather
    → [{ time, airTemp, trackTemp, humidity, windSpeed, rainfall }]
```

---

## 5. Datos extra acordados

- **Neumáticos y stints**: compuesto, vida del neumático y nº de stint por vuelta.
- **Meteorología**: aire/pista, humedad, viento, lluvia.
- **Posición y gaps en carrera**: posición por vuelta y gap al líder / al de delante.
- **Micro/mini-sectores**: la pista se divide en N tramos y se colorea quién es más
  rápido en cada uno (estilo comparativa de TV).

---

## 6. Fases

**Fase 1 — Fundamentos**
- Scaffold backend FastAPI + FastF1 con caché en disco (uv).
- Endpoints de navegación (seasons → events → sessions → drivers → laps).
- Endpoint de telemetría de una vuelta.
- Scaffold frontend Vite React TS + cliente de API tipado.

**Fase 2 — Visualización**
- Selector Año → GP → Sesión → Piloto → Vuelta.
- Gráficos de telemetría alineados por distancia (velocidad, throttle, brake, gear).
- Tabla de vueltas con tiempos, sectores, neumático y stint.

**Fase 3 — Comparación**
- Superponer 2+ vueltas + gráfica de delta acumulado.
- Mapa de pista coloreado por velocidad y por mini-sectores.
- Panel de meteorología y de posición/gaps en carrera.

**Fase 4 — Tiempo real** (posterior)
- Cliente de *live timing* de FastF1 vía WebSocket durante GPs en directo.

---

## 7. Riesgos / notas técnicas

- FastF1 la **primera** carga de una sesión es lenta (descarga); luego va de la caché.
- Datos de telemetría detallada existen de forma fiable desde ~**2018**.
- El *brake* a veces viene como 0/1 y no como %; se documenta según lo que devuelva.
- Tiempo real sólo se puede probar de verdad **durante un GP en vivo**.
- CORS: el backend debe permitir el origen del frontend (localhost en dev).
- **Puertos (dev)**: backend en **8080** (el 8000 esta reservado en Windows por
  WSL/Hyper-V y da `WinError 10013`), frontend Vite en **5173**.
