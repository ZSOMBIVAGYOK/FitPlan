// ============================================================
// settings.js — Beállítások & Fiók (Gear) modul
// FitPlan Pro | Általános adatok (kg, cm), Folyadékkalkuláció, Célok, Téma
// ============================================================

import { db } from "./firebase-config.js";
import { signOutUser } from "./auth.js";
import { initIntervals, destroyIntervals, getIntervalsConfig } from "./modules/intervals.js?v=2.5.1";
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);

let _uid = null;
let _user = null;
let _goals = {
  age: 28,
  weight: 75,
  height: 180,
  calorieGoal: 2200,
  proteinGoal: 150,
  waterGoal: 2625
};

export function getGoals() {
  return _goals;
}
if (typeof window !== 'undefined') {
  window.getGoals = getGoals;
}

export function initSettings(user) {
  _user = user;
  _uid = user ? user.uid : null;

  _bindUI();
  _loadSettings();
  if (_uid) {
    initIntervals(_uid);
  }
}

export function destroySettings() {
  destroyIntervals();
  _uid = null;
  _user = null;
}

function _bindUI() {
  const saveBtn = $("settings-save-goals-btn");
  const logoutBtn = $("settings-logout-btn");

  const weightIn = $("settings-input-weight");
  const updateWaterFromWeight = () => {
    const w = parseFloat(weightIn?.value);
    if (w && w > 0) {
      const autoWater = Math.round(w * 35);
      const watIn = $("settings-input-water");
      const calcHint = $("settings-water-calc-hint");
      if (watIn) watIn.value = autoWater;
      if (calcHint) {
        calcHint.textContent = `Kalkulált folyadékigény: ${autoWater} ml / nap (35 ml / testsúly kg alapján)`;
        calcHint.classList.remove("hidden");
      }
    }
  };

  if (weightIn && !weightIn.dataset.bound) {
    weightIn.dataset.bound = "true";
    weightIn.addEventListener("input", updateWaterFromWeight);
    weightIn.addEventListener("change", updateWaterFromWeight);
    weightIn.addEventListener("keyup", updateWaterFromWeight);
  }

  const avatarIn = $("settings-input-avatar-url");
  const avatarPrev = $("settings-avatar-preview");
  if (avatarIn && !avatarIn.dataset.bound) {
    avatarIn.dataset.bound = "true";
    avatarIn.addEventListener("input", () => {
      const val = avatarIn.value.trim();
      if (avatarPrev) {
        avatarPrev.onerror = () => {
          avatarPrev.onerror = null;
          avatarPrev.src = "./logolight.jpg";
        };
        avatarPrev.src = val || _goals.photoURL || _user?.photoURL || "./logolight.jpg";
      }
    });
  }
  if (avatarPrev && !avatarPrev.dataset.bound) {
    avatarPrev.dataset.bound = "true";
    avatarPrev.onerror = () => {
      avatarPrev.onerror = null;
      avatarPrev.src = "./logolight.jpg";
    };
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "true";
    saveBtn.addEventListener("click", _saveGoals);
  }

  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "true";
    logoutBtn.addEventListener("click", () => {
      signOutUser();
    });
  }

  populateSettingsFields();
}

