// ============================================================
// app.js — Fő alkalmazás kontroller
// FitPlan Pro | Mode switcher + navigáció + auth bridge + beállítások + téma
// ============================================================

import {
  signInWithGoogle,
  signInWithEmail,
  registerWithEmail,
  signInAsGuest,
  signInLocally,
  signOutUser,
  onAuthChange
} from "./auth.js";
import { initTheme } from "./theme.js";
import { initSettings, destroySettings, openSettingsModal } from "./settings.js";
import { initDiet,      destroyDiet      } from "./modules/diet.js";
import { initActivity,  destroyActivity  } from "./modules/activity.js";
import { initWorkout,   destroyWorkout   } from "./modules/workout.js";
import { initRecovery,  destroyRecovery  } from "./modules/recovery.js";
import { initPrHub,     destroyPrHub     } from "./modules/pr-hub.js";
import { initDocuments, destroyDocuments } from "./modules/documents.js";
import {
  initWhoop5,
  destroyWhoop5,
  _renderHomeScreen,
  _renderHealthScreen,
  _renderCommunityScreen,
  _renderMoreScreen,
  closeHomeCalendar
} from "./modules/whoop5.js";
import { syncIntervals } from "./modules/intervals.js";
import { initBodyMap, destroyBodyMap, renderBodyMap } from "./modules/bodymap.js";

