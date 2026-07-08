import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Respeta el puerto que asigne el entorno (p. ej. la preview); si no, 5173.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
