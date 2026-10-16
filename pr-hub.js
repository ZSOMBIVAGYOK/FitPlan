// ============================================================
// pr-hub.js — PR Hub & Rekordok modul
// FitPlan Pro | Amber / Gold téma
// Garmin Sportágak + Epley 1RM kalkuláció + Firestore CRUD
// ============================================================

import { db } from "../firebase-config.js";
import { GARMIN_SPORTS, getSportById } from "../garmin-sports.js";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Belső állapot ──────────────────────────────────────────
let _uid          = null;
let _unsubscribe  = null;
let _allRecords   = [];
let _activeFilter = "all";
let _selectedSportId = "strength_training";

// ── Segédek ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Epley-formula: 1RM = súly × (1 + ismétlés / 30)
function calcOneRM(weight, reps) {
  if (!weight || !reps || reps <= 0 || weight <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

let _uiInitialized = false;

// ── Publikus API ───────────────────────────────────────────
export function initPrHub(uid) {
  _uid = uid;
  if (!_uiInitialized) {
    _setupFilters();
    _setupFAB();
    _setupModal();
    _uiInitialized = true;
  }
  _subscribe(uid);
}

export function destroyPrHub() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _uid        = null;
  _allRecords = [];

  const list = $("pr-records-list");
  if (list) list.innerHTML = "";
  _updateStats();
}

// ── Firestore feliratkozás ─────────────────────────────────
function _subscribe(uid) {
  const q = query(
    collection(db, "users", uid, "records"),
    orderBy("createdAt", "desc")
  );

  _unsubscribe = onSnapshot(q,
    snap => {
      _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
      _updateStats();
    },
    err => console.error("[PR Hub] Firestore hiba:", err)
  );
}

// ── Rekordkártyák renderelése ──────────────────────────────
function _render() {
  const list = $("pr-records-list");
  if (!list) return;

  const records = _activeFilter === "all"
    ? _allRecords
    : _allRecords.filter(r => (r.sportId === _activeFilter || r.category === _activeFilter));

  if (records.length === 0) {
    list.innerHTML = `
      <div class="text-center py-16">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-amber-50 dark:bg-amber-950/40
                    flex items-center justify-center mb-4">
          <i class="fa-solid fa-trophy text-amber-400 text-2xl"></i>
        </div>
        <p class="text-gray-400 dark:text-gray-500 text-sm font-medium">Még nincs rögzített rekord</p>
        <p class="text-gray-300 dark:text-gray-600 text-xs mt-1">
          Koppints a <strong class="text-amber-500">+</strong> gombra az első Garmin sportrekord felvételéhez!
        </p>
      </div>`;
    return;
  }

  list.innerHTML = records.map(_cardHTML).join("");

  list.querySelectorAll(".pr-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _delete(btn.dataset.id);
    });
  });
}

