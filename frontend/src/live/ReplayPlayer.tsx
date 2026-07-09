// Reproductor de repeticiones: descarga la sesion completa una vez y la reproduce
// localmente -> play/pausa, adelante/atras, velocidad y saltar a cualquier momento
// son instantaneos (sin ir al servidor). El reloj avanza con requestAnimationFrame
// e interpola las posiciones X/Y entre frames para un movimiento fluido.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import { Select } from "../components/Select";
import type { EventInfo, ReplayData, SessionInfo } from "../types/api";
import { LiveTrackMap } from "./LiveTrackMap";
import { NO_POS, orderByTeam } from "./gridOrder";

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

const TYRE_COLOR: Record<string, string> = {
  SOFT: "#ff3333", MEDIUM: "#ffdd00", HARD: "#eeeeee",
  INTERMEDIATE: "#43b02a", WET: "#0067ad",
};

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLap(sec: number): string {
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(3);
  return m > 0 ? `${m}:${rest.padStart(6, "0")}` : rest;
}

// FLIP: anima el reordenamiento de las filas de la torre cuando un piloto adelanta
// a otro (la fila se desliza a su nueva posicion, como en la TV). Solo actua cuando
// el `order` cambia -no lee layout en cada frame del reproductor-: la dependencia es
// la cadena de posiciones, estable entre adelantamientos. Tecnica FLIP: se mide la
// posicion nueva (post-commit), se aplica el desplazamiento inverso sin transicion y
// se anima a 0. Devuelve la ref que hay que poner en el <tbody>.
function useTowerFlip(order: string) {
  const ref = useRef<HTMLTableSectionElement>(null);
  const prevTops = useRef<Map<string, number>>(new Map());
  const prevOrder = useRef<string | null>(null);

  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const tops = new Map<string, number>();
    for (const el of rows) tops.set(el.dataset.flipKey ?? "", el.offsetTop);

    // Solo animamos si ya habia un orden previo distinto (no en el primer render).
    if (prevOrder.current !== null && prevOrder.current !== order) {
      for (const el of rows) {
        const k = el.dataset.flipKey ?? "";
        const prev = prevTops.current.get(k);
        if (prev == null) continue;
        const delta = prev - (tops.get(k) ?? 0);
        if (Math.abs(delta) < 1) continue;
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.45s ease";
          el.style.transform = "";
        });
      }
    }
    prevTops.current = tops;
    prevOrder.current = order;
  }, [order]);

  return ref;
}

