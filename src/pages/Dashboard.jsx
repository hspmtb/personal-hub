import { useEffect, useMemo, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatIDR } from '../lib/currency'

export default function Dashboard() {
  const { user, profile } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const month = format(new Date(), 'yyyy-MM')

  const [todayTasks, setTodayTasks] = useState([])
  const [monthExpenses, setMonthExpenses] = useState([])
  const [docCount, setDocCount] = useState(0)

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'tasks'), where('uid', '==', user.uid)), (snap) =>
      setTodayTasks(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((t) => (t.startDate || t.date) <= today && (t.endDate || t.date) >= today),
      ),
    )
    const u2 = onSnapshot(query(collection(db, 'expenses'), where('uid', '==', user.uid)), (snap) =>
      setMonthExpenses(snap.docs.map((d) => d.data()).filter((e) => e.date.startsWith(month))),
    )
    const u3 = onSnapshot(query(collection(db, 'documents'), where('uid', '==', user.uid)), (snap) => setDocCount(snap.size))
    return () => { u1(); u2(); u3() }
  }, [user])

  const spentThisMonth = useMemo(() => monthExpenses.reduce((s, e) => s + e.amount, 0), [monthExpenses])
  const doneCount = todayTasks.filter((t) => t.done).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-semibold">Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}</h1>
        <p className="text-slate-400 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Today's tasks" value={`${doneCount}/${todayTasks.length}`} sub="completed" to="/tasks" />
        <StatCard label="Spent this month" value={formatIDR(spentThisMonth)} sub="total expenses" to="/expenses" />
        <StatCard label="Saved documents" value={docCount} sub="in your vault" to="/documents" />
      </div>

      <div className="card p-4">
        <h2 className="font-display font-medium mb-3">Today</h2>
        {todayTasks.length === 0 ? (
          <p className="text-slate-500 text-sm">Nothing scheduled today. <Link to="/tasks" className="text-accent">Add a task</Link>.</p>
        ) : (
          <ul className="space-y-1.5">
            {todayTasks.sort((a, b) => a.start.localeCompare(b.start)).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-slate-400 w-24 shrink-0">{t.start}–{t.end}</span>
                <span className={t.done ? 'line-through text-slate-500' : ''}>{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, to }) {
  return (
    <Link to={to} className="card p-4 block hover:border-accent/40 transition-colors">
      <p className="label">{label}</p>
      <p className="font-display text-2xl font-semibold mt-1">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </Link>
  )
}