function _cardHTML(r) {
  const sport = getSportById(r.sportId || r.category);
  const dateStr = r.date
    ? new Date(r.date + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : "";

  let valueBlock = "";
  const isStrength = sport.isStrength || r.category === "strength" || r.oneRM;

  if (isStrength) {
    const orm    = r.oneRM ? `${r.oneRM} kg` : "—";
    const detail = (r.weight && r.reps) ? `${r.weight} kg × ${r.reps} ism.` : "";
    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums leading-tight">${orm}</p>
        <p class="text-[11px] text-gray-400 mt-0.5">${detail}</p>
        <p class="text-[10px] text-amber-500 font-semibold tracking-wide mt-0.5">1RM</p>
      </div>`;
  } else {
    const dist = r.distance ? `${r.distance} km` : "—";
    const dur  = r.duration || "";
    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums leading-tight">${dist}</p>
        ${dur ? `<p class="text-[11px] text-gray-400 mt-0.5">${dur}</p>` : ""}
      </div>`;
  }

  return `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-4
                flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">

      <div class="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-950/40
                  flex items-center justify-center flex-shrink-0">
        <i class="${sport.icon} text-amber-600 dark:text-amber-400 text-base"></i>
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-sm font-bold text-gray-900 dark:text-white truncate">
          ${_esc(r.name || sport.name)}
        </p>
        <div class="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span class="inline-block bg-amber-50/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded-full px-2 py-0.5
                       text-[10px] font-semibold">${sport.name}</span>
          <span>${dateStr}</span>
        </div>
      </div>

      ${valueBlock}

      <button class="pr-delete-btn ml-1 w-7 h-7 rounded-full bg-gray-50 dark:bg-slate-800
                     flex items-center justify-center text-gray-300 dark:text-gray-600
                     hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
              data-id="${r.id}" title="Törlés">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>`;
}

function _esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ── Statisztikák ───────────────────────────────────────────
function _updateStats() {
  const elTotal   = $("pr-stat-total");
  const elBest1rm = $("pr-stat-best1rm");
  const elTopName = $("pr-stat-topname");

  if (elTotal) elTotal.textContent = _allRecords.length;

  const strength = _allRecords.filter(r => r.oneRM);
  if (strength.length > 0) {
    const max    = Math.max(...strength.map(r => r.oneRM));
    const topRec = strength.find(r => r.oneRM === max);
    if (elBest1rm) elBest1rm.textContent = `${max} kg`;
    if (elTopName && topRec) elTopName.textContent = topRec.name || "—";
  } else {
    if (elBest1rm) elBest1rm.textContent = "—";
    if (elTopName) elTopName.textContent = "—";
  }
}

// ── Szűrő sáv ──────────────────────────────────────────────
function _setupFilters() {
  const filterBar = $("pr-filter-bar");
  if (!filterBar) return;

  // Főbb Garmin sportágak a szűrősávban
  const topFilters = [
    { id: "all", label: "Összes", icon: "fa-solid fa-layer-group" },
    { id: "strength_training", label: "Súlyzós", icon: "fa-solid fa-dumbbell" },
    { id: "running", label: "Futás", icon: "fa-solid fa-person-running" },
    { id: "cycling", label: "Kerékpár", icon: "fa-solid fa-bicycle" },
    { id: "pool_swimming", label: "Úszás", icon: "fa-solid fa-person-swimming" },
    { id: "hiit", label: "HIIT", icon: "fa-solid fa-bolt-lightning" },
    { id: "hiking", label: "Túrázás", icon: "fa-solid fa-mountain" }
  ];

  filterBar.innerHTML = topFilters.map(f => `
    <button class="pr-filter-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all" data-filter="${f.id}">
      <i class="${f.icon} mr-1.5"></i>${f.label}
    </button>
  `).join('');

  filterBar.querySelectorAll(".pr-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeFilter = btn.dataset.filter || "all";
      _updateFilterUI();
      _render();
    });
  });
  _updateFilterUI();
}

function _updateFilterUI() {
  document.querySelectorAll(".pr-filter-btn").forEach(btn => {
    const active = btn.dataset.filter === _activeFilter;
    btn.style.backgroundColor = active ? "#d97706" : "";
    btn.style.color           = active ? "#ffffff" : "";
    btn.className = `pr-filter-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
      active ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400'
    }`;
  });
}

// ── FAB ────────────────────────────────────────────────────
function _setupFAB() {
  const fab = $("pr-fab");
  if (!fab) return;
  fab.addEventListener("click", _openModal);
}

