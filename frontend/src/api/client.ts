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

// La URL del backend se resuelve en tiempo de ejecucion para poder desplegar el
// frontend estatico (Cloudflare Pages) y apuntarlo a un backend con URL cambiante
// (tunel). Prioridad: lo guardado en el navegador -> VITE_API_BASE (build) -> localhost.
const LS_KEY = "f1_api_base";
const ENV_BASE = import.meta.env.VITE_API_BASE as string | undefined;
const DEFAULT_BASE = "http://127.0.0.1:8080/api";

// Normaliza: quita barras finales y garantiza el sufijo /api.
function normalize(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/\/api$/.test(u)) u += "/api";
  return u;
}

/** URL base efectiva de la API (ya normalizada con /api). */
export function getApiBase(): string {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  return normalize(stored || ENV_BASE || DEFAULT_BASE);
}

/** Lo que el usuario guardo manualmente (vacio si no ha configurado nada). */
export function getStoredApiBase(): string {
  return (typeof localStorage !== "undefined" && localStorage.getItem(LS_KEY)) || "";
}

/** Guarda (o borra, si se pasa vacio) la URL del backend en el navegador. */
export function setApiBase(url: string): void {
  const v = url.trim();
  if (v) localStorage.setItem(LS_KEY, v);
  else localStorage.removeItem(LS_KEY);
}

/** URL del WebSocket de tiempo real (deriva del base http -> ws). */
export function getWsUrl(): string {
  return getApiBase().replace(/^http/, "ws") + "/live/ws";
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`);
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
    const res = await fetch(`${getApiBase()}/compare`, {
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
