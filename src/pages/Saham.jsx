import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatIDR, formatUSD } from '../lib/currency'

const emptyForm = {
  tanggalBeli: '', namaSaham: '', country: 'INA', lot: '',
  hargaBeliUsdTotal: '', hargaBeliUsdPerLot: '', hargaBeliRp: '',
  tanggalJual: '', hargaJualUsdTotal: '', hargaJualUsdPerLot: '', hargaJualRp: '',
}

// Older records only had a single `hargaBeliUsd` / `hargaJualUsd` value
// (before Total vs Per-Lot were split out). Treat that old value as the
// "Total" and derive Per-Lot from it so nothing breaks.
function normalizeStock(id, data) {
  const lot = data.lot || 0
  const beliTotal = data.hargaBeliUsdTotal ?? data.hargaBeliUsd ?? 0
  const beliPerLot = data.hargaBeliUsdPerLot ?? (lot > 0 ? beliTotal / lot : 0)
  const jualTotalRaw = data.hargaJualUsdTotal ?? data.hargaJualUsd
  const jualTotal = jualTotalRaw === undefined || jualTotalRaw === null ? null : jualTotalRaw
  const jualPerLot = data.hargaJualUsdPerLot ?? (jualTotal !== null && lot > 0 ? jualTotal / lot : null)
  return {
    id, ...data,
    hargaBeliUsdTotal: beliTotal,
    hargaBeliUsdPerLot: beliPerLot,
    hargaJualUsdTotal: jualTotal,
    hargaJualUsdPerLot: jualPerLot,
  }
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}

