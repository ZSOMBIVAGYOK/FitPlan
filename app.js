// ============================================================
// app.js — Fő alkalmazás kontroller
// FitPlan Pro | Mode switcher + navigáció + auth bridge + beállítások + téma
// ============================================================

import { signInWithGoogle, signInWithEmail, registerWithEmail, signOutUser, onAuthChange } from "./auth.js";
import { initTheme } from "./theme.js";
import { initSettings, destroySettings } from "./settings.js";
import { initDiet,      destroyDiet      } from "./modules/diet.js";
import { initWorkout,   destroyWorkout   } from "./modules/workout.js";
import { initRecovery,  destroyRecovery  } from "./modules/recovery.js";
import { initPrHub,     destroyPrHub     } from "./modules/pr-hub.js";
import { initDocuments, destroyDocuments } from "./modules/documents.js";

// ── Modul definíciók (design token-ek) ────────────────────
const MODULES = {
  diet: {
    label:   "Diéta",
    sub:     "Napi Étkezések & Menü",
    icon:    "fa-solid fa-apple-whole",
    color:   "#16a34a",   // emerald-600
    colorBg: "#dcfce7",   // emerald-50
  },
  workout: {
    label:   "Edzés",
    sub:     "Garmin Sportok & Rutinok",
    icon:    "fa-solid fa-dumbbell",
    color:   "#4338ca",   // indigo-700
    colorBg: "#eef2ff",   // indigo-50
  },
  recovery: {
    label:   "Regeneráció",
    sub:     "Alvás & SMR / Nyújtás",
    icon:    "fa-solid fa-moon",
    color:   "#7c3aed",   // violet-600
    colorBg: "#f5f3ff",   // violet-50
  },
  prhub: {
    label:   "Rekordok",
    sub:     "Személyes Csúcsok & 1RM",
    icon:    "fa-solid fa-trophy",
    color:   "#d97706",   // amber-600
    colorBg: "#fffbeb",   // amber-50
  },
  documents: {
    label:   "Dokumentumok",
    sub:     "Leletek & Fájlok",
    icon:    "fa-solid fa-file-medical",
    color:   "#0891b2",   // cyan-600
    colorBg: "#ecfeff",   // cyan-50
  },
};

let currentModule = "diet";

const $ = id => document.getElementById(id);

// ── Fejléc átszínezése az aktív modulra ───────────────────
function applyModuleTheme(moduleKey) {
  const m = MODULES[moduleKey];
  if (!m) return;

  const headerBg    = $("header-bg");
  const iconBadge   = $("icon-badge");
  const headerIcon  = $("header-icon");
  const headerTitle = $("header-title");
  const headerSub   = $("header-sub");

  const isDark = document.documentElement.classList.contains("dark");

  if (headerBg) {
    headerBg.style.backgroundColor = isDark ? "#0f172a" : m.colorBg;
  }
  if (iconBadge)   iconBadge.style.backgroundColor = m.color;
  if (headerTitle) { headerTitle.textContent = m.label; headerTitle.style.color = m.color; }
  if (headerSub)   headerSub.textContent = m.sub;
  if (headerIcon)  headerIcon.className  = `${m.icon} text-white text-xl`;

  // Nav gomb kiemelés
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const isActive = btn.dataset.module === moduleKey;
    btn.style.backgroundColor = isActive ? m.color : "transparent";
    btn.style.color           = isActive ? "#ffffff" : "";
    btn.className = `nav-btn flex-1 min-w-[58px] flex flex-col items-center gap-1 py-2 px-1 rounded-2xl transition-all duration-200 ${
      isActive ? 'shadow-sm text-white' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600'
    }`;
  });
}

