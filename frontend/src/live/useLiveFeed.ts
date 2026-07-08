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

const HISTORY_LEN = 150; // puntos guardados para el grafico deslizante

export function useLiveFeed(selectedDriverNum: string | null) {
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [frame, setFrame] = useState<{ t: number; cars: Record<string, CarSample> } | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const selectedRef = useRef(selectedDriverNum);
  selectedRef.current = selectedDriverNum;

  useEffect(() => {
    const ws = new WebSocket(getWsUrl());
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
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
      } else if (msg.type === "end") {
        setFrame(null);
      }
    };
    return () => ws.close();
  }, []);

  // Al cambiar de piloto seleccionado, reiniciamos su historial.
  useEffect(() => {
    setHistory([]);
  }, [selectedDriverNum]);

  return { connected, meta, frame, history };
}
