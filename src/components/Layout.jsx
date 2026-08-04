import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/tasks', label: 'Tasks', icon: '◔' },
  { to: '/expenses', label: 'Expenses', icon: '◒' },
  { to: '/documents', label: 'Documents', icon: '◈' },
  { to: '/users', label: 'Users', icon: '◎', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: '◑' },
]

export default function Layout() {
  const { profile, isAdmin, logout } = useAuth()
  const [open, setOpen] = useState(false)

  const items = NAV.filter((n) => !n.adminOnly || isAdmin)

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 flex items-center justify-between px-4 bg-slate-925/90 backdrop-blur border-b border-white/10 z-40">
        <span className="font-display font-semibold tracking-tight">Personal Hub</span>
        <button className="btn-ghost !px-2 !py-1" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`
          fixed md:sticky top-0 md:top-0 h-screen w-64 shrink-0 border-r border-white/10
          bg-slate-925/95 md:bg-transparent backdrop-blur z-30
          flex flex-col transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}
      >
        <div className="hidden md:flex items-center gap-2 px-5 h-16 border-b border-white/10">
          <span className="text-accent text-xl">◆</span>
          <span className="font-display font-semibold tracking-tight">Personal Hub</span>
        </div>

        <nav className="flex-1 px-3 pt-20 md:pt-4 space-y-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:bg-white/5'
                }`
              }
            >
              <span aria-hidden className="text-base w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="px-2 pb-2 text-xs text-slate-400 truncate">
            {profile?.displayName || 'User'}
            {isAdmin && <span className="ml-1.5 text-accent">· admin</span>}
          </div>
          <button className="btn-ghost w-full" onClick={logout}>Sign out</button>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Close menu overlay"
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="flex-1 min-w-0 pt-16 md:pt-0">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
