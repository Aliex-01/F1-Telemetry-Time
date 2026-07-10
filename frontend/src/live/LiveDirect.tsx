// Vista de directo real (WebSocket + SignalR de la F1). Solo funciona durante un GP
// en vivo; la repeticion historica se maneja en ReplayPlayer.
import { useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { IconStop } from "../components/icons";
import { LiveTrackMap } from "./LiveTrackMap";
import { useLiveFeed } from "./useLiveFeed";
import { NO_POS, orderByTeam } from "./gridOrder";

export function LiveDirect() {
  const [selected, setSelected] = useState<string | null>(null);
  const { connected, meta, frame, history } = useLiveFeed(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLive() {
    setBusy(true); setError(null);
    try { await api.liveStart(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { await api.liveStop(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  const byNum = new Map(meta?.drivers.map((d) => [String(d.number), d]));
  const cars = orderByTeam(
    frame ? Object.entries(frame.cars) : [],
    (num) => frame?.cars[num]?.pos ?? NO_POS,
    (num) => byNum.get(num)?.team ?? null,
    (num) => byNum.get(num)?.number ?? Number(num),
  );

  return (
    <div>
      <div className="live-controls">
        <span className={`dot-conn ${connected ? "on" : "off"}`} />
        {connected ? "WebSocket conectado" : "Conectando…"}
        <span className="sep" />
        <button onClick={startLive} disabled={busy} title="Solo funciona durante un GP en directo"><span className="live-dot" /> Conectar al directo</button>
        <button onClick={stop} disabled={busy}><IconStop size={13} /> Parar</button>
      </div>

      <p className="status">
        El directo solo transmite datos durante un Gran Premio en vivo. Para revisar
        sesiones pasadas usa la pestaña <strong>Repetición</strong>.
      </p>
      {error && <p className="status error">{error}</p>}
      {meta && <p className="status">{meta.session} · t = {frame?.t ?? 0}s</p>}

      {meta && frame && (
        <div className="track-block">
          <div className="track-title">Posición de los pilotos en pista</div>
          <LiveTrackMap
            track={meta.track}
            cars={frame.cars}
            drivers={meta.drivers}
            rotation={meta.rotation}
            corners={meta.corners}
            selected={selected}
            onSelect={(num) => setSelected(selected === num ? null : num)}
          />
        </div>
      )}

      <div
        className="live-grid"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(cars.length / 2))}, minmax(0, 1fr))` }}
      >
        {cars.map(([num, c]) => {
          const d = byNum.get(num);
          const isSel = selected === num;
          const drsOn = c.drs >= 10; // 10/12/14 = DRS abierto
          return (
            <button
              key={num}
              className={`car ${isSel ? "sel" : ""}`}
              style={{ borderLeftColor: d?.teamColor ?? "#888" }}
              onClick={() => setSelected(isSel ? null : num)}
            >
              <div className="car-head">
                <span className="car-pos">{c.pos ? `P${c.pos}` : "—"}</span>
                <span className="car-code">{d?.code ?? num}</span>
                <span className={`car-drs ${drsOn ? "on" : ""}`}>DRS</span>
              </div>
              <div className="car-speed">{Math.round(c.speed)}<small> km/h</small></div>
              <div className="car-meta">
                <span className="gear">M{c.gear}</span>
                <span className="rpm">{(c.rpm / 1000).toFixed(1)}k rpm</span>
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

      {selected && (
        <div className="live-detail">
          <h3>{byNum.get(selected)?.code ?? selected} — telemetría en vivo</h3>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="#888" unit="s" />
                <YAxis tick={{ fontSize: 11 }} stroke="#888" domain={[0, "auto"]} />
                <Line type="monotone" dataKey="speed" stroke="#e10600" dot={false} isAnimationActive={false} strokeWidth={1.6} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
