import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { BackendConfig } from "./components/BackendConfig";
import { CompareChart } from "./components/CompareChart";
import { LapsTable } from "./components/LapsTable";
import { ProgressBar } from "./components/ProgressBar";
import { Select } from "./components/Select";
import { TelemetryChart } from "./components/TelemetryChart";
import { TrackMap } from "./components/TrackMap";
import { TyreStrategy } from "./components/TyreStrategy";
import { WeatherPanel } from "./components/WeatherPanel";

// Code-splitting: la pestana Tiempo real (reproductor + graficas) se carga aparte,
// asi la carga inicial de Analisis es mas ligera.
const LivePanel = lazy(() => import("./live/LivePanel").then((m) => ({ default: m.LivePanel })));
import type {
  CircuitInfo,
  CompareResponse,
  DriverInfo,
  EventInfo,
  LapInfo,
  LapRef,
  SessionInfo,
  Telemetry,
} from "./types/api";
import "./App.css";

// Paleta de colores para distinguir vueltas en la comparacion.
const COMPARE_COLORS = ["#e10600", "#00c853", "#2962ff", "#ff9100", "#aa00ff", "#00e5ff"];

// Envuelve un setState para que se actualice como mucho una vez por frame (rAF).
// Evita decenas de renders por segundo al mover el raton rapido por las graficas.
function useRafSetter(setValue: (v: number | null) => void) {
  const raf = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  return useCallback(
    (v: number | null) => {
      pending.current = v;
      if (raf.current == null) {
        raf.current = requestAnimationFrame(() => {
          raf.current = null;
          setValue(pending.current);
        });
      }
    },
    [setValue],
  );
}

function fmtLap(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3);
  return m > 0 ? `${m}:${rest.padStart(6, "0")}` : rest;
}

type View = "analysis" | "compare" | "live";

// Estado de seleccion que se sincroniza con la URL (enlaces compartibles) y se
// recuerda entre visitas (localStorage).
type Selection = {
  view?: View;
  year?: number;
  round?: number;
  session?: string;
  driver?: string;
  lap?: number;
};

const SEL_STORAGE_KEY = "f1_last_selection";

// Lee la seleccion inicial: primero de la URL (?y=..&gp=..&s=..&d=..&lap=..&view=..),
// y si no hay parametros, de la ultima guardada en el navegador.
function readInitialSelection(): Selection {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const num = (k: string) => (p.get(k) != null ? Number(p.get(k)) : undefined);
  const v = p.get("view");
  const view = v === "compare" || v === "live" ? (v as View) : undefined;
  if ([...p.keys()].length > 0) {
    return { view, year: num("y"), round: num("gp"), session: p.get("s") ?? undefined, driver: p.get("d") ?? undefined, lap: num("lap") };
  }
  try {
    return JSON.parse(localStorage.getItem(SEL_STORAGE_KEY) || "{}") as Selection;
  } catch {
    return {};
  }
}

