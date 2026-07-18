// Animaciones compartidas por las torres de tiempos (repeticion y directo):
// el deslizamiento de las filas al reordenarse y el destello al mejorar vuelta.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * FLIP: anima el reordenamiento de las filas cuando un piloto adelanta a otro
 * (la fila se desliza a su nueva posicion, como en la TV).
 *
 * Solo actua cuando el `order` cambia -no lee layout en cada frame-: la
 * dependencia es la cadena de posiciones, estable entre adelantamientos.
 * Tecnica FLIP: se mide la posicion nueva (post-commit), se aplica el
 * desplazamiento inverso sin transicion y se anima a 0.
 *
 * Devuelve la ref que hay que poner en el <tbody>.
 */
export function useTowerFlip(order: string) {
  const ref = useRef<HTMLTableSectionElement>(null);
  const prevTops = useRef<Map<string, number>>(new Map());
  const prevOrder = useRef<string | null>(null);

  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-flip-key]"));
    // Se cancela cualquier animacion en curso ANTES de medir: en el directo llegan
    // mensajes cada 500 ms y la animacion dura 450, asi que una fila puede estar
    // aun desplazada por un `transform`. `offsetTop` no lo incluye, pero el resto
    // del layout si, y la medida saldria falseada.
    for (const el of rows) {
      el.style.transition = "none";
      el.style.transform = "";
    }
    const tops = new Map<string, number>();
    for (const el of rows) tops.set(el.dataset.flipKey ?? "", el.offsetTop);

    const prevKeys = prevOrder.current === null ? null : prevOrder.current.split(",");
    const keys = order.split(",");
    // Solo animamos un reordenamiento real: mismo conjunto de pilotos en distinto
    // orden. Si entran o salen filas (cambio de parte en quali, un piloto que
    // aparece), el layout entero se desplaza y animar cada delta hace que "se
    // mueva todo" en vez de verse un adelantamiento.
    const sameSet =
      prevKeys !== null &&
      prevKeys.length === keys.length &&
      new Set(prevKeys).size === new Set([...prevKeys, ...keys]).size;

    if (sameSet && prevOrder.current !== order) {
      for (const el of rows) {
        const k = el.dataset.flipKey ?? "";
        const prev = prevTops.current.get(k);
        if (prev == null) continue;
        const delta = prev - (tops.get(k) ?? 0);
        // Umbral de ~media fila: por debajo son reflujos de layout (una fila que
        // cambia de alto al aparecer micro-sectores), no cambios de posicion.
        if (Math.abs(delta) < 8) continue;
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.45s ease";
          el.style.transform = "";
        });
      }
    }
    prevTops.current = tops;
    prevOrder.current = order;
  }, [order]);

  // Refresco de medidas en los renders que NO cambian el orden. El efecto de
  // arriba solo corre al cambiar `order`, pero la torre del directo repinta a
  // 2 Hz y las filas cambian de alto (micro-sectores, linea de corte): sin esto
  // el siguiente FLIP partiria de un layout que ya no existe.
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) return;
    for (const el of body.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      // Solo las quietas: una fila a mitad de animacion daria una medida falsa.
      if (el.style.transform) continue;
      prevTops.current.set(el.dataset.flipKey ?? "", el.offsetTop);
    }
  });

  return ref;
}

/**
 * Marca a los pilotos que acaban de bajar su mejor vuelta, para destellar la
 * fila (como el flash verde de la TV).
 *
 * Se compara el tiempo con el del render anterior; la marca se limpia sola
 * pasada la animacion. `times` es un mapa num -> tiempo, para que cada torre
 * decida que campo cuenta como "su" mejor vuelta.
 */
export function useImproved(times: Map<string, number>) {
  const [improved, setImproved] = useState<Set<string>>(new Set());
  const prev = useRef<Map<string, number>>(new Map());
  // Firma estable: sin esto el efecto se dispara en cada render, porque el mapa
  // se reconstruye entero cada vez que llega un mensaje.
  const sig = [...times].map(([n, t]) => `${n}:${t}`).join(",");

  useEffect(() => {
    const hits = new Set<string>();
    // En el primer render `prev` esta vacio: no destellamos toda la torre.
    if (prev.current.size) {
      for (const [num, lap] of times) {
        const before = prev.current.get(num);
        if (before != null && lap < before) hits.add(num);
      }
    }
    prev.current = new Map(times);
    if (!hits.size) return;
    setImproved(hits);
    // El temporizador se reinicia en cada cambio, asi que no se acumulan
    // destellos colgados al saltar de golpe (barra de tiempo, cambio de parte).
    const id = setTimeout(() => setImproved(new Set()), 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return improved;
}
