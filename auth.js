// ============================================================
// auth.js — Hitelesítési modul
// FitPlan Pro | Google Sign-In + állapotfigyelő
// ============================================================

import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ── Bejelentkezés Google-lel ────────────────────────────────
export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("[Auth] Bejelentkezési hiba:", err.message);
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
// Hívd meg az app.js-ből: onAuthChange(user => { ... })
export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}
