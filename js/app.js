// ============================================================
// app.js — Fő alkalmazás kontroller
// FitPlan Pro | Mode switcher + navigáció + auth bridge
// ============================================================

import { signInWithGoogle, signOutUser, onAuthChange } from "./auth.js";
import { initDiet,      destroyDiet      } from "./modules/diet.js";
import { initWorkout,   destroyWorkout   } from "./modules/workout.js";
import { initRecovery,  destroyRecovery  } from "./modules/recovery.js";
import { initPrHub,     destroyPrHub     } from "./modules/pr-hub.js";
import { initDocuments, destroyDocuments } from "./modules/documents.js";

// ── Modul definíciók (design token-ek) ────────────────────
// Sorrend: Diéta → Edzés → Regeneráció → Rekordok → Dokumentumok
const MODULES = {
  diet: {
    label:   "Diéta",
    sub:     "Napi Étkezések",
    icon:    "fa-solid fa-apple-whole",
    color:   "#16a34a",   // emerald-600
    colorBg: "#dcfce7",   // emerald-50
  },
  workout: {
    label:   "Edzés",
    sub:     "Tervek & Naplózás",
    icon:    "fa-solid fa-dumbbell",
    color:   "#4338ca",   // indigo-700
    colorBg: "#eef2ff",   // indigo-50
  },
  recovery: {
    label:   "Regeneráció",
    sub:     "Alvás & Pihenés",
    icon:    "fa-solid fa-moon",
    color:   "#7c3aed",   // violet-600
    colorBg: "#f5f3ff",   // violet-50
  },
  prhub: {
    label:   "Rekordok",
    sub:     "Személyes Rekordok",
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

// Alapértelmezett modul (első tab)
let currentModule = "diet";

// ── DOM segéd ─────────────────────────────────────────────
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

  if (headerBg)    headerBg.style.backgroundColor  = m.colorBg;
  if (iconBadge)   iconBadge.style.backgroundColor = m.color;
  if (headerTitle) { headerTitle.textContent = m.label; headerTitle.style.color = m.color; }
  if (headerSub)   headerSub.textContent = m.sub;
  if (headerIcon)  headerIcon.className  = `${m.icon} text-white text-xl`;

  // Nav gomb kiemelés
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const isActive = btn.dataset.module === moduleKey;
    btn.style.backgroundColor = isActive ? m.color      : "transparent";
    btn.style.color            = isActive ? "#ffffff"    : "#6b7280";
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

  // Mindig takarítjuk az előző előfizetéseket és adatokat
  destroyDiet();
  destroyWorkout();
  destroyRecovery();
  destroyPrHub();
  destroyDocuments();

  if (user) {
    // ── Bejelentkezett ──────────────────────────────────
    if (loginScreen) loginScreen.classList.add("hidden");
    if (appShell)    appShell.classList.remove("hidden");
    if (userAvatar)  userAvatar.src = user.photoURL || "https://www.gravatar.com/avatar/?d=mp";
    if (userName)    userName.textContent = user.displayName || user.email;

    // Aktív modul megjelenítése
    showModule(currentModule);

    // Modulok inicializálása az aktuális felhasználó egyedi azonosítójával
    initDiet(user.uid);
    initWorkout(user.uid);
    initRecovery(user.uid);
    initPrHub(user.uid);
    initDocuments(user.uid);

  } else {
    // ── Kijelentkezett — felület visszaállítása ────────
    if (userAvatar) userAvatar.src = "";
    if (userName)   userName.textContent = "";

    if (loginScreen) loginScreen.classList.remove("hidden");
    if (appShell)    appShell.classList.add("hidden");
  }
}

// ── Inicializálás ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // Auth állapot figyelő
  onAuthChange(handleAuthState);

  // Bejelentkezés
  const loginBtn = $("btn-google-login");
  if (loginBtn) loginBtn.addEventListener("click", signInWithGoogle);

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
});
