import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, addMonths, parseISO,
} from 'date-fns'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'

const todayStr = () => format(new Date(), 'yyyy-MM-dd')
const emptyForm = { title: '', startDate: todayStr(), endDate: todayStr(), start: '09:00', end: '10:00', notes: '' }

// Older tasks were saved with a single `date` field (before multi-day
// ranges existed). Treat those as a one-day range so nothing breaks.
function normalizeTask(id, data) {
  return {
    id,
    ...data,
    startDate: data.startDate || data.date,
    endDate: data.endDate || data.date,
  }
}

export default function Tasks() {
  const { user } = useAuth()
  const [view, setView] = useState('day') // day | week | month
  const [anchor, setAnchor] = useState(new Date())
  const [tasks, setTasks] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    // Fetching by uid only (no orderBy) avoids needing a composite index,
    // and lets a task's day-range be filtered client-side below.
    const q = query(collection(db, 'tasks'), where('uid', '==', user.uid))
    return onSnapshot(q, (snap) => setTasks(snap.docs.map((d) => normalizeTask(d.id, d.data()))))
  }, [user])

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor }
    if (view === 'week') return { from: startOfWeek(anchor, { weekStartsOn: 1 }), to: endOfWeek(anchor, { weekStartsOn: 1 }) }
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) }
  }, [view, anchor])

  const rangeLabel = useMemo(() => {
    if (view === 'day') return format(anchor, 'EEEE, MMMM d, yyyy')
    if (view === 'week') return `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d, yyyy')}`
    return format(anchor, 'MMMM yyyy')
  }, [view, anchor, range])

  // A task is included whenever its [startDate, endDate] range overlaps the
  // viewed range at all — this is what makes a task that starts in July and
  // ends in August still show up when viewing August.
  function tasksInRange(fromDate, toDate) {
    const fromStr = format(fromDate, 'yyyy-MM-dd')
    const toStr = format(toDate, 'yyyy-MM-dd')
    return tasks
      .filter((t) => t.startDate <= toStr && t.endDate >= fromStr)
      .sort((a, b) => `${a.startDate}${a.start || ''}`.localeCompare(`${b.startDate}${b.start || ''}`))
  }

  function shift(dir) {
    if (view === 'day') setAnchor((a) => addDaysSafe(a, dir))
    else if (view === 'week') setAnchor((a) => addWeeks(a, dir))
    else setAnchor((a) => addMonths(a, dir))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    const startDate = form.startDate
    const endDate = form.endDate < form.startDate ? form.startDate : form.endDate // guard against an accidental inverted range
    const payload = {
      uid: user.uid,
      title: form.title.trim(),
      startDate,
      endDate,
      start: form.start,
      end: form.end,
      notes: form.notes.trim(),
    }
    if (editingId) {
      await updateDoc(doc(db, 'tasks', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'tasks'), { ...payload, done: false, createdAt: serverTimestamp() })
    }
    setForm(emptyForm)
  }

  function startEdit(t) {
    setEditingId(t.id)
    setForm({ title: t.title, startDate: t.startDate, endDate: t.endDate, start: t.start, end: t.end, notes: t.notes || '' })
  }

  async function toggleDone(t) {
    await updateDoc(doc(db, 'tasks', t.id), { done: !t.done })
  }

  async function remove(id) {
    if (!confirm('Delete this task?')) return
    await deleteDoc(doc(db, 'tasks', id))
    if (editingId === id) { setEditingId(null); setForm(emptyForm) }
  }

  const items = tasksInRange(range.from, range.to)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-lg font-semibold">Tasks</h1>
        <div className="flex items-center gap-2">
          <div className="flex border border-white/10 rounded-lg overflow-hidden text-sm">
            {['day', 'week', 'month'].map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 capitalize ${view === v ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/5'}`}>
                {v}
              </button>
            ))}
          </div>
          <button className="btn-ghost !px-2.5" onClick={() => shift(-1)} aria-label="Previous">‹</button>
          <button className="btn-ghost !px-2.5" onClick={() => shift(1)} aria-label="Next">›</button>
          <button className="btn-ghost text-xs" onClick={() => setAnchor(new Date())}>Today</button>
        </div>
      </header>

      {/* Add / edit form */}
      <form onSubmit={handleSubmit} className="card p-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="sm:col-span-3 lg:col-span-2">
          <label className="label mb-1 block">Title</label>
          <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Write report" />
        </div>
        <div>
          <label className="label mb-1 block">From Date</label>
          <input
            className="input" type="date" required value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
          />
        </div>
        <div>
          <label className="label mb-1 block">To Date</label>
          <input className="input" type="date" required min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">Start Time</label>
          <input className="input" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">End Time</label>
          <input className="input" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
        <p className="sm:col-span-3 lg:col-span-6 text-xs text-slate-500 -mt-1">
          Task multi-hari: isi "From Date" dan "To Date" berbeda sekali saja — otomatis muncul di setiap hari dalam rentang itu, tidak perlu input ulang tiap hari.
        </p>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Add task'}</button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Cancel</button>
          )}
        </div>
        <div className="sm:col-span-3 lg:col-span-6">
          <label className="label mb-1 block">Notes (optional)</label>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Details…" />
        </div>
      </form>

      {/* Task list for the selected period */}
      <div>
        <div className="label mb-2">{rangeLabel}</div>
        <AgendaList items={items} view={view} onEdit={startEdit} onToggle={toggleDone} onDelete={remove} />
      </div>
    </div>
  )
}

function AgendaList({ items, view, onEdit, onToggle, onDelete }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm card p-4">No tasks in this period.</p>
  return (
    <ul className="space-y-2">
      {items.map((t) => {
        const multiDay = t.startDate !== t.endDate
        return (
          <li key={t.id} className="flex items-start gap-2 card p-3">
            <input type="checkbox" checked={!!t.done} onChange={() => onToggle(t)} className="mt-1 accent-teal-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${t.done ? 'line-through text-slate-500' : ''}`}>{t.title}</span>
                <span className="text-xs text-slate-400 font-mono">{t.start}–{t.end}</span>
                {view !== 'day' && (
                  <span className="text-[10px] uppercase tracking-wide text-accent bg-accent/10 rounded px-1.5 py-0.5">
                    {multiDay
                      ? `${format(parseISO(t.startDate), 'MMM d')}–${format(parseISO(t.endDate), 'MMM d')}`
                      : format(parseISO(t.startDate), 'MMM d')}
                  </span>
                )}
              </div>
              {t.notes && <p className="text-xs text-slate-500 mt-0.5 truncate">{t.notes}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => onEdit(t)}>Edit</button>
              <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => onDelete(t.id)}>Delete</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function addDaysSafe(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
