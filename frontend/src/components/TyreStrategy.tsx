// Estrategia de neumaticos del piloto seleccionado: una barra horizontal con los
// stints (tramos con el mismo compuesto), de ancho proporcional a su nº de vueltas.
import { useMemo } from "react";
import type { LapInfo } from "../types/api";

// Colores oficiales por compuesto (mismo criterio que la tabla de vueltas).
const TYRE_COLOR: Record<string, string> = {
  SOFT: "#ff3333",
  MEDIUM: "#ffdd00",
  HARD: "#eeeeee",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};

interface Props {
  laps: LapInfo[];
}

type Stint = { stint: number | null; compound: string | null; from: number; to: number; count: number };

export function TyreStrategy({ laps }: Props) {
  const stints = useMemo(() => {
    const out: Stint[] = [];
    for (const l of laps) {
      const last = out[out.length - 1];
      // Un stint nuevo empieza al cambiar de nº de stint o de compuesto.
      if (last && l.stint === last.stint && l.compound === last.compound) {
        last.to = l.lapNumber;
        last.count++;
      } else {
        out.push({ stint: l.stint, compound: l.compound, from: l.lapNumber, to: l.lapNumber, count: 1 });
      }
    }
    return out;
  }, [laps]);

  const total = stints.reduce((s, x) => s + x.count, 0);
  if (total === 0) return null;

  return (
    <div className="tyre-strategy">
      <div className="track-title">Estrategia de neumáticos</div>
      <div className="tyre-bar">
        {stints.map((s, i) => (
          <div
            key={i}
            className="tyre-seg"
            style={{ flexGrow: s.count, background: TYRE_COLOR[s.compound ?? ""] ?? "#888" }}
            title={`${s.compound ?? "?"} · vueltas ${s.from}–${s.to} (${s.count})`}
          >
            <span>{s.compound?.[0] ?? "?"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
