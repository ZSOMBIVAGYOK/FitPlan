// ============================================================
// pr-hub.js — PR Hub & Rekordok modul
// FitPlan Pro | Amber / Gold téma
// Epley 1RM kalkuláció + Firestore CRUD
// ============================================================

import { db } from "../firebase-config.js";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Belső állapot ──────────────────────────────────────────
let _uid          = null;
let _unsubscribe  = null;
let _allRecords   = [];
let _activeFilter = "all";
let _activeCat    = "strength";   // modal kategória

// ── Segédek ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Epley-formula: 1RM = súly × (1 + ismétlés / 30)
function calcOneRM(weight, reps) {
  if (!weight || !reps || reps <= 0 || weight <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// Kategória ikon és felirat
const CAT_META = {
  strength: { icon: "fa-solid fa-dumbbell",        label: "Súlyzós"   },
  running:  { icon: "fa-solid fa-person-running",  label: "Futás"      },
  cycling:  { icon: "fa-solid fa-bicycle",         label: "Kerékpár"  },
  swimming: { icon: "fa-solid fa-person-swimming", label: "Úszás"     },
};

let _uiInitialized = false;

// ── Publikus API ───────────────────────────────────────────

/** Modult inicializál bejelentkezés után. */
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

/** Firestore leiratkozás és felület takarítás (kijelentkezéskor). */
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
    : _allRecords.filter(r => r.category === _activeFilter);

  if (records.length === 0) {
    list.innerHTML = `
      <div class="text-center py-16">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-amber-50
                    flex items-center justify-center mb-4">
          <i class="fa-solid fa-trophy text-amber-300 text-2xl"></i>
        </div>
        <p class="text-gray-400 text-sm font-medium">Még nincs rekord</p>
        <p class="text-gray-300 text-xs mt-1">
          Koppints a <strong class="text-amber-300">+</strong> gombra az első felvételéhez!
        </p>
      </div>`;
    return;
  }

  list.innerHTML = records.map(_cardHTML).join("");

  // Törlés esemény
  list.querySelectorAll(".pr-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _delete(btn.dataset.id);
    });
  });
}

function _cardHTML(r) {
  const meta   = CAT_META[r.category] || { icon: "fa-solid fa-star", label: r.category };
  const dateStr = r.date
    ? new Date(r.date + "T12:00:00").toLocaleDateString("hu-HU",
        { month: "short", day: "numeric" })
    : "";

  let valueBlock = "";
  if (r.category === "strength") {
    const orm    = r.oneRM ? `${r.oneRM} kg` : "—";
    const detail = (r.weight && r.reps) ? `${r.weight} kg × ${r.reps} ism.` : "";
    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-amber-600 tabular-nums leading-tight">${orm}</p>
        <p class="text-[11px] text-gray-400 mt-0.5">${detail}</p>
        <p class="text-[10px] text-amber-300 font-semibold tracking-wide mt-0.5">1RM</p>
      </div>`;
  } else {
    const dist = r.distance ? `${r.distance} km` : "—";
    const dur  = r.duration || "";
    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-amber-600 tabular-nums leading-tight">${dist}</p>
        ${dur ? `<p class="text-[11px] text-gray-400 mt-0.5">${dur}</p>` : ""}
      </div>`;
  }

  return `
    <div class="bg-white border border-gray-100 rounded-2xl p-4
                flex items-center gap-3 shadow-sm">

      <div class="w-10 h-10 rounded-xl bg-amber-50
                  flex items-center justify-center flex-shrink-0">
        <i class="${meta.icon} text-amber-500 text-sm"></i>
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-gray-800 truncate">
          ${r.name || "Névtelen"}
        </p>
        <p class="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
          <span class="inline-block bg-gray-50 rounded-full px-2 py-0.5
                       text-[10px] font-medium">${meta.label}</span>
          ${dateStr}
        </p>
      </div>

      ${valueBlock}

      <button class="pr-delete-btn ml-1 w-7 h-7 rounded-full bg-gray-50
                     flex items-center justify-center text-gray-300
                     hover:bg-red-50 hover:text-red-400 transition-colors flex-shrink-0"
              data-id="${r.id}" title="Törlés">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>`;
}

// ── Statisztikák ───────────────────────────────────────────
function _updateStats() {
  const elTotal   = $("pr-stat-total");
  const elBest1rm = $("pr-stat-best1rm");
  const elTopName = $("pr-stat-topname");

  if (elTotal) elTotal.textContent = _allRecords.length;

  const strength = _allRecords.filter(r => r.category === "strength" && r.oneRM);
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

// ── Szűrő gombok ──────────────────────────────────────────
function _setupFilters() {
  document.querySelectorAll(".pr-filter-btn").forEach(btn => {
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
    btn.style.backgroundColor = active ? "#d97706" : "#f3f4f6";
    btn.style.color           = active ? "#ffffff" : "#9ca3af";
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

  if (closeBtn) closeBtn.addEventListener("click", _closeModal);
  if (backdrop) backdrop.addEventListener("click", _closeModal);
  if (saveBtn)  saveBtn.addEventListener("click",  _handleSave);

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

  // Kategória gombok
  document.querySelectorAll(".pr-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeCat = btn.dataset.cat;
      _updateCatUI();
    });
  });
}

function _updateCatUI() {
  const strFields = $("pr-strength-fields");
  const carFields = $("pr-cardio-fields");
  if (strFields) strFields.classList.toggle("hidden", _activeCat !== "strength");
  if (carFields) carFields.classList.toggle("hidden", _activeCat === "strength");

  document.querySelectorAll(".pr-cat-btn").forEach(btn => {
    const active = btn.dataset.cat === _activeCat;
    btn.style.borderColor       = active ? "#d97706" : "#e5e7eb";
    btn.style.backgroundColor   = active ? "#fffbeb" : "#f9fafb";
    btn.style.color             = active ? "#d97706" : "#9ca3af";
  });
}

function _openModal() {
  const modal = $("pr-modal");
  const sheet = $("pr-modal-sheet");
  if (!modal || !sheet) return;

  _resetForm();
  modal.classList.remove("hidden");

  // Animáció: következő frame-ben csúszik fel
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

  _activeCat = "strength";
  _updateCatUI();
}

// ── Mentés ────────────────────────────────────────────────
async function _handleSave() {
  if (!_uid) return;

  const nameEl = $("pr-input-name");
  const name   = nameEl?.value.trim();

  if (!name) {
    if (nameEl) {
      nameEl.style.borderColor = "#f59e0b";
      nameEl.focus();
      setTimeout(() => { nameEl.style.borderColor = ""; }, 2000);
    }
    return;
  }

  const dateEl  = $("pr-input-date");
  const dateVal = dateEl?.value || new Date().toISOString().split("T")[0];

  let data = {
    name,
    category:  _activeCat,
    date:      dateVal,
    createdAt: serverTimestamp(),
  };

  if (_activeCat === "strength") {
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
