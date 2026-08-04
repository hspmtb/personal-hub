import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addWeeks, addMonths, parseISO,
} from 'date-fns'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'

const emptyForm = { title: '', date: format(new Date(), 'yyyy-MM-dd'), start: '09:00', end: '10:00', notes: '' }

export default function Tasks() {
  const { user } = useAuth()
  const [view, setView] = useState('day') // day | week | month
  const [anchor, setAnchor] = useState(new Date())
  const [tasks, setTasks] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('uid', '==', user.uid), orderBy('date'), orderBy('start'))
    return onSnapshot(q, (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [user])

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor }
    if (view === 'week') return { from: startOfWeek(anchor, { weekStartsOn: 1 }), to: endOfWeek(anchor, { weekStartsOn: 1 }) }
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) }
  }, [view, anchor])

  const days = useMemo(() => eachDayOfInterval(range), [range])

  const tasksByDay = (day) => tasks.filter((t) => isSameDay(parseISO(t.date), day)).sort((a, b) => a.start.localeCompare(b.start))

  function shift(dir) {
    if (view === 'day') setAnchor((a) => addDaysSafe(a, dir))
    else if (view === 'week') setAnchor((a) => addWeeks(a, dir))
    else setAnchor((a) => addMonths(a, dir))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    const payload = {
      uid: user.uid,
      title: form.title.trim(),
      date: form.date,
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
    setForm({ title: t.title, date: t.date, start: t.start, end: t.end, notes: t.notes || '' })
  }

  async function toggleDone(t) {
    await updateDoc(doc(db, 'tasks', t.id), { done: !t.done })
  }

  async function remove(id) {
    if (!confirm('Delete this task?')) return
    await deleteDoc(doc(db, 'tasks', id))
    if (editingId === id) { setEditingId(null); setForm(emptyForm) }
  }

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
      <form onSubmit={handleSubmit} className="card p-4 grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label mb-1 block">Title</label>
          <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Write report" />
        </div>
        <div>
          <label className="label mb-1 block">Date</label>
          <input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">From</label>
          <input className="input" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">To</label>
          <input className="input" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" type="submit">{editingId ? 'Save' : 'Add task'}</button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Cancel</button>
          )}
        </div>
        <div className="sm:col-span-6">
          <label className="label mb-1 block">Notes (optional)</label>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Details…" />
        </div>
      </form>

      {/* Views */}
      {view === 'day' ? (
        <DayList day={anchor} items={tasksByDay(anchor)} onEdit={startEdit} onToggle={toggleDone} onDelete={remove} />
      ) : (
        <div className={`grid gap-3 ${view === 'week' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-5'}`}>
          {days.map((day) => (
            <div key={day.toISOString()} className="card p-3">
              <div className="label mb-2">{format(day, 'EEE, MMM d')}</div>
              <DayList compact day={day} items={tasksByDay(day)} onEdit={startEdit} onToggle={toggleDone} onDelete={remove} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DayList({ items, onEdit, onToggle, onDelete, compact }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm">No tasks.</p>
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t.id} className={`flex items-start gap-2 ${compact ? '' : 'card p-3'}`}>
          <input type="checkbox" checked={!!t.done} onChange={() => onToggle(t)} className="mt-1 accent-teal-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${t.done ? 'line-through text-slate-500' : ''}`}>{t.title}</span>
              <span className="text-xs text-slate-400 font-mono">{t.start}–{t.end}</span>
            </div>
            {t.notes && <p className="text-xs text-slate-500 mt-0.5 truncate">{t.notes}</p>}
          </div>
          {!compact && (
            <div className="flex gap-1 shrink-0">
              <button className="text-xs text-slate-400 hover:text-accent px-1.5" onClick={() => onEdit(t)}>Edit</button>
              <button className="text-xs text-slate-400 hover:text-rose-400 px-1.5" onClick={() => onDelete(t.id)}>Delete</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function addDaysSafe(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
