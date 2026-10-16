// ============================================================
// auth.js — Hitelesítési modul
// FitPlan Pro | Google Sign-In + Email/Jelszó + állapotfigyelő
// ============================================================

import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ── Bejelentkezés Google-lel ────────────────────────────────
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("[Auth] Google bejelentkezési hiba:", err.message);
    throw err;
  }
}

// ── Bejelentkezés Email / Jelszóval ─────────────────────────
export async function signInWithEmail(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("[Auth] Email bejelentkezési hiba:", err.message);
    throw err;
  }
}

// ── Regisztráció Email / Jelszóval ──────────────────────────
export async function registerWithEmail(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("[Auth] Regisztrációs hiba:", err.message);
    throw err;
  }
}

// ── Kijelentkezés ──────────────────────────────────────────
export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[Auth] Kijelentkezési hiba:", err.message);
  }
}

// ── Auth állapot figyelő (callback-alapú) ──────────────────
export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}
