// Desplegable personalizado (no nativo) para poder tematizar tambien la lista de
// opciones que se abre: fondo oscuro, hover, seleccion resaltada y scroll.
import { useEffect, useRef, useState } from "react";

interface SelectProps<T extends string | number> {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
}

export function Select<T extends string | number>({ label, value, onChange, options }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const disabled = options.length === 0;
  const selected = options.find((o) => o.value === value);

  // Cerrar al hacer clic fuera o pulsar Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <label className="select">
      <span>{label}</span>
      <div className={`select-box ${open ? "open" : ""}`} ref={boxRef}>
        <button
          type="button"
          className="select-trigger"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={selected ? "" : "placeholder"}>{selected?.label ?? "—"}</span>
          <svg className="select-chevron" width="12" height="8" viewBox="0 0 12 8" aria-hidden>
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="select-menu" role="listbox">
            {options.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`select-option ${o.value === value ? "selected" : ""}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}
