// Contenedor de la pestaña "Tiempo real": alterna entre Repetición (reproductor
// local de una sesión histórica) y Directo (WebSocket de un GP en vivo).
import { useState } from "react";
import { LiveDirect } from "./LiveDirect";
import { ReplayPlayer } from "./ReplayPlayer";

export function LivePanel() {
  const [mode, setMode] = useState<"replay" | "live">("replay");

  return (
    <section className="live">
      <h2>Tiempo real</h2>

      <div className="mode-toggle">
        <button className={mode === "replay" ? "active" : ""} onClick={() => setMode("replay")}>
          ⏱ Repetición
        </button>
        <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>
          🔴 Directo
        </button>
      </div>

      {mode === "replay" ? <ReplayPlayer /> : <LiveDirect />}
    </section>
  );
}
