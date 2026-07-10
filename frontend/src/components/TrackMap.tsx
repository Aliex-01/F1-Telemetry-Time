// Mapa de pista dibujado a partir de las coordenadas X/Y de la telemetria.
// Modos:
//  - "speed": una vuelta, segmentos coloreados por velocidad (azul->rojo).
//  - "plain": una o varias trazadas, cada una del color de su vuelta.
// Puede resaltar puntos (highlights) con bolitas y, opcionalmente, rotar todo con
// el angulo oficial del circuito (rotation) y anotar las curvas (corners), para que
// quede orientado como los mapas oficiales. La rotacion se aplica por igual a linea,
// bolitas y curvas, asi que todo sigue alineado.
//
// La geometria (rotar la traza, contorno, curvas) se memoiza: al mover el raton por
// las graficas solo se recalcula la bolita, no toda la pista -> movimiento fluido.
import { memo, useMemo } from "react";
import type { Corner } from "../types/api";

interface Trace {
  x: number[];
  y: number[];
  speed?: number[];
  color?: string;
  // Color por punto: pinta el trazado por segmentos (p. ej. mapa de dominancia,
  // cada tramo del color de la vuelta mas rapida ahi). Tiene prioridad sobre color.
  segColors?: string[];
}

interface Props {
  traces: Trace[];
  mode: "speed" | "plain";
  height?: number;
  lineWidth?: number;
  highlights?: { x: number; y: number; color?: string }[];
  rotation?: number; // grados; orienta el trazado como el mapa oficial
  corners?: Corner[];
}

const SPAN = 1000; // dimension mayor del circuito en unidades internas
const PAD = 40;

// Escala de color por velocidad: azul (lento) -> verde -> rojo (rapido).
function speedColor(v: number, min: number, max: number): string {
  const t = max > min ? (v - min) / (max - min) : 0.5;
  const hue = 240 - 240 * t; // 240=azul, 0=rojo
  return `hsl(${hue}, 90%, 50%)`;
}

export const TrackMap = memo(function TrackMap({
  traces, mode, height = 420, lineWidth = 4, highlights, rotation = 0, corners,
}: Props) {
  // Toda la parte cara (rotacion + bounds + contorno + curvas) se memoiza; solo depende
  // de traces/rotation/corners/mode, NO de highlights (que cambia en cada hover).
  const geo = useMemo(() => {
    if (traces.length === 0) return null;

    const a = (rotation * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];

    const rTraces = traces.map((t) => {
      const rx: number[] = [], ry: number[] = [];
      for (let i = 0; i < t.x.length; i++) {
        const [x, y] = rot(t.x[i], t.y[i]);
        rx.push(x); ry.push(y);
      }
      return { ...t, x: rx, y: ry };
    });

    const allX = rTraces.flatMap((t) => t.x);
    const allY = rTraces.flatMap((t) => t.y);
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
    const scale = SPAN / Math.max(spanX, spanY);
    const vbW = spanX * scale + 2 * PAD;
    const vbH = spanY * scale + 2 * PAD;

    const px = (x: number) => PAD + (x - minX) * scale;
    const py = (y: number) => PAD + (maxY - y) * scale;
    const project = (x: number, y: number) => { const [rx, ry] = rot(x, y); return [px(rx), py(ry)] as const; };

    // Elementos estaticos (trazas + curvas) prerrenderizados.
    const traceEls = rTraces.map((trace, ti) => {
      if (mode === "speed" && trace.speed) {
        const min = Math.min(...trace.speed);
        const max = Math.max(...trace.speed);
        return trace.x.slice(0, -1).map((_, i) => (
          <line
            key={`${ti}-${i}`}
            x1={px(trace.x[i])} y1={py(trace.y[i])}
            x2={px(trace.x[i + 1])} y2={py(trace.y[i + 1])}
            stroke={speedColor((trace.speed![i] + trace.speed![i + 1]) / 2, min, max)}
            strokeWidth={6} strokeLinecap="round"
          />
        ));
      }
      if (trace.segColors) {
        // Trazado por segmentos con un color por punto (mapa de dominancia).
        return trace.x.slice(0, -1).map((_, i) => (
          <line
            key={`${ti}-${i}`}
            x1={px(trace.x[i])} y1={py(trace.y[i])}
            x2={px(trace.x[i + 1])} y2={py(trace.y[i + 1])}
            stroke={trace.segColors![i]}
            strokeWidth={lineWidth} strokeLinecap="round"
          />
        ));
      }
      const points = trace.x.map((x, i) => `${px(x)},${py(trace.y[i])}`).join(" ");
      return (
        <polyline
          key={ti} points={points} fill="none"
          stroke={trace.color ?? "#e10600"} strokeWidth={lineWidth}
          strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.9}
        />
      );
    });

    const cornerEls = corners?.map((c) => {
      const [cx, cy] = project(c.x, c.y);
      return (
        <g key={`${c.number}${c.letter ?? ""}`}>
          <circle cx={cx} cy={cy} r={13} fill="#22222a" stroke="#555" strokeWidth={1} />
          <text x={cx} y={cy} fill="#ddd" fontSize={14} fontWeight={600}
            textAnchor="middle" dominantBaseline="central">
            {c.number}{c.letter ?? ""}
          </text>
        </g>
      );
    });

    return { vbW, vbH, project, traceEls, cornerEls };
  }, [traces, rotation, corners, mode, lineWidth]);

  if (!geo) return null;

  return (
    <svg
      viewBox={`0 0 ${geo.vbW} ${geo.vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", maxHeight: height, display: "block", background: "#151519", borderRadius: 8 }}
    >
      {geo.traceEls}
      {geo.cornerEls}

      {/* Bolitas de posicion (unico elemento dinamico en cada hover). */}
      {highlights?.map((h, i) => {
        const [hx, hy] = geo.project(h.x, h.y);
        return (
          <circle key={i} cx={hx} cy={hy} r={14}
            fill={h.color ?? "#e10600"} stroke="#fff" strokeWidth={3} />
        );
      })}
    </svg>
  );
});
