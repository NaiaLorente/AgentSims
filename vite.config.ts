import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// base is set to the repo name so the build works when served from
// https://<user>.github.io/agentsims/ (GitHub Pages project site).
// Locally (`npm run dev`) and for other deploy targets this can be
// overridden with the VITE_BASE_PATH env var.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/agentsims/',
  plugins: [react(), tailwindcss()],
})
