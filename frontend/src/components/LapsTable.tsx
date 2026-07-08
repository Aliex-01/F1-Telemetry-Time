// Tabla de vueltas de un piloto: tiempo, sectores, neumatico y stint.
// Al hacer clic en una fila se selecciona esa vuelta.
import type { LapInfo } from "../types/api";

interface Props {
  laps: LapInfo[];
  selected: number | null;
  onSelect: (lapNumber: number) => void;
}

function fmt(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3);
  return m > 0 ? `${m}:${rest.padStart(6, "0")}` : rest;
}

// Colores por compuesto de neumatico (codigo oficial F1).
const TYRE_COLOR: Record<string, string> = {
  SOFT: "#ff3333",
  MEDIUM: "#ffdd00",
  HARD: "#eeeeee",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};

export function LapsTable({ laps, selected, onSelect }: Props) {
  if (laps.length === 0) return null;

  return (
    <div className="laps-table">
      <table>
        <thead>
          <tr>
            <th>Vuelta</th>
            <th>Fase</th>
            <th>Tiempo</th>
            <th>S1</th>
            <th>S2</th>
            <th>S3</th>
            <th title="Neumático">Neu.</th>
            <th>Vida</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((l) => (
            <tr
              key={l.lapNumber}
              className={l.lapNumber === selected ? "sel" : ""}
              onClick={() => onSelect(l.lapNumber)}
            >
              <td>L{l.lapNumber}</td>
              <td>{l.segment ?? ""}</td>
              <td className={l.isPersonalBest ? "pb" : ""}>
                {fmt(l.lapTime)} {l.isPersonalBest ? "⚡" : ""}
              </td>
              <td>{fmt(l.sector1)}</td>
              <td>{fmt(l.sector2)}</td>
              <td>{fmt(l.sector3)}</td>
              <td>
                {l.compound ? (
                  <span
                    className="tyre"
                    style={{ background: TYRE_COLOR[l.compound] ?? "#888" }}
                    title={l.compound}
                  >
                    {l.compound[0]}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>{l.tyreLife != null ? Math.round(l.tyreLife) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
