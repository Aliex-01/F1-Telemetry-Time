// Ajuste de la URL del backend (para el despliegue: el frontend es estatico en
// Cloudflare Pages y el backend corre en el PC del usuario expuesto por un tunel
// con URL cambiante). Se guarda en el navegador (localStorage) y al guardar recarga
// para que toda la app vuelva a pedir datos contra la nueva URL.
import { useState } from "react";
import { getStoredApiBase, setApiBase } from "../api/client";

export function BackendConfig() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(getStoredApiBase());
  const configured = getStoredApiBase() !== "";

  function save() {
    setApiBase(value);
    window.location.reload();
  }

  return (
    <div className="backend-config">
      <button
        className={`backend-btn ${configured ? "" : "warn"}`}
        onClick={() => setOpen((o) => !o)}
        title="Configurar la URL del backend"
      >
        ⚙ Backend{configured ? "" : " ⚠"}
      </button>

      {open && (
        <div className="backend-pop">
          <label>URL del backend (túnel)</label>
          <input
            type="text"
            placeholder="https://algo.trycloudflare.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <p className="backend-help">
            Pega aquí la URL que te da <code>cloudflared</code> al arrancar el túnel.
            Se le añade <code>/api</code> automáticamente. Déjalo vacío para usar
            <code> localhost</code> (desarrollo).
          </p>
          <div className="backend-actions">
            <button className="backend-save" onClick={save}>Guardar y recargar</button>
            <button className="backend-cancel" onClick={() => setOpen(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
