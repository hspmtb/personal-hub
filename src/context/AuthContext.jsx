import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        const profileData = snap.exists() ? snap.data() : null
        if (profileData && profileData.active === false) {
          // Account was disabled from the Users page — sign out immediately.
          await signOut(auth)
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }
        setProfile(profileData)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  // Auto-logout setelah tidak ada aktivitas selama beberapa menit
  useEffect(() => {
    if (!user) return // cuma jalan kalau lagi login

    const TIMEOUT_MS = 5 * 60 * 1000 // 5 menit — ganti angka ini kalau mau beda
    let timer

    function resetTimer() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        logout()
      }, TIMEOUT_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((evt) => window.addEventListener(evt, resetTimer))
    resetTimer() // mulai hitung begitu user login

    return () => {
      clearTimeout(timer)
      events.forEach((evt) => window.removeEventListener(evt, resetTimer))
    }
  }, [user])

  async function login(email, password) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  /**
   * Sign-up is gated by an allowlist so this personal app can't be signed up
   * to by strangers who stumble on the URL. An admin adds an email to the
   * "allowlist" collection from the Users page before the person can create
   * an account for themselves.
   */
  async function signUp(email, password, displayName) {
    const allowRef = doc(db, 'allowlist', email.toLowerCase())
    const allowSnap = await getDoc(allowRef)
    if (!allowSnap.exists()) {
      throw new Error('This email has not been invited. Ask an admin to add it in Users first.')
    }
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const isFirstUser = allowSnap.data().role === 'admin'
    await setDoc(doc(db, 'users', cred.user.uid), {
      email: email.toLowerCase(),
      displayName: displayName || email.split('@')[0],
      role: allowSnap.data().role || 'member',
      active: true,
      createdAt: serverTimestamp(),
    })
    setProfile({
      email: email.toLowerCase(),
      displayName: displayName || email.split('@')[0],
      role: allowSnap.data().role || 'member',
      active: true,
    })
    return isFirstUser
  }

  async function logout() {
    await signOut(auth)
  }

  const value = { user, profile, loading, login, signUp, logout, isAdmin: profile?.role === 'admin' }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
