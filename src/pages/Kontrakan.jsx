import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, orderBy, onSnapshot,
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

  // Load master units + bank info once
  useEffect(() => {
    const q = query(collection(db, 'rentalUnits'), where('uid', '==', user.uid), orderBy('createdAt'))
    const unsub = onSnapshot(q, (snap) => setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    getDocs(query(collection(db, 'rentalSettings'), where('uid', '==', user.uid))).then((snap) => {
      if (!snap.empty) setBankInfo(snap.docs[0].data())
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
      setPerKwhTouched(!!pData) // once saved, treat as "already set" so it won't silently auto-recompute over a saved value
      setBiayaCurrMonthTouched(!!pData)

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