// ── Modal ──────────────────────────────────────────────────
function _setupModal() {
  const closeBtn = $("pr-modal-close");
  const backdrop = $("pr-modal-backdrop");
  const saveBtn  = $("pr-save-btn");
  const weightIn = $("pr-input-weight");
  const repsIn   = $("pr-input-reps");
  const sportSelect = $("pr-sport-select");

  if (closeBtn) closeBtn.addEventListener("click", _closeModal);
  if (backdrop) backdrop.addEventListener("click", _closeModal);
  if (saveBtn)  saveBtn.addEventListener("click",  _handleSave);

  // Garmin sportok legördülő lista feltöltése
  if (sportSelect) {
    sportSelect.innerHTML = GARMIN_SPORTS.map(s => `
      <option value="${s.id}">${s.name} (${s.cat})</option>
    `).join('');

    sportSelect.addEventListener("change", () => {
      _selectedSportId = sportSelect.value;
      _updateSportFieldsUI();
    });
  }

  // Élő 1RM kalkuláció
  function liveCalc() {
    const w       = parseFloat(weightIn?.value);
    const r       = parseInt(repsIn?.value);
    const preview = $("pr-1rm-preview");
    const valEl   = $("pr-1rm-value");
    if (!preview || !valEl) return;

    const orm = calcOneRM(w, r);
    if (orm !== null) {
      preview.classList.remove("hidden");
      valEl.textContent = `${orm} kg`;
    } else {
      preview.classList.add("hidden");
    }
  }

  if (weightIn) weightIn.addEventListener("input", liveCalc);
  if (repsIn)   repsIn.addEventListener("input",   liveCalc);
}

function _updateSportFieldsUI() {
  const sport = getSportById(_selectedSportId);
  const strFields = $("pr-strength-fields");
  const carFields = $("pr-cardio-fields");

  const isStrength = sport.isStrength;

  if (strFields) strFields.classList.toggle("hidden", !isStrength);
  if (carFields) carFields.classList.toggle("hidden", isStrength);
}

function _openModal() {
  const modal = $("pr-modal");
  const sheet = $("pr-modal-sheet");
  if (!modal || !sheet) return;

  _resetForm();
  modal.classList.remove("hidden");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = "translateY(0)";
    });
  });
}

function _closeModal() {
  const modal = $("pr-modal");
  const sheet = $("pr-modal-sheet");
  if (!modal || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => modal.classList.add("hidden"), 340);
}

function _resetForm() {
  ["pr-input-name", "pr-input-weight", "pr-input-reps",
   "pr-input-distance", "pr-input-duration"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });

  const preview = $("pr-1rm-preview");
  if (preview) preview.classList.add("hidden");

  const dateEl = $("pr-input-date");
  if (dateEl) dateEl.value = new Date().toISOString().split("T")[0];

  const sportSelect = $("pr-sport-select");
  if (sportSelect) sportSelect.value = "strength_training";
  _selectedSportId = "strength_training";
  _updateSportFieldsUI();
}

// ── Mentés ────────────────────────────────────────────────
async function _handleSave() {
  if (!_uid) return;

  const sport = getSportById(_selectedSportId);
  const nameEl = $("pr-input-name");
  const name   = nameEl?.value.trim() || sport.name;

  const dateEl  = $("pr-input-date");
  const dateVal = dateEl?.value || new Date().toISOString().split("T")[0];

  let data = {
    name,
    sportId:   _selectedSportId,
    category:  sport.cat,
    date:      dateVal,
    createdAt: serverTimestamp(),
  };

  if (sport.isStrength) {
    const w   = parseFloat($("pr-input-weight")?.value) || null;
    const r   = parseInt($("pr-input-reps")?.value)    || null;
    const orm = calcOneRM(w, r);
    data = { ...data, weight: w, reps: r, oneRM: orm };
  } else {
    const dist = parseFloat($("pr-input-distance")?.value) || null;
    const dur  = $("pr-input-duration")?.value.trim()      || null;
    data = { ...data, distance: dist, duration: dur };
  }

  const saveBtn = $("pr-save-btn");
  if (saveBtn) { saveBtn.textContent = "Mentés…"; saveBtn.disabled = true; }

  try {
    await addDoc(collection(db, "users", _uid, "records"), data);
    _closeModal();
  } catch (err) {
    console.error("[PR Hub] Mentési hiba:", err);
  } finally {
    if (saveBtn) { saveBtn.textContent = "Rekord mentése"; saveBtn.disabled = false; }
  }
}

// ── Törlés ────────────────────────────────────────────────
async function _delete(recordId) {
  if (!_uid || !recordId) return;
  try {
    await deleteDoc(doc(db, "users", _uid, "records", recordId));
  } catch (err) {
    console.error("[PR Hub] Törlési hiba:", err);
  }
}
