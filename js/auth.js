// ============================================================
// auth.js — Hitelesítési modul
// Lockin Pro
// Google Sign-In + Email/Jelszó + Vendég (Guest) mód + Helyi fallback
// JAVÍTVA: Egyszeri Firebase listener (nincs dupla regisztrálás)
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
let _firebaseListenerStarted = false; // Garantálja, hogy csak 1 listener fut
let _lastNotifiedUid = undefined; // Megelőzi a redundáns duplikált callback értesítéseket

// Korábbi helyi munkamenet ellenőrzése (szinkron, biztonságos)
try {
  const saved = localStorage.getItem('lockin_local_user');
  if (saved) {
    _currentLocalUser = JSON.parse(saved);
  }
} catch (e) {
  console.warn('[Auth] Nem sikerült a helyi munkamenet beolvasása:', e);
}

// ── Belső callback értesítő ─────────────────────────────────
function _notifyCallbacks(user) {
  const uid = user ? user.uid : null;
  if (_lastNotifiedUid === uid) return;
  _lastNotifiedUid = uid;

  _authCallbacks.forEach(cb => {
    try {
      cb(user);
    } catch (err) {
      console.error('[Auth] Callback hiba:', err);
    }
  });
}

// ── Egyszeri Firebase listener elindítása ──────────────────
// Ezt a modult betöltésekor azonnal elindítjuk, NEM minden onAuthChange()-nél!
function _startFirebaseListener() {
  if (_firebaseListenerStarted) return;
  _firebaseListenerStarted = true;

  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      // Firebase bejelentkezés sikeres — helyi profil törlése
      _currentLocalUser = null;
      localStorage.removeItem('lockin_local_user');
      _notifyCallbacks(firebaseUser);
    } else {
      // Nincs Firebase user — helyi profil ellenőrzése
      if (_currentLocalUser) {
        _notifyCallbacks(_currentLocalUser);
      } else {
        _notifyCallbacks(null);
      }
    }
  }, (err) => {
    console.error('[Auth] Firebase listener hiba:', err);
    // Firebase hiba esetén is értesítjük a callbackeket (helyi profillal ha van)
    _notifyCallbacks(_currentLocalUser || null);
  });
}

// Firebase listener azonnal indul a modul betöltésekor
_startFirebaseListener();

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
      photoURL: './logolight.jpg'
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
  const capitalized = namePart
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

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
    photoURL: 'https://www.gravatar.com/avatar/?d=mp'
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
  localStorage.removeItem('lockin_guest_uid');

  try {
    await signOut(auth);
  } catch (err) {
    console.error("[Auth] Kijelentkezési hiba:", err.message);
  }

  _notifyCallbacks(null);
}

// ── Auth állapot figyelő (callback regisztrálás) ────────────
// FONTOS: Minden onAuthChange() hívás csak egy callback-et regisztrál.
// A Firebase onAuthStateChanged listener EGY DARAB, a modul szintjén fut.
export function onAuthChange(callback) {
  if (typeof callback !== 'function') return;

  // Duplikált callback regisztrálás megelőzése
  if (_authCallbacks.includes(callback)) return;
  _authCallbacks.push(callback);

  // Ha már van ismert állapot, azonnal továbbítjuk az új feliratkozónak
  try {
    if (_currentLocalUser) {
      callback(_currentLocalUser);
    } else if (_lastNotifiedUid !== undefined) {
      callback(auth.currentUser || null);
    }
  } catch (e) {
    console.error('[Auth] Kezdeti callback hiba:', e);
  }
}