// ── Modul definíciók (design token-ek) ────────────────────
const MODULES = {
  home: {
    label:   "Lockin",
    sub:     "Home Műszerfal & Dials",
    icon:    "fa-solid fa-house",
    color:   "#00e5ff",   // electric blue
    colorBg: "#ecfeff",
  },
  health: {
    label:   "Health",
    sub:     "Lockin Age & Vérkép Elemző",
    icon:    "fa-solid fa-heart-pulse",
    color:   "#00e676",   // whoop green
    colorBg: "#dcfce7",
  },
  community: {
    label:   "Community",
    sub:     "Csapatok & Ranglisták",
    icon:    "fa-solid fa-users",
    color:   "#00e5ff",
    colorBg: "#ecfeff",
  },
  more: {
    label:   "More",
    sub:     "Modulok & Beállítások",
    icon:    "fa-solid fa-ellipsis",
    color:   "#818cf8",
    colorBg: "#eef2ff",
  },
  diet: {
    label:   "Diéta",
    sub:     "Napi Étkezések & Menü",
    icon:    "fa-solid fa-apple-whole",
    color:   "#16a34a",   // emerald-600
    colorBg: "#dcfce7",   // emerald-50
  },
  activity: {
    label:   "Aktivitás",
    sub:     "Edzés, Rutinok, SMR & Felszerelés",
    icon:    "fa-solid fa-bolt",
    color:   "#00e5ff",   // electric blue / cyan
    colorBg: "#ecfeff",   // cyan-50
  },
  workout: {
    label:   "Aktivitás",
    sub:     "Edzés, Rutinok, SMR & Felszerelés",
    icon:    "fa-solid fa-bolt",
    color:   "#00e5ff",
    colorBg: "#ecfeff",
  },
  recovery: {
    label:   "Aktivitás",
    sub:     "Edzés, Rutinok, SMR & Felszerelés",
    icon:    "fa-solid fa-bolt",
    color:   "#00e5ff",
    colorBg: "#ecfeff",
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
  bodymap: {
    label:   "Testtérkép",
    sub:     "Izomterhelés & Regeneráció",
    icon:    "fa-solid fa-person",
    color:   "#e11d48",   // rose-600
    colorBg: "#ffe4e6",   // rose-50
  },
};

let currentModule = "home";

const $ = id => document.getElementById(id);

// ── Fejléc átszínezése az aktív modulra ───────────────────
function applyModuleTheme(moduleKey) {
  const m = MODULES[moduleKey];
  if (!m) return;

  const headerBg      = $("header-bg");
  const iconBadge     = $("icon-badge");
  const headerIcon    = $("header-icon");
  const headerTitle   = $("header-title");
  const headerSub     = $("header-sub");
  const headerLogoL   = $("header-logo-light");
  const headerLogoD   = $("header-logo-dark");

  const isDark = document.documentElement.classList.contains("dark");

  if (headerBg) {
    headerBg.style.backgroundColor = isDark ? "#0B0C0E" : m.colorBg;
  }
  if (iconBadge) {
    // Home modulon: logó látszik, ikon rejtve és átlátszó háttér
    if (moduleKey === "home") {
      iconBadge.style.backgroundColor = "transparent";
      iconBadge.style.boxShadow = "none";
      if (headerIcon)  headerIcon.className = "hidden";
      if (headerLogoL) headerLogoL.classList.remove("hidden");
      if (headerLogoD) headerLogoD.classList.remove("hidden");
    } else {
      iconBadge.style.backgroundColor = m.color;
      iconBadge.style.boxShadow = "";
      if (headerIcon)  headerIcon.className  = `${m.icon} text-white text-xl`;
      if (headerLogoL) headerLogoL.classList.add("hidden");
      if (headerLogoD) headerLogoD.classList.add("hidden");
    }
  }
  if (headerTitle) { headerTitle.textContent = m.label; headerTitle.style.color = m.color; }
  if (headerSub)   headerSub.textContent = m.sub;

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
export function showModule(moduleKey) {
  if (moduleKey === "workout" || moduleKey === "recovery") {
    moduleKey = "activity";
  }

  // Ha nem a Home fülön vagyunk, a naptár azonnal eltűnik
  if (moduleKey !== "home") {
    closeHomeCalendar();
  }

  currentModule = moduleKey;
  applyModuleTheme(moduleKey);

  document.querySelectorAll(".module-panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  const target = $(`panel-${moduleKey}`);
  if (target) target.classList.remove("hidden");

  // WHOOP 5.0 képernyők dinamikus frissítése
  if (moduleKey === "home") {
    _renderHomeScreen();
  } else if (moduleKey === "health") {
    _renderHealthScreen();
  } else if (moduleKey === "community") {
    _renderCommunityScreen();
  } else if (moduleKey === "more") {
    _renderMoreScreen();
  } else if (moduleKey === "bodymap") {
    renderBodyMap();
  }
}
window.showModule = showModule;

// ── Auth állapot kezelése ──────────────────────────────────
let _lastHandledUserId = undefined; // Dupla tüzelés megelőzése

function handleAuthState(user) {
  const userId = user ? (user.uid || user.email || 'local') : null;

  // Ha ugyanaz a user/állapot már be van töltve, ne inicializáljunk újra (pl. dupla Firebase event)
  if (_lastHandledUserId === userId) {
    return;
  }
  _lastHandledUserId = userId;

  const loginScreen = $("login-screen");
  const appShell    = $("app-shell");
  const userAvatar  = $("user-avatar");
  const userName    = $("user-name");

  // Előző modulok biztonságos takarítása
  try { destroyWhoop5(); } catch (e) { console.warn("[App] destroyWhoop5 error:", e); }
  try { destroyDiet(); } catch (e) { console.warn("[App] destroyDiet error:", e); }
  try { destroyActivity(); } catch (e) { console.warn("[App] destroyActivity error:", e); }
  try { destroyWorkout(); } catch (e) { console.warn("[App] destroyWorkout error:", e); }
  try { destroyRecovery(); } catch (e) { console.warn("[App] destroyRecovery error:", e); }
  try { destroyPrHub(); } catch (e) { console.warn("[App] destroyPrHub error:", e); }
  try { destroyDocuments(); } catch (e) { console.warn("[App] destroyDocuments error:", e); }
  try { destroyBodyMap(); } catch (e) { console.warn("[App] destroyBodyMap error:", e); }
  try { destroySettings(); } catch (e) { console.warn("[App] destroySettings error:", e); }

  if (user) {
    // ── Bejelentkezett ──────────────────────────────────
    if (loginScreen) loginScreen.classList.add("hidden");
    if (appShell)    appShell.classList.remove("hidden");
    if (userAvatar)  userAvatar.src = user.photoURL || "https://www.gravatar.com/avatar/?d=mp";
    if (userName)    userName.textContent = user.displayName || user.email || "Sportoló";

    // Modulok indítása
    try { initSettings(user); } catch (e) { console.error("[App] initSettings error:", e); }
    try { initWhoop5(user.uid); } catch (e) { console.error("[App] initWhoop5 error:", e); }
    try { initDiet(user.uid); } catch (e) { console.error("[App] initDiet error:", e); }
    try { initActivity(user.uid); } catch (e) { console.error("[App] initActivity error:", e); }
    try { initPrHub(user.uid); } catch (e) { console.error("[App] initPrHub error:", e); }
    try { initDocuments(user.uid); } catch (e) { console.error("[App] initDocuments error:", e); }
    try { initBodyMap(user.uid); } catch (e) { console.error("[App] initBodyMap error:", e); }

    // Aktív modul megjelenítése (Alapértelmezett: WHOOP 5.0 Home)
    try { showModule(currentModule); } catch (e) { console.error("[App] showModule error:", e); }

  } else {
    // ── Kijelentkezett ─────────────────────────────────
    if (userAvatar) userAvatar.src = "";
    if (userName)   userName.textContent = "";

    if (loginScreen) loginScreen.classList.remove("hidden");
    if (appShell)    appShell.classList.add("hidden");
  }
}

// ── Bejelentkező felület vezérlő (Google / Email / Vendég) ──
function setupAuthScreen() {
  const loginBtn   = $("btn-google-login");
  const guestBtn   = $("btn-guest-login");
  const authForm   = $("auth-form");
  const toggleBtn  = $("btn-toggle-auth-mode");
  const submitBtn  = $("btn-email-submit");
  const emailIn    = $("input-email");
  const passIn     = $("input-password");
  const titleEl    = $("auth-title-text");

  let authMode = "login"; // 'login' | 'register'

  // 1. Google Bejelentkezés
  if (loginBtn && !loginBtn.dataset.bound) {
    loginBtn.dataset.bound = "true";
    loginBtn.addEventListener("click", async () => {
      _clearAuthError();
      loginBtn.disabled = true;
      try {
        await signInWithGoogle();
      } catch (err) {
        _handleAuthError(err);
      } finally {
        loginBtn.disabled = false;
      }
    });
  }

  // 2. Vendég / Gyors belépés (1 kattintás regisztráció nélkül)
  if (guestBtn && !guestBtn.dataset.bound) {
    guestBtn.dataset.bound = "true";
    guestBtn.addEventListener("click", async () => {
      _clearAuthError();
      guestBtn.disabled = true;
      guestBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Belépés folyamatban...';
      try {
        await signInAsGuest();
      } catch (err) {
        _handleAuthError(err);
      } finally {
        guestBtn.disabled = false;
        guestBtn.innerHTML = '<i class="fa-solid fa-user-check text-sm mr-1.5"></i><span>Belépés vendégként (Azonnali próba regisztráció nélkül)</span>';
      }
    });
  }

  // 3. Váltás Bejelentkezés és Regisztráció között
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = "true";
    toggleBtn.addEventListener("click", () => {
      authMode = authMode === "login" ? "register" : "login";
      if (titleEl) titleEl.textContent = authMode === "login" ? "Bejelentkezés fiókkal" : "Új fiók regisztrációja";
      if (submitBtn) submitBtn.textContent = authMode === "login" ? "Bejelentkezés" : "Fiók létrehozása";
      toggleBtn.textContent = authMode === "login" ? "Nincs még fiókod? Regisztrálj!" : "Van már fiókod? Lépj be!";
      _clearAuthError();
    });
  }

  // 4. Email / Jelszó űrlap beküldése
  const handleEmailSubmit = async (e) => {
    if (e) e.preventDefault();
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
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Folyamatban...";
    }

    try {
      if (authMode === "login") {
        await signInWithEmail(email, pass);
      } else {
        await registerWithEmail(email, pass);
      }
    } catch (err) {
      _handleAuthError(err, email);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = authMode === "login" ? "Bejelentkezés" : "Fiók létrehozása";
      }
    }
  };

  if (authForm && !authForm.dataset.bound) {
    authForm.dataset.bound = "true";
    authForm.addEventListener("submit", handleEmailSubmit);
  }

  if (submitBtn && !submitBtn.dataset.bound) {
    submitBtn.dataset.bound = "true";
    submitBtn.addEventListener("click", handleEmailSubmit);
  }
}

