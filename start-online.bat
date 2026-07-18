@echo off
REM Arranca el backend (:8080) y lo expone a internet con TAILSCALE FUNNEL, que da
REM una URL FIJA https://<equipo>.<tailnet>.ts.net (no cambia entre reinicios, a
REM diferencia del quick tunnel de Cloudflare). Al ser fija, la web ya apunta sola
REM y no hace falta volver a pegarla en el boton "Backend".
REM
REM Requisitos (una sola vez):
REM   - uv instalado (backend)
REM   - Tailscale instalado y con sesion iniciada:  tailscale up
REM   - En la consola de Tailscale: MagicDNS + HTTPS Certificates activados y
REM     Funnel habilitado para este equipo.

set "TS=%ProgramFiles%\Tailscale\tailscale.exe"

echo === Comprobando el token de F1TV (necesario para el directo) ===
REM El token caduca cada pocos dias. Solo renovamos si falta o esta a punto (<24h);
REM asi no te pide login en cada arranque. La reautenticacion abre el navegador.
pushd "%~dp0backend"
uv run python -m app.live.auth
if errorlevel 1 (
    echo Renovando token de F1TV: se abrira el navegador para que inicies sesion...
    uv run python -m fastf1 auth f1tv --authenticate
)
popd
echo.

echo === Arrancando backend (uvicorn :8080) en otra ventana ===
start "F1 backend" cmd /k "cd /d %~dp0backend && uv run uvicorn app.main:app --port 8080"

echo Esperando a que arranque el backend...
timeout /t 4 /nobreak >nul

echo.
echo === Exponiendo el backend con Tailscale Funnel (URL fija) ===
echo (Deja esta ventana abierta mientras quieras estar online; cierrala para parar.)
echo.
"%TS%" funnel 8080
