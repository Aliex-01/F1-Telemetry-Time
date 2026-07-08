@echo off
REM Arranca el backend (puerto 8080) y lo expone a internet con un tunel de
REM Cloudflare (gratis, sin cuenta). Copia la URL https://....trycloudflare.com
REM que aparezca y pegala en la web (boton "Backend") en f1-telemetry-time.pages.dev
REM
REM Requisitos (una sola vez):
REM   - uv instalado (backend)
REM   - cloudflared instalado:  winget install --id Cloudflare.cloudflared

echo === Arrancando backend (uvicorn :8080) en otra ventana ===
start "F1 backend" cmd /k "cd /d %~dp0backend && uv run uvicorn app.main:app --port 8080"

echo Esperando a que arranque el backend...
timeout /t 4 /nobreak >nul

echo.
echo === Abriendo tunel Cloudflare (copia la URL https que aparezca) ===
cloudflared tunnel --url http://localhost:8080
