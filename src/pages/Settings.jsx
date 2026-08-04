import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { useVault } from '../context/VaultContext.jsx'
import { decryptField, encryptField } from '../lib/vaultCrypto'

const PALETTE = ['#2DD4BF', '#F59E0B', '#F43F5E', '#818CF8', '#34D399', '#FB923C', '#F472B6', '#38BDF8', '#A78BFA', '#FACC15']

export default function Settings() {
  return (
    <div className="space-y-8">
      <h1 className="font-display text-lg font-semibold">Settings</h1>
      <ExpenseCategorySettings />
      <VaultSettings />
    </div>
  )
}

function ExpenseCategorySettings() {
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])

  useEffect(() => {
    const q = query(collection(db, 'expenseCategories'), where('uid', '==', user.uid))
    return onSnapshot(q, (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user])

  async function addCategory(e) {
    e.preventDefault()
    if (!name.trim()) return
    await addDoc(collection(db, 'expenseCategories'), { uid: user.uid, name: name.trim(), color })
    setName('')
    setColor(PALETTE[(categories.length + 1) % PALETTE.length])
  }

  async function renameCategory(cat, newName) {
    await updateDoc(doc(db, 'expenseCategories', cat.id), { name: newName })
  }

  async function recolorCategory(cat, newColor) {
    await updateDoc(doc(db, 'expenseCategories', cat.id), { color: newColor })
  }

  async function removeCategory(id) {
    if (!confirm('Delete this category? Existing expenses will keep showing as "Uncategorized".')) return
    await deleteDoc(doc(db, 'expenseCategories', id))
  }

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="font-display font-medium">Expense Categories</h2>
        <p className="text-xs text-slate-500 mt-1">These appear as options in the Expenses page and drive the pie chart colors.</p>
      </div>

      <form onSubmit={addCategory} className="flex flex-wrap gap-2 items-center">
        <input className="input flex-1 min-w-[160px]" placeholder="e.g. Coffee" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="h-9 w-12 rounded border border-white/10 bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} />
        <button className="btn-primary" type="submit">Add category</button>
      </form>

      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <input type="color" className="h-7 w-9 rounded border border-white/10 bg-transparent" value={c.color} onChange={(e) => recolorCategory(c, e.target.value)} />
            <input className="input flex-1" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && renameCategory(c, e.target.value.trim())} />
            <button className="text-xs text-slate-400 hover:text-rose-400 px-2" onClick={() => removeCategory(c.id)}>Delete</button>
          </li>
        ))}
        {categories.length === 0 && <p className="text-slate-500 text-sm">No categories yet — add your first one above.</p>}
      </ul>
    </section>
  )
}

function VaultSettings() {
  const { user } = useAuth()
  const vault = useVault()
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleChange(e) {
    e.preventDefault()
    setStatus('')
    if (newPass.length < 8) return setStatus('New passphrase must be at least 8 characters.')
    if (newPass !== newPass2) return setStatus('New passphrases do not match.')
    setBusy(true)
    try {
      await vault.changeMasterPassword(oldPass, newPass, async (oldP, newP) => {
        const snap = await getDocs(query(collection(db, 'documents'), where('uid', '==', user.uid)))
        for (const docSnap of snap.docs) {
          const data = docSnap.data()
          const username = decryptField(data.username_enc, oldP)
          const password = decryptField(data.password_enc, oldP)
          await updateDoc(doc(db, 'documents', docSnap.id), {
            username_enc: encryptField(username, newP),
            password_enc: encryptField(password, newP),
          })
        }
      })
      setStatus('Master passphrase changed and all documents re-encrypted.')
      setOldPass(''); setNewPass(''); setNewPass2('')
    } catch (err) {
      setStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="font-display font-medium">Document Vault</h2>
        <p className="text-xs text-slate-500 mt-1">
          Documents (usernames and passwords) are encrypted client-side with AES-256-CBC before they
          are sent to Firestore. Each item has its own random salt and IV, and the encryption key is
          derived from your master passphrase using PBKDF2 (SHA-256, 210,000 iterations) — the
          passphrase itself is never transmitted or stored anywhere. To decrypt, use the "Unlock" step
          on the Documents page and enter the same passphrase; changing it below re-encrypts every
          saved item with the new one.
        </p>
      </div>

      <form onSubmit={handleChange} className="space-y-3 max-w-sm">
        <div>
          <label className="label mb-1 block">Current passphrase</label>
          <input className="input" type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} />
        </div>
        <div>
          <label className="label mb-1 block">New passphrase</label>
          <input className="input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
        </div>
        <div>
          <label className="label mb-1 block">Confirm new passphrase</label>
          <input className="input" type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} />
        </div>
        {status && <p className="text-xs text-slate-300">{status}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Re-encrypting…' : 'Change passphrase'}</button>
      </form>
    </section>
  )
}