function _handleAuthError(err, attemptedEmail) {
  let msg = err.message || "Ismeretlen hitelesítési hiba történt.";
  let allowLocalFallback = true;

  const code = err.code || "";

  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
    msg = "Hibás email cím vagy jelszó! Ha még nincs fiókod, kattints a 'Regisztrálj!' gombra alul, vagy használd a vendég belépést!";
  } else if (code === "auth/email-already-in-use") {
    msg = "Ez az email cím már regisztrálva van! Jelentkezz be jelszavaddal, vagy lépj be vendégként!";
  } else if (code === "auth/invalid-email") {
    msg = "Érvénytelen email cím formátum! Kérlek, ellenőrizd az email címet.";
  } else if (code === "auth/weak-password") {
    msg = "Túl gyenge jelszó! A jelszónak legalább 6 karakterből kell állnia.";
  } else if (code === "auth/popup-blocked") {
    msg = "A böngésződ blokkolta a felugró Google bejelentkezési ablakot. Engedélyezd a felugró ablakokat a címsorban, vagy kattints az alábbi gombra az azonnali belépéshez!";
  } else if (code === "auth/popup-closed-by-user") {
    msg = "A Google bejelentkezési ablak be lett zárva a folyamat befejezése előtt. Próbáld újra, vagy lépj be az alábbi gombbal!";
  } else if (code === "auth/operation-not-allowed") {
    msg = "A Google bejelentkezés még nincs bekapcsolva a Firebase konzolban (Authentication -> Sign-in method -> Google: Engedélyezve). Kattints az alábbi gombra a teszteléshez!";
  } else if (code === "auth/operation-not-supported-in-this-environment") {
    msg = "A Google felhőbejelentkezés közvetlen fájlból (file:// protokoll) nem működik. Nyisd meg a http://localhost:8000 címet, vagy lépj be az alábbi gombbal!";
  } else if (code === "auth/network-request-failed") {
    msg = "Hálózati hiba: a Firebase szervere nem érhető el. Ellenőrizd a kapcsolatot, vagy folytasd offline!";
  } else if (code === "auth/unauthorized-domain") {
    msg = "Ez a domain (pl. 127.0.0.1) nincs engedélyezve a Firebase konzolban! Használd a http://localhost:8000 címet a 127.0.0.1 helyett!";
  }

  _showAuthError(msg, attemptedEmail || "zsombor.sportolo@gmail.com");
}

