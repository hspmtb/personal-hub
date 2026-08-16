import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatIDR, formatNumberID, ceilRupiah } from '../lib/currency'

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function periodKey(year, monthIdx) {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

function prevPeriodOf(year, monthIdx) {
  return monthIdx === 0 ? { year: year - 1, monthIdx: 11 } : { year, monthIdx: monthIdx - 1 }
}

function yearOptions(currentYear) {
  const arr = []
  for (let y = currentYear - 3; y <= currentYear + 1; y++) arr.push(y)
  return arr
}

// Pagi 06:00–11:00, Siang 11:01–15:00, Sore 15:01–19:00, Malam 19:01–24:00
// (and 00:00–05:59, not specified, falls back to "Malam" as the closest bucket).
function getTimeGreeting(date = new Date()) {
  const mins = date.getHours() * 60 + date.getMinutes()
  if (mins >= 360 && mins <= 660) return 'Pagi'
  if (mins >= 661 && mins <= 900) return 'Siang'
  if (mins >= 901 && mins <= 1140) return 'Sore'
  return 'Malam'
}

function genderTitle(gender) {
  return gender === 'F' ? 'Mbak' : 'Mas'
}

const emptyPeriodForm = {
  topupKwh: '', biayaTopup: '', sisaKwhLastMonth: '', sisaKwhCurrMonth: '', biayaPerKwh: '', biayaCurrMonth: '',
}

export default function Kontrakan() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [monthIdx, setMonthIdx] = useState(now.getMonth())
  const period = periodKey(year, monthIdx)
  const prev = prevPeriodOf(year, monthIdx)
  const prevPeriod = periodKey(prev.year, prev.monthIdx)

  const [units, setUnits] = useState([])
  const [bankInfo, setBankInfo] = useState({ bankName: '', accountNumber: '', accountHolder: '' })
  const [periodForm, setPeriodForm] = useState(emptyPeriodForm)
  const [sisaLastMonthLocked, setSisaLastMonthLocked] = useState(false)
  const [perKwhTouched, setPerKwhTouched] = useState(false)
  const [biayaCurrMonthTouched, setBiayaCurrMonthTouched] = useState(false)
  const [readings, setReadings] = useState({}) // unitId -> { kubikCurrMonth, adjustBiayaAir }
  const [prevReadings, setPrevReadings] = useState({}) // unitId -> { kubikCurrMonth }
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('')
  const [printItem, setPrintItem] = useState(null)

  const [rentalExpenses, setRentalExpenses] = useState([])
  const [expenseForm, setExpenseForm] = useState({ name: '', amount: '' })
  const [editingExpenseId, setEditingExpenseId] = useState(null)

  // Load master units + bank info once
  useEffect(() => {
    const q = query(collection(db, 'rentalUnits'), where('uid', '==', user.uid), orderBy('createdAt'))
    const unsub = onSnapshot(q, (snap) => setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    getDoc(doc(db, 'rentalSettings', user.uid)).then((snap) => {
      if (snap.exists()) setBankInfo(snap.data())
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Load period data whenever the selected period changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPerKwhTouched(false)
    setBiayaCurrMonthTouched(false)

    async function load() {
      const [periodSnap, prevPeriodSnap, readingsSnap, prevReadingsSnap] = await Promise.all([
        getDoc(doc(db, 'rentalPeriods', `${user.uid}_${period}`)),
        getDoc(doc(db, 'rentalPeriods', `${user.uid}_${prevPeriod}`)),
        getDocs(query(collection(db, 'rentalReadings'), where('uid', '==', user.uid), where('period', '==', period))),
        getDocs(query(collection(db, 'rentalReadings'), where('uid', '==', user.uid), where('period', '==', prevPeriod))),
      ])
      if (cancelled) return

      const pData = periodSnap.exists() ? periodSnap.data() : null
      const prevHasData = prevPeriodSnap.exists()
      const sisaLastMonthAuto = prevHasData ? String(prevPeriodSnap.data().sisaKwhCurrMonth ?? '') : ''

      setPeriodForm({
        topupKwh: pData ? String(pData.topupKwh ?? '') : '',
        biayaTopup: pData ? String(pData.biayaTopup ?? '') : '',
        sisaKwhLastMonth: pData ? String(pData.sisaKwhLastMonth ?? '') : sisaLastMonthAuto,
        sisaKwhCurrMonth: pData ? String(pData.sisaKwhCurrMonth ?? '') : '',
        biayaPerKwh: pData ? String(pData.biayaPerKwh ?? '') : '',
        biayaCurrMonth: pData ? String(pData.biayaCurrMonth ?? '') : '',
      })
      setSisaLastMonthLocked(prevHasData && !pData)
      // Only treat as "manually set" if that specific field was actually
      // saved before — a period doc saved before this field existed
      // (pData exists but biayaPerKwh/biayaCurrMonth is missing) should
      // still auto-calculate its default.
      setPerKwhTouched(!!(pData && pData.biayaPerKwh !== undefined && pData.biayaPerKwh !== null))
      setBiayaCurrMonthTouched(!!(pData && pData.biayaCurrMonth !== undefined && pData.biayaCurrMonth !== null))

      const readingsMap = {}
      readingsSnap.forEach((d) => { readingsMap[d.data().unitId] = d.data() })
      setReadings(readingsMap)

      const prevReadingsMap = {}
      prevReadingsSnap.forEach((d) => { prevReadingsMap[d.data().unitId] = d.data() })
      setPrevReadings(prevReadingsMap)

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user, period, prevPeriod])

  // Rental-specific expenses for the currently selected period
  useEffect(() => {
    const q = query(collection(db, 'rentalExpenses'), where('uid', '==', user.uid), where('period', '==', period))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      setRentalExpenses(list)
    })
  }, [user, period])

  // Auto-compute default "Biaya Per Kwh" = ceil(biayaTopup / topupKwh) unless the user manually edited it
  useEffect(() => {
    if (perKwhTouched) return
    const topup = parseFloat(periodForm.topupKwh)
    const biaya = parseFloat(periodForm.biayaTopup)
    if (topup > 0 && biaya >= 0) {
      setPeriodForm((f) => ({ ...f, biayaPerKwh: String(ceilRupiah(biaya / topup)) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodForm.topupKwh, periodForm.biayaTopup])

  const pemakaianKwhCurrMonth = useMemo(() => {
    const last = parseFloat(periodForm.sisaKwhLastMonth) || 0
    const topup = parseFloat(periodForm.topupKwh) || 0
    const curr = parseFloat(periodForm.sisaKwhCurrMonth) || 0
    return last + topup - curr
  }, [periodForm])

  // Auto-compute default "Biaya Curr Month" = Pemakaian Kwh Curr Month * Biaya Per Kwh,
  // unless the user manually edited it.
  useEffect(() => {
    if (biayaCurrMonthTouched) return
    const perKwh = parseFloat(periodForm.biayaPerKwh) || 0
    setPeriodForm((f) => ({ ...f, biayaCurrMonth: String(Math.round(pemakaianKwhCurrMonth * perKwh)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pemakaianKwhCurrMonth, periodForm.biayaPerKwh])

  const biayaCurrMonthNum = parseFloat(periodForm.biayaCurrMonth) || 0

  // Per-unit water usage + cost distribution
  const rows = useMemo(() => {
    const withTerpakai = units.map((u) => {
      const prevKubik = prevReadings[u.id]?.kubikCurrMonth ?? u.kubikAwal ?? 0
      const kubikCurrRaw = readings[u.id]?.kubikCurrMonth
      const hasCurr = kubikCurrRaw !== undefined && kubikCurrRaw !== null && kubikCurrRaw !== ''
      const kubikCurr = hasCurr ? Number(kubikCurrRaw) : null
      const terpakai = hasCurr ? Math.max(0, kubikCurr - prevKubik) : 0
      return { unit: u, prevKubik, kubikCurr, hasCurr, terpakai }
    })
    const totalTerpakai = withTerpakai.reduce((s, r) => s + r.terpakai, 0)
    return withTerpakai.map((r) => {
      const biayaAir = totalTerpakai > 0 ? (r.terpakai / totalTerpakai) * biayaCurrMonthNum : 0
      const adjustRaw = readings[r.unit.id]?.adjustBiayaAir
      const adjust = adjustRaw !== undefined && adjustRaw !== null && adjustRaw !== '' ? Number(adjustRaw) : Math.round(biayaAir)
      return { ...r, biayaAir, adjust }
    })
  }, [units, readings, prevReadings, biayaCurrMonthNum])

  const totalBiayaAir = rows.reduce((s, r) => s + r.biayaAir, 0)
  const totalAdjustAir = rows.reduce((s, r) => s + r.adjust, 0)

  async function savePeriod(e) {
    e?.preventDefault()
    await setDoc(doc(db, 'rentalPeriods', `${user.uid}_${period}`), {
      uid: user.uid,
      period,
      topupKwh: parseFloat(periodForm.topupKwh) || 0,
      biayaTopup: parseFloat(periodForm.biayaTopup) || 0,
      sisaKwhLastMonth: parseFloat(periodForm.sisaKwhLastMonth) || 0,
      sisaKwhCurrMonth: parseFloat(periodForm.sisaKwhCurrMonth) || 0,
      biayaPerKwh: parseFloat(periodForm.biayaPerKwh) || 0,
      biayaCurrMonth: parseFloat(periodForm.biayaCurrMonth) || 0,
    }, { merge: true })
    setSaveStatus('Tersimpan.')
    setTimeout(() => setSaveStatus(''), 2000)
  }

  async function saveReading(unitId, patch) {
    const merged = { ...readings[unitId], ...patch }
    setReadings((r) => ({ ...r, [unitId]: merged }))
    await setDoc(doc(db, 'rentalReadings', `${user.uid}_${period}_${unitId}`), {
      uid: user.uid,
      period,
      unitId,
      kubikCurrMonth: merged.kubikCurrMonth ?? null,
      adjustBiayaAir: merged.adjustBiayaAir ?? null,
    }, { merge: true })
  }

  async function submitRentalExpense(e) {
    e.preventDefault()
    const amount = parseFloat(expenseForm.amount)
    if (!expenseForm.name.trim() || !amount || amount <= 0) return
    const payload = { uid: user.uid, period, name: expenseForm.name.trim(), amount }
    if (editingExpenseId) {
      await updateDoc(doc(db, 'rentalExpenses', editingExpenseId), payload)
      setEditingExpenseId(null)
    } else {
      await addDoc(collection(db, 'rentalExpenses'), { ...payload, createdAt: serverTimestamp() })
    }
    setExpenseForm({ name: '', amount: '' })
  }

  function startEditRentalExpense(item) {
    setEditingExpenseId(item.id)
    setExpenseForm({ name: item.name, amount: String(item.amount) })
  }

  async function removeRentalExpense(id) {
    if (!confirm('Hapus pengeluaran ini?')) return
    await deleteDoc(doc(db, 'rentalExpenses', id))
    if (editingExpenseId === id) { setEditingExpenseId(null); setExpenseForm({ name: '', amount: '' }) }
  }

  const totalRentalExpense = rentalExpenses.reduce((s, e) => s + e.amount, 0)

  function openPrint(row) {
    const total = row.unit.uangSewa + row.unit.iuranRT + row.adjust + row.unit.uangInternet
    const text = [
      `${getTimeGreeting()} ${genderTitle(row.unit.gender)} ${row.unit.namaPenyewa},`,
      '',
      'Reminder uang kontrakan ya, rinciannya :',
      `Uang Sewa : Rp${formatNumberID(row.unit.uangSewa)}`,
      `Uang RT, Kebersihan, Keamanan : Rp${formatNumberID(row.unit.iuranRT)}`,
      `Uang Air : Rp${formatNumberID(row.adjust)}`,
      `Internet : Rp${formatNumberID(row.unit.uangInternet)}`,
      `Total : Rp${formatNumberID(total)}`,
      '',
      `Mohon segera ditransfer ke rek ${bankInfo.bankName || '—'} : ${bankInfo.accountNumber || '—'} a/n ${bankInfo.accountHolder || '—'}`,
      '',
      'Terimakasih 🙏',
    ].join('\n')
    setPrintItem({ row, text })
  }

  if (loading) return <p className="text-slate-500 text-sm">Memuat data periode…</p>

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-lg font-semibold">Kontrakan</h1>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions(now.getFullYear()).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>

      {units.length === 0 && (
        <p className="text-sm text-slate-400 card p-4">
          Belum ada data Kontrakan. Tambahkan dulu di <span className="text-accent">Settings → Master Kontrakan</span>.
        </p>
      )}

      {/* Electricity / Kwh tracking */}
      <form onSubmit={savePeriod} className="card p-4 space-y-3">
        <h2 className="font-display font-medium">Listrik (Topup Kwh) — {MONTHS[monthIdx]} {year}</h2>
        <div className="grid gap-x-3 gap-y-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Topup Kwh</label>
            <input className="input" type="number" step="0.01" value={periodForm.topupKwh} onChange={(e) => setPeriodForm({ ...periodForm, topupKwh: e.target.value })} placeholder="280.2" />
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Biaya Topup</label>
            <input className="input" type="number" step="1" value={periodForm.biayaTopup} onChange={(e) => setPeriodForm({ ...periodForm, biayaTopup: e.target.value })} placeholder="503000" />
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Sisa Kwh Last Month</label>
            <input
              className="input"
              type="number" step="0.01"
              value={periodForm.sisaKwhLastMonth}
              readOnly={sisaLastMonthLocked}
              onChange={(e) => setPeriodForm({ ...periodForm, sisaKwhLastMonth: e.target.value })}
              placeholder="203.7"
            />
            {sisaLastMonthLocked && <p className="text-[11px] text-slate-500 mt-0.5">Otomatis dari bulan lalu</p>}
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Sisa Kwh Curr Month</label>
            <input className="input" type="number" step="0.01" value={periodForm.sisaKwhCurrMonth} onChange={(e) => setPeriodForm({ ...periodForm, sisaKwhCurrMonth: e.target.value })} placeholder="170.38" />
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Pemakaian Kwh Curr Month</label>
            <input className="input font-mono" value={pemakaianKwhCurrMonth.toFixed(2)} readOnly />
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Biaya Per Kwh</label>
            <input
              className="input"
              type="number" step="1"
              value={periodForm.biayaPerKwh}
              onChange={(e) => { setPerKwhTouched(true); setPeriodForm({ ...periodForm, biayaPerKwh: e.target.value }) }}
            />
          </div>
          <div>
            <label className="label mb-1 flex items-end min-h-[2rem]">Biaya Curr Month</label>
            <input
              className="input"
              type="number" step="1"
              value={periodForm.biayaCurrMonth}
              onChange={(e) => { setBiayaCurrMonthTouched(true); setPeriodForm({ ...periodForm, biayaCurrMonth: e.target.value }) }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit">Simpan periode ini</button>
          {saveStatus && <span className="text-xs text-slate-400">{saveStatus}</span>}
        </div>
      </form>

      {/* Water usage & cost distribution per unit */}
      {units.length > 0 && (
        <div className="card p-4 overflow-x-auto">
          <h2 className="font-display font-medium mb-3">Air — {MONTHS[monthIdx]} {year}</h2>
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-slate-500 text-xs uppercase">
                <th className="py-1.5 pr-3">Data Kontrakan</th>
                <th className="py-1.5 pr-3">Kubik Awal Bulan</th>
                <th className="py-1.5 pr-3">Kubik Curr Month</th>
                <th className="py-1.5 pr-3">Kubik Terpakai</th>
                <th className="py-1.5 pr-3">Biaya Air Curr Month</th>
                <th className="py-1.5 pr-3">Adjust Biaya Air</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${period}-${r.unit.id}`} className="border-t border-white/5">
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{r.unit.noKontrakan}</div>
                    <div className="text-xs text-slate-500">{r.unit.namaPenyewa}</div>
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{r.prevKubik}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      className="input !py-1 w-24"
                      type="number" step="1"
                      defaultValue={r.kubikCurr ?? ''}
                      onBlur={(e) => saveReading(r.unit.id, { kubikCurrMonth: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="40"
                    />
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{r.hasCurr ? r.terpakai : '—'}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatIDR(r.biayaAir)}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      className="input !py-1 w-28"
                      type="number" step="1"
                      defaultValue={readings[r.unit.id]?.adjustBiayaAir ?? Math.round(r.biayaAir)}
                      onBlur={(e) => saveReading(r.unit.id, { adjustBiayaAir: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td className="py-1.5">
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => openPrint(r)}>Print</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-medium">
                <td className="py-2 pr-3" colSpan={4}>Total</td>
                <td className="py-2 pr-3 font-mono">{formatIDR(totalBiayaAir)}</td>
                <td className="py-2 pr-3 font-mono">{formatIDR(totalAdjustAir)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Rental-specific expenses for this period (separate from the main Expenses menu) */}
      <div className="card p-4 space-y-3">
        <h2 className="font-display font-medium">Pengeluaran Kontrakan — {MONTHS[monthIdx]} {year}</h2>
        <form onSubmit={submitRentalExpense} className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label mb-1 block">Nama Pengeluaran</label>
            <input className="input" required value={expenseForm.name} onChange={(e) => setExpenseForm({ ...expenseForm, name: e.target.value })} placeholder="Ganti keran bocor" />
          </div>
          <div>
            <label className="label mb-1 block">Harga</label>
            <input className="input" type="number" step="1" min="1" required value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} placeholder="150000" />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-primary flex-1" type="submit">{editingExpenseId ? 'Save' : 'Tambah'}</button>
            {editingExpenseId && (
              <button type="button" className="btn-ghost" onClick={() => { setEditingExpenseId(null); setExpenseForm({ name: '', amount: '' }) }}>Batal</button>
            )}
          </div>
        </form>

        {rentalExpenses.length === 0 ? (
          <p className="text-slate-500 text-sm">Belum ada pengeluaran kontrakan bulan ini.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {rentalExpenses.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">{e.name}</span>
                  <span className="font-mono">{formatIDR(e.amount)}</span>
                  <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEditRentalExpense(e)}>Edit</button>
                  <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => removeRentalExpense(e.id)}>Delete</button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm font-medium">
              <span>Total Pengeluaran Kontrakan</span>
              <span className="font-mono">{formatIDR(totalRentalExpense)}</span>
            </div>
          </>
        )}
      </div>

      <RentalIncomeSection year={year} uid={user.uid} />

      <ConstructionCostSection uid={user.uid} />

      {printItem && <PrintModal item={printItem} onClose={() => setPrintItem(null)} />}
    </div>
  )
}

function PrintModal({ item, onClose }) {
  function copy() {
    navigator.clipboard?.writeText(item.text)
  }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card bg-slate-925 p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-medium mb-3">Reminder — {item.row.unit.namaPenyewa}</h3>
        <pre className="whitespace-pre-wrap text-sm bg-black/30 rounded-lg p-3 font-body">{item.text}</pre>
        <div className="flex gap-2 mt-4">
          <button className="btn-primary flex-1" onClick={copy}>Copy</button>
          <a
            className="btn-ghost flex-1 text-center"
            href={`https://wa.me/?text=${encodeURIComponent(item.text)}`}
            target="_blank" rel="noreferrer noopener"
          >
            Buka WhatsApp
          </a>
        </div>
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          Kalau punya 2 WhatsApp di HP, Android akan tanya mau buka pakai app yang mana — pilih WhatsApp Business dan centang "selalu" supaya ke depannya otomatis.
        </p>
        <button className="text-xs text-slate-500 hover:text-slate-300 mt-3 w-full text-center" onClick={onClose}>Tutup</button>
      </div>
    </div>
  )
}

const emptyIncomeForm = { monthIdx: new Date().getMonth(), grossIncome: '', expense: '' }

// Older entries only had a single `amount` field (before Gross/Expense were
// split out). Treat that as Gross Income with zero Expense so nothing breaks.
function normalizeIncome(id, data) {
  const grossIncome = data.grossIncome ?? data.amount ?? 0
  const expense = data.expense ?? 0
  return { id, ...data, grossIncome, expense, netIncome: grossIncome - expense }
}

// Yearly rent-income tracker: one entry per period (month), scoped to the
// year currently selected at the top of the Kontrakan page. Kept in its
// own component so its Firestore listener only re-subscribes when the
// year actually changes, not on every keystroke elsewhere on the page.
//
// The year dropdown at the top of the page already allows picking any year
// from (current year − 3) to (current year + 1), so entering a missed
// month from a prior year (e.g. December 2026 while now in 2027) is always
// possible — just switch the year selector, no extra date restriction here.
function RentalIncomeSection({ year, uid }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyIncomeForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    // Fetch by uid only (no range query needed) and filter to this year
    // client-side — avoids needing an extra composite index.
    const q = query(collection(db, 'rentalIncomes'), where('uid', '==', uid))
    return onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => normalizeIncome(d.id, d.data()))
        .filter((r) => r.period.startsWith(String(year)))
      list.sort((a, b) => a.period.localeCompare(b.period))
      setRows(list)
    })
  }, [uid, year])

  const totals = useMemo(() => {
    let gross = 0, expense = 0
    for (const r of rows) { gross += r.grossIncome; expense += r.expense }
    return { gross, expense, net: gross - expense }
  }, [rows])

  async function handleSubmit(e) {
    e.preventDefault()
    const grossIncome = parseFloat(form.grossIncome) || 0
    const expense = parseFloat(form.expense) || 0
    if (!grossIncome && !expense) return
    const period = `${year}-${String(Number(form.monthIdx) + 1).padStart(2, '0')}`
    const payload = { uid, period, grossIncome, expense }
    if (editingId) {
      await updateDoc(doc(db, 'rentalIncomes', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'rentalIncomes'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyIncomeForm)
  }

  function startEdit(r) {
    setEditingId(r.id)
    const [, m] = r.period.split('-')
    setForm({ monthIdx: Number(m) - 1, grossIncome: String(r.grossIncome), expense: String(r.expense) })
  }

  async function remove(id) {
    if (!confirm('Hapus pemasukan ini?')) return
    await deleteDoc(doc(db, 'rentalIncomes', id))
    if (editingId === id) { setEditingId(null); setForm(emptyIncomeForm) }
  }

  function periodLabel(period) {
    const [y, m] = period.split('-')
    return `${MONTHS[Number(m) - 1]} ${y}`
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-display font-medium">Pemasukan Periode {year}</h2>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label mb-1 block">Periode</label>
          <select className="input" value={form.monthIdx} onChange={(e) => setForm({ ...form, monthIdx: e.target.value })}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m} {year}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Gross Income</label>
          <input className="input" type="number" step="1" min="0" value={form.grossIncome} onChange={(e) => setForm({ ...form, grossIncome: e.target.value })} placeholder="30000000" />
        </div>
        <div>
          <label className="label mb-1 block">Expense</label>
          <input className="input" type="number" step="1" min="0" value={form.expense} onChange={(e) => setForm({ ...form, expense: e.target.value })} placeholder="0" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Tambah'}</button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyIncomeForm) }}>Batal</button>
          )}
        </div>
        <p className="sm:col-span-4 text-[11px] text-slate-500 -mt-1">Net Income dihitung otomatis = Gross Income − Expense.</p>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm">Belum ada pemasukan tahun ini.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase">
                  <th className="py-1.5 pr-3">Periode</th>
                  <th className="py-1.5 pr-3">Gross Income</th>
                  <th className="py-1.5 pr-3">Expense</th>
                  <th className="py-1.5 pr-3">Net Income</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5 pr-3">{periodLabel(r.period)}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatIDR(r.grossIncome)}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatIDR(r.expense)}</td>
                    <td className={`py-1.5 pr-3 font-mono ${r.netIncome >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatIDR(r.netIncome)}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                      <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10 font-medium">
                  <td className="py-2 pr-3">Total {year}</td>
                  <td className="py-2 pr-3 font-mono">{formatIDR(totals.gross)}</td>
                  <td className="py-2 pr-3 font-mono">{formatIDR(totals.expense)}</td>
                  <td className={`py-2 pr-3 font-mono ${totals.net >= 0 ? 'text-accent' : 'text-rose-400'}`}>{formatIDR(totals.net)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const SUMBER_OPTIONS = ['Santy', 'Rony', 'Yanny']
const emptyConstructionForm = { tanggal: '', nominal: '', sumber: SUMBER_OPTIONS[0], keterangan: '' }

// Construction-cost ledger — not scoped to a year (it's a one-off build
// project), so it lists everything ever entered for this rental property.
function ConstructionCostSection({ uid }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyConstructionForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'rentalConstruction'), where('uid', '==', uid))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => a.tanggal.localeCompare(b.tanggal))
      setRows(list)
    })
  }, [uid])

  const totalsBySumber = useMemo(() => {
    const totals = Object.fromEntries(SUMBER_OPTIONS.map((s) => [s, 0]))
    for (const r of rows) totals[r.sumber] = (totals[r.sumber] || 0) + r.nominal
    return totals
  }, [rows])

  async function handleSubmit(e) {
    e.preventDefault()
    const nominal = parseFloat(form.nominal)
    if (!form.tanggal || !nominal || nominal <= 0) return
    const payload = { uid, tanggal: form.tanggal, nominal, sumber: form.sumber, keterangan: form.keterangan.trim() }
    if (editingId) {
      await updateDoc(doc(db, 'rentalConstruction', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'rentalConstruction'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyConstructionForm)
  }

  function startEdit(r) {
    setEditingId(r.id)
    setForm({ tanggal: r.tanggal, nominal: String(r.nominal), sumber: r.sumber, keterangan: r.keterangan || '' })
  }

  async function remove(id) {
    if (!confirm('Hapus biaya pembangunan ini?')) return
    await deleteDoc(doc(db, 'rentalConstruction', id))
    if (editingId === id) { setEditingId(null); setForm(emptyConstructionForm) }
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-display font-medium">Biaya Pembangunan Kontrakan</h2>

      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label mb-1 block">Tanggal</label>
          <input className="input" type="date" required value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">Nominal</label>
          <input className="input" type="number" step="1" min="1" required value={form.nominal} onChange={(e) => setForm({ ...form, nominal: e.target.value })} placeholder="1000000" />
        </div>
        <div>
          <label className="label mb-1 block">Sumber</label>
          <select className="input" value={form.sumber} onChange={(e) => setForm({ ...form, sumber: e.target.value })}>
            {SUMBER_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="lg:col-span-1">
          <label className="label mb-1 block">Keterangan</label>
          <input className="input" value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} placeholder="Bayar Kontraktor" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Tambah'}</button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyConstructionForm) }}>Batal</button>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm">Belum ada biaya pembangunan.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase">
                  <th className="py-1.5 pr-3">Tanggal</th>
                  <th className="py-1.5 pr-3">Nominal</th>
                  <th className="py-1.5 pr-3">Sumber</th>
                  <th className="py-1.5 pr-3">Keterangan</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1.5 pr-3 font-mono">{r.tanggal}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatIDR(r.nominal)}</td>
                    <td className="py-1.5 pr-3">{r.sumber}</td>
                    <td className="py-1.5 pr-3">{r.keterangan || '—'}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => startEdit(r)}>Edit</button>
                      <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => remove(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-white/10 pt-2 grid gap-1.5 max-w-xs text-sm font-medium">
            {SUMBER_OPTIONS.map((s) => (
              <div key={s} className="flex items-center justify-between">
                <span>{s}</span>
                <span className="font-mono">{formatIDR(totalsBySumber[s])}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
