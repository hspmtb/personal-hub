import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatIDR, formatUSD } from '../lib/currency'

const emptyForm = {
  tanggalBeli: '', namaSaham: '', country: 'INA', lot: '',
  hargaBeliUsd: '', hargaBeliRp: '',
  tanggalJual: '', hargaJualUsd: '', hargaJualRp: '',
}

export default function Saham() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'stocks'), where('uid', '==', user.uid), orderBy('tanggalBeli'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user])

  function profitOf(r) {
    if (r.hargaJualRp === null || r.hargaJualRp === undefined || r.hargaJualRp === '') return null
    return r.lot * (r.hargaJualRp - r.hargaBeliRp)
  }

  const totals = useMemo(() => {
    let beliUsd = 0, beliRp = 0, profitRp = 0
    for (const r of rows) {
      beliUsd += r.hargaBeliUsd || 0
      beliRp += r.hargaBeliRp || 0
      const p = profitOf(r)
      if (p !== null) profitRp += p
    }
    return { beliUsd, beliRp, profitRp }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.tanggalBeli || !form.namaSaham.trim() || !form.lot) return
    const payload = {
      uid: user.uid,
      tanggalBeli: form.tanggalBeli,
      namaSaham: form.namaSaham.trim(),
      country: form.country,
      lot: parseFloat(form.lot) || 0,
      hargaBeliUsd: parseFloat(form.hargaBeliUsd) || 0,
      hargaBeliRp: parseFloat(form.hargaBeliRp) || 0,
      tanggalJual: form.tanggalJual || null,
      hargaJualUsd: form.hargaJualUsd === '' ? null : parseFloat(form.hargaJualUsd),
      hargaJualRp: form.hargaJualRp === '' ? null : parseFloat(form.hargaJualRp),
    }
    if (editingId) {
      await updateDoc(doc(db, 'stocks', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'stocks'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyForm)
  }

  function startEdit(r) {
    setEditingId(r.id)
    setForm({
      tanggalBeli: r.tanggalBeli,
      namaSaham: r.namaSaham,
      country: r.country,
      lot: String(r.lot),
      hargaBeliUsd: String(r.hargaBeliUsd ?? ''),
      hargaBeliRp: String(r.hargaBeliRp ?? ''),
      tanggalJual: r.tanggalJual || '',
      hargaJualUsd: r.hargaJualUsd === null || r.hargaJualUsd === undefined ? '' : String(r.hargaJualUsd),
      hargaJualRp: r.hargaJualRp === null || r.hargaJualRp === undefined ? '' : String(r.hargaJualRp),
    })
  }

  async function remove(id) {
    if (!confirm('Hapus data saham ini?')) return
    await deleteDoc(doc(db, 'stocks', id))
    if (editingId === id) { setEditingId(null); setForm(emptyForm) }
  }

  const lotStep = form.country === 'USA' ? '0.0001' : '1'

  return (
    <div className="space-y-6">
      <h1 className="font-display text-lg font-semibold">Saham</h1>

      {/* Add / edit form */}
      <form onSubmit={handleSubmit} className="card p-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="label mb-1 block">Tanggal Beli</label>
          <input className="input" type="date" required value={form.tanggalBeli} onChange={(e) => setForm({ ...form, tanggalBeli: e.target.value })} />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="label mb-1 block">Nama Saham</label>
          <input className="input" required value={form.namaSaham} onChange={(e) => setForm({ ...form, namaSaham: e.target.value })} placeholder="BBCA / AAPL" />
        </div>
        <div>
          <label className="label mb-1 block">Country</label>
          <select className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            <option value="INA">INA</option>
            <option value="USA">USA</option>
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Lot</label>
          <input
            className="input" type="number" step={lotStep} required
            value={form.lot} onChange={(e) => setForm({ ...form, lot: e.target.value })}
            placeholder={form.country === 'USA' ? '0.006' : '10'}
          />
          <p className="text-[11px] text-slate-500 mt-0.5">{form.country === 'USA' ? 'Boleh desimal' : 'Biasanya bilangan bulat'}</p>
        </div>
        <div>
          <label className="label mb-1 block">Harga Beli $</label>
          <input className="input" type="number" step="0.0001" value={form.hargaBeliUsd} onChange={(e) => setForm({ ...form, hargaBeliUsd: e.target.value })} placeholder="0" />
        </div>
        <div>
          <label className="label mb-1 block">Harga Beli Rp</label>
          <input className="input" type="number" step="1" value={form.hargaBeliRp} onChange={(e) => setForm({ ...form, hargaBeliRp: e.target.value })} placeholder="0" />
        </div>
        <div>
          <label className="label mb-1 block">Tanggal Jual</label>
          <input className="input" type="date" value={form.tanggalJual} onChange={(e) => setForm({ ...form, tanggalJual: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">Harga Jual $</label>
          <input className="input" type="number" step="0.0001" value={form.hargaJualUsd} onChange={(e) => setForm({ ...form, hargaJualUsd: e.target.value })} placeholder="Belum dijual" />
        </div>
        <div>
          <label className="label mb-1 block">Harga Jual Rp</label>
          <input className="input" type="number" step="1" value={form.hargaJualRp} onChange={(e) => setForm({ ...form, hargaJualRp: e.target.value })} placeholder="Belum dijual" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Tambah'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Batal</button>}
        </div>
      </form>

      {/* List */}
      <div className="card p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="text-left text-slate-500 text-xs uppercase">
              <th className="py-1.5 pr-3">No</th>
              <th className="py-1.5 pr-3">Tanggal Beli</th>
              <th className="py-1.5 pr-3">Nama Saham</th>
              <th className="py-1.5 pr-3">Country</th>
              <th className="py-1.5 pr-3">Lot</th>
              <th className="py-1.5 pr-3">Harga Beli $</th>
              <th className="py-1.5 pr-3">Harga Beli Rp</th>
              <th className="py-1.5 pr-3">Tanggal Jual</th>
              <th className="py-1.5 pr-3">Harga Jual $</th>
              <th className="py-1.5 pr-3">Harga Jual Rp</th>
              <th className="py-1.5 pr-3">Profit Rp</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const profit = profitOf(r)
              return (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-slate-500">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalBeli}</td>
                  <td className="py-1.5 pr-3">{r.namaSaham}</td>
                  <td className="py-1.5 pr-3">{r.country}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.lot}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatUSD(r.hargaBeliUsd)}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatIDR(r.hargaBeliRp)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalJual || '—'}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJualUsd === null || r.hargaJualUsd === undefined ? '—' : formatUSD(r.hargaJualUsd)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJualRp === null || r.hargaJualRp === undefined ? '—' : formatIDR(r.hargaJualRp)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${profit === null ? '' : profit >= 0 ? 'text-accent' : 'text-rose-400'}`}>
                    {profit === null ? '—' : formatIDR(profit)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                    <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={12} className="py-3 text-slate-500 text-center">Belum ada data saham.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 font-medium">
                <td className="py-2 pr-3" colSpan={5}>Total</td>
                <td className="py-2 pr-3 font-mono">{formatUSD(totals.beliUsd)}</td>
                <td className="py-2 pr-3 font-mono">{formatIDR(totals.beliRp)}</td>
                <td colSpan={3}></td>
                <td className={`py-2 pr-3 font-mono ${totals.profitRp >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatIDR(totals.profitRp)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="text-[11px] text-slate-500 mt-2">Total Profit Rp hanya menjumlahkan saham yang sudah ada Harga Jual Rp-nya (yang belum dijual tidak ikut dihitung).</p>
      </div>
    </div>
  )
}
