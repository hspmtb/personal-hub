import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { VaultProvider } from './context/VaultContext.jsx'
import './index.css'

// HashRouter is used (not BrowserRouter) because GitHub Pages serves static
// files with no server-side rewrite rules — a hash route like
// /#/expenses always resolves to index.html, so refreshing or deep-linking
// never 404s. A regular path route (/expenses) would 404 on refresh on
// GitHub Pages without extra workarounds.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <AuthedVaultProvider />
      </AuthProvider>
    </HashRouter>
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
