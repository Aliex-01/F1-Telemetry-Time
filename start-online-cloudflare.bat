@echo off
REM [ALTERNATIVA ANTIGUA] Arranca el backend (:8080) y lo expone con un quick tunnel
REM de Cloudflare (gratis, sin cuenta). La URL https://....trycloudflare.com CAMBIA en
REM cada arranque: copiala y pegala en la web (boton "Backend") en
REM f1-telemetry-time.pages.dev cada vez.
REM
REM El metodo por defecto ahora es Tailscale Funnel (URL fija): usa start-online.bat.
REM Este archivo se conserva por si quieres volver al tunel de Cloudflare.
REM
REM Requisitos (una sola vez):
REM   - uv instalado (backend)
REM   - cloudflared instalado:  winget install --id Cloudflare.cloudflared

echo === Comprobando el token de F1TV (necesario para el directo) ===
REM Solo renovamos si falta o esta a punto (<24h); la reautenticacion abre el navegador.
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
echo === Abriendo tunel Cloudflare (copia la URL https que aparezca) ===
cloudflared tunnel --url http://localhost:8080
