// Panel de meteorologia de la sesion: resumen (temperaturas, humedad, viento, lluvia)
// y evolucion de las temperaturas de aire y pista a lo largo de la sesion.
import { memo, useEffect, useState } from "react";
import { IconRain, IconSun } from "./icons";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { WeatherSample } from "../types/api";
import { ProgressBar } from "./ProgressBar";

interface Props {
  year: number;
  round: number;
  session: string;
}

function avg(nums: number[]): number | null {
  const v = nums.filter((n) => n != null && !Number.isNaN(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="weather-stat">
      <span className="weather-stat-label">{label}</span>
      <span className="weather-stat-value" style={accent ? { color: accent } : undefined}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export const WeatherPanel = memo(function WeatherPanel({ year, round, session }: Props) {
  const [data, setData] = useState<WeatherSample[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    let alive = true;
    api.weather(year, round, session)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [year, round, session]);

  if (error) return null;
  if (!data) return <div className="weather"><ProgressBar label="Cargando meteorología…" /></div>;
  if (data.length === 0) return null;

  const airAvg = avg(data.map((d) => d.airTemp ?? NaN));
  const trackAvg = avg(data.map((d) => d.trackTemp ?? NaN));
  const humAvg = avg(data.map((d) => d.humidity ?? NaN));
  const windMax = Math.max(...data.map((d) => d.windSpeed ?? 0));
  const rained = data.some((d) => d.rainfall);

  // Serie para el grafico: minuto de sesion -> aire / pista.
  const chart = data.map((d) => ({
    min: Math.round(d.time / 60),
    air: d.airTemp,
    track: d.trackTemp,
  }));

  // Intervalos de lluvia (minutos) a partir de muestras contiguas con rainfall=true.
  const rawIntervals: [number, number][] = [];
  let rainStart: number | null = null;
  data.forEach((d, i) => {
    const min = d.time / 60;
    if (d.rainfall && rainStart === null) rainStart = min;
    else if (!d.rainfall && rainStart !== null) { rawIntervals.push([rainStart, min]); rainStart = null; }
    if (i === data.length - 1 && rainStart !== null) rawIntervals.push([rainStart, min]);
  });
  // Fusiona intervalos separados por menos de 2 min (evita fragmentacion por ruido).
  const rainIntervals: [number, number][] = [];
  for (const [a, b] of rawIntervals) {
    const last = rainIntervals[rainIntervals.length - 1];
    if (last && a - last[1] <= 2) last[1] = b;
    else rainIntervals.push([a, b]);
  }

  // Rango de tiempo de la sesion (para posicionar la franja de lluvia).
  const minMin = data[0].time / 60;
  const maxMin = data[data.length - 1].time / 60;
  const span = maxMin - minMin || 1;

  return (
    <div className="weather">
      <div className="weather-head">
        <h3>Meteorología</h3>
        <span className={`weather-badge ${rained ? "wet" : "dry"}`}>
          {rained ? <><IconRain size={13} /> Lluvia</> : <><IconSun size={13} /> Seco</>}
        </span>
      </div>

      <div className="weather-stats">
        <Stat label="Aire" value={airAvg != null ? airAvg.toFixed(1) : "—"} unit="°C" accent="#ff9100" />
        <Stat label="Pista" value={trackAvg != null ? trackAvg.toFixed(1) : "—"} unit="°C" accent="#e10600" />
        <Stat label="Humedad" value={humAvg != null ? humAvg.toFixed(0) : "—"} unit="%" accent="#2f7bff" />
        <Stat label="Viento máx" value={windMax.toFixed(1)} unit=" m/s" accent="#00c853" />
      </div>

      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="grad-track" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e10600" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#e10600" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-air" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff9100" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#ff9100" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="min" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} unit=" min" tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} minTickGap={40} />
            <YAxis tick={{ fontSize: 11, fill: "#8a8f9c" }} tickLine={false} axisLine={false} width={38} unit="°" />
            <Tooltip labelFormatter={(v) => `min ${v}`} formatter={(val, name) => [`${Number(val).toFixed(1)} °C`, name === "air" ? "Aire" : "Pista"]} cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }} />
            <Area type="monotone" dataKey="track" stroke="#e10600" strokeWidth={2} fill="url(#grad-track)" fillOpacity={1} dot={false} activeDot={{ r: 3.5, stroke: "#fff", strokeWidth: 1.5 }} isAnimationActive={false} />
            <Area type="monotone" dataKey="air" stroke="#ff9100" strokeWidth={2} fill="url(#grad-air)" fillOpacity={1} dot={false} activeDot={{ r: 3.5, stroke: "#fff", strokeWidth: 1.5 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {rainIntervals.length > 0 && (
        <div className="rain-strip">
          <span className="rain-strip-label"><IconRain size={12} /> Lluvia</span>
          {/* La pista se alinea con el area de trazado (offset del eje Y + margen dcho.) */}
          <div className="rain-track">
            {rainIntervals.map(([a, b], i) => (
              <div
                key={i}
                className="rain-seg"
                style={{ left: `${((a - minMin) / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
                title={`Lluvia · min ${Math.round(a)}–${Math.round(b)}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
