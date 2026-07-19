// Torre de tiempos en vivo: lo unico que el feed oficial entrega con una cuenta
// F1 gratuita (CarData.z / Position.z -velocidad y mapa- exigen suscripcion F1TV).
// Posiciones, gaps, sectores, mejor vuelta y neumatico.
import { useEffect, useMemo, useRef, useState } from "react";
import { TYRE_COLOR } from "../components/tyres";
import { DriverDetail } from "./DriverDetail";
import { useImproved, useTowerFlip } from "./towerAnim";
import type { LapHistory, LiveTiming as LiveTimingData, SegmentColor } from "./useLiveFeed";

// Morado = mejor de la sesion, verde = mejor personal (convencion de la F1).
const PURPLE = "#b14bdb";
const GREEN = "#00c853";

function sectorColor(s: { personalFastest: boolean; overallFastest: boolean }): string | undefined {
  if (s.overallFastest) return PURPLE;
  if (s.personalFastest) return GREEN;
  return undefined;
}

/** Fondo del bloque de un sector ya cerrado. A diferencia del reproductor —donde
 *  un sector normal va amarillo— aqui el feed solo distingue mejor de la sesion
 *  y mejor personal, asi que el resto se queda en gris claro: sobre el fondo
 *  oscuro de la torre el texto negro no se leeria. */
const SECTOR_PLAIN = "#c8ccd4";

function sectorBg(s: { personalFastest: boolean; overallFastest: boolean }): string {
  return sectorColor(s) ?? SECTOR_PLAIN;
}

type LiveSector = {
  value: string | null;
  personalFastest: boolean;
  overallFastest: boolean;
  segments?: SegmentColor[];
};

/**
 * Los tres sectores como una banda continua: mini-tramos arriba y la barra por
 * sector debajo, igual que la rejilla del reproductor (`MicroSectorGrid`).
 *
 * A diferencia del reproductor, aqui NO hay tiempo por mini-tramo -el feed solo
 * manda un color de estado por segmento-, asi que el ancho de cada sector no
 * puede salir de tiempos: sale del **numero de segmentos** que el propio feed da
 * para ese sector, que es lo que hace que los cortes de las dos bandas caigan en
 * el mismo sitio. Y el color de la barra es el del feed (morado = mejor de la
 * sesion, verde = mejor personal), no una comparacion calculada aqui.
 */
function SectorBand({ sectors }: { sectors?: LiveSector[] }) {
  const secs = [0, 1, 2].map((i) => sectors?.[i]);
  if (!secs.some((s) => s?.value || s?.segments?.length)) return null;
  // Reparto del ancho. Con segmentos manda su numero; si un sector aun no tiene
  // (no se ha entrado en el), se le da un peso medio para que la banda no salte
  // de tamano al llegar los primeros.
  const spans = secs.map((s) => s?.segments?.length || 6);
  return (
    <span className="lt-band">
      <span className="lt-band-segs">
        {secs.map((s, i) => (
          <span className="lt-band-group" key={i} style={{ flex: `${spans[i]} 0 0` }}>
            {(s?.segments ?? []).map((c, k) => (
              <i key={k} className={`lt-seg ${c ?? "none"}`} />
            ))}
          </span>
        ))}
      </span>
      <span className="lt-band-secs">
        {secs.map((s, i) => (
          <i
            key={i}
            className={`lt-band-sec${s?.value ? "" : " pending"}`}
            style={{
              flex: `${spans[i]} 0 0`,
              // Color al FONDO (como la rejilla del reproductor), no al texto:
              // sobre morado/verde el numero se lee en negro, y asi los tres
              // sectores se comparan de un vistazo por bloques de color.
              ...(s?.value ? { background: sectorBg(s) } : {}),
            }}
            title={s?.value ? `S${i + 1}: ${s.value}` : undefined}
          >
            {s?.value ?? ""}
          </i>
        ))}
      </span>
    </span>
  );
}

