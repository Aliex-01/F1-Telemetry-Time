// Comparacion de varias vueltas: canales superpuestos + delta acumulado.
// Todo alineado por distancia (ver DESIGN.md).
import { memo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompareResponse } from "../types/api";

interface Props {
  data: CompareResponse;
  colors: string[];
  // Reporta el indice (sobre la rejilla comun) del punto bajo el raton, o null.
  onHover?: (index: number | null) => void;
}

type Channel = { key: "speed" | "throttle" | "brake" | "gear"; label: string; domain?: [number, number] };

const CHANNELS: Channel[] = [
  { key: "speed", label: "Velocidad (km/h)" },
  { key: "throttle", label: "Acelerador (%)", domain: [0, 100] },
  { key: "brake", label: "Freno (%)", domain: [0, 100] },
  { key: "gear", label: "Marcha", domain: [0, 8] },
];

export const CompareChart = memo(function CompareChart({ data, colors, onHover }: Props) {
  const { grid, laps, delta } = data;

  const hoverProps = {
    onMouseMove: (s: { activeTooltipIndex?: number | string | null }) => {
      if (onHover && s && s.activeTooltipIndex != null) onHover(Number(s.activeTooltipIndex));
    },
    onMouseLeave: () => onHover?.(null),
  };

  // Construye un array de puntos para un canal: {distance, <label>: valor, ...}.
  const buildChannelData = (key: Channel["key"]) =>
    grid.map((d, i) => {
      const row: Record<string, number> = { distance: Math.round(d) };
      laps.forEach((lap) => {
        row[lap.label] = lap[key][i];
      });
      return row;
    });

  const deltaData = grid.map((d, i) => {
    const row: Record<string, number> = { distance: Math.round(d) };
    delta.forEach((series) => {
      row[series.label] = series.values[i];
    });
    return row;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {CHANNELS.map((ch) => (
        <div key={ch.key} className="tele-chart" style={{ height: ch.key === "speed" ? 232 : 142 }}>
          <div className="tele-chart-title">{ch.label}</div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={buildChannelData(ch.key)} margin={{ top: 4, right: 16, bottom: 4, left: 0 }} {...hoverProps}>
              <defs>
                {/* Glow suave por vuelta (contenido: hay varias lineas superpuestas). */}
                {laps.map((lap, j) => (
                  <filter key={lap.label} id={`cmp-glow-${ch.key}-${j}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation="1.6" floodColor={lap.color ?? colors[j % colors.length]} floodOpacity="0.35" />
                  </filter>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="distance" unit=" m" tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} minTickGap={40} />
              <YAxis domain={ch.domain ?? ["auto", "auto"]} tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={false} width={40} />
              <Tooltip labelFormatter={(v) => `${v} m`} formatter={(val) => `${Math.round(Number(val))}`} cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }} />
              {laps.map((lap, j) => (
                <Line
                  key={lap.label}
                  type={ch.key === "gear" ? "stepAfter" : "monotone"}
                  dataKey={lap.label}
                  stroke={lap.color ?? colors[j % colors.length]}
                  dot={false}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `url(#cmp-glow-${ch.key}-${j})` }}
                  activeDot={{ r: 3.5, stroke: "#fff", strokeWidth: 1.5, filter: `url(#cmp-glow-${ch.key}-${j})` }}
                  // Trazado progresivo al recomponer la comparacion. No se re-dispara
                  // en el hover (componente memoizado, onHover estable).
                  isAnimationActive={true}
                  animationDuration={1000}
                  animationEasing="ease-out"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}

      {/* Delta acumulado vs. la primera vuelta (referencia). + = mas lento. */}
      <div className="tele-chart" style={{ height: 180 }}>
        <div className="tele-chart-title">
          Delta (s) vs. {laps[0]?.label} <em>— positivo = más lento</em>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={deltaData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }} {...hoverProps}>
            <defs>
              {/* Relleno tenue bajo cada delta (deja leer de un vistazo donde se saca ventaja). */}
              {delta.map((series, j) => {
                const c = laps[j + 1]?.color ?? colors[(j + 1) % colors.length];
                return (
                  <linearGradient key={series.label} id={`cmp-delta-grad-${j}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="distance" unit=" m" tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} minTickGap={40} />
            <YAxis tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={false} width={40} />
            <Tooltip labelFormatter={(v) => `${v} m`} formatter={(val) => `${Number(val).toFixed(3)} s`} cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
            {delta.map((series, j) => (
              <Area
                key={series.label}
                type="monotone"
                dataKey={series.label}
                // El delta j corresponde a la vuelta j+1 (la 0 es la referencia).
                stroke={laps[j + 1]?.color ?? colors[(j + 1) % colors.length]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#cmp-delta-grad-${j})`}
                fillOpacity={1}
                dot={false}
                activeDot={{ r: 3.5, stroke: "#fff", strokeWidth: 1.5 }}
                isAnimationActive={true}
                animationDuration={1000}
                animationEasing="ease-out"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
