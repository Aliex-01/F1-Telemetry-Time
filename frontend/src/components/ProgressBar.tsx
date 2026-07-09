// Barra de progreso INDETERMINADA (franja que se desliza). Se usa mientras se cargan
// datos cuyo avance real no conocemos: el backend descarga/adelgaza la sesion antes de
// responder, asi que no hay un % fiable; la barra solo indica "trabajando".
export function ProgressBar({ label }: { label?: string }) {
  return (
    <div className="progress" role="status" aria-live="polite">
      {label && <span className="progress-label">{label}</span>}
      <div className="progress-track">
        <div className="progress-fill" />
      </div>
    </div>
  );
}
