import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this project at /TRCONQUEST/ (a project page, not a
  // user/org root page) — without this, built asset paths are root-relative
  // and 404 under that subpath.
  base: '/TRCONQUEST/',
})
