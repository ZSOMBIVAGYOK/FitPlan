// ============================================================
// settings.js — Beállítások & Fiók (Gear) modul
// FitPlan Pro | Általános adatok (kg, cm), Folyadékkalkuláció, Célok, Téma
// ============================================================

import { db } from "./firebase-config.js";
import { signOutUser } from "./auth.js";
import { initIntervals, destroyIntervals } from "./modules/intervals.js";
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
  const gearBtn = $("btn-settings-gear");
  const modal = $("settings-modal");
  const closeBtn = $("settings-modal-close");
  const backdrop = $("settings-modal-backdrop");
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

  if (gearBtn && !gearBtn.dataset.bound) {
    gearBtn.dataset.bound = "true";
    gearBtn.addEventListener("click", _openModal);
  }

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", _closeModal);
  }

  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = "true";
    backdrop.addEventListener("click", _closeModal);
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "true";
    saveBtn.addEventListener("click", _saveGoals);
  }

  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "true";
    logoutBtn.addEventListener("click", () => {
      _closeModal();
      signOutUser();
    });
  }
}

export function openSettingsModal() {
  _openModal();
}

export function closeSettingsModal() {
  _closeModal();
}

function _openModal() {
  const modal = $("settings-modal");
  const sheet = $("settings-modal-sheet");
  if (!modal || !sheet) return;

  // Profil infók kitöltése
  const emailEl = $("settings-user-email");
  const uidEl = $("settings-user-uid");
  if (emailEl) emailEl.textContent = _user?.email || "Vendég / Helyi profil";
  if (uidEl) uidEl.textContent = _user?.uid ? `ID: ${_user.uid.slice(0, 8)}...` : "";

  if (_uid) {
    try {
      initIntervals(_uid);
    } catch (e) {
      console.warn("[settings] initIntervals warning:", e);
    }
  }

  // Mezők kitöltése
  const ageIn    = $("settings-input-age");
  const weightIn = $("settings-input-weight");
  const heightIn = $("settings-input-height");
  const calIn = $("settings-input-calories");
  const proIn = $("settings-input-protein");
  const watIn = $("settings-input-water");
  const calcHint = $("settings-water-calc-hint");

  if (ageIn) ageIn.value = _goals.age || 28;
  if (weightIn) weightIn.value = _goals.weight || 75;
  if (heightIn) heightIn.value = _goals.height || 180;
  if (calIn) calIn.value = _goals.calorieGoal || 2200;
  if (proIn) proIn.value = _goals.proteinGoal || 150;

  const initialWater = _goals.waterGoal || Math.round((_goals.weight || 75) * 35);
  if (watIn) watIn.value = initialWater;
  if (calcHint) {
    calcHint.textContent = `Kalkulált folyadékigény: ${Math.round((_goals.weight || 75) * 35)} ml / nap (35 ml / kg alapján)`;
    calcHint.classList.remove("hidden");
  }

  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = "translateY(0)";
    });
  });
}

function _closeModal() {
  const modal = $("settings-modal");
  const sheet = $("settings-modal-sheet");
  if (!modal || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 340);
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
  }
}

async function _saveGoals() {
  if (!_uid) return;
  const ageIn    = $("settings-input-age");
  const weightIn = $("settings-input-weight");
  const heightIn = $("settings-input-height");
  const calIn    = $("settings-input-calories");
  const proIn    = $("settings-input-protein");
  const watIn    = $("settings-input-water");
  const saveBtn  = $("settings-save-goals-btn");

  const age    = parseInt(ageIn?.value) || 28;
  const weight = parseFloat(weightIn?.value) || 75;
  const height = parseFloat(heightIn?.value) || 180;
  const cal    = parseInt(calIn?.value) || 2200;
  const pro    = parseInt(proIn?.value) || 150;
  const wat    = parseInt(watIn?.value) || Math.round(weight * 35);

  _goals = {
    age,
    weight,
    height,
    calorieGoal: cal,
    proteinGoal: pro,
    waterGoal: wat
  };
  localStorage.setItem(`fitplan_goals_${_uid}`, JSON.stringify(_goals));

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Mentés folyamatban...";
  }

  try {
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

    // Esemény küldése a moduloknak, hogy frissítsék a célokat
    window.dispatchEvent(new CustomEvent("fitplan:goals-updated", { detail: _goals }));
    _closeModal();
  } catch (err) {
    console.error("[Settings] Célok mentési hiba:", err);
  } finally {
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