export default function Saham() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [beliPerLotTouched, setBeliPerLotTouched] = useState(false)
  const [jualPerLotTouched, setJualPerLotTouched] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'stocks'), where('uid', '==', user.uid), orderBy('tanggalBeli'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => normalizeStock(d.id, d.data()))))
  }, [user])

  function profitRpOf(r) {
    if (r.hargaJualRp === null || r.hargaJualRp === undefined || r.hargaJualRp === '') return null
    return r.lot * (r.hargaJualRp - r.hargaBeliRp)
  }

  function profitUsdOf(r) {
    if (r.hargaJualUsdPerLot === null || r.hargaJualUsdPerLot === undefined) return null
    return r.lot * (r.hargaJualUsdPerLot - r.hargaBeliUsdPerLot)
  }

  const totals = useMemo(() => {
    let beliUsd = 0, beliRp = 0, profitRp = 0, profitUsd = 0
    for (const r of rows) {
      beliUsd += r.hargaBeliUsdTotal || 0
      beliRp += r.hargaBeliRp || 0
      const pr = profitRpOf(r)
      if (pr !== null) profitRp += pr
      const pu = profitUsdOf(r)
      if (pu !== null) profitUsd += pu
    }
    return { beliUsd, beliRp, profitRp, profitUsd }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  // --- Form field handlers: keep "Harga per Lot" auto-calculated from
  // Total ÷ Lot, unless the user has typed directly into that field. ---

  function updateLot(value) {
    const lot = parseFloat(value) || 0
    setForm((f) => {
      const next = { ...f, lot: value }
      if (!beliPerLotTouched) {
        const total = parseFloat(f.hargaBeliUsdTotal) || 0
        next.hargaBeliUsdPerLot = lot > 0 ? String(round4(total / lot)) : ''
      }
      if (!jualPerLotTouched && f.hargaJualUsdTotal !== '') {
        const total = parseFloat(f.hargaJualUsdTotal) || 0
        next.hargaJualUsdPerLot = lot > 0 ? String(round4(total / lot)) : ''
      }
      return next
    })
  }

  function updateBeliTotal(value) {
    setForm((f) => {
      const next = { ...f, hargaBeliUsdTotal: value }
      const lot = parseFloat(f.lot) || 0
      if (!beliPerLotTouched && lot > 0) {
        next.hargaBeliUsdPerLot = String(round4((parseFloat(value) || 0) / lot))
      }
      return next
    })
  }

  function updateJualTotal(value) {
    setForm((f) => {
      const next = { ...f, hargaJualUsdTotal: value }
      const lot = parseFloat(f.lot) || 0
      if (!jualPerLotTouched && lot > 0 && value !== '') {
        next.hargaJualUsdPerLot = String(round4((parseFloat(value) || 0) / lot))
      }
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.tanggalBeli || !form.namaSaham.trim() || !form.lot) return
    const payload = {
      uid: user.uid,
      tanggalBeli: form.tanggalBeli,
      namaSaham: form.namaSaham.trim(),
      country: form.country,
      lot: parseFloat(form.lot) || 0,
      hargaBeliUsdTotal: parseFloat(form.hargaBeliUsdTotal) || 0,
      hargaBeliUsdPerLot: parseFloat(form.hargaBeliUsdPerLot) || 0,
      hargaBeliRp: parseFloat(form.hargaBeliRp) || 0,
      tanggalJual: form.tanggalJual || null,
      hargaJualUsdTotal: form.hargaJualUsdTotal === '' ? null : parseFloat(form.hargaJualUsdTotal),
      hargaJualUsdPerLot: form.hargaJualUsdPerLot === '' ? null : parseFloat(form.hargaJualUsdPerLot),
      hargaJualRp: form.hargaJualRp === '' ? null : parseFloat(form.hargaJualRp),
    }
    if (editingId) {
      await updateDoc(doc(db, 'stocks', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'stocks'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyForm)
    setBeliPerLotTouched(false)
    setJualPerLotTouched(false)
  }

  function startEdit(r) {
    setEditingId(r.id)
    setBeliPerLotTouched(true) // editing an existing row: don't silently recompute its saved per-lot price
    setJualPerLotTouched(true)
    setForm({
      tanggalBeli: r.tanggalBeli,
      namaSaham: r.namaSaham,
      country: r.country,
      lot: String(r.lot),
      hargaBeliUsdTotal: String(r.hargaBeliUsdTotal ?? ''),
      hargaBeliUsdPerLot: String(r.hargaBeliUsdPerLot ?? ''),
      hargaBeliRp: String(r.hargaBeliRp ?? ''),
      tanggalJual: r.tanggalJual || '',
      hargaJualUsdTotal: r.hargaJualUsdTotal === null || r.hargaJualUsdTotal === undefined ? '' : String(r.hargaJualUsdTotal),
      hargaJualUsdPerLot: r.hargaJualUsdPerLot === null || r.hargaJualUsdPerLot === undefined ? '' : String(r.hargaJualUsdPerLot),
      hargaJualRp: r.hargaJualRp === null || r.hargaJualRp === undefined ? '' : String(r.hargaJualRp),
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
    setBeliPerLotTouched(false)
    setJualPerLotTouched(false)
  }

  async function remove(id) {
    if (!confirm('Hapus data saham ini?')) return
    await deleteDoc(doc(db, 'stocks', id))
    if (editingId === id) cancelEdit()
  }

  const lotStep = form.country === 'USA' ? '0.0001' : '1'

  return (
    <div className="space-y-6">
      <h1 className="font-display text-lg font-semibold">Saham</h1>

      {/* Add / edit form */}
      <form onSubmit={handleSubmit} className="card p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label mb-1 block">Tanggal Beli</label>
            <input className="input" type="date" required value={form.tanggalBeli} onChange={(e) => setForm({ ...form, tanggalBeli: e.target.value })} />
          </div>
          <div>
            <label className="label mb-1 block">Nama Saham</label>
            <input className="input" required value={form.namaSaham} onChange={(e) => setForm({ ...form, namaSaham: e.target.value })} placeholder="BBCA / GOOGL" />
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
              value={form.lot} onChange={(e) => updateLot(e.target.value)}
              placeholder={form.country === 'USA' ? '0.6' : '10'}
            />
            <p className="text-[11px] text-slate-500 mt-0.5">{form.country === 'USA' ? 'Boleh desimal' : 'Biasanya bilangan bulat'}</p>
          </div>
        </div>

        {/* Buy side */}
        <div className="border-t border-white/10 pt-4">
          <p className="label mb-2">Data Beli</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label mb-1 block">Total Harga Beli $</label>
              <input className="input" type="number" step="0.0001" value={form.hargaBeliUsdTotal} onChange={(e) => updateBeliTotal(e.target.value)} placeholder="263.49" />
              <p className="text-[11px] text-slate-500 mt-0.5">Nominal total yang dibayar</p>
            </div>
            <div>
              <label className="label mb-1 block">Harga per Lot $</label>
              <input
                className="input" type="number" step="0.0001"
                value={form.hargaBeliUsdPerLot}
                onChange={(e) => { setBeliPerLotTouched(true); setForm({ ...form, hargaBeliUsdPerLot: e.target.value }) }}
              />
              <p className="text-[11px] text-slate-500 mt-0.5">Otomatis = Total ÷ Lot, bisa diedit</p>
            </div>
            <div>
              <label className="label mb-1 block">Harga Beli Rp</label>
              <input className="input" type="number" step="1" value={form.hargaBeliRp} onChange={(e) => setForm({ ...form, hargaBeliRp: e.target.value })} placeholder="0" />
            </div>
          </div>
        </div>

        {/* Sell side */}
        <div className="border-t border-white/10 pt-4">
          <p className="label mb-2">Data Jual (kosongkan kalau belum dijual)</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label mb-1 block">Tanggal Jual</label>
              <input className="input" type="date" value={form.tanggalJual} onChange={(e) => setForm({ ...form, tanggalJual: e.target.value })} />
            </div>
            <div>
              <label className="label mb-1 block">Total Harga Jual $</label>
              <input className="input" type="number" step="0.0001" value={form.hargaJualUsdTotal} onChange={(e) => updateJualTotal(e.target.value)} placeholder="Belum dijual" />
            </div>
            <div>
              <label className="label mb-1 block">Harga per Lot Jual $</label>
              <input
                className="input" type="number" step="0.0001"
                value={form.hargaJualUsdPerLot}
                onChange={(e) => { setJualPerLotTouched(true); setForm({ ...form, hargaJualUsdPerLot: e.target.value }) }}
                placeholder="Otomatis"
              />
            </div>
            <div>
              <label className="label mb-1 block">Harga Jual Rp</label>
              <input className="input" type="number" step="1" value={form.hargaJualRp} onChange={(e) => setForm({ ...form, hargaJualRp: e.target.value })} placeholder="Belum dijual" />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Tambah'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={cancelEdit}>Batal</button>}
        </div>
      </form>

      {/* List */}
      <div className="card p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[1500px]">
          <thead>
            <tr className="text-left text-slate-500 text-xs uppercase">
              <th className="py-1.5 pr-3">No</th>
              <th className="py-1.5 pr-3">Tanggal Beli</th>
              <th className="py-1.5 pr-3">Nama Saham</th>
              <th className="py-1.5 pr-3">Country</th>
              <th className="py-1.5 pr-3">Lot</th>
              <th className="py-1.5 pr-3">Total Beli $</th>
              <th className="py-1.5 pr-3">Harga/Lot Beli $</th>
              <th className="py-1.5 pr-3">Harga Beli Rp</th>
              <th className="py-1.5 pr-3">Tanggal Jual</th>
              <th className="py-1.5 pr-3">Total Jual $</th>
              <th className="py-1.5 pr-3">Harga/Lot Jual $</th>
              <th className="py-1.5 pr-3">Harga Jual Rp</th>
              <th className="py-1.5 pr-3">Profit $</th>
              <th className="py-1.5 pr-3">Profit Rp</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const profitRp = profitRpOf(r)
              const profitUsd = profitUsdOf(r)
              return (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-slate-500">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalBeli}</td>
                  <td className="py-1.5 pr-3">{r.namaSaham}</td>
                  <td className="py-1.5 pr-3">{r.country}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.lot}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatUSD(r.hargaBeliUsdTotal)}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatUSD(r.hargaBeliUsdPerLot)}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatIDR(r.hargaBeliRp)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalJual || '—'}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJualUsdTotal === null || r.hargaJualUsdTotal === undefined ? '—' : formatUSD(r.hargaJualUsdTotal)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJualUsdPerLot === null || r.hargaJualUsdPerLot === undefined ? '—' : formatUSD(r.hargaJualUsdPerLot)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJualRp === null || r.hargaJualRp === undefined ? '—' : formatIDR(r.hargaJualRp)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${profitUsd === null ? '' : profitUsd >= 0 ? 'text-accent' : 'text-rose-400'}`}>
                    {profitUsd === null ? '—' : formatUSD(profitUsd)}
                  </td>
                  <td className={`py-1.5 pr-3 font-mono ${profitRp === null ? '' : profitRp >= 0 ? 'text-accent' : 'text-rose-400'}`}>
                    {profitRp === null ? '—' : formatIDR(profitRp)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                    <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={15} className="py-3 text-slate-500 text-center">Belum ada data saham.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 font-medium">
                <td className="py-2 pr-3" colSpan={5}>Total</td>
                <td className="py-2 pr-3 font-mono">{formatUSD(totals.beliUsd)}</td>
                <td colSpan={2}></td>
                <td className="py-2 pr-3 font-mono">{formatIDR(totals.beliRp)}</td>
                <td colSpan={3}></td>
                <td className={`py-2 pr-3 font-mono ${totals.profitUsd >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatUSD(totals.profitUsd)}</td>
                <td className={`py-2 pr-3 font-mono ${totals.profitRp >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatIDR(totals.profitRp)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="text-[11px] text-slate-500 mt-2">Total Profit hanya menjumlahkan saham yang sudah ada harga jualnya (yang belum dijual tidak ikut dihitung).</p>
      </div>
    </div>
  )
}