function _showAuthError(msg, fallbackEmail) {
  const errBox = $("auth-error-box");
  const errText = $("auth-error-text");
  const errAction = $("auth-error-action");

  if (!errBox) return;

  if (errText) errText.textContent = msg;
  else errBox.textContent = msg;

  if (errAction) {
    if (fallbackEmail) {
      const emailToUse = fallbackEmail || "sportolo@lockin.app";
      const isGoogleLike = emailToUse.includes("@gmail") || msg.includes("Google") || msg.includes("file://");
      errAction.innerHTML = `
        <button type="button" id="btn-fallback-local-login"
                class="w-full mt-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1.5 active:scale-95">
          <i class="fa-solid fa-bolt"></i>
          <span>${isGoogleLike ? 'Belépés Google fiókkal azonnal (Helyi profil)' : 'Belépés helyi profillal azonnal'}</span>
        </button>
      `;
      errAction.classList.remove("hidden");

      const fbBtn = $("btn-fallback-local-login");
      if (fbBtn) {
        fbBtn.addEventListener("click", () => {
          _clearAuthError();
          signInLocally(emailToUse);
        });
      }
    } else {
      errAction.innerHTML = "";
      errAction.classList.add("hidden");
    }
  }

  errBox.classList.remove("hidden");
}

function _clearAuthError() {
  const errBox = $("auth-error-box");
  const errText = $("auth-error-text");
  const errAction = $("auth-error-action");

  if (errText) errText.textContent = "";
  if (errAction) {
    errAction.innerHTML = "";
    errAction.classList.add("hidden");
  }
  if (errBox) {
    errBox.classList.add("hidden");
  }
}

// ── Inicializálás ─────────────────────────────────────────
let _appInitialized = false;

function initApp() {
  if (_appInitialized) return;
  _appInitialized = true;

  // Apple Light/Dark téma inicializálása
  initTheme();

  // Auth képernyő és állapotfigyelő
  setupAuthScreen();
  onAuthChange(handleAuthState);

  // Beállítások megnyitása a profilképre (Avatar) kattintva
  const userAvatar = $("user-avatar");
  if (userAvatar && !userAvatar.dataset.boundApp) {
    userAvatar.dataset.boundApp = "true";
    userAvatar.addEventListener("click", openSettingsModal);
  }

  const gearBtn = $("btn-settings-gear");
  if (gearBtn && !gearBtn.dataset.boundApp) {
    gearBtn.dataset.boundApp = "true";
    gearBtn.addEventListener("click", openSettingsModal);
  }

  // Kijelentkezés
  const logoutBtn = $("btn-logout");
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "true";
    logoutBtn.addEventListener("click", signOutUser);
  }

  // Fejléc Szinkronizálás gomb (Garmin / Intervals.icu manuális frissítés)
  const headerSyncBtn = $("btn-header-sync");
  if (headerSyncBtn && !headerSyncBtn.dataset.bound) {
    headerSyncBtn.dataset.bound = "true";
    headerSyncBtn.addEventListener("click", async () => {
      try {
        await syncIntervals(null, null, { silent: false });
      } catch (err) {
        console.error("Header sync error:", err);
      }
    });
  }

  // Navigációs gombok
  document.querySelectorAll(".nav-btn").forEach(btn => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = "true";
      btn.addEventListener("click", () => {
        const mod = btn.dataset.module;
        if (mod) showModule(mod);
      });
    }
  });

  // Téma váltáskor fejléc szín frissítése
  window.addEventListener("fitplan:theme-changed", () => applyModuleTheme(currentModule));
  window.addEventListener("storage", () => applyModuleTheme(currentModule));

  // Lebegő ablak felügyelő inicializálása (dinamikus z-index verem + homályos háttér zárolása)
  initModalSupervisor();
}

