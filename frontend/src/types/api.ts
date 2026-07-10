// Tipos TS espejo del contrato del backend (ver DESIGN.md, seccion 4).

export interface EventInfo {
  round: number;
  name: string;
  country: string | null;
  circuit: string | null;
  date: string | null;
}

export interface SessionInfo {
  code: string; // FP1, FP2, FP3, SQ, S, Q, R
  name: string;
  date: string | null; // ISO (UTC) de inicio, si se conoce
  upcoming: boolean; // true si la sesión aún no se ha disputado (no hay datos)
}

export interface DriverInfo {
  code: string;
  number: number | null;
  name: string;
  team: string | null;
  teamColor: string | null;
}

export interface LapInfo {
  lapNumber: number;
  lapTime: number | null;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  compound: string | null;
  tyreLife: number | null;
  stint: number | null;
  segment: string | null; // Q1/Q2/Q3 (o SQ1/SQ2/SQ3)
  isPersonalBest: boolean;
  position: number | null;
  gapToLeader: number | null;
  gapToAhead: number | null;
}

export interface Telemetry {
  distance: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  time: number[];
  x: number[];
  y: number[];
}

export interface Corner {
  x: number;
  y: number;
  number: number;
  letter: string | null;
}

export interface CircuitInfo {
  rotation: number; // grados
  corners: Corner[];
}

export interface ReplayCar {
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  x: number[];
  y: number[];
}

export interface StandingRec {
  t: number;
  lap: number;
  position: number;
  gapLeader: number;
  gapAhead: number;
  compound: string | null;
  tyreLife: number | null;
}

export interface RankEvent {
  t: number;
  num: string;
  lapTime: number;
  compound: string | null;
}

export interface LiveRankSegment {
  name: string;
  start: number;
  end: number;
  events: RankEvent[];
}

export interface FlagIntervals {
  sectorCount: number; // nº de sectores de comisarios (para repartir por el trazado)
  yellow: { sector: number; start: number; end: number }[]; // tiempo de sesión (s)
  red: { start: number; end: number }[];
}

export interface ReplayData {
  session: string;
  type: string; // race | quali | practice
  t0: number;
  dt: number;
  n: number;
  drivers: { code: string; number: number | null; team: string | null; teamColor: string | null }[];
  cars: Record<string, ReplayCar>;
  rotation: number;
  corners: Corner[];
  track: [number, number][];
  standings: Record<string, StandingRec[]>;
  pits: Record<string, { start: number; end: number }[]>; // ventanas en el pit lane (tiempo de sesión)
  retirements: string[]; // nº de pilotos que abandonaron (van al fondo de la torre)
  liveRanking: LiveRankSegment[];
  flags: FlagIntervals;
  safety: { kind: "SC" | "VSC"; start: number; end: number }[];
  rain: { start: number; end: number }[];
}


export interface WeatherSample {
  time: number;
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  windSpeed: number | null;
  rainfall: boolean | null;
}

export interface LapRef {
  year: number;
  round: number;
  session: string;
  driver: string;
  lap: number;
}

export interface CompareLap {
  label: string;
  color: string | null;
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  x: number[];
  y: number[];
}

export interface DeltaSeries {
  label: string;
  values: number[];
}

export interface CompareResponse {
  grid: number[];
  laps: CompareLap[];
  delta: DeltaSeries[];
}