export function populateSettingsFields() {
  try {
    // Profil infók kitöltése
    const emailEl = $("settings-user-email");
    const uidEl = $("settings-user-uid");
    if (emailEl) emailEl.textContent = _user?.email || "Vendég / Helyi profil";
    if (uidEl) uidEl.textContent = _user?.uid ? `ID: ${_user.uid.slice(0, 8)}...` : "";

    // Profilkép és URL előnézet kitöltése
    const avatarInput = $("settings-input-avatar-url");
    const avatarPreview = $("settings-avatar-preview");
    let currentAvatar = _goals.photoURL || _user?.photoURL || (_uid ? localStorage.getItem(`lockin_avatar_${_uid}`) : null) || $("user-avatar")?.src || "";
    if (typeof currentAvatar !== "string") currentAvatar = "";
    const isDefaultOrPlaceholder = !currentAvatar || currentAvatar.includes("gravatar.com") || currentAvatar.includes("logolight");
    if (avatarInput) {
      avatarInput.value = !isDefaultOrPlaceholder ? currentAvatar : "";
    }
    if (avatarPreview) {
      avatarPreview.onerror = () => {
        avatarPreview.onerror = null;
        avatarPreview.src = "./logolight.jpg";
      };
      avatarPreview.src = (currentAvatar && !currentAvatar.includes("gravatar.com")) ? currentAvatar : "./logolight.jpg";
    }

    // Intervals.icu beállítások kitöltése
    const athleteIn = $("settings-intervals-athlete");
    const apiKeyIn  = $("settings-intervals-apikey");
    let intervalsConfig = {};
    try {
      if (typeof getIntervalsConfig === "function") {
        intervalsConfig = getIntervalsConfig() || {};
      }
    } catch (_) {}
    if (!intervalsConfig.apiKey && _uid) {
      try {
        intervalsConfig = JSON.parse(localStorage.getItem(`lockin_intervals_${_uid}`) || "{}");
      } catch (_) {}
    }
    if (athleteIn && (!athleteIn.value || athleteIn.value === "")) {
      athleteIn.value = intervalsConfig.athleteId || "";
    }
    if (apiKeyIn && (!apiKeyIn.value || apiKeyIn.value === "")) {
      apiKeyIn.value = intervalsConfig.apiKey || "";
    }

    // Mezők kitöltése
    const ageIn    = $("settings-input-age");
    const weightIn = $("settings-input-weight");
    const heightIn = $("settings-input-height");
    const calIn    = $("settings-input-calories");
    const proIn    = $("settings-input-protein");
    const watIn    = $("settings-input-water");
    const calcHint = $("settings-water-calc-hint");

    if (ageIn) ageIn.value = _goals.age || 28;
    if (weightIn) weightIn.value = _goals.weight || 75;
    if (heightIn) heightIn.value = _goals.height || 180;
    if (calIn) calIn.value = _goals.calorieGoal || 2200;
    if (proIn) proIn.value = _goals.proteinGoal || 150;

    const initialWater = _goals.waterGoal || Math.round((_goals.weight || 75) * 35);
    if (watIn) watIn.value = initialWater;
    if (calcHint) {
      calcHint.textContent = `Kalkulált folyadékigény: ${Math.round((_goals.weight || 75) * 35)} ml / nap (35 ml / testsúly kg alapján)`;
      calcHint.classList.remove("hidden");
    }
  } catch (err) {
    console.warn("[Settings] Hiba a beállítások betöltésekor:", err);
  }
}
if (typeof window !== "undefined") {
  window.populateSettingsFields = populateSettingsFields;
}

export function openSettingsModal(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  if (e && typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation();
  }
  if (typeof window.showModule === 'function') {
    window.showModule('settings');
  }
}
if (typeof window !== "undefined") {
  window.openSettingsModal = openSettingsModal;
}

export function closeSettingsModal(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  if (e && typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation();
  }
  if (typeof window.showModule === 'function') {
    window.showModule('more');
  }
}
if (typeof window !== "undefined") {
  window.closeSettingsModal = closeSettingsModal;
}

async function _loadSettings() {
  if (!_uid) return;
  try {
    const snap = await getDoc(doc(db, "users", _uid, "settings", "profile"));
    if (snap.exists()) {
      _goals = { ..._goals, ...snap.data() };
    } else {
      // LocalStorage fallback
      const local = localStorage.getItem(`fitplan_goals_${_uid}`);
      if (local) _goals = { ..._goals, ...JSON.parse(local) };
    }
  } catch (err) {
    console.warn("[Settings] Nem sikerült a profil célok betöltése Firestore-ból:", err);
    const local = localStorage.getItem(`fitplan_goals_${_uid}`);
    if (local) _goals = { ..._goals, ...JSON.parse(local) };
  }

  const savedAvatar = _goals.photoURL || localStorage.getItem(`lockin_avatar_${_uid}`);
  if (savedAvatar) {
    const headerAvatar = $("user-avatar");
    if (headerAvatar) headerAvatar.src = savedAvatar;
  }

  window.dispatchEvent(new CustomEvent("fitplan:goals-updated", { detail: _goals }));
  populateSettingsFields();
}