// ============================================================
// Lebegő ablak felügyelő (Modal Supervisor)
// Minden felugró modal mindig a legfelső rétegre (z-index) kerül.
// Nyitott modal esetén a háttér homályos, teljesen görgetés- és
// kattintás-védett; kizárólag a legfelső lebegő ablak kezelhető.
// ============================================================
function initModalSupervisor() {
  let _modalZIndexTop = 1000;
  const _activeModalStack = [];

  function _updateBodyLock() {
    if (_activeModalStack.length > 0) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
      _modalZIndexTop = 1000;
    }
  }

  function _handleModalVisibility(modalEl) {
    if (!modalEl || !modalEl.id || !modalEl.id.endsWith("-modal")) return;
    if (modalEl.id === "login-screen" || modalEl.id === "app-shell") return;

    const isHidden = modalEl.classList.contains("hidden") || modalEl.style.display === "none";
    const existingIndex = _activeModalStack.indexOf(modalEl);

    if (!isHidden) {
      // Új vagy újra aktiválódott modal: mindig hozzuk a legfelső rétegre
      if (existingIndex !== -1) {
        _activeModalStack.splice(existingIndex, 1);
      }
      _modalZIndexTop += 10;
      modalEl.style.zIndex = _modalZIndexTop.toString();
      _activeModalStack.push(modalEl);
      _updateBodyLock();

      // Biztosítjuk, hogy a felugró lap (sheet) látható pozícióba kerüljön (translateY(0))
      const sheet = modalEl.querySelector(".modal-sheet") || modalEl.querySelector('[id$="-sheet"]');
      if (sheet) {
        setTimeout(() => {
          sheet.style.transform = "translateY(0)";
        }, 20);
      }
    } else {
      // Bezáródott modal
      if (existingIndex !== -1) {
        _activeModalStack.splice(existingIndex, 1);
        modalEl.style.zIndex = "";
        _updateBodyLock();

        // Alaphelyzetbe állítjuk a lap elmozdulását a következő megnyitáshoz
        const sheet = modalEl.querySelector(".modal-sheet") || modalEl.querySelector('[id$="-sheet"]');
        if (sheet) {
          sheet.style.transform = "translateY(100%)";
        }
      }
    }
  }

  // Meglévő nyitott modálok regisztrációja
  const allModals = document.querySelectorAll('[id$="-modal"]');
  allModals.forEach(m => {
    if (!m.classList.contains("hidden") && m.style.display !== "none") {
      _handleModalVisibility(m);
    }
  });

  // Háttérre kattintás: ha a felhasználó a homályosított háttérre kattint,
  // a lebegő ablak a saját bezáró gombján keresztül elegánsan bezárul
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id && e.target.id.endsWith("-backdrop")) {
      const modal = e.target.closest('[id$="-modal"]') || e.target.parentElement;
      if (modal) {
        const closeBtn = modal.querySelector("[id$='-close']") || modal.querySelector("button[id*='close']");
        if (closeBtn) {
          closeBtn.click();
        } else {
          modal.classList.add("hidden");
        }
      }
    }
  });

  // DOM állapotváltozás figyelése: KIZÁRÓLAG 'class' attribútumot figyelünk!
  // A 'style' attribútumot tilos figyelni, mert a zIndex állítása rekurzív mikrotaszk-hurkot okozna!
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        const target = mutation.target;
        if (target && target.id && target.id.endsWith("-modal")) {
          const isHidden = target.classList.contains("hidden");
          const isInStack = _activeModalStack.includes(target);
          if ((!isHidden && !isInStack) || (isHidden && isInStack)) {
            _handleModalVisibility(target);
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["class"]
  });

  // Escape billentyű: kizárólag a legfelső rétegen lévő aktív lebegő ablakot zárja be
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _activeModalStack.length > 0) {
      const topModal = _activeModalStack[_activeModalStack.length - 1];
      if (topModal) {
        const closeBtn = topModal.querySelector("[id$='-close']") || topModal.querySelector("button[id*='close']");
        if (closeBtn) closeBtn.click();
      }
    }
  });
}

// Biztosítjuk, hogy akkor is lefusson, ha a DOMContentLoaded már lefutott
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
