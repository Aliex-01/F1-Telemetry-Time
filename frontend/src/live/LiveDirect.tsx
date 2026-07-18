// Vista de directo real (WebSocket + SignalR de la F1). Solo funciona durante un GP
// en vivo; la repeticion historica se maneja en ReplayPlayer.
import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { api, type AuthStatus } from "../api/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { IconStop } from "../components/icons";
import { LiveTiming } from "./LiveTiming";
import { LiveTrackMap } from "./LiveTrackMap";
import { LiveWeatherPanel, RaceControlPanel } from "./RaceControl";
import { MAX_DELAY_SECS, useLiveFeed } from "./useLiveFeed";
import { NO_POS, orderByTeam } from "./gridOrder";

export function LiveDirect() {
  const [selected, setSelected] = useState<string | null>(null);
  // Retraso (segundos) para cuadrar la torre con el retardo de tu emisión.
  //
  // Van separados a propósito: `draft` es lo que estás ajustando con −5s/+5s y
  // `delay` el que está aplicado de verdad. Sin esa separación cada pulsación
  // cambiaba el retraso al vuelo y no había forma de saber cuándo empezaba a
  // contar la espera.
  const [draft, setDraft] = useState(0);
  const [delay, setDelay] = useState(0);
  // Instante en que la torre quedará sincronizada. Para la cuenta atrás.
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [waitLeft, setWaitLeft] = useState(0);
  const { connected, meta, frame, history, timing, lapHistory } = useLiveFeed(selected, delay);

  /**
   * Aplica un retraso y calcula cuándo quedará cuadrado.
   *
   * Sobre la espera: solo hay que esperar por los segundos que **se añaden**,
   * porque lo ya encolado sigue ahí. De 100 a 105 son 5s, no 105. Y bajarlo no
   * espera nada: el `drain` suelta de golpe lo que ya cumplió el nuevo tiempo,
   * así que la torre salta hacia adelante y queda cuadrada al momento.
   */
  const applyDelay = (next: number) => {
    const added = next - delay;
    setDelay(next);
    setDraft(next);
    if (next <= 0) setReadyAt(null);
    else if (added > 0) setReadyAt(Date.now() + added * 1000);
    // Al bajar, si aún estábamos sincronizando el objetivo no se mueve; si ya
    // estaba cuadrado sigue estándolo.
    else if (readyAt == null) setReadyAt(Date.now());
  };

  // Mientras la cola se llena la torre se queda congelada: sin este contador
  // parece que el retraso no hace nada (justo la confusión que lo motivó).
  useEffect(() => {
    if (readyAt == null || delay <= 0) { setWaitLeft(0); return; }
    const tick = () => setWaitLeft(Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [readyAt, delay]);

  // Con retraso ya activo los ajustes son inmediatos y no necesitan confirmar.
  // El botón Aplicar solo hace falta para arrancar desde cero.
  const live = delay > 0;
  const dirty = draft !== delay;
  const syncing = waitLeft > 0;

  const bump = (secs: number) => {
    const next = Math.min(MAX_DELAY_SECS, Math.max(0, draft + secs));
    setDraft(next);
    // Si ya hay retraso corriendo, se aplica solo: reajustar es lo habitual
    // (te has quedado corto por unos segundos) y pedir confirmación estorba.
    if (live) applyDelay(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Estado del token de F1TV: caduca cada pocos días y sin él el directo no va.
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  // Consultamos el estado del token al abrir, para avisar antes de que moleste.
  useEffect(() => {
    api.liveAuth().then(setAuth).catch(() => setAuth(null));
  }, []);

  async function startLive() {
    setBusy(true); setError(null);
    try {
      const res = await api.liveStart();
      setAuth(res.auth);
      // Token caducado/ausente: el backend no arrancó el feed (evita colgarse).
      if (!res.started) setError(res.auth.message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try { await api.liveStop(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  const byNum = new Map(meta?.drivers.map((d) => [String(d.number), d]));
  // CarData.z / Position.z solo llegan con suscripcion F1TV de pago. Sin ellos el
  // frame trae unicamente la posicion de carrera (de TimingData): ni mapa ni
  // velocidades, asi que en ese caso mostramos solo la torre de tiempos.
  const hasTelemetry = !!frame && Object.values(frame.cars).some(
    (c) => c.x != null || c.y != null || c.speed > 0,
  );
  const cars = orderByTeam(
    hasTelemetry && frame ? Object.entries(frame.cars) : [],
    (num) => frame?.cars[num]?.pos ?? NO_POS,
    (num) => byNum.get(num)?.team ?? null,
    (num) => byNum.get(num)?.number ?? Number(num),
  );

  return (
    <div>
      <div className="live-controls">
        <span className={`dot-conn ${connected ? "on" : "off"}`} />
        {connected ? "WebSocket conectado" : "Conectando…"}
        <span className="sep" />
        <button onClick={startLive} disabled={busy} title="Solo funciona durante un GP en directo"><span className="live-dot" /> Conectar al directo</button>
        <button onClick={stop} disabled={busy}><IconStop size={13} /> Parar</button>
        <span className="sep" />
        <div className="delay-ctl" title="Retrasa la torre para cuadrarla con tu emisión de TV">
          <span className="delay-lbl">Retraso</span>
          <button onClick={() => bump(-5)} disabled={draft <= 0} title={live ? "Quita 5s al momento" : undefined}>−5s</button>
          <span className={`delay-val${dirty ? " dirty" : ""}`}>{draft}s</span>
          <button onClick={() => bump(5)} disabled={draft >= MAX_DELAY_SECS} title={live ? "Añade 5s al momento" : undefined}>+5s</button>
          {/* Solo para arrancar: con el retraso ya activo los ajustes son inmediatos. */}
          {!live && (
            <button
              className="delay-apply"
              onClick={() => applyDelay(draft)}
              disabled={draft <= 0}
              title="Aplica el retraso y empieza la espera de sincronización"
            >
              Aplicar
            </button>
          )}
          {syncing && (
            <span className="delay-sync" title="Tiempo que falta para que la torre cuadre con tu emisión">
              Sincronizando… {waitLeft}s
            </span>
          )}
          {live && !syncing && <span className="delay-active">✓ cuadrado</span>}
          {live && (
            <button
              className="delay-reset"
              onClick={() => applyDelay(0)}
              title="Vuelve al directo sin retraso"
            >
              Quitar retraso
            </button>
          )}
        </div>
      </div>

      <p className="status">
        El directo solo transmite datos durante un Gran Premio en vivo. Para revisar
        sesiones pasadas usa la pestaña <strong>Repetición</strong>.
      </p>
      {error && <p className="status error">{error}</p>}
      {auth && <AuthBanner auth={auth} />}

      {/* Acotado: si el cronometraje viene con una forma inesperada, que no se
          lleve por delante toda la pestaña. */}
      <ErrorBoundary what="la torre de tiempos">
        {timing?.weather && <LiveWeatherPanel weather={timing.weather} />}
        {timing && <LiveTiming data={timing} lapHistory={lapHistory} />}
        {timing && <RaceControlPanel messages={timing.raceControl} />}
      </ErrorBoundary>

      {timing && !hasTelemetry && (
        <p className="status">
          Mostrando solo cronometraje: el mapa y la telemetría en vivo (velocidad,
          marcha, acelerador) viajan por canales que requieren una suscripción
          <strong> F1TV Access/Pro/Premium</strong>. Con una cuenta gratuita el feed
          oficial no los envía.
        </p>
      )}

      {meta && frame && hasTelemetry && (
        <div className="track-block">
          <div className="track-title">Posición de los pilotos en pista</div>
          <LiveTrackMap
            track={meta.track}
            cars={frame.cars}
            drivers={meta.drivers}
            rotation={meta.rotation}
            corners={meta.corners}
            selected={selected}
            onSelect={(num) => setSelected(selected === num ? null : num)}
          />
        </div>
      )}

      <div
        className="live-grid"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(cars.length / 2))}, minmax(0, 1fr))` }}
      >
        {cars.map(([num, c]) => {
          const d = byNum.get(num);
          const isSel = selected === num;
          const drsOn = c.drs >= 10; // 10/12/14 = DRS abierto
          return (
            <button
              key={num}
              className={`car ${isSel ? "sel" : ""}`}
              style={{ borderLeftColor: d?.teamColor ?? "#888" }}
              onClick={() => setSelected(isSel ? null : num)}
            >
              <div className="car-head">
                <span className="car-pos">{c.pos ? `P${c.pos}` : "—"}</span>
                <span className="car-code">{d?.code ?? num}</span>
                <span className={`car-drs ${drsOn ? "on" : ""}`}>DRS</span>
              </div>
              <div className="car-speed">{Math.round(c.speed)}<small> km/h</small></div>
              <div className="car-meta">
                <span className="gear">M{c.gear}</span>
                <span className="rpm">{(c.rpm / 1000).toFixed(1)}k rpm</span>
              </div>
              <div className="car-bar-row">
                <span className="bar-lbl">ACE</span>
                <span className="bar"><i style={{ width: `${c.throttle}%`, background: "#00c853" }} /></span>
              </div>
              <div className="car-bar-row">
                <span className="bar-lbl">FRE</span>
                <span className="bar"><i style={{ width: `${c.brake}%`, background: "#2962ff" }} /></span>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="live-detail">
          <h3>{byNum.get(selected)?.code ?? selected} — telemetría en vivo</h3>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="#888" unit="s" />
                <YAxis tick={{ fontSize: 11 }} stroke="#888" domain={[0, "auto"]} />
                <Line type="monotone" dataKey="speed" stroke="#e10600" dot={false} isAnimationActive={false} strokeWidth={1.6} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/** Aviso del estado del token de F1TV: si sirve, cuándo caduca; si no, cómo
 *  renovarlo. El token caduca cada pocos días y sin él el directo no conecta. */
function AuthBanner({ auth }: { auth: AuthStatus }) {
  if (auth.ok) {
    const exp = auth.expiresAt ? new Date(auth.expiresAt) : null;
    // A menos de 24 h avisamos en ámbar; si no, un discreto informativo.
    const soon = exp ? exp.getTime() - Date.now() < 24 * 3600 * 1000 : false;
    return (
      <p className={`status auth-ok ${soon ? "auth-soon" : ""}`}>
        Token de F1TV válido
        {exp && <> · caduca el {exp.toLocaleString()}</>}
        {soon && <> — conviene renovarlo pronto</>}
      </p>
    );
  }
  return <p className="status error">{auth.message}</p>;
}
