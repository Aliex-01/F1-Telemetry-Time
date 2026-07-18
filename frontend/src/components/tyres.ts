// Colores por compuesto de neumatico (codigo oficial F1).
// Vive aqui y no en cada componente: estaba duplicado y las copias empezaban a
// divergir. Lo usan LapsTable, ReplayPlayer, LiveTiming y DriverDetail.
export const TYRE_COLOR: Record<string, string> = {
  SOFT: "#ff3333",
  MEDIUM: "#ffdd00",
  HARD: "#eeeeee",
  INTERMEDIATE: "#43b02a",
  WET: "#0067ad",
};
