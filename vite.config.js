import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: change "personal-hub" below to your actual GitHub repository name.
// GitHub Pages serves project sites from https://<user>.github.io/<repo-name>/
// so Vite's base path must match the repo name exactly (case-sensitive).
export default defineConfig({
  plugins: [react()],
  base: '/personal-hub/',
})
