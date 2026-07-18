// Hook que se conecta al WebSocket de tiempo real y mantiene el estado en vivo:
// metadatos (pilotos), ultimo frame de todos los coches, e historial del piloto
// seleccionado para el grafico deslizante.
import { useEffect, useRef, useState } from "react";
import { getWsUrl } from "../api/client";

export interface CarSample {
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  pos?: number;
  x?: number;
  y?: number;
}

export interface LiveDriver {
  code: string;
  number: number | null;
  team: string | null;
  teamColor: string | null;
}

export interface LiveCorner {
  x: number;
  y: number;
  number: number;
  letter: string | null;
}

export interface LiveMeta {
  kind: string;
  session: string;
  drivers: LiveDriver[];
  track: [number, number][];
  rotation: number;
  corners: LiveCorner[];
}

export interface HistoryPoint extends CarSample {
  t: number;
}

/** Color de un mini-sector: mejor de sesión, mejor personal, más lento o boxes. */
export type SegmentColor = "purple" | "green" | "yellow" | "pit" | null;

export interface TimingSector {
  value: string | null;
  personalFastest: boolean;
  overallFastest: boolean;
  segments: SegmentColor[];
}

/** Un valor con su puesto en el ranking de la sesión (de TimingStats). */
export interface TimingStat {
  value: string;
  position: number | null;
}

export interface TimingStint {
  compound: string;
  laps: number;
  new: boolean | null;
}

export interface TimingLap {
  lap: number;
  time: string;
  /** Vuelta de entrada o salida de boxes: no representa el ritmo real, porque
   *  acaba en el pit lane o arrastra el tiempo parado. Se excluye de la gráfica.
   *  Opcional: un backend anterior a este campo no lo manda. */
  pit?: boolean;
}

/** Mensaje de dirección de carrera (banderas, tiempos borrados, sanciones…). */
export interface RaceControlMessage {
  utc: string | null;
  category: string | null;
  message: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  lap: number | null;
  /** Números de coche citados en el mensaje ("CAR 87 (BEA)" → ["87"]). */
  cars: string[];
}

export interface LiveWeather {
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  rainfall: boolean;
}

/** Una fila de la torre de tiempos en vivo (cronometraje, sin telemetria). */
export interface TimingRow {
  num: string;
  code: string;
  /** Nombre completo y foto oficial (de DriverList), para el panel del piloto. */
  name: string | null;
  headshot: string | null;
  team: string | null;
  teamColor: string | null;
  pos: number;
  gap: string | null;
  interval: string | null;
  last: string | null;
  lastPersonalBest: boolean;
  lastOverallBest: boolean;
  best: string | null;
  sectors: TimingSector[];
  laps: number | null;
  pitStops: number | null;
  inPit: boolean;
  pitOut: boolean;
  retired: boolean;
  stopped: boolean;
  knockedOut: boolean;
  compound: string | null;
  tyreLaps: number | null;
  tyreNew: boolean | null;
  // --- detalle del piloto ---
  /** Historial completo de neumáticos de la sesión. */
  stints: TimingStint[];
  /** Mejor S1/S2/S3 de la sesión con su puesto. */
  bestSectors: (TimingStat | null)[];
  /** Suma de sus mejores sectores. */
  idealLap: string | null;
  /** I1/I2 intermedios, FL meta, ST trampa de velocidad. */
  bestSpeeds: Record<"I1" | "I2" | "FL" | "ST", TimingStat | null>;
}

/** Vueltas cronometradas por piloto. Llega en su propio mensaje (`laps`) y más
 *  espaciado que la torre: crece toda la sesión y reenviarlo a 2 Hz dispara el
 *  ancho de banda. */
export type LapHistory = Record<string, TimingLap[]>;

export interface TimingSession {
  name: string | null;
  type: string | null;
  meeting: string | null;
  status: string | null;
  remaining: string | null;
  /** El reloj corre: hay que descontarlo en local (el feed no lo refresca cada segundo).
   *  Opcional: un backend anterior a este campo no lo manda. */
  extrapolating?: boolean;
  trackStatus: string | null;
  lap: number | null;
  totalLaps: number | null;
  /** Parte de la clasificacion (1, 2 o 3). `null` fuera de clasificacion.
   *  El feed no la publica: se deduce del recuento de eliminados. */
  part?: number | null;
}