/** "1:45.990" -> 105.99 segundos. Devuelve null si no es un tiempo valido. */
function parseLap(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** "00:29:50" -> 1790 segundos. */
function parseClock(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function formatClock(totalSecs: number): string {
  const t = Math.max(0, Math.floor(totalSecs));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/**
 * Descuenta el tiempo restante en local.
 *
 * El feed solo manda ExtrapolatedClock de vez en cuando (por eso el reloj se
 * quedaba clavado). Tomamos como base el ultimo valor recibido y el instante en
 * que llego —hora local, no el `Utc` del feed, para no depender de que el reloj
 * del PC este sincronizado con el de la F1— y restamos desde ahi. Cada nuevo
 * mensaje vuelve a fijar la base, asi que no acumulamos deriva.
 *
 * `recvAt` es cuando **llego** el mensaje, no cuando se aplico: con el retraso
 * activo median minutos entre ambos, y usar `Date.now()` aqui reajustaba el
 * reloj a la hora real y anulaba el retraso que si tenia la torre.
 */
function useCountdown(remaining: string | null, recvAt: number, running: boolean): string | null {
  const [display, setDisplay] = useState(remaining);
  const base = useRef<{ secs: number; at: number } | null>(null);

  useEffect(() => {
    const secs = parseClock(remaining);
    base.current = secs == null ? null : { secs, at: recvAt };
    setDisplay(secs == null ? remaining : formatClock(secs - (Date.now() - recvAt) / 1000));
  }, [remaining, recvAt]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const b = base.current;
      if (b) setDisplay(formatClock(b.secs - (Date.now() - b.at) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  return display;
}

export function LiveTiming({ data, lapHistory }: { data: LiveTimingData; lapHistory: LapHistory }) {
  const { session, rows, raceControl } = data;
  const isRace = session.type === "Race";
  const [selected, setSelected] = useState<string | null>(null);
  // `extrapolating` manda cuando viene (el feed lo pone a false en bandera roja).
  // Si no viene, deducimos por el estado de la sesion: asi el reloj corre aunque
  // el backend sea anterior a ese campo.
  const running = session.extrapolating ?? session.status === "Started";
  const remaining = useCountdown(session.remaining, data.recvAt, running);

  // En Q2/Q3 los eliminados de la parte anterior ya no compiten: se ocultan para
  // dejar solo a quienes siguen en pista. En Q1 no se filtra (nadie ha quedado
  // fuera aun) ni en carrera, donde `knockedOut` no aplica y un abandono debe
  // seguir viendose con su OUT.
  const hideKnocked = session.part != null && session.part > 1;
  const visibleRows = hideKnocked ? rows.filter((r) => !r.knockedOut) : rows;
  // Zona de eliminacion. Se deriva del numero de coches en vez de fijarla: en Q3
  // quedan siempre 10, y de Q1 pasan `total - ceil((total - 10) / 2)`. Con 22
  // coches (parrilla de 2026) pasan 16 -cae desde P17- y con 20 pasan 15.
  // En Q2 siempre cae desde P11, y en Q3 no cae nadie.
  // Marca a quien se quedaria fuera si la parte acabase ahora, que es lo util en
  // vivo: los ya eliminados no estan en la tabla.
  const dropFrom = ((): number | null => {
    if (session.part === 2) return 11;
    if (session.part !== 1) return null;
    const total = rows.length;
    if (total <= 10) return null;
    return total - Math.ceil((total - 10) / 2) + 1;
  })();

  // Deslizamiento de las filas al reordenarse y destello al bajar la vuelta,
  // las mismas animaciones que la torre de repeticion.
  const bodyRef = useTowerFlip(visibleRows.map((r) => r.num).join(","));
  const bestTimes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of visibleRows) {
      const t = parseLap(r.best);
      if (t != null) m.set(r.num, t);
    }
    return m;
  }, [visibleRows]);
  const improved = useImproved(bestTimes);
  // Convencion de la F1: morado = mejor de la sesion, verde = mejor personal. El
  // lider de la tabla es quien tiene la vuelta mas rapida, asi que si mejora el,
  // el destello es morado; el resto de mejoras son verdes.
  const overallBestNum = visibleRows.length ? visibleRows[0].num : null;
  // La fila se busca por numero en cada render: `rows` se reemplaza entera cada
  // vez que llega un mensaje, asi que guardar el objeto lo dejaria congelado.
  // Se busca sobre las visibles: si el piloto queda eliminado, su panel se cierra
  // solo en vez de quedarse abierto sobre una fila que ya no esta en la tabla.
  const selectedRow = selected ? visibleRows.find((r) => r.num === selected) ?? null : null;

  return (
    <div className="tower live-timing">
      <div className="tower-head">
        <div className="lt-session">
          <strong>{session.meeting ?? "—"}</strong>
          <span className="sep-dot">·</span>
          {session.name ?? "—"}
          {session.part != null && <span className="lt-part">Q{session.part}</span>}
          {session.status && <span className="lt-status">{session.status}</span>}
        </div>
        <div className="lt-clock">
          {session.trackStatus && (
            <span className={`lt-flag ${session.trackStatus.toLowerCase()}`}>
              {session.trackStatus}
            </span>
          )}
          {isRace && session.lap != null && (
            <span className="lt-lap">
              Vuelta {session.lap}{session.totalLaps ? `/${session.totalLaps}` : ""}
            </span>
          )}
          {remaining && <span className="lt-remaining">{remaining}</span>}
        </div>
      </div>

      <table className="tower-table lt-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Piloto</th>
            <th>{isRace ? "Gap" : "Dif."}</th>
            <th>Int.</th>
            <th>Mejor</th>
            <th>Última</th>
            <th>Sectores</th>
            <th>Trampa</th>
            <th>Vta</th>
            <th>Neum.</th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {visibleRows.map((r, i) => {
            const out = r.retired || r.stopped || r.knockedOut;
            const isSel = selected === r.num;
            // Por indice y no por `r.pos`: en Q2/Q3 las posiciones del feed
            // traen huecos, porque los eliminados ya no estan en la tabla.
            const cut = dropFrom != null && i + 1 === dropFrom;
            const elim = dropFrom != null && i + 1 >= dropFrom;
            return (
              <tr
                key={r.num}
                data-flip-key={r.num}
                className={`${out ? "dnf" : ""} ${r.inPit ? "pit" : ""} ${isSel ? "sel" : ""}${cut ? " cutline" : ""}${improved.has(r.num) ? (r.num === overallBestNum ? " improved best" : " improved") : ""}`}
                onClick={() => setSelected(isSel ? null : r.num)}
                title={r.name ?? undefined}
              >
                <td className={`lt-pos${elim ? " elim" : ""}`}>{r.pos || "—"}</td>
                <td>
                  <span className="lt-chip" style={{ background: r.teamColor ?? "#888" }} />
                  <span className="lt-code">{r.code}</span>
                </td>
                <td className="lt-gap">{r.gap ?? "—"}</td>
                <td className="lt-gap">{r.interval ?? "—"}</td>
                <td className="lt-best">{r.best ?? "—"}</td>
                <td style={{ color: r.lastOverallBest ? PURPLE : r.lastPersonalBest ? GREEN : undefined }}>
                  {r.last ?? "—"}
                </td>
                {/* Los tres sectores en una sola celda, como banda continua. El
                    flex va en el wrapper y NO en el <td>: cambiar el `display`
                    de una celda la saca del layout de la tabla y descuadra la
                    fila entera. */}
                <td className="lt-sector">
                  <SectorBand sectors={r.sectors} />
                </td>
                <td className="lt-trap">
                  {r.bestSpeeds?.ST ? (
                    <>
                      {r.bestSpeeds.ST.value}
                      <small> km/h</small>
                    </>
                  ) : "—"}
                </td>
                <td className="lt-laps">{r.laps ?? "—"}</td>
                <td className="tower-tyre">
                  {/* Igual que en los sectores: el flex va en el wrapper, no en
                      el <td>, para no sacar la celda del layout de la tabla. */}
                  <span className="tyre-cell">
                    {r.compound ? (
                      <>
                        <span className="tyre" style={{ background: TYRE_COLOR[r.compound] ?? "#888" }} title={r.compound}>
                          {r.compound[0]}
                        </span>
                        <span className="tyre-life">{r.tyreLaps ?? "—"}</span>
                      </>
                    ) : "—"}
                    {/* Siempre presente: si solo se renderiza al entrar en boxes,
                        su ancho empuja el neumatico y la columna baila.
                        OUT manda sobre BOX: si esta fuera da igual donde estuviera. */}
                    <span className={`lt-box${out ? " out" : r.inPit ? "" : " off"}`}>
                      {out ? "OUT" : "BOX"}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedRow && (
        <DriverDetail
          row={selectedRow}
          raceControl={raceControl}
          laps={lapHistory[selectedRow.num] ?? []}
          isRace={isRace}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
