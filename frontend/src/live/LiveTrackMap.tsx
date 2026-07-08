// Mapa del circuito en vivo: contorno de la pista + una bolita por piloto en su
// posicion X/Y actual, coloreada por equipo. Rota todo (contorno, bolitas y curvas)
// con el angulo oficial del circuito para que quede orientado como en analisis.
import type { CarSample, LiveCorner, LiveDriver } from "./useLiveFeed";

interface Props {
  track: [number, number][];
  cars: Record<string, CarSample>;
  drivers: LiveDriver[];
  selected: string | null;
  onSelect: (num: string) => void;
  rotation?: number;
  corners?: LiveCorner[];
  height?: number;
  // Banderas (repeticion): tramo amarillo por sector de comisarios y roja global.
  sectorCount?: number;
  yellowSectors?: number[];
  red?: boolean;
}

const SPAN = 1000;
const PAD = 40;

export function LiveTrackMap({
  track, cars, drivers, selected, onSelect, rotation = 0, corners, height = 460,
  sectorCount = 0, yellowSectors, red = false,
}: Props) {
  const byNum = new Map(drivers.map((d) => [String(d.number), d]));

  // Rotacion (convencion de FastF1): [x*cos - y*sin, x*sin + y*cos].
  const a = (rotation * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];

  // Limites (sobre puntos ya rotados): preferimos el contorno (estable); si no, posiciones.
  const rawPts: [number, number][] =
    track.length > 0
      ? track
      : Object.values(cars)
          .filter((c) => c.x != null && c.y != null)
          .map((c) => [c.x as number, c.y as number]);

  if (rawPts.length === 0) {
    return <p className="status">Esperando posiciones… (arranca un replay o el directo)</p>;
  }

  const pts = rawPts.map(([x, y]) => rot(x, y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const scale = SPAN / Math.max(spanX, spanY);
  const vbW = spanX * scale + 2 * PAD;
  const vbH = spanY * scale + 2 * PAD;

  const px = (x: number) => PAD + (x - minX) * scale;
  const py = (y: number) => PAD + (maxY - y) * scale; // Y invertida (SVG)
  // Proyecta un punto crudo (rota + escala).
  const project = (x: number, y: number) => { const [rx, ry] = rot(x, y); return [px(rx), py(ry)] as const; };

  const trackPath = track.map(([x, y]) => { const [tx, ty] = project(x, y); return `${tx},${ty}`; }).join(" ");

  // --- Tramos de bandera amarilla ---------------------------------------
  // FastF1 no da la posicion de cada sector de comisarios, asi que repartimos los
  // N sectores uniformemente por la longitud del trazado (sector 1 arranca en meta,
  // en sentido de marcha). El resultado es aproximado en los bordes del tramo.
  const yellowPaths: string[] = [];
  if (track.length > 1 && sectorCount > 0 && yellowSectors && yellowSectors.length) {
    // Longitud acumulada (fraccion 0..1) sobre el trazado cerrado.
    const closed = [...track, track[0]];
    const fr = [0];
    for (let i = 1; i < closed.length; i++) {
      fr[i] = fr[i - 1] + Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]);
    }
    const total = fr[fr.length - 1] || 1;
    for (let i = 0; i < fr.length; i++) fr[i] /= total;

    const rawAtFrac = (f: number): [number, number] => {
      let i = 1;
      while (i < fr.length - 1 && fr[i] < f) i++;
      const seg = fr[i] - fr[i - 1] || 1;
      const k = (f - fr[i - 1]) / seg;
      return [closed[i - 1][0] + (closed[i][0] - closed[i - 1][0]) * k,
              closed[i - 1][1] + (closed[i][1] - closed[i - 1][1]) * k];
    };

    // Pintamos tambien el sector anterior: el reparto uniforme cae un pelin adelantado
    // respecto a la posicion real, y con s-1 el tramo queda encajado.
    const toDraw = new Set<number>();
    for (const s of yellowSectors) { toDraw.add(s); toDraw.add(s - 1); }
    for (const s of toDraw) {
      if (s < 1 || s > sectorCount) continue;
      const f0 = (s - 1) / sectorCount, f1 = s / sectorCount;
      const pts: [number, number][] = [rawAtFrac(f0)];
      for (let i = 0; i < fr.length; i++) if (fr[i] > f0 && fr[i] < f1) pts.push(closed[i]);
      pts.push(rawAtFrac(f1));
      yellowPaths.push(pts.map(([x, y]) => { const [tx, ty] = project(x, y); return `${tx},${ty}`; }).join(" "));
    }
  }

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", maxHeight: height, display: "block", background: "#151519", borderRadius: 8 }}>
      {track.length > 0 && (
        <polyline points={trackPath} fill="none" stroke={red ? "#e10600" : "#3a3a42"} strokeWidth={16} strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Tramos bajo bandera amarilla (ignorados si hay roja: toda la pista ya va en rojo) */}
      {!red && yellowPaths.map((pts, i) => (
        <polyline key={`y${i}`} points={pts} fill="none" stroke="#ffd400" strokeWidth={16} strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* Numeros de curva */}
      {corners?.map((c) => {
        const [cx, cy] = project(c.x, c.y);
        return (
          <g key={`${c.number}${c.letter ?? ""}`}>
            <circle cx={cx} cy={cy} r={12} fill="#22222a" stroke="#555" strokeWidth={1} />
            <text x={cx} y={cy} fill="#bbb" fontSize={13} fontWeight={600}
              textAnchor="middle" dominantBaseline="central">
              {c.number}{c.letter ?? ""}
            </text>
          </g>
        );
      })}

      {Object.entries(cars).map(([num, c]) => {
        if (c.x == null || c.y == null) return null;
        const d = byNum.get(num);
        const isSel = selected === num;
        const [cx, cy] = project(c.x, c.y);
        return (
          <g key={num} onClick={() => onSelect(num)} style={{ cursor: "pointer" }}>
            <circle
              cx={cx} cy={cy} r={isSel ? 16 : 11}
              fill={d?.teamColor ?? "#ccc"}
              stroke={isSel ? "#fff" : "#111"} strokeWidth={isSel ? 3 : 1.5}
            />
            <text
              x={cx} y={cy - (isSel ? 20 : 15)}
              fill="#eee" fontSize={isSel ? 22 : 16} fontWeight={700}
              textAnchor="middle"
            >
              {d?.code ?? num}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
