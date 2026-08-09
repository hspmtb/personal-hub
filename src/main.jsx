import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { VaultProvider } from './context/VaultContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// Whenever a new deploy activates a new service worker, force one automatic
// reload so the tab picks up the new JS/CSS immediately — this is what
// prevents the "stale index.html referencing deleted file hashes → 404"
// problem after every update, without needing a manual cache clear.
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

// HashRouter is used (not BrowserRouter) because GitHub Pages serves static
// files with no server-side rewrite rules — a hash route like
// /#/expenses always resolves to index.html, so refreshing or deep-linking
// never 404s. A regular path route (/expenses) would 404 on refresh on
// GitHub Pages without extra workarounds.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <AuthedVaultProvider />
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Small wrapper so VaultProvider (which needs `user`) only mounts once auth
// state is known, and unmounts cleanly on logout.
function AuthedVaultProvider() {
  return (
    <VaultProvider>
      <App />
    </VaultProvider>
  )
}
