// ============================================================
// settings.js — Beállítások & Fiók (Gear) modul
// FitPlan Pro | Célok, Fiók, Téma
// ============================================================

import { db } from "./firebase-config.js";
import { signOutUser } from "./auth.js";
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);

let _uid = null;
let _user = null;
let _goals = {
  calorieGoal: 2200,
  proteinGoal: 150,
  waterGoal: 2500
};

export function getGoals() {
  return _goals;
}

export function initSettings(user) {
  _user = user;
  _uid = user ? user.uid : null;

  _bindUI();
  _loadSettings();
}

export function destroySettings() {
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

function _openModal() {
  const modal = $("settings-modal");
  const sheet = $("settings-modal-sheet");
  if (!modal || !sheet) return;

  // Profil infók kitöltése
  const emailEl = $("settings-user-email");
  const uidEl = $("settings-user-uid");
  if (emailEl) emailEl.textContent = _user?.email || "Névtelen";
  if (uidEl) uidEl.textContent = _user?.uid ? `ID: ${_user.uid.slice(0, 8)}...` : "";

  // Mezők kitöltése
  const calIn = $("settings-input-calories");
  const proIn = $("settings-input-protein");
  const watIn = $("settings-input-water");
  if (calIn) calIn.value = _goals.calorieGoal || 2200;
  if (proIn) proIn.value = _goals.proteinGoal || 150;
  if (watIn) watIn.value = _goals.waterGoal || 2500;

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
  const calIn = $("settings-input-calories");
  const proIn = $("settings-input-protein");
  const watIn = $("settings-input-water");
  const saveBtn = $("settings-save-goals-btn");

  const cal = parseInt(calIn?.value) || 2200;
  const pro = parseInt(proIn?.value) || 150;
  const wat = parseInt(watIn?.value) || 2500;

  _goals = { calorieGoal: cal, proteinGoal: pro, waterGoal: wat };
  localStorage.setItem(`fitplan_goals_${_uid}`, JSON.stringify(_goals));

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Mentés folyamatban...";
  }

  try {
    await setDoc(doc(db, "users", _uid, "settings", "profile"), _goals, { merge: true });
    // Esemény küldése a moduloknak, hogy frissítsék a célokat
    window.dispatchEvent(new CustomEvent("fitplan:goals-updated", { detail: _goals }));
    _closeModal();
  } catch (err) {
    console.error("[Settings] Célok mentési hiba:", err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Célok mentése";
    }
  }
}
