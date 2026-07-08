// Cliente tipado de la API del backend.
// El puerto oficial del backend en dev es 8080 (ver DESIGN.md).
import type {
  CircuitInfo,
  CompareResponse,
  DriverInfo,
  EventInfo,
  LapInfo,
  LapRef,
  ReplayData,
  SessionInfo,
  Telemetry,
  WeatherSample,
} from "../types/api";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080/api";

// URL del WebSocket de tiempo real (deriva del BASE http -> ws).
export const WS_URL = BASE.replace(/^http/, "ws") + "/live/ws";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  seasons: () => get<number[]>("/seasons"),
  events: (year: number) => get<EventInfo[]>(`/${year}/events`),
  sessions: (year: number, round: number) =>
    get<SessionInfo[]>(`/${year}/${round}/sessions`),
  drivers: (year: number, round: number, session: string) =>
    get<DriverInfo[]>(`/${year}/${round}/${session}/drivers`),
  laps: (year: number, round: number, session: string, driver: string) =>
    get<LapInfo[]>(`/${year}/${round}/${session}/${driver}/laps`),
  telemetry: (
    year: number,
    round: number,
    session: string,
    driver: string,
    lap: number,
  ) =>
    get<Telemetry>(
      `/${year}/${round}/${session}/${driver}/lap/${lap}/telemetry`,
    ),
  weather: (year: number, round: number, session: string) =>
    get<WeatherSample[]>(`/${year}/${round}/${session}/weather`),
  circuit: (year: number, round: number, session: string) =>
    get<CircuitInfo>(`/${year}/${round}/${session}/circuit`),
  replay: (year: number, round: number, session: string) =>
    get<ReplayData>(`/${year}/${round}/${session}/replay`),
  // Precalienta la telemetria de la sesion en el backend (prefetch en segundo plano).
  prefetch: (year: number, round: number, session: string) =>
    post<{ warmed: boolean }>(`/${year}/${round}/${session}/prefetch`, {}),
  compare: async (laps: LapRef[]): Promise<CompareResponse> => {
    const res = await fetch(`${BASE}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ laps }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<CompareResponse>;
  },

  // ---- tiempo real (directo) ----
  liveStart: () => post<{ started: string }>("/live/live/start", {}),
  liveStop: () => post<{ stopped: boolean }>("/live/stop", {}),
};
