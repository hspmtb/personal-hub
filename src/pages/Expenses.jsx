import { useEffect, useMemo, useState } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { format, parseISO } from 'date-fns'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext.jsx'
import { formatIDR } from '../lib/currency'

const emptyForm = { categoryId: '', amount: '', date: format(new Date(), 'yyyy-MM-dd'), note: '' }

export default function Expenses() {
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [expenses, setExpenses] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [selectedCategory, setSelectedCategory] = useState(null)

  useEffect(() => {
    const q1 = query(collection(db, 'expenseCategories'), where('uid', '==', user.uid), orderBy('name'))
    const u1 = onSnapshot(q1, (snap) => setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    const q2 = query(collection(db, 'expenses'), where('uid', '==', user.uid), orderBy('date', 'desc'))
    const u2 = onSnapshot(q2, (snap) => setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [user])

  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  const monthExpenses = useMemo(() => expenses.filter((e) => (e.date || '').startsWith(month)), [expenses, month])

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
        catId,
        name: categoryById[catId]?.name || 'Uncategorized',
        value: amount,
        color: categoryById[catId]?.color || '#64748b',
        pct: totals.total ? (amount / totals.total) * 100 : 0,
      })),
    [totals, categoryById],
  )

  // Reset the category filter whenever the viewed month changes or the
  // selected category no longer has any transactions this month.
  useEffect(() => {
    setSelectedCategory(null)
  }, [month])

  const displayedExpenses = useMemo(
    () => (selectedCategory ? monthExpenses.filter((e) => e.categoryId === selectedCategory) : monthExpenses),
    [monthExpenses, selectedCategory],
  )

  function toggleCategory(catId) {
    setSelectedCategory((current) => (current === catId ? null : catId))
  }

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
          <input className="input" type="number" step="1" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display font-medium">Breakdown — {format(parseISO(month + '-01'), 'MMMM yyyy')}</h2>
            <span className="font-mono text-sm text-slate-300">Total: {formatIDR(totals.total)}</span>
          </div>
          {pieData.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">No expenses recorded this month.</p>
          ) : (
            <>
              <div className="h-64 block w-full max-w-full min-w-0 overflow-hidden mx-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {pieData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.color}
                          stroke="none"
                          cursor="pointer"
                          opacity={selectedCategory && selectedCategory !== entry.catId ? 0.35 : 1}
                          onClick={() => toggleCategory(entry.catId)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#F1F5F9' }}
                      itemStyle={{ color: '#F1F5F9' }}
                      formatter={(value, name, props) => [`${formatIDR(value)} (${props.payload.pct.toFixed(1)}%)`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Explicit per-category breakdown, e.g. "Coffee — Rp500.000 (5%)" — click to filter Transactions */}
              <ul className="mt-3 space-y-1.5 text-sm border-t border-white/10 pt-3">
                {[...pieData].sort((a, b) => b.value - a.value).map((c) => (
                  <li
                    key={c.name}
                    onClick={() => toggleCategory(c.catId)}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 cursor-pointer transition-colors ${
                      selectedCategory === c.catId ? 'bg-accent/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className={`flex-1 truncate ${selectedCategory === c.catId ? 'text-accent' : ''}`}>{c.name}</span>
                    <span className="font-mono text-slate-300">{formatIDR(c.value)}</span>
                    <span className="text-slate-500 w-14 text-right shrink-0">{c.pct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* List for the month */}
        <div className="card p-4" onClick={(e) => { if (e.target === e.currentTarget) setSelectedCategory(null) }}>
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="font-display font-medium">
              Transactions
              {selectedCategory && (
                <span className="text-slate-400 font-normal"> — {categoryById[selectedCategory]?.name || 'Uncategorized'}</span>
              )}
            </h2>
            {selectedCategory && (
              <button className="text-xs text-accent hover:underline shrink-0" onClick={() => setSelectedCategory(null)}>
                Show all
              </button>
            )}
          </div>
          {displayedExpenses.length === 0 ? (
            <p className="text-slate-500 text-sm">No transactions{selectedCategory ? ' for this category.' : '.'}</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {displayedExpenses.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: categoryById[e.categoryId]?.color || '#64748b' }} />
                  <span className="text-slate-400 font-mono text-xs w-20 shrink-0">{format(parseISO(e.date), 'MMM d')}</span>
                  <span className="flex-1 min-w-0 truncate">{categoryById[e.categoryId]?.name || 'Uncategorized'}{e.note ? ` — ${e.note}` : ''}</span>
                  <span className="font-mono shrink-0">{formatIDR(e.amount)}</span>
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
