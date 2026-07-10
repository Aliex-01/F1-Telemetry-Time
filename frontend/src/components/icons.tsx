// Iconos SVG en linea, monocromos (heredan el color con `currentColor`), para que
// encajen con la paleta de la web en vez de emojis de colores. Tamano configurable.
import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function svg(size: number, className: string | undefined, children: ReactNode) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      className={className} aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-0.15em", flex: "none" }}
    >
      {children}
    </svg>
  );
}

// --- Controles del reproductor (rellenos, se leen como botones) ---
export const IconToStart = ({ size = 15, className }: IconProps) =>
  svg(size, className, <path fill="currentColor" d="M7 5h2.3v14H7zM20 5v14L9.7 12z" />);

export const IconBack10 = ({ size = 15, className }: IconProps) =>
  svg(size, className, <path fill="currentColor" d="M12 6v12l-8-6zM21 6v12l-8-6z" />);

export const IconFwd10 = ({ size = 15, className }: IconProps) =>
  svg(size, className, <path fill="currentColor" d="M12 6v12l8-6zM3 6v12l8-6z" />);

export const IconPlay = ({ size = 15, className }: IconProps) =>
  svg(size, className, <path fill="currentColor" d="M8 5v14l11-7z" />);

export const IconPause = ({ size = 15, className }: IconProps) =>
  svg(size, className, <path fill="currentColor" d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" />);

export const IconStop = ({ size = 15, className }: IconProps) =>
  svg(size, className, <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />);

// --- Estado / indicadores (trazo, al estilo del chevron del Select) ---
export const IconDownload = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v11" />
      <path d="M8 10.5l4 4 4-4" />
      <path d="M4 19h16" />
    </g>
  ));

export const IconAlert = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l9 15H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </g>
  ));

export const IconFlagWave = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v18" />
      <path d="M6 4.5c4-2.2 8 2 12-.2v7.4c-4 2.2-8-2-12 .2z" />
    </g>
  ));

export const IconStopwatch = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5h5" />
      <path d="M12 5.5v0" />
      <circle cx="12" cy="13" r="7" />
      <path d="M12 13V9.5" />
    </g>
  ));

export const IconFlag = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v18" />
      <path d="M6 4h12l-2.5 4L18 12H6z" fill="currentColor" fillOpacity="0.85" stroke="none" />
    </g>
  ));

export const IconSun = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </g>
  ));

export const IconRain = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 15a4 4 0 0 1 .4-8 5 5 0 0 1 9.5 1.3A3.5 3.5 0 0 1 16.5 15z" />
      <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
    </g>
  ));