export default function App() {
  const initialSel = useRef(readInitialSelection()).current;
  const [seasons, setSeasons] = useState<number[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [laps, setLaps] = useState<LapInfo[]>([]);

  const [year, setYear] = useState<number | null>(initialSel.year ?? null);
  const [round, setRound] = useState<number | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [driver, setDriver] = useState<string | null>(null);
  const [lap, setLap] = useState<number | null>(null);

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [circuit, setCircuit] = useState<CircuitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Indice del punto sobre el que esta el raton (comparte graficas <-> mapa).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [compareHoverIdx, setCompareHoverIdx] = useState<number | null>(null);

  // Clave de la ultima sesion cuya telemetria ya se ha precargado (prefetch).
  const prefetchedRef = useRef<string | null>(null);

  // Seleccion pendiente de restaurar (deep-link): se va aplicando nivel a nivel a
  // medida que llega cada lista dependiente (eventos -> sesiones -> pilotos -> vueltas).
  const pendingSel = useRef<Selection>(initialSel);

  // Pestana/seccion activa.
  const [view, setView] = useState<View>(initialSel.view ?? "analysis");

  // Comparacion: cesta de vueltas (misma sesion) + resultado del backend.
  const [compareRefs, setCompareRefs] = useState<LapRef[]>([]);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);

  // Trazas estables (referencia constante entre hovers) para no romper la memoizacion
  // del TrackMap: solo cambian cuando cambia la telemetria/comparacion.
  const lapTraces = useMemo(
    () => (telemetry ? [{ x: telemetry.x, y: telemetry.y, color: "#3a3a42" }] : []),
    [telemetry],
  );
  const compareTraces = useMemo(
    () => (compareData ? [{ x: compareData.laps[0].x, y: compareData.laps[0].y, color: "#3a3a42" }] : []),
    [compareData],
  );

  // Mapa de dominancia (solo con 2 vueltas): cada tramo del trazado se pinta del
  // color de la vuelta que va mas rapida ahi (mayor velocidad en ese punto).
  const dominance = useMemo(() => {
    if (!compareData || compareData.laps.length !== 2) return null;
    const [a, b] = compareData.laps;
    const ca = a.color ?? COMPARE_COLORS[0];
    const cb = b.color ?? COMPARE_COLORS[1];
    const segColors = a.speed.map((sa, i) => (sa >= b.speed[i] ? ca : cb));
    return { traces: [{ x: a.x, y: a.y, segColors }], ca, cb, la: a.label, lb: b.label };
  }, [compareData]);

  // Setters de hover limitados a un update por frame (movimiento fluido).
  const onHoverLap = useRafSetter(setHoverIdx);
  const onHoverCompare = useRafSetter(setCompareHoverIdx);

  // Subrayado deslizante de las pestanas: un unico indicador que mide el boton
  // activo y se anima (left/width) al cambiar de pestana, en vez de aparecer/
  // desaparecer. Se recalcula al cambiar de vista, al variar el badge de la
  // cesta (cambia el ancho) y al redimensionar la ventana.
  const tabsRef = useRef<HTMLElement>(null);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const measureUnderline = useCallback(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>("button.active");
    if (active) setUnderline({ left: active.offsetLeft, width: active.offsetWidth });
  }, []);
  useLayoutEffect(measureUnderline, [measureUnderline, view, compareRefs.length]);
  useEffect(() => {
    window.addEventListener("resize", measureUnderline);
    return () => window.removeEventListener("resize", measureUnderline);
  }, [measureUnderline]);

  // Sesion seleccionada y si aun no se ha disputado (sin datos): en ese caso no
  // pedimos nada al backend y mostramos un aviso amable en vez de un error feo.
  const currentSession = sessions.find((s) => s.code === session) ?? null;
  const upcoming = currentSession?.upcoming ?? false;

  // Carga inicial de temporadas.
  useEffect(() => {
    api.seasons().then(setSeasons).catch((e) => setError(String(e)));
  }, []);

  // Restauracion del deep-link nivel a nivel: cuando llega cada lista dependiente,
  // si habia una seleccion pendiente valida, la aplicamos y la consumimos.
  useEffect(() => {
    const want = pendingSel.current.round;
    if (want != null && events.some((e) => e.round === want)) {
      pendingSel.current.round = undefined;
      setRound(want);
    }
  }, [events]);
  useEffect(() => {
    const want = pendingSel.current.session;
    if (want != null && sessions.some((s) => s.code === want)) {
      pendingSel.current.session = undefined;
      setSession(want);
    }
  }, [sessions]);
  useEffect(() => {
    const want = pendingSel.current.driver;
    if (want != null && drivers.some((d) => d.code === want)) {
      pendingSel.current.driver = undefined;
      setDriver(want);
    }
  }, [drivers]);
  useEffect(() => {
    const want = pendingSel.current.lap;
    if (want != null && laps.some((l) => l.lapNumber === want)) {
      pendingSel.current.lap = undefined;
      setLap(want);
    }
  }, [laps]);

  // Refleja la seleccion en la URL (enlace compartible) y la recuerda en el navegador.
  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== "analysis") p.set("view", view);
    if (year != null) p.set("y", String(year));
    if (round != null) p.set("gp", String(round));
    if (session) p.set("s", session);
    if (driver) p.set("d", driver);
    if (lap != null) p.set("lap", String(lap));
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    localStorage.setItem(SEL_STORAGE_KEY, JSON.stringify({ view, year, round, session, driver, lap }));
  }, [view, year, round, session, driver, lap]);

  // Cascada: cada selección resetea las siguientes y carga la lista dependiente.
  useEffect(() => {
    setEvents([]); setRound(null);
    if (year != null) api.events(year).then(setEvents).catch((e) => setError(String(e)));
  }, [year]);

  useEffect(() => {
    setSessions([]); setSession(null);
    if (year != null && round != null)
      api.sessions(year, round).then(setSessions).catch((e) => setError(String(e)));
  }, [year, round]);

  // Info del circuito (rotacion + curvas) para orientar y anotar el mapa.
  useEffect(() => {
    setCircuit(null);
    if (year != null && round != null && session && !upcoming)
      api.circuit(year, round, session).then(setCircuit).catch(() => setCircuit(null));
  }, [year, round, session, upcoming]);

  useEffect(() => {
    setDrivers([]); setDriver(null);
    if (year != null && round != null && session && !upcoming)
      loadWithSpinner(() => api.drivers(year, round, session).then(setDrivers));
  }, [year, round, session, upcoming]);

  useEffect(() => {
    setLaps([]); setLap(null);
    if (year != null && round != null && session && driver) {
      loadWithSpinner(() => api.laps(year, round, session, driver).then(setLaps));
      // Precarga la telemetria de la sesion en segundo plano (una vez por sesion),
      // para que abrir cualquier vuelta despues sea instantaneo.
      const key = `${year}-${round}-${session}`;
      if (prefetchedRef.current !== key) {
        prefetchedRef.current = key;
        api.prefetch(year, round, session).catch(() => {
          prefetchedRef.current = null; // si falla, permitir reintento
        });
      }
    }
  }, [year, round, session, driver]);

  useEffect(() => {
    setTelemetry(null);
    setHoverIdx(null);
    if (year != null && round != null && session && driver && lap != null)
      loadWithSpinner(() =>
        api.telemetry(year, round, session, driver, lap).then(setTelemetry),
      );
  }, [year, round, session, driver, lap]);

  // Al cambiar de sesion/GP/año, la cesta de comparacion deja de tener sentido.
  useEffect(() => {
    setCompareRefs([]);
    setCompareData(null);
  }, [year, round, session]);

  // Recalcula la comparacion cuando hay 2+ vueltas en la cesta.
  useEffect(() => {
    if (compareRefs.length < 2) {
      setCompareData(null);
      return;
    }
    api.compare(compareRefs).then(setCompareData).catch((e) => setError(String(e)));
  }, [compareRefs]);

  function addToCompare() {
    if (year == null || round == null || !session || !driver || lap == null) return;
    const ref: LapRef = { year, round, session, driver, lap };
    // Evita duplicados (mismo piloto + vuelta).
    if (compareRefs.some((r) => r.driver === driver && r.lap === lap)) return;
    setCompareRefs((prev) => [...prev, ref]);
  }

  function removeFromCompare(idx: number) {
    setCompareRefs((prev) => prev.filter((_, i) => i !== idx));
  }

  async function loadWithSpinner(fn: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-bar" />
          <div>
            <h1>F1 <span>TELEMETRY</span> TIME</h1>
            <p className="sub">Análisis de vueltas · clasificación, carrera y tiempo real</p>
          </div>
        </div>
        {/* Solo en dev: en produccion la URL del backend va fijada (client.ts). */}
        {import.meta.env.DEV && <BackendConfig />}
      </header>

      <nav className="tabs" ref={tabsRef}>
        <button className={view === "analysis" ? "active" : ""} onClick={() => setView("analysis")}>
          Análisis
        </button>
        <button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>
          Comparación
          {compareRefs.length > 0 && <span className="tab-badge">{compareRefs.length}</span>}
        </button>
        <button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>
          Tiempo real
        </button>
        <span className="tab-underline" style={{ left: underline.left, width: underline.width }} />
      </nav>

      {(view === "analysis" || view === "compare") && (
        <div className="selectors">
          <Select label="Año" value={year} onChange={(v) => setYear(v)}
            options={seasons.map((s) => ({ value: s, label: String(s) }))} />
          <Select label="Gran Premio" value={round} onChange={(v) => setRound(v)}
            options={events.map((e) => ({ value: e.round, label: e.name }))} />
          <Select label="Sesión" value={session} onChange={(v) => setSession(v)}
            options={sessions.map((s) => ({ value: s.code, label: s.upcoming ? `${s.name} · próximamente` : s.name }))} />
          <Select label="Piloto" value={driver} onChange={(v) => setDriver(v)}
            options={drivers.map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))} />
          <Select label="Vuelta" value={lap} onChange={(v) => setLap(v)}
            options={laps.map((l) => ({
              value: l.lapNumber,
              label: `L${l.lapNumber}${l.segment ? ` [${l.segment}]` : ""} · ${fmtLap(l.lapTime)}`,
            }))} />
          <button className="add-compare selectors-add" onClick={addToCompare} disabled={lap == null}>
            {lap != null ? `Añadir ${driver} L${lap}` : "Añadir vuelta"} a comparar
          </button>
        </div>
      )}

      {(view === "analysis" || view === "compare") && loading && (
        <ProgressBar label="Cargando… (la primera sesión descarga datos)" />
      )}
      {(view === "analysis" || view === "compare") && error && (
        <p className="status error">{error}</p>
      )}

      {view === "analysis" && year != null && round != null && session && !upcoming && (
        <WeatherPanel year={year} round={round} session={session} />
      )}

      {view === "analysis" && upcoming && (
        <p className="status">
          Esta sesión aún no se ha disputado
          {currentSession?.date ? ` (empieza el ${new Date(currentSession.date).toLocaleString()})` : ""}.
          Todavía no hay datos disponibles.
        </p>
      )}

      {view === "analysis" && !upcoming && (
        <div className="analysis-layout">
          {/* Fila superior: tabla de vueltas + mapa de pista. */}
          <div className="analysis-top">
            {laps.length > 0 && (
              <LapsTable laps={laps} selected={lap} onSelect={(n) => setLap(n)} />
            )}
            {telemetry && (
              <div className="track-block">
                <div className="track-title">
                  Mapa de pista — pasa el ratón por las gráficas para ver la posición
                </div>
                <TrackMap
                  mode="plain"
                  lineWidth={12}
                  traces={lapTraces}
                  rotation={circuit?.rotation ?? 0}
                  corners={circuit?.corners}
                  highlights={
                    hoverIdx != null
                      ? [{ x: telemetry.x[hoverIdx], y: telemetry.y[hoverIdx] }]
                      : []
                  }
                />
              </div>
            )}
          </div>

          {/* Estrategia de neumaticos del piloto (stints por compuesto). */}
          {laps.length > 0 && <TyreStrategy laps={laps} />}

          {/* Las graficas de telemetria, a lo ancho de toda la pagina. */}
          {telemetry && (
            <div className="charts">
              <TelemetryChart telemetry={telemetry} onHover={onHoverLap} />
            </div>
          )}
          {!telemetry && !loading && (
            <p className="status">
              {laps.length > 0
                ? "Elige una vuelta (en la tabla o el selector) para ver la telemetría."
                : "Elige año, GP, sesión y piloto para empezar."}
            </p>
          )}
        </div>
      )}

      {view === "compare" && (
        <section className="compare">
          <h2>Comparación</h2>
          {compareRefs.length === 0 && (
            <p className="status">
              Aún no has añadido vueltas. Ve a <strong>Análisis</strong>, elige una vuelta y pulsa
              «Añadir a comparar».
            </p>
          )}
          <div className="compare-chips">
            {compareRefs.map((r, i) => {
              const color = compareData?.laps[i]?.color ?? COMPARE_COLORS[i % COMPARE_COLORS.length];
              return (
                <span className="chip" key={`${r.driver}-${r.lap}`} style={{ borderColor: color }}>
                  <span className="dot" style={{ background: color }} />
                  {r.driver} L{r.lap}{i === 0 ? " (ref.)" : ""}
                  <button onClick={() => removeFromCompare(i)} title="Quitar">×</button>
                </span>
              );
            })}
          </div>
          {compareRefs.length < 2 && (
            <p className="status">Añade al menos otra vuelta para comparar.</p>
          )}
          {compareData && (
            <>
              <div className="track-block">
                <div className="track-title">
                  {dominance
                    ? "Dominancia — cada tramo, del color de la vuelta más rápida ahí"
                    : "Trazadas superpuestas — pasa el ratón por las gráficas para ver las posiciones"}
                </div>
                {dominance && (
                  <div className="dominance-legend">
                    <span><span className="dot" style={{ background: dominance.ca }} /> {dominance.la}</span>
                    <span><span className="dot" style={{ background: dominance.cb }} /> {dominance.lb}</span>
                  </div>
                )}
                <TrackMap
                  mode="plain"
                  lineWidth={12}
                  rotation={circuit?.rotation ?? 0}
                  corners={circuit?.corners}
                  traces={dominance ? dominance.traces : compareTraces}
                  highlights={
                    compareHoverIdx != null
                      ? compareData.laps.map((lap, i) => ({
                          x: lap.x[compareHoverIdx],
                          y: lap.y[compareHoverIdx],
                          color: lap.color ?? COMPARE_COLORS[i % COMPARE_COLORS.length],
                        }))
                      : []
                  }
                />
              </div>
              <CompareChart data={compareData} colors={COMPARE_COLORS} onHover={onHoverCompare} />
            </>
          )}
        </section>
      )}

      {/* Siempre montado (oculto con CSS) para conservar el estado de la repeticion
          -sesion cargada y momento- al cambiar a Analisis/Comparacion y volver. */}
      <div style={{ display: view === "live" ? undefined : "none" }}>
        <Suspense fallback={<ProgressBar label="Cargando tiempo real…" />}>
          <LivePanel active={view === "live"} />
        </Suspense>
      </div>

      <footer className="app-footer">
        <div className="footer-main">
          <div className="footer-col footer-about">
            <div className="footer-brand">F1 <span>TELEMETRY</span> TIME</div>
            <p>
              Visor de telemetría y tiempo real de Fórmula 1. Los datos se descargan de la
              fuente oficial de F1 con <strong>FastF1</strong>, se cachean y se adelgazan en el
              servidor antes de mostrarse.
            </p>
          </div>
          <div className="footer-col">
            <h4>Tecnología</h4>
            <ul>
              <li>Backend · FastAPI + FastF1</li>
              <li>Frontend · React + Vite</li>
              <li>Gráficas · Recharts</li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Enlaces</h4>
            <ul>
              <li>
                <a href="https://github.com/Aliex-01/F1-Telemetry-Time" target="_blank" rel="noreferrer">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://docs.fastf1.dev/" target="_blank" rel="noreferrer">
                  FastF1
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>F1 Telemetry Time · {new Date().getFullYear()}</span>
          <span className="footer-disclaimer">
            Proyecto no oficial. No afiliado ni respaldado por Formula 1. Las marcas y los datos
            pertenecen a sus respectivos titulares.
          </span>
        </div>
      </footer>
    </div>
  );
}
