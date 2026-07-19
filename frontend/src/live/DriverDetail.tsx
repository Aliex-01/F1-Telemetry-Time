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
import { DriverHeader } from "../components/DriverHeader";
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
  row, raceControl, laps, isRace = false, onClose,
}: {
  row: TimingRow;
  raceControl: RaceControlMessage[];
  laps: TimingLap[];
  /** En carrera el hueco al líder se llama "Líder"; en quali/práctica es la
   *  diferencia con el más rápido. Lo decide `LiveTiming`, que ya lo calcula. */
  isRace?: boolean;
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
      <DriverHeader
        name={row.name ?? row.code}
        team={row.team}
        num={row.num}
        teamColor={row.teamColor}
        headshot={row.headshot}
        pos={row.pos ?? "—"}
        onClose={onClose}
      />

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

        {/* Estado en la sesion: lo que mas se mira y hasta ahora solo estaba en
            la torre. El mismo bloque existe en el reproductor, para que las dos
            vistas den la misma informacion. */}
        <div className="dd-block">
          <h4>{isRace ? "Carrera" : "Sesión"}</h4>
          <div className="dd-stat"><span className="dd-stat-label">{isRace ? "Líder" : "Dif."}</span>
            <span className="dd-stat-value">{row.gap ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Intervalo</span>
            <span className="dd-stat-value">{row.interval ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Paradas</span>
            <span className="dd-stat-value">{row.pitStops ?? "—"}</span></div>
          <div className="dd-stat"><span className="dd-stat-label">Neumático</span>
            <span className="dd-stat-value">
              {row.compound ? (
                <>
                  <span
                    className="tyre dd-tyre"
                    style={{ background: TYRE_COLOR[row.compound] ?? "#888" }}
                    title={row.compound}
                  >
                    {row.compound[0]}
                  </span>
                  {row.tyreLaps != null && <small>{row.tyreLaps} v</small>}
                  {row.tyreNew === false && <small> · usado</small>}
                </>
              ) : "—"}
            </span></div>
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
