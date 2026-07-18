// Panel del piloto seleccionado en la torre de tiempos. Todo lo que se puede
// montar con el cronometraje gratuito: ficha, mejores sectores y vuelta ideal,
// velocidades punta, estrategia de neumaticos, evolucion de vueltas y los
// mensajes de direccion de carrera que le citan.
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TYRE_COLOR } from "../components/tyres";
import type { RaceControlMessage, TimingLap, TimingRow, TimingStat } from "./useLiveFeed";

/** "1:47.070" -> 107.07 s. También acepta "47.308". */
function parseLapTime(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function ordinal(pos: number | null): string {
  return pos ? `P${pos}` : "—";
}

/** Un dato con su puesto: el puesto en rojo si es el mejor de la sesión. */
function StatCell({ label, stat, unit }: { label: string; stat: TimingStat | null; unit?: string }) {
  return (
    <div className="dd-stat">
      <span className="dd-stat-label">{label}</span>
      <span className="dd-stat-value">
        {stat ? `${stat.value}${unit ?? ""}` : "—"}
      </span>
      <span className={`dd-stat-pos ${stat?.position === 1 ? "best" : ""}`}>
        {ordinal(stat?.position ?? null)}
      </span>
    </div>
  );
}

export function DriverDetail({
  row, raceControl, laps, onClose,
}: {
  row: TimingRow;
  raceControl: RaceControlMessage[];
  laps: TimingLap[];
  onClose: () => void;
}) {
  const color = row.teamColor ?? "#888";
  const mine = raceControl.filter((m) => m.cars?.includes(row.num));
  // Todo con `?? []`: si el backend va por detrás del frontend, faltan campos y
  // una sola excepción aquí tumba el render de toda la pestaña.
  const stints = row.stints ?? [];
  const bestSectors = row.bestSectors ?? [];

  // Fuera las vueltas de boxes: la de entrada acaba en el pit lane y la de salida
  // arrastra el tiempo parado, asi que distorsionan la escala (una parada larga
  // daba "vueltas" de varios minutos y aplastaba el resto de la grafica).
  const chart = (laps ?? [])
    .filter((l) => !l.pit)
    .map((l) => ({ lap: l.lap, secs: parseLapTime(l.time), time: l.time }))
    .filter((l): l is { lap: number; secs: number; time: string } => l.secs != null);

  const totalStintLaps = stints.reduce((sum, s) => sum + Math.max(s.laps, 1), 0) || 1;

  return (
    <div className="driver-detail-card" style={{ borderTopColor: color }}>
      <div className="dd-head">
        {row.headshot && (
          <img className="dd-photo" src={row.headshot} alt="" loading="lazy" />
        )}
        <div className="dd-id">
          <div className="dd-name">{row.name ?? row.code}</div>
          <div className="dd-team" style={{ color }}>
            {row.team ?? "—"} · #{row.num}
          </div>
        </div>
        <div className="dd-pos">{row.pos ? `P${row.pos}` : "—"}</div>
        <button className="dd-close" onClick={onClose} title="Cerrar">✕</button>
      </div>

      <div className="dd-grid">
        <div className="dd-block">
          <h4>Vuelta</h4>
          <div className="dd-stat"><span className="dd-stat-label">Mejor</span>
            <span className="dd-stat-value strong">{row.best ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Última</span>
            <span className="dd-stat-value">{row.last ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Ideal</span>
            <span className="dd-stat-value">{row.idealLap ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Vueltas</span>
            <span className="dd-stat-value">{row.laps ?? "—"}</span></div>
        </div>

        <div className="dd-block">
          <h4>Mejores sectores</h4>
          {[0, 1, 2].map((i) => (
            <StatCell key={i} label={`S${i + 1}`} stat={bestSectors[i] ?? null} />
          ))}
        </div>

        <div className="dd-block">
          <h4>Velocidades</h4>
          <StatCell label="Trampa" stat={row.bestSpeeds?.ST ?? null} unit=" km/h" />
          <StatCell label="Meta" stat={row.bestSpeeds?.FL ?? null} unit=" km/h" />
          <StatCell label="Int. 1" stat={row.bestSpeeds?.I1 ?? null} unit=" km/h" />
          <StatCell label="Int. 2" stat={row.bestSpeeds?.I2 ?? null} unit=" km/h" />
        </div>
      </div>

      {stints.length > 0 && (
        <div className="dd-section">
          <h4>Estrategia</h4>
          <div className="dd-stints">
            {stints.map((s, i) => (
              <div
                key={i}
                className="dd-stint"
                style={{
                  flexGrow: Math.max(s.laps, 1) / totalStintLaps,
                  background: TYRE_COLOR[s.compound] ?? "#888",
                }}
                title={`${s.compound}${s.new === false ? " (usado)" : ""} · ${s.laps} vueltas`}
              >
                {s.compound[0]}
                <small>{s.laps}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {chart.length > 1 && (
        <div className="dd-section">
          <h4>Evolución de vueltas</h4>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <XAxis dataKey="lap" tick={{ fontSize: 10 }} stroke="#888" />
                <YAxis
                  tick={{ fontSize: 10 }} stroke="#888" domain={["dataMin - 1", "dataMax + 1"]}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <Tooltip
                  contentStyle={{ background: "#14141c", border: "1px solid #2a2a36", fontSize: 12 }}
                  labelFormatter={(l) => `Vuelta ${l}`}
                  formatter={(_v, _n, p) => [p.payload.time, "Tiempo"]}
                />
                <Line
                  type="monotone" dataKey="secs" stroke={color} strokeWidth={1.8}
                  dot={{ r: 2 }} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div className="dd-section">
          <h4>Dirección de carrera</h4>
          <ul className="dd-rcm">
            {mine.slice(0, 5).map((m, i) => (
              <li key={i}>{m.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
