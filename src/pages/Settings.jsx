import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, orderBy, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { useVault } from '../context/VaultContext.jsx'
import { decryptField, encryptField } from '../lib/vaultCrypto'

const PALETTE = ['#2DD4BF', '#F59E0B', '#F43F5E', '#818CF8', '#34D399', '#FB923C', '#F472B6', '#38BDF8', '#A78BFA', '#FACC15']

async function setRentalSettingsDoc(uid, data) {
  await setDoc(doc(db, 'rentalSettings', uid), { uid, ...data }, { merge: true })
}

export default function Settings() {
  return (
    <div className="space-y-8">
      <h1 className="font-display text-lg font-semibold">Settings</h1>
      <ExpenseCategorySettings />
      <RentalUnitSettings />
      <RentalBankSettings />
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

const emptyRentalForm = { noKontrakan: '', namaPenyewa: '', uangSewa: '', iuranRT: '', uangInternet: '', kubikAwal: '' }

function RentalUnitSettings() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [form, setForm] = useState(emptyRentalForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'rentalUnits'), where('uid', '==', user.uid), orderBy('createdAt'))
    return onSnapshot(q, (snap) => setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user])

  async function submit(e) {
    e.preventDefault()
    if (!form.noKontrakan.trim() || !form.namaPenyewa.trim()) return
    const payload = {
      uid: user.uid,
      noKontrakan: form.noKontrakan.trim(),
      namaPenyewa: form.namaPenyewa.trim(),
      uangSewa: Number(form.uangSewa) || 0,
      iuranRT: Number(form.iuranRT) || 0,
      uangInternet: Number(form.uangInternet) || 0,
      kubikAwal: Number(form.kubikAwal) || 0,
    }
    if (editingId) {
      await updateDoc(doc(db, 'rentalUnits', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'rentalUnits'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyRentalForm)
  }

  function startEdit(u) {
    setEditingId(u.id)
    setForm({
      noKontrakan: u.noKontrakan,
      namaPenyewa: u.namaPenyewa,
      uangSewa: String(u.uangSewa),
      iuranRT: String(u.iuranRT),
      uangInternet: String(u.uangInternet),
      kubikAwal: String(u.kubikAwal),
    })
  }

  async function remove(id) {
    if (!confirm('Delete this rental unit? Its monthly Kontrakan history will remain but will no longer show in the list.')) return
    await deleteDoc(doc(db, 'rentalUnits', id))
    if (editingId === id) { setEditingId(null); setForm(emptyRentalForm) }
  }

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="font-display font-medium">Master Kontrakan</h2>
        <p className="text-xs text-slate-500 mt-1">Data unit sewa yang dipakai di menu Kontrakan setiap bulan.</p>
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label mb-1 block">No Kontrakan</label>
          <input className="input" required value={form.noKontrakan} onChange={(e) => setForm({ ...form, noKontrakan: e.target.value })} placeholder="Kontrakan 1" />
        </div>
        <div>
          <label className="label mb-1 block">Nama Penyewa</label>
          <input className="input" required value={form.namaPenyewa} onChange={(e) => setForm({ ...form, namaPenyewa: e.target.value })} placeholder="Fikri" />
        </div>
        <div>
          <label className="label mb-1 block">Uang Sewa</label>
          <input className="input" type="number" min="0" step="1" value={form.uangSewa} onChange={(e) => setForm({ ...form, uangSewa: e.target.value })} placeholder="2000000" />
        </div>
        <div>
          <label className="label mb-1 block">Iuran RT/RW</label>
          <input className="input" type="number" min="0" step="1" value={form.iuranRT} onChange={(e) => setForm({ ...form, iuranRT: e.target.value })} placeholder="50000" />
        </div>
        <div>
          <label className="label mb-1 block">Uang Internet</label>
          <input className="input" type="number" min="0" step="1" value={form.uangInternet} onChange={(e) => setForm({ ...form, uangInternet: e.target.value })} placeholder="75000" />
        </div>
        <div>
          <label className="label mb-1 block">Kubik Awal</label>
          <input className="input" type="number" min="0" step="1" value={form.kubikAwal} onChange={(e) => setForm({ ...form, kubikAwal: e.target.value })} placeholder="35" />
        </div>
        <div className="sm:col-span-3 flex gap-2">
          <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Add Kontrakan'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyRentalForm) }}>Cancel</button>}
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs uppercase">
              <th className="py-1.5 pr-3">No Kontrakan</th>
              <th className="py-1.5 pr-3">Penyewa</th>
              <th className="py-1.5 pr-3">Uang Sewa</th>
              <th className="py-1.5 pr-3">Iuran RT/RW</th>
              <th className="py-1.5 pr-3">Internet</th>
              <th className="py-1.5 pr-3">Kubik Awal</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-t border-white/5">
                <td className="py-1.5 pr-3">{u.noKontrakan}</td>
                <td className="py-1.5 pr-3">{u.namaPenyewa}</td>
                <td className="py-1.5 pr-3 font-mono">{u.uangSewa.toLocaleString('id-ID')}</td>
                <td className="py-1.5 pr-3 font-mono">{u.iuranRT.toLocaleString('id-ID')}</td>
                <td className="py-1.5 pr-3 font-mono">{u.uangInternet.toLocaleString('id-ID')}</td>
                <td className="py-1.5 pr-3 font-mono">{u.kubikAwal}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(u)}>Edit</button>
                  <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(u.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-slate-500 text-center">Belum ada data Kontrakan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RentalBankSettings() {
  const { user } = useAuth()
  const [form, setForm] = useState({ bankName: '', accountNumber: '', accountHolder: '' })
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'rentalSettings'), where('uid', '==', user.uid))).then((snap) => {
      if (!snap.empty) setForm({ ...form, ...snap.docs[0].data() })
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function save(e) {
    e.preventDefault()
    await setRentalSettingsDoc(user.uid, form)
    setStatus('Tersimpan.')
    setTimeout(() => setStatus(''), 2000)
  }

  if (!loaded) return null

  return (
    <section className="card p-4 space-y-3">
      <div>
        <h2 className="font-display font-medium">Info Rekening (untuk Print reminder)</h2>
        <p className="text-xs text-slate-500 mt-1">Muncul di teks "Print" pada menu Kontrakan.</p>
      </div>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 max-w-2xl">
        <div>
          <label className="label mb-1 block">Nama Bank</label>
          <input className="input" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="BCA" />
        </div>
        <div>
          <label className="label mb-1 block">No Rekening</label>
          <input className="input" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} placeholder="1234567890" />
        </div>
        <div>
          <label className="label mb-1 block">Atas Nama</label>
          <input className="input" value={form.accountHolder} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} placeholder="Rony" />
        </div>
        <div className="sm:col-span-3 flex items-center gap-3">
          <button className="btn-primary" type="submit">Simpan</button>
          {status && <span className="text-xs text-slate-400">{status}</span>}
        </div>
      </form>
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
