import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { user, login, signUp } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await signUp(email, password, displayName)
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-accent text-3xl mb-2">◆</div>
          <h1 className="font-display text-xl font-semibold">Personal Apps Rony Delano</h1>
          <p className="text-slate-400 text-sm mt-1">Tasks, expenses, and documents — private and encrypted.</p>
        </div>

        <div className="card p-6">
          <div className="flex text-sm mb-5 border border-white/10 rounded-lg overflow-hidden">
            <button
              className={`flex-1 py-2 ${mode === 'login' ? 'bg-accent/15 text-accent' : 'text-slate-400'}`}
              onClick={() => setMode('login')}
              type="button"
            >
              Sign in
            </button>
            <button
              className={`flex-1 py-2 ${mode === 'signup' ? 'bg-accent/15 text-accent' : 'text-slate-400'}`}
              onClick={() => setMode('signup')}
              type="button"
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="label mb-1 block">Display name</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane" />
              </div>
            )}
            <div>
              <label className="label mb-1 block">Email</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="label mb-1 block">Password</label>
              <input
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-rose-400 text-sm">{error}</p>}

            <button className="btn-primary w-full mt-2" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {mode === 'signup' && (
            <p className="text-xs text-slate-500 mt-4">
              Sign-up only works for emails an admin has already invited from the Users page.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function friendlyError(err) {
  const code = err?.code || ''
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Incorrect email or password.'
  if (code.includes('user-not-found')) return 'No account with that email.'
  if (code.includes('email-already-in-use')) return 'An account with that email already exists.'
  if (code.includes('weak-password')) return 'Password should be at least 6 characters.'
  return err.message || 'Something went wrong. Please try again.'
}
