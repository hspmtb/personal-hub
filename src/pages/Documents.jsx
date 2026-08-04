import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { useVault } from '../context/VaultContext.jsx'
import { encryptField, decryptField } from '../lib/vaultCrypto'

const emptyForm = { docName: '', username: '', password: '', link: '', note: '' }

export default function Documents() {
  const { user } = useAuth()
  const vault = useVault()
  const [items, setItems] = useState([])
  const [needsSetup, setNeedsSetup] = useState(null) // null = unknown, true/false once checked
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockInput2, setUnlockInput2] = useState('')
  const [unlockError, setUnlockError] = useState('')

  useEffect(() => {
    vault.hasMasterPassword().then((has) => setNeedsSetup(!has))
  }, [user])

  useEffect(() => {
    if (!vault.unlocked) return
    const q = query(collection(db, 'documents'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'))
    return onSnapshot(q, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user, vault.unlocked])

  if (needsSetup === null) return <p className="text-slate-500 text-sm">Loading vault…</p>

  if (needsSetup) {
    return <SetupMasterPassword onDone={() => setNeedsSetup(false)} />
  }

  if (!vault.unlocked) {
    return (
      <div className="max-w-sm mx-auto mt-10 card p-6 space-y-3">
        <h1 className="font-display text-lg font-semibold text-center">Vault locked</h1>
        <p className="text-slate-400 text-sm text-center">Enter your master passphrase to view your documents.</p>
        <input
          className="input"
          type="password"
          placeholder="Master passphrase"
          value={unlockInput}
          onChange={(e) => setUnlockInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
        />
        {unlockError && <p className="text-rose-400 text-xs">{unlockError}</p>}
        <button className="btn-primary w-full" onClick={tryUnlock}>Unlock</button>
      </div>
    )
  }

  return <VaultContents items={items} uid={user.uid} passphrase={vault.passphrase} onLock={vault.lock} />

  async function tryUnlock() {
    setUnlockError('')
    const ok = await vault.unlock(unlockInput)
    if (!ok) setUnlockError('Incorrect passphrase.')
    setUnlockInput('')
  }
}

function SetupMasterPassword({ onDone }) {
  const vault = useVault()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (p1.length < 8) return setError('Use at least 8 characters.')
    if (p1 !== p2) return setError('Passphrases do not match.')
    await vault.setupMasterPassword(p1)
    onDone()
  }

  return (
    <div className="max-w-md mx-auto mt-10 card p-6 space-y-4">
      <h1 className="font-display text-lg font-semibold">Set up your document vault</h1>
      <p className="text-slate-400 text-sm">
        Choose a master passphrase for encrypting usernames and passwords stored here (AES-256-CBC).
        It is <strong className="text-slate-200">never sent to or stored in the database</strong> — if you
        forget it, this data cannot be recovered. Write it down somewhere safe and offline.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="password" placeholder="New master passphrase" value={p1} onChange={(e) => setP1(e.target.value)} />
        <input className="input" type="password" placeholder="Confirm passphrase" value={p2} onChange={(e) => setP2(e.target.value)} />
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <button className="btn-primary w-full" type="submit">Create vault</button>
      </form>
    </div>
  )
}

function VaultContents({ items, uid, passphrase, onLock }) {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [reveal, setReveal] = useState({})
  const [decrypted, setDecrypted] = useState({}) // id -> { username, password }
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.docName.trim()) return
    setError('')
    try {
      const payload = {
        uid,
        docName: form.docName.trim(),
        link: form.link.trim(),
        note: form.note.trim(),
        username_enc: encryptField(form.username, passphrase),
        password_enc: encryptField(form.password, passphrase),
      }
      if (editingId) {
        await updateDoc(doc(db, 'documents', editingId), payload)
        setEditingId(null)
      } else {
        await addDoc(collection(db, 'documents'), { ...payload, createdAt: serverTimestamp() })
      }
      setForm(emptyForm)
    } catch (err) {
      setError(err.message)
    }
  }

  async function startEdit(item) {
    try {
      const username = decryptField(item.username_enc, passphrase)
      const password = decryptField(item.password_enc, passphrase)
      setEditingId(item.id)
      setForm({ docName: item.docName, username, password, link: item.link || '', note: item.note || '' })
    } catch {
      setError('Could not decrypt this item with the current passphrase.')
    }
  }

  async function toggleReveal(item) {
    if (!reveal[item.id]) {
      try {
        const username = decryptField(item.username_enc, passphrase)
        const password = decryptField(item.password_enc, passphrase)
        setDecrypted((d) => ({ ...d, [item.id]: { username, password } }))
      } catch {
        setError('Could not decrypt this item with the current passphrase.')
        return
      }
    }
    setReveal((r) => ({ ...r, [item.id]: !r[item.id] }))
  }

  async function remove(id) {
    if (!confirm('Delete this document permanently?')) return
    await deleteDoc(doc(db, 'documents', id))
    if (editingId === id) { setEditingId(null); setForm(emptyForm) }
  }

  function copy(text) {
    navigator.clipboard?.writeText(text)
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-lg font-semibold">Documents</h1>
        <button className="btn-ghost text-xs" onClick={onLock}>Lock vault</button>
      </header>

      <form onSubmit={handleSubmit} className="card p-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label mb-1 block">Name</label>
          <input className="input" required value={form.docName} onChange={(e) => setForm({ ...form, docName: e.target.value })} placeholder="e.g. BCA Mobile Banking" />
        </div>
        <div>
          <label className="label mb-1 block">Username / User ID</label>
          <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <label className="label mb-1 block">Password</label>
          <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <label className="label mb-1 block">Link (optional)</label>
          <input className="input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
        </div>
        <div>
          <label className="label mb-1 block">Notes (optional)</label>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        {error && <p className="text-rose-400 text-xs sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2 flex gap-2">
          <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Add document'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Cancel</button>}
        </div>
      </form>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-slate-500 text-sm">No documents saved yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-medium">{item.docName}</h3>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer noopener" className="text-xs text-accent break-all">{item.link}</a>
                )}
                {item.note && <p className="text-xs text-slate-500 mt-1">{item.note}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => toggleReveal(item)}>
                  {reveal[item.id] ? 'Hide' : 'Reveal'}
                </button>
                <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(item)}>Edit</button>
                <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(item.id)}>Delete</button>
              </div>
            </div>

            {reveal[item.id] && decrypted[item.id] && (
              <div className="mt-3 grid sm:grid-cols-2 gap-2 text-sm font-mono bg-black/20 rounded-lg p-3">
                <FieldRow label="Username" value={decrypted[item.id].username} onCopy={copy} />
                <FieldRow label="Password" value={decrypted[item.id].password} onCopy={copy} mask />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FieldRow({ label, value, onCopy, mask }) {
  const [show, setShow] = useState(!mask)
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500 text-xs w-16 shrink-0">{label}</span>
      <span className="flex-1 truncate">{value ? (show ? value : '••••••••') : '—'}</span>
      {mask && value && (
        <button className="text-xs text-slate-400 hover:text-accent" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
      )}
      {value && <button className="text-xs text-slate-400 hover:text-accent" onClick={() => onCopy(value)}>Copy</button>}
    </div>
  )
}
