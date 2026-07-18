// Dos paneles laterales del directo, ambos con datos que el feed da gratis:
// los mensajes de direccion de carrera y la meteo en vivo.
import { IconRain, IconSun } from "../components/icons";
import type { LiveWeather, RaceControlMessage } from "./useLiveFeed";

/** Los mensajes traen la hora en UTC; la pasamos a la hora local. */
function hhmm(utc: string | null): string {
  if (!utc) return "";
  // El feed manda "2026-07-17T12:07:56" sin zona: es UTC.
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : `${utc}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Colorea el mensaje según lo que anuncia. */
function toneOf(m: RaceControlMessage): string {
  const flag = (m.flag ?? "").toUpperCase();
  const text = m.message.toUpperCase();
  if (flag === "RED" || text.includes("RED FLAG")) return "red";
  if (flag.includes("YELLOW") || text.includes("YELLOW")) return "yellow";
  if (flag === "CHEQUERED" || text.includes("CHEQUERED")) return "chequered";
  if (text.includes("DELETED") || text.includes("PENALTY") || text.includes("INVESTIGAT")) {
    return "warn";
  }
  if (text.includes("CLEAR") || flag === "GREEN") return "green";
  return "";
}

export function RaceControlPanel({ messages }: { messages: RaceControlMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="rc-panel">
      <div className="rc-head">Dirección de carrera</div>
      <ul className="rc-list">
        {messages.map((m, i) => (
          <li key={`${m.utc}-${i}`} className={`rc-item ${toneOf(m)}`}>
            <span className="rc-time">{hhmm(m.utc)}</span>
            <span className="rc-msg">{m.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LiveWeatherPanel({ weather }: { weather: LiveWeather | null }) {
  if (!weather) return null;
  const val = (n: number | null, unit: string, digits = 1) =>
    n == null ? "—" : `${n.toFixed(digits)}${unit}`;
  return (
    <div className="lw-panel">
      <span className="lw-icon">
        {weather.rainfall ? <IconRain size={14} /> : <IconSun size={14} />}
      </span>
      <span><b>Aire</b> {val(weather.airTemp, "°")}</span>
      <span><b>Pista</b> {val(weather.trackTemp, "°")}</span>
      <span><b>Humedad</b> {val(weather.humidity, "%")}</span>
      <span><b>Viento</b> {val(weather.windSpeed, " m/s")}</span>
      {weather.rainfall && <span className="lw-rain">Lluvia</span>}
    </div>
  );
}
