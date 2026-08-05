import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// IMPORTANT: change "personal-hub" below to your actual GitHub repository name.
// GitHub Pages serves project sites from https://<user>.github.io/<repo-name>/
// so Vite's base path must match the repo name exactly (case-sensitive).
const BASE = '/personal-hub/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only precache our own built app shell (HTML/JS/CSS/icons). We
      // deliberately do NOT add runtime caching rules for Firestore/Auth —
      // those go straight to the network as normal, so data is always
      // fresh and nothing sensitive is cached by the service worker.
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Personal Hub',
        short_name: 'Personal Hub',
        description: 'Tasks, expenses, and documents — private and encrypted.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0B1220',
        theme_color: '#0B1220',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only; never cache API/auth calls.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
})
