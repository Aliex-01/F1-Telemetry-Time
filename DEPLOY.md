# Despliegue — frontend en Cloudflare Pages + backend en tu PC (túnel)

Este proyecto **no es estático**: el frontend (React) sí puede vivir en Cloudflare
Pages, pero el backend (Python + FastF1) es un servidor que **corre en tu ordenador**
y se expone a internet con un **túnel**. La web funciona cuando tu PC está encendido
con el backend y el túnel arrancados; si lo apagas, la web carga pero sin datos.

```
Navegador  ──►  f1-telemetry-time.pages.dev  (frontend estático, siempre online)
                          │
                          ▼   (URL FIJA por Tailscale Funnel, ya fijada en la web)
      https://alejandro.tail2c9840.ts.net   ──►  tu PC: uvicorn :8080  ──►  FastF1
```

> **Método actual: Tailscale Funnel** (URL fija). El frontend ya apunta a esa URL por
> defecto, así que **no hay que pegar nada** en la web. El antiguo túnel de Cloudflare
> (URL que cambiaba en cada arranque) se conserva como alternativa — ver el final.

---

## 1) Frontend en Cloudflare Pages (una sola vez)

1. En el panel de Cloudflare → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** y elige el repo `Aliex-01/F1-Telemetry-Time`.
2. Configuración de build:
   - **Project name:** `f1-telemetry-time`  → te da `f1-telemetry-time.pages.dev`
   - **Framework preset:** `Vite`
   - **Root directory:** `frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Variables de entorno:** ninguna (la URL del backend se configura en la web).
3. **Save and Deploy**. A partir de ahí, cada `git push` redepliega solo.

> No hace falta `VITE_API_BASE`: la URL del backend se guarda en el navegador desde
> el botón **⚙ Backend** de la propia web.

---

## 2) Backend + Tailscale Funnel en tu PC (cada vez que quieras que esté online)

Requisitos (una sola vez):
- `uv` (ya lo usas para el backend).
- **Tailscale** instalado y con sesión iniciada:
  `winget install --id tailscale.tailscale` → `tailscale up`.
- En la **consola de Tailscale** (`login.tailscale.com/admin/dns`): activa **MagicDNS**
  y **HTTPS Certificates**. La primera vez que ejecutes `tailscale funnel 8080`, el
  comando te dará una URL para **habilitar Funnel** en el equipo (un clic).

Arranque (doble clic):
- Ejecuta **`start-online.bat`** en la raíz del repo. Abre el backend en una ventana
  y expone el Funnel en otra. Deja abierta la ventana del Funnel mientras quieras
  estar online.

Alternativa manual (dos terminales):
```bash
# 1) backend
cd backend
uv run uvicorn app.main:app --port 8080
# 2) funnel (URL fija)
tailscale funnel 8080
```

Tu URL es **siempre la misma**: `https://alejandro.tail2c9840.ts.net`.

---

## 3) Conectar la web con tu backend

**Nada que hacer.** El frontend ya trae esa URL fija como backend por defecto en el
build de producción (`frontend/src/api/client.ts`), así que al abrir
`https://f1-telemetry-time.pages.dev` con tu PC online, verás los datos directamente.

> Si algún día cambias de PC o de tailnet (nueva URL `.ts.net`), actualiza `PROD_BASE`
> en `client.ts`. Puntualmente también puedes apuntar a otro backend desde el botón
> **⚙ Backend** de la web (se guarda en tu navegador y tiene prioridad sobre el default).

---

## Alternativa: túnel de Cloudflare (URL cambiante)

Si prefieres el método anterior, ejecuta **`start-online-cloudflare.bat`** (requiere
`cloudflared`:  `winget install --id Cloudflare.cloudflared`). Da una URL
`https://xxxx.trycloudflare.com` que **cambia en cada arranque**, así que hay que
pegarla en **⚙ Backend** de la web (se le añade `/api` automáticamente) cada vez.

---

## Notas

- **CORS:** el backend ya permite el origen `*.f1-telemetry-time.pages.dev` además de
  localhost (ver `backend/app/config.py`).
- **Primera carga lenta:** la primera vez que abras una sesión nunca vista, FastF1 la
  descarga (lento, inevitable); luego va de la caché en disco de tu PC.
- **Coste:** 0 €. Cloudflare Pages y el quick tunnel son gratis y sin límites de datos.
