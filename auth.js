// ============================================================
// auth.js — Hitelesítési modul
// FitPlan Pro | Lockin 5.0
// Google Sign-In + Email/Jelszó + Vendég (Guest) mód + Helyi fallback
// ============================================================

import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ── Belső állapot ──────────────────────────────────────────
const _authCallbacks = [];
let _currentLocalUser = null;

// Korábbi helyi munkamenet ellenőrzése
try {
  const saved = localStorage.getItem('lockin_local_user');
  if (saved) {
    _currentLocalUser = JSON.parse(saved);
  }
} catch (e) {
  console.warn('[Auth] Nem sikerült a helyi munkamenet beolvasása:', e);
}

function _notifyCallbacks(user) {
  _authCallbacks.forEach(cb => {
    try {
      cb(user);
    } catch (err) {
      console.error('[Auth] Callback hiba:', err);
    }
  });
}

// ── Bejelentkezés Google-lel ────────────────────────────────
export async function signInWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, provider);
    _currentLocalUser = null;
    localStorage.removeItem('lockin_local_user');
    return cred.user;
  } catch (err) {
    console.error("[Auth] Google bejelentkezési hiba:", err);
    throw err;
  }
}

// ── Bejelentkezés Email / Jelszóval ─────────────────────────
export async function signInWithEmail(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    _currentLocalUser = null;
    localStorage.removeItem('lockin_local_user');
    return cred.user;
  } catch (err) {
    console.error("[Auth] Email bejelentkezési hiba:", err);
    throw err;
  }
}

// ── Regisztráció Email / Jelszóval ──────────────────────────
export async function registerWithEmail(email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    _currentLocalUser = null;
    localStorage.removeItem('lockin_local_user');
    return cred.user;
  } catch (err) {
    console.error("[Auth] Regisztrációs hiba:", err);
    throw err;
  }
}

// ── Bejelentkezés Vendégként / Próba ─────────────────────────
export async function signInAsGuest() {
  try {
    // 1. Megpróbáljuk a hivatalos Firebase Anonymous Auth-ot
    const cred = await signInAnonymously(auth);
    _currentLocalUser = null;
    localStorage.removeItem('lockin_local_user');
    return cred.user;
  } catch (err) {
    console.warn("[Auth] Firebase Anonymous belépés sikertelen, helyi profil indítása:", err.message);
    
    // 2. Helyi vendég munkamenet generálása (offline / file:// / tiltott környezetben)
    let guestUid = localStorage.getItem('lockin_guest_uid');
    if (!guestUid) {
      guestUid = 'guest_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('lockin_guest_uid', guestUid);
    }

    const localUser = {
      uid: guestUid,
      email: 'vendeg@lockin.app',
      displayName: 'Vendég Sportoló',
      isAnonymous: true,
      photoURL: ''
    };

    _currentLocalUser = localUser;
    localStorage.setItem('lockin_local_user', JSON.stringify(localUser));
    _notifyCallbacks(localUser);
    return localUser;
  }
}

// ── Bejelentkezés Helyi Profilként (Fallback) ────────────────
export function signInLocally(email) {
  const cleanEmail = (email || 'sportolo@lockin.app').trim();
  const namePart = cleanEmail.split('@')[0];
  const capitalized = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  
  let safeUid = '';
  try {
    safeUid = 'local_' + btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  } catch (e) {
    safeUid = 'local_' + Math.random().toString(36).slice(2, 12);
  }

  const localUser = {
    uid: safeUid,
    email: cleanEmail,
    displayName: capitalized,
    isAnonymous: false,
    photoURL: ''
  };

  _currentLocalUser = localUser;
  localStorage.setItem('lockin_local_user', JSON.stringify(localUser));
  _notifyCallbacks(localUser);
  return localUser;
}

// ── Kijelentkezés ──────────────────────────────────────────
export async function signOutUser() {
  _currentLocalUser = null;
  localStorage.removeItem('lockin_local_user');

  try {
    await signOut(auth);
  } catch (err) {
    console.error("[Auth] Kijelentkezési hiba:", err.message);
  }

  _notifyCallbacks(null);
}

// ── Auth állapot figyelő (callback-alapú) ──────────────────
export function onAuthChange(callback) {
  if (typeof callback !== 'function') return;
  _authCallbacks.push(callback);

  // Ha van érvényes helyi munkamenet, azonnal továbbítjuk
  if (_currentLocalUser) {
    try {
      callback(_currentLocalUser);
    } catch (e) {
      console.error('[Auth] Kezdeti callback hiba:', e);
    }
  }

  // Firebase Auth figyelő csatolása
  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      _currentLocalUser = null;
      localStorage.removeItem('lockin_local_user');
      callback(firebaseUser);
    } else {
      // Ha nincs Firebase user, de van helyi profil
      if (_currentLocalUser) {
        callback(_currentLocalUser);
      } else {
        callback(null);
      }
    }
  });
}
