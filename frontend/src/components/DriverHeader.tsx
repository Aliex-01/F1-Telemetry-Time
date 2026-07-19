// Cabecera del piloto seleccionado, compartida por el directo (`DriverDetail`) y
// el reproductor (`ReplayPlayer`).
//
// Las dos vistas manejan datos distintos -el directo tiene foto y puesto pero no
// telemetria; el reproductor al reves- asi que lo comun es solo la IDENTIDAD:
// franja del color del equipo, foto si la hay, nombre, equipo y dorsal, y la
// posicion grande a la derecha. Lo que cada una anada va debajo, no aqui.
type Props = {
  /** Nombre completo si se conoce; si no, el codigo de tres letras. */
  name: string;
  team: string | null;
  /** Dorsal. Se muestra junto al equipo. */
  num: string | number | null;
  teamColor: string | null;
  /** Foto oficial. Solo la trae el feed en directo; sin ella la cabecera se
   *  compacta y no deja un hueco vacio. */
  headshot?: string | null;
  /** Posicion en la sesion. Se pinta grande a la derecha. */
  pos?: number | string | null;
  /** Si se pasa, se dibuja la "✕" de cerrar. */
  onClose?: () => void;
};

export function DriverHeader({ name, team, num, teamColor, headshot, pos, onClose }: Props) {
  const color = teamColor ?? "#888";
  return (
    <div className="dh">
      {/* Franja del color del equipo: identifica al piloto de un vistazo, igual
          que el borde de las filas en las torres de tiempos. */}
      <span className="dh-chip" style={{ background: color }} />
      {headshot && <img className="dh-photo" src={headshot} alt="" loading="lazy" />}
      <div className="dh-id">
        <div className="dh-name">{name}</div>
        <div className="dh-team" style={{ color }}>
          {team ?? "—"}
          {num != null && num !== "" && ` · #${num}`}
        </div>
      </div>
      {pos != null && pos !== "" && (
        <div className="dh-pos">{typeof pos === "number" ? `P${pos}` : pos}</div>
      )}
      {onClose && (
        <button className="dh-close" onClick={onClose} title="Cerrar">✕</button>
      )}
    </div>
  );
}
