// Rejilla comparativa de micro-sectores: una fila por piloto con su mejor vuelta
// troceada por distancia. De un vistazo se ve quien gana tiempo en que parte del
// circuito, algo que la torre de tiempos (un solo numero por vuelta) no muestra.
//
// Cada fila lleva dos bandas: arriba los micro-tramos finos y abajo la barra
// agrupada por sector, para leer el detalle y el resumen a la vez.
import { useMemo } from "react";
import { TYRE_COLOR } from "./tyres";
import type { MicroSectorRow } from "../types/api";

/** Lo mínimo que necesita la rejilla para pintar cada fila. Se pide así, y no
 *  `DriverInfo`, para aceptar también los pilotos que vienen en `ReplayData`
 *  (que no traen `name`). */
type GridDriver = {
  code: string;
  number: number | null;
  teamColor: string | null;
};

/** Morado = mejor de todos, verde = a menos de una decima, amarillo = mas lento.
 *  Mismo codigo de color que la torre en vivo. */
const BEST = "#b14bdb";
const CLOSE = "#00c853";
const SLOW = "#ffdd00";

/**
 * Color de un tramo/sector comparado con el mejor de su columna.
 *
 * `isBest` decide el morado, y lo decide QUIEN llama: es exclusivo del piloto
 * que tiene el mejor tiempo de esa columna, no de todo el que iguale el minimo.
 * Comparando solo valores, cuando varios pilotos van a la vez cada uno mejoraba
 * al anterior y el mínimo de ese instante siempre lo poseia alguien que ya se
 * habia pintado morado: la rejilla acababa entera morada (ver captura del bug).
 * Al perder el mejor tiempo se degrada a verde -si sigue a menos de una decima-
 * o amarillo, como en el cronometraje oficial.
 */
function colorFor(value: number | null, best: number | null, isBest = false): string {
  if (value == null || best == null) return "var(--surface-3)";
  if (isBest) return BEST;
  return value - best <= 0.1 ? CLOSE : SLOW;
}

