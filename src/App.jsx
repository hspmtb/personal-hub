import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Tasks from './pages/Tasks.jsx'
import Expenses from './pages/Expenses.jsx'
import Kontrakan from './pages/Kontrakan.jsx'
import Saham from './pages/Saham.jsx'
import Documents from './pages/Documents.jsx'
import Users from './pages/Users.jsx'
import Settings from './pages/Settings.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <FullscreenLoader />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function FullscreenLoader() {
  return (
    <div className="h-screen w-full flex items-center justify-center text-slate-400 text-sm">
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="kontrakan" element={<Kontrakan />} />
        <Route path="saham" element={<Saham />} />
        <Route path="documents" element={<Documents />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
