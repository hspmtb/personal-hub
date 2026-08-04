// Client-side encryption for the "Personal Documents" vault.
//
// Design:
// - The user chooses a MASTER PASSPHRASE. It is never sent to or stored in
//   Firebase, in any form — not even hashed. It only ever lives in the
//   browser's memory (React state) for the current session, optionally
//   cached in sessionStorage (cleared when the tab closes) if the user opts
//   into "remember for this session".
// - For every vault item we generate a random 128-bit salt and a random
//   128-bit IV. A key is derived from (passphrase + salt) using PBKDF2 with
//   a high iteration count, then used to AES-256-CBC encrypt the payload.
// - Salt + IV + ciphertext are stored in Firestore. Without the passphrase,
//   nothing meaningful can be recovered from a database dump, an exported
//   backup, or a leaked service-account read — the passphrase is the only
//   place the key material can be reconstructed from.
// - Because the salt is per-item, two identical passwords stored in two
//   items produce completely different ciphertext.
// - If the user forgets the master passphrase, the data is NOT recoverable.
//   This is intentional (true zero-knowledge encryption) — make sure the
//   passphrase itself is backed up somewhere safe and offline.

import CryptoJS from 'crypto-js'

const PBKDF2_ITERATIONS = 210000 // OWASP 2023+ recommendation ballpark for PBKDF2-HMAC-SHA256
const KEY_SIZE_WORDS = 256 / 32

function deriveKey(passphrase, saltHex) {
  const salt = CryptoJS.enc.Hex.parse(saltHex)
  return CryptoJS.PBKDF2(passphrase, salt, {
    keySize: KEY_SIZE_WORDS,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  })
}

function randomHex(bytes) {
  return CryptoJS.lib.WordArray.random(bytes).toString(CryptoJS.enc.Hex)
}

/**
 * Encrypts a plaintext string with AES-256-CBC.
 * Returns { cipherText, iv, salt } — all safe to store in Firestore.
 */
export function encryptField(plainText, passphrase) {
  if (plainText === '' || plainText === null || plainText === undefined) {
    return { cipherText: '', iv: '', salt: '' }
  }
  const salt = randomHex(16) // 128-bit salt
  const iv = CryptoJS.enc.Hex.parse(randomHex(16)) // 128-bit IV
  const key = deriveKey(passphrase, salt)

  const encrypted = CryptoJS.AES.encrypt(plainText, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })

  return {
    cipherText: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv: iv.toString(CryptoJS.enc.Hex),
    salt,
  }
}

/**
 * Decrypts a field previously produced by encryptField.
 * Throws if the passphrase is wrong (padding/UTF-8 error), which callers
 * should catch and treat as "wrong master passphrase".
 */
export function decryptField({ cipherText, iv, salt }, passphrase) {
  if (!cipherText) return ''
  const key = deriveKey(passphrase, salt)
  const ivWords = CryptoJS.enc.Hex.parse(iv)
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(cipherText),
  })
  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: ivWords,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  })
  const text = decrypted.toString(CryptoJS.enc.Utf8)
  if (!text && cipherText) {
    throw new Error('Decryption failed — wrong master passphrase?')
  }
  return text
}

/**
 * Verification helper: encrypt a known marker string with the passphrase and
 * store salt+iv+cipherText in the user's settings doc. Later, checking the
 * passphrase = trying to decrypt the marker and compare it back. This lets
 * the app tell "wrong passphrase" apart from "corrupted data" without ever
 * storing the passphrase itself.
 */
export const VAULT_CHECK_MARKER = 'personal-hub-vault-ok'

export function makePassphraseCheck(passphrase) {
  return encryptField(VAULT_CHECK_MARKER, passphrase)
}

export function verifyPassphrase(check, passphrase) {
  try {
    return decryptField(check, passphrase) === VAULT_CHECK_MARKER
  } catch {
    return false
  }
}
