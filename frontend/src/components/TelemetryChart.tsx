// Gráficos de telemetría de una vuelta, todos alineados por distancia.
import { memo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Telemetry } from "../types/api";

interface Props {
  telemetry: Telemetry;
  // Reporta el indice del punto sobre el que esta el raton (o null al salir),
  // para sincronizar la bolita del mapa de pista.
  onHover?: (index: number | null) => void;
}

type Channel = {
  key: keyof Telemetry;
  label: string;
  color: string;
  unit: string;
  domain?: [number, number];
};

const CHANNELS: Channel[] = [
  { key: "speed", label: "Velocidad", color: "#e10600", unit: "km/h" },
  { key: "throttle", label: "Acelerador", color: "#00c853", unit: "%", domain: [0, 100] },
  { key: "brake", label: "Freno", color: "#2962ff", unit: "%", domain: [0, 100] },
  { key: "gear", label: "Marcha", color: "#aa00ff", unit: "", domain: [0, 8] },
  { key: "rpm", label: "RPM", color: "#ff9100", unit: "" },
  { key: "drs", label: "DRS (abierto)", color: "#00e5ff", unit: "", domain: [0, 1] },
];

export const TelemetryChart = memo(function TelemetryChart({ telemetry, onHover }: Props) {
  // Un único array de puntos {distance, speed, throttle, ...} para todos los charts.
  // Codigos DRS de FastF1: 10/12/14 = abierto; 0/1/8 = cerrado -> lo pasamos a 0/1.
  const data = telemetry.distance.map((d, i) => ({
    distance: Math.round(d),
    speed: telemetry.speed[i],
    throttle: telemetry.throttle[i],
    brake: telemetry.brake[i],
    gear: telemetry.gear[i],
    rpm: telemetry.rpm[i],
    drs: telemetry.drs[i] >= 10 ? 1 : 0,
  }));

  // Oculta el canal DRS si esta plano a 0 (p. ej. temporada 2026, ya no hay DRS).
  const drsActive = telemetry.drs.some((v) => v >= 10);
  const channels = CHANNELS.filter((ch) => ch.key !== "drs" || drsActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {channels.map((ch) => (
        <div key={ch.key} className="tele-chart" style={{ height: ch.key === "speed" ? 232 : 132 }}>
          <div className="tele-chart-title" style={{ color: ch.color }}>
            <span className="tele-dot" style={{ background: ch.color }} />
            {ch.label} {ch.unit && <em>({ch.unit})</em>}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
              onMouseMove={(s: { activeTooltipIndex?: number | null }) => {
                if (onHover && s && s.activeTooltipIndex != null) onHover(s.activeTooltipIndex);
              }}
              onMouseLeave={() => onHover?.(null)}
            >
              <defs>
                <linearGradient id={`grad-${ch.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ch.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ch.color} stopOpacity={0} />
                </linearGradient>
                {/* Glow sutil del color del canal, estilo pantalla de pit-wall. */}
                <filter id={`glow-${ch.key}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={ch.color} floodOpacity="0.55" />
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="distance"
                unit=" m"
                tick={{ fontSize: 11, fill: "#8a8f9c" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                minTickGap={40}
              />
              <YAxis
                domain={ch.domain ?? ["auto", "auto"]}
                tick={{ fontSize: 11, fill: "#8a8f9c" }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                labelFormatter={(v) => `${v} m`}
                formatter={(val: number) => [`${val} ${ch.unit}`, ch.label]}
                cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
              />
              <Area
                type={ch.key === "gear" || ch.key === "drs" ? "stepAfter" : "monotone"}
                dataKey={ch.key}
                stroke={ch.color}
                // Velocidad (protagonista) con trazo mas grueso que los canales secundarios.
                strokeWidth={ch.key === "speed" ? 2.5 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#grad-${ch.key})`}
                fillOpacity={1}
                dot={false}
                style={{ filter: `url(#glow-${ch.key})` }}
                // Punto activo con halo del color del canal + nucleo con borde blanco.
                activeDot={{ r: 4, fill: ch.color, stroke: "#fff", strokeWidth: 1.5, filter: `url(#glow-${ch.key})` }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
});
