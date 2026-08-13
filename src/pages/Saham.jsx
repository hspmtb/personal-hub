import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatRpSpaced, formatUsdSpaced } from '../lib/currency'

const LOT_SIZE_INA = 100 // 1 lot IDX = 100 shares

// Shared USD→IDR exchange rate, stored once per user (stockSettings/{uid})
// and used by both the stock totals and the dividend totals below. On
// first load with no saved value yet, it tries to fetch a live rate from
// a free public API; the user can always override or re-fetch manually.
function useKurs(uid) {
  const [kurs, setKursState] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'stockSettings', uid)).then(async (snap) => {
      if (cancelled) return
      if (snap.exists() && snap.data().usdToIdr) {
        setKursState(snap.data().usdToIdr)
        setLoading(false)
      } else {
        await fetchLive()
        if (!cancelled) setLoading(false)
      }
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  async function persist(value) {
    setKursState(value)
    await setDoc(doc(db, 'stockSettings', uid), { uid, usdToIdr: value, updatedAt: serverTimestamp() }, { merge: true })
  }

  async function fetchLive() {
    setFetching(true)
    setError('')
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      const data = await res.json()
      const rate = data?.rates?.IDR
      if (rate) await persist(Math.round(rate))
      else setError('Gagal ambil kurs dari internet.')
    } catch {
      setError('Gagal ambil kurs dari internet — cek koneksi.')
    } finally {
      setFetching(false)
    }
  }

  return { kurs, loading, fetching, error, setKurs: persist, refresh: fetchLive }
}

function fmt(amount, country) {
  return country === 'USA' ? formatUsdSpaced(amount) : formatRpSpaced(amount)
}

function computeTotal(country, hargaPerUnit, lot) {
  return country === 'INA' ? hargaPerUnit * lot * LOT_SIZE_INA : hargaPerUnit * lot
}

const emptyForm = {
  tanggalBeli: '', namaSaham: '', country: 'INA', lot: '',
  hargaBeli: '', totalBeli: '',
  tanggalJual: '', hargaJual: '', totalJual: '',
}

// Migrate older records (from earlier schema versions) onto the current
// simplified shape: a single Harga Beli/Jual per share/lot-unit, with
// Total Beli/Jual computed from the country-specific formula unless a
// value was already explicitly saved.
function normalizeStock(id, data) {
  const country = data.country === 'USA' ? 'USA' : 'INA'
  const lot = data.lot || 0

  let hargaBeli = data.hargaBeli
  if (hargaBeli === undefined) {
    hargaBeli = country === 'USA' ? (data.hargaBeliUsdPerLot ?? data.hargaBeliUsdTotal ?? data.hargaBeliUsd ?? 0) : (data.hargaBeliRp ?? 0)
  }
  let totalBeli = data.totalBeli
  if (totalBeli === undefined) totalBeli = computeTotal(country, hargaBeli, lot)

  const hasJual = data.hargaJual !== undefined
    ? data.hargaJual !== null
    : (country === 'USA' ? (data.hargaJualUsdPerLot ?? data.hargaJualUsdTotal ?? data.hargaJualUsd) : data.hargaJualRp) != null

  let hargaJual = data.hargaJual
  if (hargaJual === undefined) {
    hargaJual = hasJual
      ? (country === 'USA' ? (data.hargaJualUsdPerLot ?? data.hargaJualUsdTotal ?? data.hargaJualUsd) : data.hargaJualRp)
      : null
  }
  let totalJual = data.totalJual
  if (totalJual === undefined) totalJual = hasJual ? computeTotal(country, hargaJual, lot) : null

  return {
    id, ...data, country, lot, hargaBeli, totalBeli,
    tanggalJual: data.tanggalJual || null,
    hargaJual, totalJual,
  }
}

