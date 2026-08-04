import { createContext, useContext, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { makePassphraseCheck, verifyPassphrase } from '../lib/vaultCrypto'
import { useAuth } from './AuthContext'

const VaultContext = createContext(null)

const SESSION_KEY = 'ph_vault_unlocked_marker' // never stores the passphrase itself, see below

export function VaultProvider({ children }) {
  const { user } = useAuth()
  const [passphrase, setPassphrase] = useState(null) // held only in memory (React state)
  const [unlocked, setUnlocked] = useState(false)

  const settingsRef = useCallback(() => doc(db, 'vaultSettings', user?.uid || '_none'), [user])

  async function hasMasterPassword() {
    const snap = await getDoc(settingsRef())
    return snap.exists()
  }

  async function setupMasterPassword(newPassphrase) {
    const check = makePassphraseCheck(newPassphrase)
    await setDoc(settingsRef(), { check })
    setPassphrase(newPassphrase)
    setUnlocked(true)
  }

  async function unlock(candidatePassphrase) {
    const snap = await getDoc(settingsRef())
    if (!snap.exists()) throw new Error('No master passphrase has been set up yet.')
    const ok = verifyPassphrase(snap.data().check, candidatePassphrase)
    if (!ok) return false
    setPassphrase(candidatePassphrase)
    setUnlocked(true)
    // Only a non-reversible session flag is cached, purely so the UI can
    // remember "this tab already unlocked" across a refresh prompt style —
    // the actual passphrase is intentionally NOT persisted anywhere.
    sessionStorage.setItem(SESSION_KEY, '1')
    return true
  }

  function lock() {
    setPassphrase(null)
    setUnlocked(false)
    sessionStorage.removeItem(SESSION_KEY)
  }

  /**
   * Changing the master password re-encrypts every existing vault item with
   * a freshly derived key. Callers pass in the currently loaded documents and
   * a save function, since re-encryption needs Firestore writes per item.
   */
  async function changeMasterPassword(oldPassphrase, newPassphrase, reencryptAll) {
    const snap = await getDoc(settingsRef())
    if (!snap.exists()) throw new Error('No master passphrase set yet.')
    const ok = verifyPassphrase(snap.data().check, oldPassphrase)
    if (!ok) throw new Error('Current master passphrase is incorrect.')
    await reencryptAll(oldPassphrase, newPassphrase)
    const check = makePassphraseCheck(newPassphrase)
    await setDoc(settingsRef(), { check })
    setPassphrase(newPassphrase)
  }

  const value = {
    passphrase,
    unlocked,
    hasMasterPassword,
    setupMasterPassword,
    unlock,
    lock,
    changeMasterPassword,
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault() {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within VaultProvider')
  return ctx
}