export function ReplayPlayer({ active = true }: { active?: boolean }) {
  // Cascada de seleccion (igual que en Analisis).
  const [seasons, setSeasons] = useState<number[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [session, setSession] = useState<string | null>(null);

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.seasons().then(setSeasons).catch(() => {}); }, []);
  useEffect(() => {
    setEvents([]); setRound(null);
    if (year != null) api.events(year).then(setEvents).catch(() => {});
  }, [year]);
  useEffect(() => {
    setSessions([]); setSession(null);
    if (year != null && round != null) api.sessions(year, round).then(setSessions).catch(() => {});
  }, [year, round]);

  const [pos, setPos] = useState(0); // frame (float)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [selected, setSelected] = useState<string | null>(null);
  const [gapMode, setGapMode] = useState<"ahead" | "leader">("ahead");
  const posRef = useRef(0);

  async function load() {
    if (year == null || round == null || !session) return;
    setLoading(true); setError(null); setData(null); setPlaying(false);
    posRef.current = 0; setPos(0); setSelected(null);
    try {
      setData(await api.replay(year, round, session));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Bucle de reproduccion (rAF). Avanza el frame segun el tiempo real y la velocidad.
  useEffect(() => {
    if (!data || !playing || !active) return; // no avanzar mientras la pestaña esta oculta
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dtReal = (now - last) / 1000;
      last = now;
      let p = posRef.current + (dtReal / data.dt) * speed;
      if (p >= data.n - 1) {
        p = data.n - 1;
        posRef.current = p; setPos(p); setPlaying(false);
        return;
      }
      posRef.current = p; setPos(p);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [data, playing, speed, active]);

  function seek(p: number) {
    if (!data) return;
    const c = Math.max(0, Math.min(data.n - 1, p));
    posRef.current = c; setPos(c);
  }
  const skip = (secs: number) => data && seek(posRef.current + secs / data.dt);

  const byNum = useMemo(
    () => new Map((data?.drivers ?? []).map((d) => [String(d.number), d])),
    [data],
  );

  // Frame actual: interpola X/Y entre muestras para movimiento suave.
  const frameCars = useMemo(() => {
    if (!data) return {};
    const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, data.n - 1), f = pos - i0;
    const out: Record<string, { x: number; y: number; speed: number; throttle: number; brake: number; gear: number; rpm: number; drs: number }> = {};
    for (const [num, c] of Object.entries(data.cars)) {
      out[num] = {
        x: c.x[i0] + (c.x[i1] - c.x[i0]) * f,
        y: c.y[i0] + (c.y[i1] - c.y[i0]) * f,
        speed: c.speed[i0], throttle: c.throttle[i0], brake: c.brake[i0], gear: c.gear[i0],
        rpm: 0, drs: 0, // la repeticion no trae estos canales; el mapa solo usa x/y
      };
    }
    return out;
  }, [data, pos]);

  // Vuelta EN CURSO del piloto seleccionado (rango de frames), para acotar la grafica
  // a una sola vuelta en vez de toda la sesion. OJO: standings[num] trae 3 registros
  // por vuelta (meta + cortes de S1 y S2), asi que nos quedamos solo con el cruce de
  // META = el registro de mayor t por cada numero de vuelta.
  const selLap = useMemo(() => {
    if (!data || !selected) return null;
    const recs = data.standings[selected] ?? [];
    const lastFrame = data.n - 1;
    const toFrame = (tt: number) =>
      Math.max(0, Math.min(lastFrame, Math.round((tt - data.t0) / data.dt)));

    const finishByLap = new Map<number, number>();
    for (const r of recs) {
      const prev = finishByLap.get(r.lap);
      if (prev === undefined || r.t > prev) finishByLap.set(r.lap, r.t);
    }
    const finishes = [...finishByLap.entries()]
      .map(([lap, t]) => ({ lap, t }))
      .sort((a, b) => a.t - b.t);

    // Sin cruces de meta (practicas/quali sin datos de vuelta): ventana movil de ~45 s.
    if (finishes.length === 0) {
      const half = Math.max(1, Math.round(45 / data.dt));
      const p = Math.round(pos);
      return { startFrame: Math.max(0, p - half), endFrame: Math.min(lastFrame, p + half), lap: null };
    }
    const now = data.t0 + pos * data.dt;
    let idx = -1;
    for (let i = 0; i < finishes.length && finishes[i].t <= now; i++) idx = i;
    const startT = idx >= 0 ? finishes[idx].t : data.t0;
    const endT = idx + 1 < finishes.length ? finishes[idx + 1].t : data.t0 + lastFrame * data.dt;
    const lap = idx + 1 < finishes.length ? finishes[idx + 1].lap : idx >= 0 ? finishes[idx].lap + 1 : 1;
    return { startFrame: toFrame(startT), endFrame: toFrame(endT), lap };
  }, [data, selected, pos]);

  // Serie de velocidad de esa vuelta para la grafica (solo se rehace al cambiar de
  // vuelta, no cada frame). x = frame; asi el playhead se situa por su indice de frame.
  const lapSeries = useMemo(() => {
    if (!data || !selected || !selLap) return [];
    const { startFrame, endFrame } = selLap;
    if (endFrame <= startFrame) return [];
    const s = data.cars[selected].speed;
    const out: { x: number; speed: number }[] = [];
    for (let i = startFrame; i <= endFrame; i++) out.push({ x: i, speed: Math.round(s[i]) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected, selLap?.startFrame, selLap?.endFrame]);

  // Firma del estado de vueltas: cambia SOLO cuando un coche cruza meta (nueva vuelta
  // completada). Asi la torre no se ajusta en cada frame, solo al pasar por meta.
  const t = data ? data.t0 + pos * data.dt : 0;
  let lapSig = "";
  if (data && data.type === "race") {
    for (const [num, recs] of Object.entries(data.standings)) {
      if (!recs.length) continue;
      let idx = 0;
      for (let i = recs.length - 1; i >= 0; i--) {
        if (recs[i].t <= t) { idx = i; break; }
      }
      lapSig += `${num}:${idx};`;
    }
  }

  // Torre de tiempos (solo carrera): ultima vuelta completada por coche. Se recalcula
  // unicamente cuando cambia lapSig (es decir, cuando alguien cruza la linea de meta).
  const tower = useMemo(() => {
    if (!data || data.type !== "race") return [];
    const now = data.t0 + posRef.current * data.dt;
    const retired = new Set(data.retirements ?? []);
    type Row = { num: string; rec: (typeof data.standings)[string][number]; dnf: boolean; fin: boolean };
    const rows: Row[] = [];
    for (const [num, recs] of Object.entries(data.standings)) {
      if (recs.length === 0) continue;
      let cur = recs[0]; // si aun no hay vuelta completada, el orden inicial
      let idx = 0;
      for (let i = recs.length - 1; i >= 0; i--) {
        if (recs[i].t <= now) { cur = recs[i]; idx = i; break; }
      }
      // Alcanzo su ultimo registro = cruzo meta por ultima vez (fin de su carrera).
      const reachedEnd = idx === recs.length - 1 && now >= recs[recs.length - 1].t;
      const dnf = reachedEnd && retired.has(num);   // abandono -> al fondo
      const fin = reachedEnd && !retired.has(num);  // termino -> bandera a cuadros
      rows.push({ num, rec: cur, dnf, fin });
    }
    const active = rows.filter((r) => !r.dnf).sort((a, b) => a.rec.position - b.rec.position);
    // Entre abandonados, el ultimo en abandonar va por delante (mas vueltas completadas).
    const dnfs = rows.filter((r) => r.dnf).sort((a, b) => b.rec.lap - a.rec.lap);
    return [...active, ...dnfs];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lapSig]);

  // Ranking en vivo (practicas/quali): la tanda activa segun el reloj (Q1->Q2->Q3) y,
  // dentro de ella, la mejor vuelta de cada piloto hasta el momento actual.
  let activeSeg: ReplayData["liveRanking"][number] | null = null;
  if (data && data.type !== "race" && data.liveRanking.length) {
    activeSeg = data.liveRanking[0];
    for (const s of data.liveRanking) if (s.start <= t) activeSeg = s;
  }
  const rankSig = activeSeg ? `${activeSeg.name}:${activeSeg.events.filter((e) => e.t <= t).length}` : "";
  // Zona de eliminacion segun la tanda: en Q1 caen desde P16 (pasan 15), en Q2 desde
  // P11 (pasan 10); en Q3 no hay eliminados. El nombre es Q1/Q2/Q3 (o SQ1/SQ2/SQ3).
  const dropFrom = ((): number | null => {
    if (!activeSeg) return null;
    const rnd = activeSeg.name.trim().slice(-1);
    if (rnd === "1") return 16;
    if (rnd === "2") return 11;
    return null;
  })();
  const ranking = useMemo(() => {
    if (!data || !activeSeg) return [] as { num: string; lapTime: number; compound: string | null }[];
    const now = data.t0 + posRef.current * data.dt;
    const best = new Map<string, { lapTime: number; compound: string | null }>();
    for (const e of activeSeg.events) {
      if (e.t > now) break; // eventos ordenados por tiempo
      const cur = best.get(e.num);
      if (!cur || e.lapTime < cur.lapTime) best.set(e.num, { lapTime: e.lapTime, compound: e.compound });
    }
    return [...best.entries()]
      .map(([num, v]) => ({ num, ...v }))
      .sort((a, b) => a.lapTime - b.lapTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rankSig]);

  // Refs FLIP para animar el reordenamiento de las dos torres (carrera y ranking).
  const towerRef = useTowerFlip(tower.map((r) => r.num).join(","));
  const rankingRef = useTowerFlip(ranking.map((r) => r.num).join(","));

  // Banderas activas en el instante actual: sectores en amarilla y si hay roja.
  const flagState = useMemo(() => {
    if (!data?.flags) return { red: false, sectors: [] as number[] };
    const red = data.flags.red.some((r) => t >= r.start && t <= r.end);
    const sectors = data.flags.yellow
      .filter((y) => t >= y.start && t <= y.end)
      .map((y) => y.sector);
    return { red, sectors };
  }, [data, t]);

  // Safety Car / VSC activo en el instante actual (aviso; toda la pista).
  const safety = data?.safety?.find((s) => t >= s.start && t <= s.end) ?? null;
  // Lluvia activa en el instante actual.
  const raining = data?.rain?.some((r) => t >= r.start && t <= r.end) ?? false;

  // Nº total de vueltas de la carrera (la mayor completada por cualquier coche).
  const totalLaps = useMemo(() => {
    if (!data || data.type !== "race") return 0;
    let mx = 0;
    for (const recs of Object.values(data.standings)) {
      if (recs.length) mx = Math.max(mx, recs[recs.length - 1].lap);
    }
    return mx;
  }, [data]);
  // Vuelta del líder en el instante actual (completó rec.lap -> va por la siguiente).
  const leaderLap =
    data && data.type === "race" && tower.length && totalLaps
      ? Math.min((tower[0].rec.lap ?? 0) + 1, totalLaps)
      : 0;

  // Clasificacion FINAL de la sesion (estatica: no cambia con la reproduccion). Ordena
  // la parrilla siempre igual, por como acabaron.
  //   - Carrera: posicion en el ultimo registro de cada coche; los abandonos, al fondo
  //     (mas vueltas completadas, mas adelante).
  //   - Practica/quali: mejor vuelta de toda la sesion (menor tiempo, primero).
  const finalPosByNum = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    if (data.type === "race") {
      const retired = new Set(data.retirements ?? []);
      const rows = Object.entries(data.standings)
        .filter(([, recs]) => recs.length > 0)
        .map(([num, recs]) => {
          const last = recs[recs.length - 1];
          return { num, position: last.position, lap: last.lap, dnf: retired.has(num) };
        });
      const active = rows.filter((r) => !r.dnf).sort((a, b) => a.position - b.position);
      const dnfs = rows.filter((r) => r.dnf).sort((a, b) => b.lap - a.lap);
      [...active, ...dnfs].forEach((r, i) => m.set(r.num, i + 1));
    } else {
      const best = new Map<string, number>();
      for (const seg of data.liveRanking)
        for (const e of seg.events)
          if (!best.has(e.num) || e.lapTime < best.get(e.num)!) best.set(e.num, e.lapTime);
      [...best.entries()]
        .sort((a, b) => a[1] - b[1])
        .forEach(([num], i) => m.set(num, i + 1));
    }
    return m;
  }, [data]);

  const cars = data
    ? orderByTeam(
        Object.entries(frameCars),
        (num) => finalPosByNum.get(num) ?? NO_POS,
        (num) => byNum.get(num)?.team ?? null,
        (num) => byNum.get(num)?.number ?? Number(num),
      )
    : [];
  const elapsed = data ? pos * data.dt : 0;
  const total = data ? (data.n - 1) * data.dt : 0;
  const selCar = selected ? frameCars[selected] : null;

  return (
    <div>
      <div className="selectors replay-picker">
        <Select label="Año" value={year} onChange={setYear}
          options={seasons.map((s) => ({ value: s, label: String(s) }))} />
        <Select label="Gran Premio" value={round} onChange={setRound}
          options={events.map((e) => ({ value: e.round, label: e.name }))} />
        <Select label="Sesión" value={session} onChange={setSession}
          options={sessions.map((s) => ({ value: s.code, label: s.name }))} />
        <button className="add-compare replay-load" onClick={load} disabled={loading || !session}>
          {loading ? "Cargando…" : "📥 Cargar repetición"}
        </button>
      </div>

      {error && <p className="status error">{error}</p>}
      {loading && <ProgressBar label="Descargando la sesión completa… (unos segundos)" />}

      {data && (
        <>
          {/* Barra de reproductor */}
          <div className="player">
            <div className="player-buttons">
              <button onClick={() => seek(0)} title="Al inicio">⏮</button>
              <button onClick={() => skip(-10)} title="-10 s">⏪</button>
              <button className="play" onClick={() => setPlaying((p) => !p)}>
                {playing ? "⏸" : "▶"}
              </button>
              <button onClick={() => skip(10)} title="+10 s">⏩</button>
              <span className="player-time">{mmss(elapsed)} / {mmss(total)}</span>
              {data.type === "race" && totalLaps > 0 && (
                <span className="player-lap">Vuelta {leaderLap}/{totalLaps}</span>
              )}
              <span className="player-spacer" />
              <label className="player-speed">
                Velocidad
                <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
            </div>
            <input
              className="timeline"
              type="range"
              min={0}
              max={data.n - 1}
              step={1}
              value={Math.floor(pos)}
              onChange={(e) => seek(+e.target.value)}
            />
          </div>

          <div className="replay-stage">
          {/* Torre de tiempos (carrera) sincronizada con el reloj */}
          {tower.length > 0 && (
            <div className="tower">
              <div className="tower-head">
                <span className="track-title" style={{ margin: 0 }}>Clasificación en carrera</span>
                <div className="gap-toggle">
                  <button className={gapMode === "ahead" ? "active" : ""} onClick={() => setGapMode("ahead")}>Al de delante</button>
                  <button className={gapMode === "leader" ? "active" : ""} onClick={() => setGapMode("leader")}>Al líder</button>
                </div>
              </div>
              <table className="tower-table">
                <tbody ref={towerRef}>
                  {tower.map(({ num, rec, dnf, fin }, i) => {
                    const d = byNum.get(num);
                    const gap = gapMode === "ahead" ? rec.gapAhead : rec.gapLeader;
                    // BOX solo mientras esta dentro del pit lane (reloj en vivo).
                    const inPit = !dnf && !fin && (data.pits?.[num] ?? []).some((w) => t >= w.start && t <= w.end);
                    return (
                      <tr key={num} data-flip-key={num} className={`${selected === num ? "sel" : ""}${dnf ? " dnf" : ""}${inPit ? " pit" : ""}`} onClick={() => setSelected(selected === num ? null : num)}>
                        <td className="lb-pos">{i + 1}</td>
                        <td className="lb-code" style={{ borderLeftColor: d?.teamColor ?? "#888" }}>
                          {d?.code ?? num}
                          {fin && <span className="fin-tag" title="Ha terminado la carrera">🏁</span>}
                        </td>
                        <td className="lb-gap">{dnf ? "OUT" : inPit ? "BOX" : i === 0 ? "Líder" : `+${gap.toFixed(1)}`}</td>
                        <td className="tower-tyre">
                          {rec.compound && (
                            <span className="tyre" style={{ background: TYRE_COLOR[rec.compound] ?? "#888" }} title={rec.compound}>
                              {rec.compound[0]}
                            </span>
                          )}
                          {rec.tyreLife != null && <span className="tyre-life">{rec.tyreLife}v</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ranking en vivo por mejor vuelta (practicas y clasificacion), tanda activa */}
          {data.type !== "race" && activeSeg && (
            <div className="tower">
              <div className="tower-head">
                <span className="track-title" style={{ margin: 0 }}>
                  Clasificación · {activeSeg.name}
                </span>
              </div>
              <table className="tower-table">
                <tbody ref={rankingRef}>
                  {ranking.map((r, i) => {
                    const d = byNum.get(r.num);
                    return (
                      <tr key={r.num} data-flip-key={r.num} className={`${selected === r.num ? "sel" : ""}${dropFrom != null && i + 1 === dropFrom ? " cutline" : ""}`} onClick={() => setSelected(selected === r.num ? null : r.num)}>
                        <td className={`lb-pos${dropFrom != null && i + 1 >= dropFrom ? " elim" : ""}`}>{i + 1}</td>
                        <td className="lb-code" style={{ borderLeftColor: d?.teamColor ?? "#888" }}>{d?.code ?? r.num}</td>
                        <td className="lb-time">{fmtLap(r.lapTime)}</td>
                        <td className="lb-gap">{i === 0 ? "—" : `+${(r.lapTime - ranking[0].lapTime).toFixed(3)}`}</td>
                        <td className="tower-tyre">
                          {r.compound && (
                            <span className="tyre" style={{ background: TYRE_COLOR[r.compound] ?? "#888" }} title={r.compound}>
                              {r.compound[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="track-block" style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              {safety && (
                <div
                  className="sc-banner"
                  style={{
                    padding: "6px 12px", borderRadius: 8,
                    fontWeight: 700, color: "#111", fontSize: 13,
                    background: safety.kind === "SC" ? "#ff8700" : "#ffd400",
                    boxShadow: "0 2px 6px rgba(0,0,0,.4)",
                  }}
                >
                  {safety.kind === "SC" ? "🚧 Safety Car en pista" : "🐢 Virtual Safety Car (VSC)"}
                </div>
              )}
              {raining && (
                <div
                  className="rain-banner"
                  style={{
                    padding: "6px 12px", borderRadius: 8,
                    fontWeight: 700, color: "#fff", fontSize: 13,
                    background: "#0067ad",
                    boxShadow: "0 2px 6px rgba(0,0,0,.4)",
                  }}
                >
                  🌧️ Lluvia
                </div>
              )}
            </div>
            <div className="track-title">{data.session} · posición de los pilotos</div>
            <LiveTrackMap
              track={data.track}
              cars={frameCars}
              drivers={data.drivers}
              rotation={data.rotation}
              corners={data.corners}
              selected={selected}
              onSelect={(num) => setSelected(selected === num ? null : num)}
              sectorCount={data.flags?.sectorCount ?? 0}
              yellowSectors={flagState.sectors}
              red={flagState.red}
              height={620}
            />
          </div>
          </div>

          {/* Traza de velocidad de la vuelta en curso del piloto seleccionado */}
          {selected && lapSeries.length > 1 && (() => {
            const col = byNum.get(selected)?.teamColor ?? "#e10600";
            return (
            <div className="track-block">
              <div className="track-title">
                {byNum.get(selected)?.code ?? selected} · velocidad
                {selLap?.lap ? ` · vuelta ${selLap.lap}` : ""}
              </div>
              {selCar && (
                <div className="driver-readout">
                  <span><b>{Math.round(selCar.speed)}</b><small> km/h</small></span>
                  <span>Marcha <b>{selCar.gear}</b></span>
                  <span className="ro-bar">Acel. <span className="bar"><i style={{ width: `${selCar.throttle}%`, background: "#00c853" }} /></span></span>
                  <span className="ro-bar">Freno <span className="bar"><i style={{ width: `${selCar.brake}%`, background: "#2962ff" }} /></span></span>
                </div>
              )}
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={lapSeries} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
                  <defs>
                    <linearGradient id="spd-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={col} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={col} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#2a2a36" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} hide />
                  <YAxis
                    width={38}
                    tick={{ fontSize: 11, fill: "#9096a4" }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, (max: number) => Math.ceil((max + 20) / 20) * 20]}
                    tickCount={4}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    contentStyle={{ background: "#1e1e28", border: "1px solid #3a3a48", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={() => ""}
                    formatter={(v: number) => [`${v} km/h`, ""]}
                  />
                  <Area
                    type="monotone"
                    dataKey="speed"
                    stroke={col}
                    strokeWidth={2}
                    fill="url(#spd-fill)"
                    isAnimationActive={false}
                    dot={false}
                    activeDot={{ r: 3, fill: col, stroke: "none" }}
                  />
                  <ReferenceLine x={pos} stroke="#eef0f4" strokeWidth={1.5} strokeOpacity={0.7} />
                  {selCar && (
                    <ReferenceDot x={pos} y={Math.round(selCar.speed)} r={4} fill="#eef0f4" stroke={col} strokeWidth={2} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            );
          })()}

          <div
            className="live-grid"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(cars.length / 2))}, minmax(0, 1fr))` }}
          >
            {cars.map(([num, c]) => {
              const d = byNum.get(num);
              const isSel = selected === num;
              const gridPos = finalPosByNum.get(num);
              return (
                <button
                  key={num}
                  className={`car ${isSel ? "sel" : ""}`}
                  style={{ borderLeftColor: d?.teamColor ?? "#888" }}
                  onClick={() => setSelected(isSel ? null : num)}
                >
                  <div className="car-head">
                    <span className="car-pos">{gridPos ? `P${gridPos}` : "—"}</span>
                    <span className="car-code">{d?.code ?? num}</span>
                  </div>
                  <div className="car-speed">{Math.round(c.speed)}<small> km/h</small></div>
                  <div className="car-meta">
                    <span className="gear">M{c.gear}</span>
                  </div>
                  <div className="car-bar-row">
                    <span className="bar-lbl">ACE</span>
                    <span className="bar"><i style={{ width: `${c.throttle}%`, background: "#00c853" }} /></span>
                  </div>
                  <div className="car-bar-row">
                    <span className="bar-lbl">FRE</span>
                    <span className="bar"><i style={{ width: `${c.brake}%`, background: "#2962ff" }} /></span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