export default function Saham() {
  const { user } = useAuth()
  const kursCtl = useKurs(user.uid)
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [totalBeliTouched, setTotalBeliTouched] = useState(false)
  const [totalJualTouched, setTotalJualTouched] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'stocks'), where('uid', '==', user.uid), orderBy('tanggalBeli'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => normalizeStock(d.id, d.data()))))
  }, [user])

  function profitOf(r) {
    if (r.totalJual === null || r.totalJual === undefined) return null
    return r.totalJual - r.totalBeli
  }

  const totals = useMemo(() => {
    let beliINA = 0, beliUS = 0, profitINA = 0, profitUS = 0
    for (const r of rows) {
      const p = profitOf(r)
      if (r.country === 'INA') {
        beliINA += r.totalBeli || 0
        if (p !== null) profitINA += p
      } else {
        beliUS += r.totalBeli || 0
        if (p !== null) profitUS += p
      }
    }
    return { beliINA, beliUS, profitINA, profitUS }
  }, [rows])

  // --- Auto-calc Total Beli/Jual from the formula, unless the user typed
  // directly into that field (same "touched" pattern used elsewhere). ---

  function recalc(f, patch) {
    const next = { ...f, ...patch }
    const lot = parseFloat(next.lot) || 0
    if (!totalBeliTouched) {
      const harga = parseFloat(next.hargaBeli) || 0
      next.totalBeli = String(computeTotal(next.country, harga, lot))
    }
    if (!totalJualTouched && next.hargaJual !== '') {
      const harga = parseFloat(next.hargaJual) || 0
      next.totalJual = String(computeTotal(next.country, harga, lot))
    }
    return next
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
      hargaBeli: parseFloat(form.hargaBeli) || 0,
      totalBeli: parseFloat(form.totalBeli) || 0,
      tanggalJual: form.tanggalJual || null,
      hargaJual: form.hargaJual === '' ? null : parseFloat(form.hargaJual),
      totalJual: form.totalJual === '' ? null : parseFloat(form.totalJual),
    }
    if (editingId) {
      await updateDoc(doc(db, 'stocks', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'stocks'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyForm)
    setTotalBeliTouched(false)
    setTotalJualTouched(false)
  }

  function startEdit(r) {
    setEditingId(r.id)
    setTotalBeliTouched(true) // editing an existing row: don't silently recompute its saved total
    setTotalJualTouched(true)
    setForm({
      tanggalBeli: r.tanggalBeli,
      namaSaham: r.namaSaham,
      country: r.country,
      lot: String(r.lot),
      hargaBeli: String(r.hargaBeli ?? ''),
      totalBeli: String(r.totalBeli ?? ''),
      tanggalJual: r.tanggalJual || '',
      hargaJual: r.hargaJual === null || r.hargaJual === undefined ? '' : String(r.hargaJual),
      totalJual: r.totalJual === null || r.totalJual === undefined ? '' : String(r.totalJual),
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
    setTotalBeliTouched(false)
    setTotalJualTouched(false)
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
            <label className="label mb-1 block">Kode Saham</label>
            <input className="input" required value={form.namaSaham} onChange={(e) => setForm({ ...form, namaSaham: e.target.value })} placeholder="BBCA / GOOG" />
          </div>
          <div>
            <label className="label mb-1 block">Country</label>
            <select className="input" value={form.country} onChange={(e) => setForm(recalc(form, { country: e.target.value }))}>
              <option value="INA">INA</option>
              <option value="USA">USA</option>
            </select>
          </div>
          <div>
            <label className="label mb-1 block">{form.country === 'INA' ? 'Lot' : 'Lot/Lembar'}</label>
            <input
              className="input" type="number" step={lotStep} required
              value={form.lot} onChange={(e) => setForm(recalc(form, { lot: e.target.value }))}
              placeholder={form.country === 'USA' ? '0.53' : '10'}
            />
            <p className="text-[11px] text-slate-500 mt-0.5">
              {form.country === 'INA' ? '1 lot = 100 lembar saham' : 'Boleh desimal (fractional share)'}
            </p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="label mb-2">Data Beli</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1 block">Harga Beli {form.country === 'USA' ? '($ per lembar)' : '(Rp per lembar)'}</label>
              <input className="input" type="number" step="0.0001" value={form.hargaBeli} onChange={(e) => setForm(recalc(form, { hargaBeli: e.target.value }))} placeholder={form.country === 'USA' ? '501.2365' : '5600'} />
            </div>
            <div>
              <label className="label mb-1 block">Total Beli</label>
              <input
                className="input" type="number" step="1"
                value={form.totalBeli}
                onChange={(e) => { setTotalBeliTouched(true); setForm({ ...form, totalBeli: e.target.value }) }}
              />
              <p className="text-[11px] text-slate-500 mt-0.5">
                Otomatis = {form.country === 'INA' ? 'Lot × Harga × 100' : 'Lot × Harga'}, bisa diedit
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="label mb-2">Data Jual (kosongkan kalau belum dijual)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label mb-1 block">Tanggal Jual</label>
              <input className="input" type="date" value={form.tanggalJual} onChange={(e) => setForm({ ...form, tanggalJual: e.target.value })} />
            </div>
            <div>
              <label className="label mb-1 block">Harga Jual</label>
              <input className="input" type="number" step="0.0001" value={form.hargaJual} onChange={(e) => setForm(recalc(form, { hargaJual: e.target.value }))} placeholder="Belum dijual" />
            </div>
            <div>
              <label className="label mb-1 block">Total Jual</label>
              <input
                className="input" type="number" step="1"
                value={form.totalJual}
                onChange={(e) => { setTotalJualTouched(true); setForm({ ...form, totalJual: e.target.value }) }}
                placeholder="Otomatis"
              />
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
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="text-left text-slate-500 text-xs uppercase">
              <th className="py-1.5 pr-3">Tgl Beli</th>
              <th className="py-1.5 pr-3">Country</th>
              <th className="py-1.5 pr-3">Kode Saham</th>
              <th className="py-1.5 pr-3">Lot/Lembar</th>
              <th className="py-1.5 pr-3">Harga Beli</th>
              <th className="py-1.5 pr-3">Total Beli</th>
              <th className="py-1.5 pr-3">Tgl Jual</th>
              <th className="py-1.5 pr-3">Harga Jual</th>
              <th className="py-1.5 pr-3">Total Jual</th>
              <th className="py-1.5 pr-3">Profit</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const profit = profitOf(r)
              return (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalBeli}</td>
                  <td className="py-1.5 pr-3">{r.country}</td>
                  <td className="py-1.5 pr-3">{r.namaSaham}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.lot}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(r.hargaBeli, r.country)}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmt(r.totalBeli, r.country)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.tanggalJual || '—'}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.hargaJual === null || r.hargaJual === undefined ? '—' : fmt(r.hargaJual, r.country)}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.totalJual === null || r.totalJual === undefined ? '—' : fmt(r.totalJual, r.country)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${profit === null ? '' : profit >= 0 ? 'text-accent' : 'text-rose-400'}`}>
                    {profit === null ? '—' : fmt(profit, r.country)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                    <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="py-3 text-slate-500 text-center">Belum ada data saham.</td></tr>
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
            <KursControl ctl={kursCtl} />
            <div className="grid gap-1.5 sm:grid-cols-2 max-w-md text-sm">
              <span className="text-slate-400">Total Beli INA</span>
              <span className="font-mono text-right sm:text-left">{formatRpSpaced(totals.beliINA)}</span>
              <span className="text-slate-400">Total Beli US</span>
              <span className="font-mono text-right sm:text-left">{formatUsdSpaced(totals.beliUS)}</span>
              <span className="text-slate-400">Total Beli US Dalam Rp</span>
              <span className="font-mono text-right sm:text-left">{formatRpSpaced(totals.beliUS * kursCtl.kurs)}</span>
              <span className="text-slate-400 font-medium">Total Beli Asset</span>
              <span className="font-mono text-right sm:text-left font-medium">{formatRpSpaced(totals.beliINA + totals.beliUS * kursCtl.kurs)}</span>
              <span className="text-slate-400">Total Profit INA</span>
              <span className={`font-mono text-right sm:text-left ${totals.profitINA >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatRpSpaced(totals.profitINA)}</span>
              <span className="text-slate-400">Total Profit US</span>
              <span className={`font-mono text-right sm:text-left ${totals.profitUS >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatUsdSpaced(totals.profitUS)}</span>
              <span className="text-slate-400">Total Profit Dalam Rp</span>
              <span className={`font-mono text-right sm:text-left ${totals.profitUS >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatRpSpaced(totals.profitUS * kursCtl.kurs)}</span>
              <span className="text-slate-400 font-medium">Total All Profit</span>
              <span className={`font-mono text-right sm:text-left font-medium ${(totals.profitINA + totals.profitUS * kursCtl.kurs) >= 0 ? 'text-accent' : 'text-rose-400'}`}>
                {formatRpSpaced(totals.profitINA + totals.profitUS * kursCtl.kurs)}
              </span>
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-3">Total Profit hanya menjumlahkan saham yang sudah ada harga jualnya (yang belum dijual tidak ikut dihitung).</p>
      </div>

      <DividendSection kurs={kursCtl.kurs} />
    </div>
  )
}

