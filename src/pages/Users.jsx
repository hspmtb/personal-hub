import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'

export default function Users() {
  const { isAdmin, user } = useAuth()
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    const u2 = onSnapshot(collection(db, 'allowlist'), (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  if (!isAdmin) {
    return <p className="text-slate-400 text-sm">Only admins can manage users. Ask an existing admin for access.</p>
  }

  async function invite(e) {
    e.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!clean) return
    await setDoc(doc(db, 'allowlist', clean), { role, invitedAt: serverTimestamp() })
    setEmail('')
  }

  async function removeInvite(id) {
    if (!confirm(`Remove invite for ${id}? They will not be able to sign up.`)) return
    await deleteDoc(doc(db, 'allowlist', id))
  }

  async function setUserRole(u, newRole) {
    await updateDoc(doc(db, 'users', u.id), { role: newRole })
  }

  async function setUserActive(u, active) {
    await updateDoc(doc(db, 'users', u.id), { active })
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-lg font-semibold">Users</h1>

      <div className="card p-4">
        <h2 className="font-display font-medium mb-3">Invite a new user</h2>
        <p className="text-xs text-slate-500 mb-3">
          Adding an email here allows that person to create their own account from the Sign in page.
          Their data (tasks, expenses, documents) stays private to their own account.
        </p>
        <form onSubmit={invite} className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-[200px]" type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn-primary" type="submit">Invite</button>
        </form>

        {invites.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <span>{i.id} <span className="text-slate-500">· {i.role}</span></span>
                <button className="text-xs text-slate-400 hover:text-rose-400" onClick={() => removeInvite(i.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-display font-medium mb-3">Registered users</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 flex-wrap text-sm border-b border-white/5 last:border-0 pb-2 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium truncate">{u.displayName} {u.id === user?.uid && '(you)'}</p>
                <p className="text-xs text-slate-500 truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select className="input w-auto !py-1 text-xs" value={u.role} onChange={(e) => setUserRole(u, e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  className={`text-xs px-2 py-1 rounded border ${u.active ? 'border-white/10 text-slate-300' : 'border-danger/30 text-rose-300'}`}
                  onClick={() => setUserActive(u, !u.active)}
                >
                  {u.active ? 'Active' : 'Disabled'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