// ── Panel váltás ──────────────────────────────────────────
function showModule(moduleKey) {
  currentModule = moduleKey;
  applyModuleTheme(moduleKey);

  document.querySelectorAll(".module-panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  const target = $(`panel-${moduleKey}`);
  if (target) target.classList.remove("hidden");
}

// ── Auth állapot kezelése ──────────────────────────────────
function handleAuthState(user) {
  const loginScreen = $("login-screen");
  const appShell    = $("app-shell");
  const userAvatar  = $("user-avatar");
  const userName    = $("user-name");

  // Előző modulok takarítása
  destroyDiet();
  destroyWorkout();
  destroyRecovery();
  destroyPrHub();
  destroyDocuments();
  destroySettings();

  if (user) {
    // ── Bejelentkezett ──────────────────────────────────
    if (loginScreen) loginScreen.classList.add("hidden");
    if (appShell)    appShell.classList.remove("hidden");
    if (userAvatar)  userAvatar.src = user.photoURL || "https://www.gravatar.com/avatar/?d=mp";
    if (userName)    userName.textContent = user.displayName || user.email;

    // Beállítások (Gear) és Téma inicializálása
    initSettings(user);

    // Aktív modul megjelenítése
    showModule(currentModule);

    // Modulok indítása
    initDiet(user.uid);
    initWorkout(user.uid);
    initRecovery(user.uid);
    initPrHub(user.uid);
    initDocuments(user.uid);

  } else {
    // ── Kijelentkezett ─────────────────────────────────
    if (userAvatar) userAvatar.src = "";
    if (userName)   userName.textContent = "";

    if (loginScreen) loginScreen.classList.remove("hidden");
    if (appShell)    appShell.classList.add("hidden");
  }
}

// ── Bejelentkező felület vezérlő (Email / Jelszó) ───────────
function setupAuthScreen() {
  const loginBtn = $("btn-google-login");
  if (loginBtn) loginBtn.addEventListener("click", () => {
    signInWithGoogle().catch(err => _showAuthError(err.message));
  });

  let authMode = "login"; // 'login' | 'register'
  const toggleBtn = $("btn-toggle-auth-mode");
  const submitBtn = $("btn-email-submit");
  const emailIn   = $("input-email");
  const passIn    = $("input-password");
  const titleEl   = $("auth-title-text");

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      authMode = authMode === "login" ? "register" : "login";
      if (titleEl) titleEl.textContent = authMode === "login" ? "Bejelentkezés fiókkal" : "Új fiók regisztrációja";
      if (submitBtn) submitBtn.textContent = authMode === "login" ? "Bejelentkezés" : "Fiók létrehozása";
      toggleBtn.textContent = authMode === "login" ? "Nincs még fiókod? Regisztrálj!" : "Van már fiókod? Lépj be!";
      _clearAuthError();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = emailIn?.value.trim();
      const pass = passIn?.value;

      if (!email || !pass) {
        _showAuthError("Kérlek, töltsd ki mind az email, mind a jelszó mezőt!");
        return;
      }
      if (pass.length < 6) {
        _showAuthError("A jelszónak legalább 6 karakter hosszúnak kell lennie!");
        return;
      }

      _clearAuthError();
      submitBtn.disabled = true;
      submitBtn.textContent = "Folyamatban...";

      try {
        if (authMode === "login") {
          await signInWithEmail(email, pass);
        } else {
          await registerWithEmail(email, pass);
        }
      } catch (err) {
        let msg = err.message;
        if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
          msg = "Hibás email cím vagy jelszó!";
        } else if (err.code === "auth/email-already-in-use") {
          msg = "Ez az email cím már regisztrálva van!";
        } else if (err.code === "auth/invalid-email") {
          msg = "Érvénytelen email cím formátum!";
        }
        _showAuthError(msg);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = authMode === "login" ? "Bejelentkezés" : "Fiók létrehozása";
      }
    });
  }
}

function _showAuthError(msg) {
  const errBox = $("auth-error-box");
  if (errBox) {
    errBox.textContent = msg;
    errBox.classList.remove("hidden");
  }
}

function _clearAuthError() {
  const errBox = $("auth-error-box");
  if (errBox) {
    errBox.textContent = "";
    errBox.classList.add("hidden");
  }
}

// ── Inicializálás ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Apple Light/Dark téma inicializálása
  initTheme();

  // Auth képernyő és állapotfigyelő
  setupAuthScreen();
  onAuthChange(handleAuthState);

  // Kijelentkezés
  const logoutBtn = $("btn-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", signOutUser);

  // Navigációs gombok
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mod = btn.dataset.module;
      if (mod) showModule(mod);
    });
  });

  // Téma váltáskor fejléc szín frissítése
  window.addEventListener("storage", () => applyModuleTheme(currentModule));
});