const emptyDividendForm = { tanggal: '', namaSaham: '', country: 'INA', jumlah: '' }

function KursControl({ ctl }) {
  const [draft, setDraft] = useState(String(ctl.kurs))

  useEffect(() => { setDraft(String(ctl.kurs)) }, [ctl.kurs])

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label mb-1 block">Kurs USD → IDR</label>
        <input
          className="input w-40" type="number" step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const v = parseFloat(draft) || 0; if (v !== ctl.kurs) ctl.setKurs(v) }}
        />
      </div>
      <button type="button" className="btn-ghost text-xs" onClick={ctl.refresh} disabled={ctl.fetching}>
        {ctl.fetching ? 'Mengambil…' : 'Refresh dari internet'}
      </button>
      {ctl.loading && <span className="text-xs text-slate-500">Memuat kurs…</span>}
      {ctl.error && <span className="text-xs text-rose-400">{ctl.error}</span>}
    </div>
  )
}

function DividendSection({ kurs }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyDividendForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'dividends'), where('uid', '==', user.uid), orderBy('tanggal'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user])

  const totals = useMemo(() => {
    let ina = 0, us = 0
    for (const r of rows) {
      if (r.country === 'USA') us += r.jumlah || 0
      else ina += r.jumlah || 0
    }
    return { ina, us }
  }, [rows])

  async function handleSubmit(e) {
    e.preventDefault()
    const jumlah = parseFloat(form.jumlah)
    if (!form.tanggal || !form.namaSaham.trim() || !jumlah) return
    const payload = { uid: user.uid, tanggal: form.tanggal, namaSaham: form.namaSaham.trim(), country: form.country, jumlah }
    if (editingId) {
      await updateDoc(doc(db, 'dividends', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'dividends'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyDividendForm)
  }

  function startEdit(r) {
    setEditingId(r.id)
    setForm({ tanggal: r.tanggal, namaSaham: r.namaSaham, country: r.country, jumlah: String(r.jumlah) })
  }

  async function remove(id) {
    if (!confirm('Hapus data dividen ini?')) return
    await deleteDoc(doc(db, 'dividends', id))
    if (editingId === id) { setEditingId(null); setForm(emptyDividendForm) }
  }

  return (
    <div className="card p-4 space-y-4">
      <h2 className="font-display font-medium">Dividen</h2>

      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label mb-1 block">Tanggal Dividen</label>
          <input className="input" type="date" required value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">Kode Saham</label>
          <input className="input" required value={form.namaSaham} onChange={(e) => setForm({ ...form, namaSaham: e.target.value })} placeholder="BBCA / GOOG" />
        </div>
        <div>
          <label className="label mb-1 block">Country</label>
          <select className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            <option value="INA">INA</option>
            <option value="USA">USA</option>
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Jumlah {form.country === 'USA' ? '($)' : '(Rp)'}</label>
          <input className="input" type="number" step="0.0001" required value={form.jumlah} onChange={(e) => setForm({ ...form, jumlah: e.target.value })} placeholder={form.country === 'USA' ? '12.50' : '150000'} />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Tambah'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyDividendForm) }}>Batal</button>}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm">Belum ada data dividen.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 font-mono text-xs w-24 shrink-0">{r.tanggal}</span>
                <span className="w-14 shrink-0 text-slate-400">{r.country}</span>
                <span className="flex-1 min-w-0 truncate">{r.namaSaham}</span>
                <span className="font-mono">{r.country === 'USA' ? formatUsdSpaced(r.jumlah) : formatRpSpaced(r.jumlah)}</span>
                <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
              </li>
            ))}
          </ul>
          <div className="border-t border-white/10 pt-2 grid gap-1.5 sm:grid-cols-2 max-w-md text-sm font-medium">
            <span>Total Dividen INA</span>
            <span className="font-mono text-right sm:text-left">{formatRpSpaced(totals.ina)}</span>
            <span>Total Dividen US</span>
            <span className="font-mono text-right sm:text-left">{formatUsdSpaced(totals.us)}</span>
            <span>Total Dividen US Dalam Rp</span>
            <span className="font-mono text-right sm:text-left">{formatRpSpaced(totals.us * kurs)}</span>
            <span>Total All Dividen</span>
            <span className="font-mono text-right sm:text-left">{formatRpSpaced(totals.ina + totals.us * kurs)}</span>
          </div>
        </>
      )}
    </div>
  )
}