export interface LiveTiming {
  session: TimingSession;
  rows: TimingRow[];
  weather: LiveWeather | null;
  raceControl: RaceControlMessage[];
  /** `Date.now()` de cuando **llegó** el mensaje, no de cuando se aplicó.
   *  Con retraso activo hay minutos de diferencia entre ambos: el reloj debe
   *  descontar desde este instante para quedar retrasado como la torre. */
  recvAt: number;
}

const HISTORY_LEN = 150; // puntos guardados para el grafico deslizante

/** Mensaje del WebSocket: es JSON dinámico (varios `type`), lo tratamos laxo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveMsg = any;

/** Cada cuánto revisamos la cola de mensajes retrasados. */
const DRAIN_MS = 100;
/** Tope de retraso, y por tanto de lo que llegamos a guardar en memoria. */
export const MAX_DELAY_SECS = 180;

/**
 * Conexión al directo, con **retraso opcional**.
 *
 * El cronometraje oficial va por delante de cualquier emisión de TV, así que la
 * página "destripa" lo que aún no has visto. Con `delaySecs` los mensajes pasan
 * por una cola y no se aplican hasta que han cumplido ese tiempo, de forma que
 * la pantalla queda sincronizada con tu stream.
 *
 * El retraso va aquí, en el navegador, y no en el backend: es cosa de cada
 * espectador (cada stream lleva su propio retardo) y así un feed sirve a todos.
 *
 * El reloj de la sesión se ajusta solo: cada mensaje trae el tiempo restante que
 * era cierto cuando se emitió, y `useCountdown` empieza a descontarlo cuando lo
 * aplicamos. Retrasar el mensaje retrasa el reloj en la misma medida.
 */
export function useLiveFeed(selectedDriverNum: string | null, delaySecs = 0) {
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [frame, setFrame] = useState<{ t: number; cars: Record<string, CarSample> } | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [timing, setTiming] = useState<LiveTiming | null>(null);
  const [lapHistory, setLapHistory] = useState<LapHistory>({});

  const selectedRef = useRef(selectedDriverNum);
  selectedRef.current = selectedDriverNum;
  // Mensajes recibidos que aún no toca mostrar, con la hora en que llegaron.
  const queue = useRef<{ at: number; msg: LiveMsg }[]>([]);
  const delayRef = useRef(delaySecs);
  delayRef.current = delaySecs;

  useEffect(() => {
    const apply = (msg: LiveMsg, recvAt: number) => {
      if (msg.type === "meta") {
        setMeta({
          kind: msg.kind, session: msg.session, drivers: msg.drivers,
          track: msg.track ?? [], rotation: msg.rotation ?? 0, corners: msg.corners ?? [],
        });
        setHistory([]);
      } else if (msg.type === "frame") {
        setFrame({ t: msg.t, cars: msg.cars });
        const sel = selectedRef.current;
        if (sel && msg.cars[sel]) {
          setHistory((prev) => {
            const next = [...prev, { t: msg.t, ...msg.cars[sel] }];
            return next.length > HISTORY_LEN ? next.slice(-HISTORY_LEN) : next;
          });
        }
      } else if (msg.type === "timing") {
        setTiming({
          session: msg.session, rows: msg.rows,
          weather: msg.weather ?? null, raceControl: msg.raceControl ?? [],
          recvAt,
        });
      } else if (msg.type === "laps") {
        setLapHistory(msg.history ?? {});
      } else if (msg.type === "end") {
        setFrame(null);
      }
    };

    const ws = new WebSocket(getWsUrl());
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg: LiveMsg = JSON.parse(ev.data);
      const at = Date.now();
      // Sin retraso: aplicamos al momento. Con retraso: a la cola de espera.
      // En ambos casos `at` es la hora de llegada, que viaja con el mensaje para
      // que el reloj descuente desde ahí y no desde el momento de aplicarlo.
      if (delayRef.current <= 0) apply(msg, at);
      else queue.current.push({ at, msg });
    };

    // Vaciamos lo que ya ha "cumplido" su retraso. Se revisa siempre (no solo
    // con retraso activo) para poder vaciar de golpe si lo bajas a 0.
    const drain = setInterval(() => {
      const cutoff = Date.now() - delayRef.current * 1000;
      const q = queue.current;
      while (q.length && q[0].at <= cutoff) {
        const item = q.shift()!;
        apply(item.msg, item.at);
      }
    }, DRAIN_MS);

    return () => {
      clearInterval(drain);
      ws.close();
    };
  }, []);

  // Al cambiar de piloto seleccionado, reiniciamos su historial.
  useEffect(() => {
    setHistory([]);
  }, [selectedDriverNum]);

  return { connected, meta, frame, history, timing, lapHistory };
}