function fmtLap(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function MicroSectorGrid({
  rows,
  reference,
  drivers,
  now,
}: {
  rows: MicroSectorRow[];
  /** Todas las vueltas de la tanda, de donde sale el mejor de cada columna. Se
   *  pasa aparte de `rows` porque el morado sigue la convención de la F1 —el más
   *  rápido de la tanda— y no "el mejor de los que están rodando ahora": con solo
   *  las filas visibles el color cambiaba según quién estuviera en pista. Si no
   *  se pasa, se comparan las filas entre sí. */
  reference?: MicroSectorRow[];
  drivers: GridDriver[];
  /** Instante del reproductor (s de sesión). Los tramos que el coche aún no ha
   *  recorrido se pintan apagados, para que se vea el avance de la vuelta. */
  now?: number;
}) {
  // Las vueltas contra las que se compara. Solo cuentan las ya terminadas: una
  // en curso tiene tramos que el coche aun no ha recorrido.
  //
  // Mientras no haya NINGUNA terminada -el arranque de la tanda- se comparan las
  // filas visibles entre si. Sin este respaldo no habia con que comparar y la
  // rejilla salia entera en gris hasta que alguien cruzaba meta por primera vez,
  // que es justo el rato en el que se quiere ver quien va ganando tiempo.
  const base = useMemo(() => {
    if (!reference?.length) return rows;
    const done = now == null ? reference : reference.filter((r) => now >= r.end);
    return done.length ? done : rows;
  }, [reference, rows, now]);
  const byNum = useMemo(
    () => new Map(drivers.map((d) => [String(d.number), d])),
    [drivers],
  );

  // Mejor tiempo de cada columna y DE QUIEN es. Hace falta el dueño, y no solo
  // el valor, para que el morado sea de uno solo: si se compara por valor, todo
  // el que iguale el minimo se lo lleva y acaban todos morados.
  //
  // El empate lo gana el primero que lo hizo (`start` mas temprano), como en el
  // cronometraje oficial: quien marca el tiempo lo conserva hasta que alguien lo
  // BAJA, no hasta que alguien lo iguala.
  const bestMicro = useMemo(() => {
    const n = base[0]?.micros.length ?? rows[0]?.micros.length ?? 0;
    return Array.from({ length: n }, (_, i) => {
      let val: number | null = null;
      let owner: string | null = null;
      for (const r of base) {
        const v = r.micros[i];
        if (v == null || !(v > 0)) continue;
        if (val == null || v < val) {
          val = v;
          owner = r.num;
        }
      }
      return { val, owner };
    });
  }, [base, rows]);

  const bestSector = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        let val: number | null = null;
        let owner: string | null = null;
        for (const r of base) {
          const v = r.sectors[i];
          if (v == null || !(v > 0)) continue;
          if (val == null || v < val) {
            val = v;
            owner = r.num;
          }
        }
        return { val, owner };
      }),
    [base],
  );

  if (!rows.length) return null;

  return (
    <div className="micro-grid">
      {rows.map((r) => {
        const d = byNum.get(r.num);
        // Cuantos micro-tramos lleva recorridos si la vuelta esta en curso. El
        // reparto es por distancia, no por tiempo, asi que se aproxima con el
        // tiempo acumulado de los tramos: suficiente para ver el avance.
        const running = now != null && now < r.end;
        let done = r.micros.length;
        if (running) {
          const elapsed = Math.max(0, (now ?? 0) - r.start);
          let acc = 0;
          done = 0;
          for (const v of r.micros) {
            acc += v;
            if (acc > elapsed) break;
            done++;
          }
        }
        // Reparto de los tramos por sector. Cada sector se queda con un numero
        // ENTERO de tramos y su ancho se calcula desde esos mismos tramos (no
        // desde su tiempo): asi las dos bandas miden igual y los cortes caen en
        // el mismo sitio. Repartir por tiempo arriba y por tramos abajo hacia
        // que el bloque de un sector no coincidiese con sus propios tramos.
        const nMicros = r.micros.length;
        const sectorEnds = (() => {
          let acc = 0;
          return r.sectors.map((s, i) => {
            if (i === 2) return nMicros; // el ultimo cierra en el total exacto
            acc += s != null && r.lapTime > 0 ? (s / r.lapTime) * nMicros : nMicros / 3;
            return Math.min(nMicros, Math.max(i + 1, Math.round(acc)));
          });
        })();
        // Cuantos tramos toca a cada sector, que es lo que fija su ancho.
        const sectorSpan = sectorEnds.map((end, i) => end - (i === 0 ? 0 : sectorEnds[i - 1]));
        return (
          <div className={`micro-row${running ? " running" : ""}`} key={r.num}>
            <span className="micro-code" style={{ borderLeftColor: d?.teamColor ?? "#888" }}>
              {d?.code ?? r.num}
            </span>
            <span className="micro-time">
              {running ? "en curso" : fmtLap(r.lapTime)}
              {r.lapNumber != null && <small> V{r.lapNumber}</small>}
            </span>
            {r.compound && (
              <span
                className="tyre micro-tyre"
                style={{ background: TYRE_COLOR[r.compound] ?? "#888" }}
                title={r.compound}
              >
                {r.compound[0]}
              </span>
            )}
            <div className="micro-bands">
              {/* Un grupo por sector, con el mismo `flex-grow` que su bloque de
                  abajo: es lo que hace que los cortes coincidan exactamente. */}
              <div className="micro-segs">
                {sectorSpan.map((span, s) => {
                  const from = s === 0 ? 0 : sectorEnds[s - 1];
                  return (
                    <div className="micro-seg-group" key={s} style={{ flex: `${span} 0 0` }}>
                      {r.micros.slice(from, sectorEnds[s]).map((v, k) => {
                        const i = from + k;
                        // Lo que el coche aun no ha recorrido va neutro y sin
                        // tooltip: colorearlo, aunque fuese apagado, adelantaba
                        // como iba a quedar el tramo antes de que ocurriera.
                        const pending = i >= done;
                        return (
                          <i
                            key={i}
                            className={pending ? "pending" : undefined}
                            style={
                              pending
                                ? undefined
                                : {
                                    background: colorFor(
                                      v,
                                      bestMicro[i]?.val ?? null,
                                      bestMicro[i]?.owner === r.num,
                                    ),
                                  }
                            }
                            title={pending ? undefined : `Tramo ${i + 1}: ${v.toFixed(3)} s`}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {/* Barra agrupada por sector. El ancho sale del NUMERO DE TRAMOS
                  de cada sector, no de su tiempo: los tramos de arriba miden
                  todos igual, asi que es la unica forma de que un bloque acabe
                  justo donde acaban sus tramos. */}
              <div className="micro-sectors">
                {r.sectors.map((v, i) => {
                  // Un sector solo se colorea cuando el coche lo ha terminado;
                  // antes iria adelantando el resultado.
                  const closed = !running || done >= sectorEnds[i];
                  return (
                    <i
                      key={i}
                      className={closed ? undefined : "pending"}
                      style={{
                        // `flex-grow` proporcional a sus tramos: reparte el
                        // espacio igual que arriba aunque haya huecos de por medio.
                        flex: `${sectorSpan[i]} 0 0`,
                        ...(closed
                          ? {
                              background: colorFor(
                                v,
                                bestSector[i]?.val ?? null,
                                bestSector[i]?.owner === r.num,
                              ),
                            }
                          : {}),
                      }}
                      title={closed && v != null ? `S${i + 1}: ${v.toFixed(3)} s` : undefined}
                    >
                      {/* El tiempo en vez de la etiqueta "S1/S2/S3": que bloque
                          es se sabe por la posicion, el tiempo no. En un sector
                          muy corto no cabe y se cortaria a medias: ahi se deja
                          solo en el tooltip. */}
                      {closed && v != null && sectorSpan[i] >= 4 ? v.toFixed(3) : ""}
                    </i>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