async function _saveGoals() {
  const ageIn    = $("settings-input-age");
  const weightIn = $("settings-input-weight");
  const heightIn = $("settings-input-height");
  const calIn    = $("settings-input-calories");
  const proIn    = $("settings-input-protein");
  const watIn    = $("settings-input-water");
  const saveBtn  = $("settings-save-goals-btn");
  const avatarIn = $("settings-input-avatar-url");

  const age    = parseInt(ageIn?.value) || 28;
  const weight = parseFloat(weightIn?.value) || 75;
  const height = parseFloat(heightIn?.value) || 180;
  const cal    = parseInt(calIn?.value) || 2200;
  const pro    = parseInt(proIn?.value) || 150;
  const wat    = parseInt(watIn?.value) || Math.round(weight * 35);

  _goals = {
    ..._goals,
    age,
    weight,
    height,
    calorieGoal: cal,
    proteinGoal: pro,
    waterGoal: wat
  };

  const newAvatarUrl = avatarIn ? avatarIn.value.trim() : "";
  _goals.photoURL = newAvatarUrl;
  if (_user) {
    _user.photoURL = newAvatarUrl;
  }
  const headerAvatar = $("user-avatar");
  if (headerAvatar) {
    headerAvatar.src = newAvatarUrl || "./logolight.jpg";
  }
  const preview = $("settings-avatar-preview");
  if (preview) {
    preview.src = newAvatarUrl || "./logolight.jpg";
  }
  if (_uid) {
    if (newAvatarUrl) {
      localStorage.setItem(`lockin_avatar_${_uid}`, newAvatarUrl);
    } else {
      localStorage.removeItem(`lockin_avatar_${_uid}`);
    }
  }
  try {
    const localUserStr = localStorage.getItem("lockin_local_user");
    if (localUserStr) {
      const localUser = JSON.parse(localUserStr);
      localUser.photoURL = newAvatarUrl;
      localStorage.setItem("lockin_local_user", JSON.stringify(localUser));
    }
  } catch (_) {}

  if (_uid) {
    localStorage.setItem(`fitplan_goals_${_uid}`, JSON.stringify(_goals));
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Mentés folyamatban...";
  }

  try {
    if (_uid) {
      await setDoc(doc(db, "users", _uid, "settings", "profile"), _goals, { merge: true });

      // Intervals.icu beállítások mentése ha ki vannak töltve
      const athleteIn = $("settings-intervals-athlete");
      const apiKeyIn  = $("settings-intervals-apikey");
      if (athleteIn && apiKeyIn) {
        const athleteVal = athleteIn.value.trim();
        const apiVal     = apiKeyIn.value.trim();
        if (apiVal) {
          try {
            const cur = JSON.parse(localStorage.getItem(`lockin_intervals_${_uid}`) || '{}');
            const updated = {
              ...cur,
              athleteId: athleteVal || '0',
              apiKey: apiVal
            };
            localStorage.setItem(`lockin_intervals_${_uid}`, JSON.stringify(updated));
            await setDoc(doc(db, "users", _uid, "settings", "intervals"), {
              athleteId: athleteVal || '0',
              apiKey: apiVal
            }, { merge: true }).catch(() => {});
          } catch (e) {
            console.warn("[Settings] Intervals mentési figyelmeztetés:", e);
          }
        }
      }
    }

    // Esemény küldése a moduloknak, hogy frissítsék a célokat
    window.dispatchEvent(new CustomEvent("fitplan:goals-updated", { detail: _goals }));

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Sikeresen mentve! ✓";
      saveBtn.classList.add("bg-emerald-700");
      setTimeout(() => {
        if (saveBtn) {
          saveBtn.textContent = "Célok & Profil mentése";
          saveBtn.classList.remove("bg-emerald-700");
        }
      }, 1500);
    }
  } catch (err) {
    console.error("[Settings] Célok mentési hiba:", err);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Célok & Profil mentése";
    }
  }
}

// Biztosítjuk, hogy a Beállítások (Fogaskerék) gomb mindig azonnal kattintható legyen
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindUI);
  } else {
    _bindUI();
  }
}
