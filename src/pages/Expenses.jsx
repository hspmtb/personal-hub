import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { format, parseISO } from 'date-fns'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'

const emptyForm = { categoryId: '', amount: '', date: format(new Date(), 'yyyy-MM-dd'), note: '' }

export default function Expenses() {
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [expenses, setExpenses] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))

  useEffect(() => {
    const q1 = query(collection(db, 'expenseCategories'), where('uid', '==', user.uid), orderBy('name'))
    const u1 = onSnapshot(q1, (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    const q2 = query(collection(db, 'expenses'), where('uid', '==', user.uid), orderBy('date', 'desc'))
    const u2 = onSnapshot(q2, (snap) => setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [user])

  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  const monthExpenses = useMemo(() => expenses.filter((e) => e.date.startsWith(month)), [expenses, month])

  const totals = useMemo(() => {
    const byCategory = {}
    let total = 0
    for (const e of monthExpenses) {
      byCategory[e.categoryId] = (byCategory[e.categoryId] || 0) + e.amount
      total += e.amount
    }
    return { byCategory, total }
  }, [monthExpenses])

  const pieData = useMemo(
    () =>
      Object.entries(totals.byCategory).map(([catId, amount]) => ({
        name: categoryById[catId]?.name || 'Uncategorized',
        value: amount,
        color: categoryById[catId]?.color || '#64748b',
        pct: totals.total ? (amount / totals.total) * 100 : 0,
      })),
    [totals, categoryById],
  )

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!form.categoryId || !amount || amount <= 0) return
    const payload = { uid: user.uid, categoryId: form.categoryId, amount, date: form.date, note: form.note.trim() }
    if (editingId) {
      await updateDoc(doc(db, 'expenses', editingId), payload)
      setEditingId(null)
    } else {
      await addDoc(collection(db, 'expenses'), { ...payload, createdAt: serverTimestamp() })
    }
    setForm(emptyForm)
  }

  function startEdit(e) {
    setEditingId(e.id)
    setForm({ categoryId: e.categoryId, amount: String(e.amount), date: e.date, note: e.note || '' })
  }

  async function remove(id) {
    if (!confirm('Delete this expense?')) return
    await deleteDoc(doc(db, 'expenses', id))
    if (editingId === id) { setEditingId(null); setForm(emptyForm) }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-lg font-semibold">Expenses</h1>
        <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
      </header>

      {categories.length === 0 && (
        <p className="text-sm text-slate-400 card p-4">
          No expense categories yet. Add some in <span className="text-accent">Settings → Expense Categories</span> first.
        </p>
      )}

      {/* Add / edit form */}
      <form onSubmit={handleSubmit} className="card p-4 grid gap-3 sm:grid-cols-5">
        <div>
          <label className="label mb-1 block">Category</label>
          <select className="input" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block">Amount</label>
          <input className="input" type="number" step="0.01" min="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
        </div>
        <div>
          <label className="label mb-1 block">Date</label>
          <input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label mb-1 block">Note (optional)</label>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. lunch with team" />
        </div>
        <div className="sm:col-span-5 flex gap-2">
          <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Add expense'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Cancel</button>}
        </div>
      </form>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display font-medium">Breakdown — {format(parseISO(month + '-01'), 'MMMM yyyy')}</h2>
            <span className="font-mono text-sm text-slate-300">Total: {formatCurrency(totals.total)}</span>
          </div>
          {pieData.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">No expenses recorded this month.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    formatter={(value, name, props) => [`${formatCurrency(value)} (${props.payload.pct.toFixed(1)}%)`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* List for the month */}
        <div className="card p-4">
          <h2 className="font-display font-medium mb-3">Transactions</h2>
          {monthExpenses.length === 0 ? (
            <p className="text-slate-500 text-sm">No transactions.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {monthExpenses.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: categoryById[e.categoryId]?.color || '#64748b' }} />
                  <span className="text-slate-400 font-mono text-xs w-20 shrink-0">{format(parseISO(e.date), 'MMM d')}</span>
                  <span className="flex-1 min-w-0 truncate">{categoryById[e.categoryId]?.name || 'Uncategorized'}{e.note ? ` — ${e.note}` : ''}</span>
                  <span className="font-mono shrink-0">{formatCurrency(e.amount)}</span>
                  <button className="text-xs text-slate-400 hover:text-accent px-1" onClick={() => startEdit(e)}>Edit</button>
                  <button className="text-xs text-slate-400 hover:text-rose-400 px-1" onClick={() => remove(e.id)}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function formatCurrency(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n || 0)
}
