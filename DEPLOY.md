# Despliegue — frontend en Cloudflare Pages + backend en tu PC (túnel)

Este proyecto **no es estático**: el frontend (React) sí puede vivir en Cloudflare
Pages, pero el backend (Python + FastF1) es un servidor que **corre en tu ordenador**
y se expone a internet con un **túnel**. La web funciona cuando tu PC está encendido
con el backend y el túnel arrancados; si lo apagas, la web carga pero sin datos.

```
Navegador  ──►  f1-telemetry-time.pages.dev  (frontend estático, siempre online)
                          │
                          ▼   (URL del túnel, configurable en la web)
                 https://xxxx.trycloudflare.com   ──►  tu PC: uvicorn :8080  ──►  FastF1
```

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

## 2) Backend + túnel en tu PC (cada vez que quieras que esté online)

Requisitos (una sola vez):
- `uv` (ya lo usas para el backend).
- `cloudflared`:  `winget install --id Cloudflare.cloudflared`

Arranque (doble clic):
- Ejecuta **`start-online.bat`** en la raíz del repo. Abre el backend en una ventana
  y el túnel en otra.
- En la ventana del túnel aparece una línea tipo:
  `https://algo-al-azar.trycloudflare.com`  → **copia esa URL**.

Alternativa manual (dos terminales):
```bash
# 1) backend
cd backend
uv run uvicorn app.main:app --port 8080
# 2) túnel
cloudflared tunnel --url http://localhost:8080
```

---

## 3) Conectar la web con tu backend

1. Abre `https://f1-telemetry-time.pages.dev`.
2. Pulsa **⚙ Backend** (arriba a la derecha).
3. Pega la URL del túnel (p. ej. `https://algo-al-azar.trycloudflare.com`) y
   **Guardar y recargar**. Se le añade `/api` automáticamente.
4. Ya deberías ver los datos. La URL queda guardada en tu navegador.

> La URL del *quick tunnel* **cambia** cada vez que reinicias `cloudflared`. Cuando
> eso pase, vuelve a pegar la nueva en **⚙ Backend**. (Si algún día añades un dominio
> propio a Cloudflare, se puede montar un túnel con URL fija y olvidarte de este paso.)

---

## Notas

- **CORS:** el backend ya permite el origen `*.f1-telemetry-time.pages.dev` además de
  localhost (ver `backend/app/config.py`).
- **Primera carga lenta:** la primera vez que abras una sesión nunca vista, FastF1 la
  descarga (lento, inevitable); luego va de la caché en disco de tu PC.
- **Coste:** 0 €. Cloudflare Pages y el quick tunnel son gratis y sin límites de datos.
