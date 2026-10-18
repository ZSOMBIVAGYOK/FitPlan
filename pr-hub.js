// ============================================================
// pr-hub.js — PR Hub & Rekordok modul
// FitPlan Pro | Amber / Gold téma
// Garmin Sportágak + Epley 1RM kalkuláció + Táv/Idő/Sebesség + Firestore CRUD
// ============================================================

import { db } from "../firebase-config.js";
import { GARMIN_SPORTS, getSportById, DEFAULT_EXERCISES } from "../garmin-sports.js";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Belső állapot ──────────────────────────────────────────
let _uid              = null;
let _unsubscribe      = null;
let _unsubExercises   = null;
let _allRecords       = [];
let _customExercises  = [];
let _activeFilter     = "all";
let _selectedSportId  = "strength_training";
let _activeType       = "strength"; // 'strength' | 'cardio'
let _distanceUnit     = "km";       // 'km' | 'm'
let _uiInitialized    = false;

// ── Segédek ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Gyors sablon javaslatok
const QUICK_STRENGTH = [
  "Fekvenyomás",
  "Guggolás",
  "Felhúzás",
  "Vállból nyomás",
  "Döntött evezés",
  "Tolódzkodás",
  "Húzódzkodás",
  "Bicepsz állva"
];

const QUICK_CARDIO = [
  { name: "400 m futás", dist: 400, unit: "m", sportId: "running" },
  { name: "800 m futás", dist: 800, unit: "m", sportId: "running" },
  { name: "1 km futás", dist: 1, unit: "km", sportId: "running" },
  { name: "5 km futás", dist: 5, unit: "km", sportId: "running" },
  { name: "10 km futás", dist: 10, unit: "km", sportId: "running" },
  { name: "Félmaraton (21.1 km)", dist: 21.1, unit: "km", sportId: "running" },
  { name: "Maraton (42.2 km)", dist: 42.2, unit: "km", sportId: "running" },
  { name: "20 km kerékpár", dist: 20, unit: "km", sportId: "cycling" },
  { name: "1000 m úszás", dist: 1000, unit: "m", sportId: "pool_swimming" }
];

// Epley-formula: 1RM = súly × (1 + ismétlés / 30)
function calcOneRM(weight, reps) {
  if (!weight || !reps || reps <= 0 || weight <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// Sebesség és Tempó kalkuláció
function calcSpeedAndPace(rawDist, unit, durStr, durH, durM, durS) {
  let totalSec = (parseInt(durH) || 0) * 3600 + (parseInt(durM) || 0) * 60 + (parseInt(durS) || 0);

  if (totalSec <= 0 && durStr) {
    const parts = String(durStr).trim().split(':').map(Number);
    if (parts.length === 3) {
      totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      totalSec = parts[0] * 60 + parts[1];
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      totalSec = parts[0] * 60;
    }
  }

  const dist = parseFloat(rawDist) || 0;
  if (dist <= 0 || totalSec <= 0) {
    return { speedKmh: null, paceStr: null, formattedDuration: durStr || "", totalSec: 0 };
  }

  const distKm = unit === 'm' ? dist / 1000 : dist;
  const hours = totalSec / 3600;
  const speedKmh = Math.round((distKm / hours) * 10) / 10;

  const secPerKm = totalSec / distKm;
  const pMin = Math.floor(secPerKm / 60);
  const pSec = Math.round(secPerKm % 60);
  const paceStr = `${pMin}:${String(pSec).padStart(2, '0')} perc/km`;

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  const formattedDuration = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return { speedKmh, paceStr, formattedDuration, totalSec };
}

// ── Publikus API ───────────────────────────────────────────
export function initPrHub(uid) {
  _uid = uid;
  if (!_uiInitialized) {
    _setupFilters();
    _setupFAB();
    _setupModal();
    _uiInitialized = true;
  }
  _loadLocalRecords();
  _subscribe(uid);
}

export function destroyPrHub() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }
  _uid             = null;
  _allRecords      = [];
  _customExercises = [];

  const list = $("pr-records-list");
  if (list) list.innerHTML = "";
  _updateStats();
}

export function openPrModal(e) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  _openModal(e);
}
if (typeof window !== 'undefined') {
  window.openPrModal = openPrModal;
}

export function closePrModal(e) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  _closeModal(e);
}
if (typeof window !== 'undefined') {
  window.closePrModal = closePrModal;
}

// ── LocalStorage gyorsítótár ───────────────────────────────
function _getLocalKey() {
  return `lockin_records_${_uid || 'default'}`;
}

function _loadLocalRecords() {
  try {
    const raw = localStorage.getItem(_getLocalKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _allRecords = parsed;
        _render();
        _updateStats();
      }
    }
  } catch (_) {}
}

function _saveToLocal(record) {
  try {
    const records = _allRecords.filter(r => r.id !== record.id);
    records.unshift(record);
    localStorage.setItem(_getLocalKey(), JSON.stringify(records));
  } catch (_) {}
}

function _deleteFromLocal(recordId) {
  try {
    const records = _allRecords.filter(r => r.id !== recordId);
    localStorage.setItem(_getLocalKey(), JSON.stringify(records));
  } catch (_) {}
}

// ── Firestore feliratkozás ─────────────────────────────────
function _subscribe(uid) {
  if (!uid) return;
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }

  const q = query(
    collection(db, "users", uid, "records"),
    orderBy("createdAt", "desc")
  );

  _unsubscribe = onSnapshot(q,
    snap => {
      _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      try {
        localStorage.setItem(_getLocalKey(), JSON.stringify(_allRecords));
      } catch (_) {}
      _render();
      _updateStats();
    },
    err => {
      console.warn("[PR Hub] Firestore feliratkozási hiba, offline rekordok használata:", err);
      _loadLocalRecords();
    }
  );

  const qEx = query(
    collection(db, "users", uid, "exercises"),
    orderBy("createdAt", "desc")
  );

  _unsubExercises = onSnapshot(qEx,
    snap => {
      _customExercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _populateExercisesDatalist();
    },
    err => console.warn("[PR Hub] exercises onSnapshot warning:", err)
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
  const isStrength = r.type === "strength" || sport.isStrength || r.category === "strength" || r.oneRM;

  if (isStrength) {
    const orm    = r.oneRM ? `${r.oneRM} kg` : "—";
    const detail = (r.weight && r.reps) ? `${r.weight} kg × ${r.reps} ism.` : "";
    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-extrabold text-amber-600 dark:text-amber-400 tabular-nums leading-tight">${orm}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${detail}</p>
        <p class="text-[10px] text-amber-500 font-semibold tracking-wide mt-0.5">1RM</p>
      </div>`;
  } else {
    // Állóképességi / Kardió rekord: Táv és Idő (sebesség zárójelben halványabban)
    let distText = "";
    if (r.distance !== undefined && r.distance !== null && r.distance !== "") {
      const unit = r.distanceUnit || (Number(r.distance) > 100 ? 'm' : 'km');
      distText = `${r.distance} ${unit}`;
    } else {
      distText = "—";
    }

    // Sebesség meghatározása (tárolt vagy dinamikusan kalkulált)
    let speedVal = r.speedKmh || r.speed || null;
    let durDisplay = r.duration || "";
    if (!speedVal && r.distance && r.duration) {
      const calc = calcSpeedAndPace(r.distance, r.distanceUnit || (r.distance > 100 ? 'm' : 'km'), r.duration);
      if (calc.speedKmh) speedVal = calc.speedKmh;
      if (calc.formattedDuration) durDisplay = calc.formattedDuration;
    }

    const speedHTML = speedVal
      ? `<span class="text-gray-400 dark:text-gray-500 font-normal text-[11px] ml-1">(${speedVal} km/h)</span>`
      : "";

    valueBlock = `
      <div class="text-right flex-shrink-0">
        <p class="text-lg font-extrabold text-amber-600 dark:text-amber-400 tabular-nums leading-tight">${distText}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${durDisplay}${speedHTML}</p>
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
  if (!fab.dataset.bound) {
    fab.dataset.bound = "true";
    fab.addEventListener("click", (e) => {
      if (e) e.stopPropagation();
      _openModal(e);
    });
  }
}

// ── Modal & UI interakciók ─────────────────────────────────
function _setupModal() {
  const closeBtn  = $("pr-modal-close");
  const backdrop  = $("pr-modal-backdrop");
  const saveBtn   = $("pr-save-btn");
  const weightIn  = $("pr-input-weight");
  const repsIn    = $("pr-input-reps");
  const distIn    = $("pr-input-distance");
  const durH      = $("pr-input-dur-h");
  const durM      = $("pr-input-dur-m");
  const durS      = $("pr-input-dur-s");
  const sportSelect = $("pr-sport-select");

  const btnTypeStr = $("pr-type-tab-strength");
  const btnTypeCar = $("pr-type-tab-cardio");
  const btnUnitKm  = $("pr-unit-btn-km");
  const btnUnitM   = $("pr-unit-btn-m");

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
    saveBtn.addEventListener("click", _handleSave);
  }

  // Típus váltó gombok (Súlyzós vs Állóképességi)
  if (btnTypeStr && !btnTypeStr.dataset.bound) {
    btnTypeStr.dataset.bound = "true";
    btnTypeStr.addEventListener("click", () => _setType("strength"));
  }
  if (btnTypeCar && !btnTypeCar.dataset.bound) {
    btnTypeCar.dataset.bound = "true";
    btnTypeCar.addEventListener("click", () => _setType("cardio"));
  }

  // Mértékegység kapcsoló (km vs m)
  if (btnUnitKm && !btnUnitKm.dataset.bound) {
    btnUnitKm.dataset.bound = "true";
    btnUnitKm.addEventListener("click", () => _setDistanceUnit("km"));
  }
  if (btnUnitM && !btnUnitM.dataset.bound) {
    btnUnitM.dataset.bound = "true";
    btnUnitM.addEventListener("click", () => _setDistanceUnit("m"));
  }

  // Súlyzós élő 1RM kalkuláció
  if (weightIn && !weightIn.dataset.bound) {
    weightIn.dataset.bound = "true";
    weightIn.addEventListener("input", _liveStrengthCalc);
  }
  if (repsIn && !repsIn.dataset.bound) {
    repsIn.dataset.bound = "true";
    repsIn.addEventListener("input", _liveStrengthCalc);
  }

  // Állóképességi élő sebesség és tempó kalkuláció
  [distIn, durH, durM, durS].forEach(el => {
    if (el && !el.dataset.bound) {
      el.dataset.bound = "true";
      el.addEventListener("input", _liveCardioCalc);
      el.addEventListener("change", _liveCardioCalc);
      el.addEventListener("keyup", _liveCardioCalc);
    }
  });

  if (sportSelect && !sportSelect.dataset.bound) {
    sportSelect.dataset.bound = "true";
    sportSelect.addEventListener("change", () => {
      _selectedSportId = sportSelect.value;
      const sport = getSportById(_selectedSportId);
      if (sport.isCardio && _activeType !== "cardio") {
        _setType("cardio");
      } else if (sport.isStrength && _activeType !== "strength") {
        _setType("strength");
      }
    });
  }

  _populateSportSelect("strength");
  _populateExercisesDatalist();

  window.addEventListener("fitplan:exercises-updated", () => {
    _populateExercisesDatalist();
  });
}

function _setType(type) {
  _activeType = type === "cardio" ? "cardio" : "strength";
  const btnStrength = $("pr-type-tab-strength");
  const btnCardio   = $("pr-type-tab-cardio");
  const nameLabel   = $("pr-name-label");
  const nameInp     = $("pr-input-name");
  const strFields   = $("pr-strength-fields");
  const carFields   = $("pr-cardio-fields");
  const sportSelect = $("pr-sport-select");

  if (_activeType === "strength") {
    if (btnStrength) btnStrength.className = "py-2.5 rounded-xl text-xs font-bold transition-all bg-amber-500 text-white shadow-sm flex items-center justify-center gap-2";
    if (btnCardio)   btnCardio.className   = "py-2.5 rounded-xl text-xs font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2";
    if (nameLabel)   nameLabel.textContent = "Gyakorlat neve";
    if (nameInp)     nameInp.placeholder = "pl. Fekvenyomás, Guggolás...";
    if (strFields)   strFields.classList.remove("hidden");
    if (carFields)   carFields.classList.add("hidden");

    _populateSportSelect("strength");
    if (sportSelect) {
      sportSelect.value = "strength_training";
      _selectedSportId = "strength_training";
    }
  } else {
    if (btnCardio)   btnCardio.className   = "py-2.5 rounded-xl text-xs font-bold transition-all bg-amber-500 text-white shadow-sm flex items-center justify-center gap-2";
    if (btnStrength) btnStrength.className = "py-2.5 rounded-xl text-xs font-bold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2";
    if (nameLabel)   nameLabel.textContent = "Tevékenység / Rekord neve";
    if (nameInp)     nameInp.placeholder = "pl. 5 km futás, Cooper-teszt, 1000m úszás...";
    if (strFields)   strFields.classList.add("hidden");
    if (carFields)   carFields.classList.remove("hidden");

    _populateSportSelect("cardio");
    if (sportSelect) {
      sportSelect.value = "running";
      _selectedSportId = "running";
    }
  }

  _renderQuickSuggestions();
}

function _setDistanceUnit(unit) {
  _distanceUnit = unit === "m" ? "m" : "km";
  const btnKm     = $("pr-unit-btn-km");
  const btnM      = $("pr-unit-btn-m");
  const unitLabel = $("pr-distance-unit-label");
  const distInp   = $("pr-input-distance");

  if (_distanceUnit === "km") {
    if (btnKm) btnKm.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition-all bg-amber-500 text-white shadow-sm";
    if (btnM)  btnM.className  = "px-2.5 py-1 rounded-lg text-xs font-bold transition-all text-gray-500 dark:text-gray-400";
    if (unitLabel) unitLabel.textContent = "km";
    if (distInp) distInp.placeholder = "5";
  } else {
    if (btnM)  btnM.className  = "px-2.5 py-1 rounded-lg text-xs font-bold transition-all bg-amber-500 text-white shadow-sm";
    if (btnKm) btnKm.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition-all text-gray-500 dark:text-gray-400";
    if (unitLabel) unitLabel.textContent = "m";
    if (distInp) distInp.placeholder = "5000";
  }
  _liveCardioCalc();
}

function _populateSportSelect(group) {
  const sportSelect = $("pr-sport-select");
  if (!sportSelect) return;

  let sports = GARMIN_SPORTS;
  if (group === "strength") {
    sports = [
      ...GARMIN_SPORTS.filter(s => s.isStrength),
      ...GARMIN_SPORTS.filter(s => !s.isStrength)
    ];
  } else if (group === "cardio") {
    sports = [
      ...GARMIN_SPORTS.filter(s => s.isCardio),
      ...GARMIN_SPORTS.filter(s => !s.isCardio)
    ];
  }

  sportSelect.innerHTML = sports.map(s => `
    <option value="${s.id}">${s.name} (${s.cat})</option>
  `).join('');
}

function _renderQuickSuggestions() {
  const container = $("pr-quick-suggestions");
  if (!container) return;

  if (_activeType === "strength") {
    container.innerHTML = QUICK_STRENGTH.map(name => `
      <button type="button" class="pr-quick-tag flex-shrink-0 px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-white text-[11px] font-semibold text-gray-600 dark:text-gray-300 transition-all" data-name="${_esc(name)}">
        ${_esc(name)}
      </button>
    `).join('');

    container.querySelectorAll(".pr-quick-tag").forEach(tag => {
      tag.addEventListener("click", () => {
        const inp = $("pr-input-name");
        if (inp) {
          inp.value = tag.dataset.name;
          inp.focus();
        }
      });
    });
  } else {
    container.innerHTML = QUICK_CARDIO.map(item => `
      <button type="button" class="pr-quick-cardio-tag flex-shrink-0 px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-white text-[11px] font-semibold text-gray-600 dark:text-gray-300 transition-all"
              data-name="${_esc(item.name)}" data-dist="${item.dist}" data-unit="${item.unit}" data-sport="${item.sportId}">
        ${_esc(item.name)}
      </button>
    `).join('');

    container.querySelectorAll(".pr-quick-cardio-tag").forEach(tag => {
      tag.addEventListener("click", () => {
        const nameInp = $("pr-input-name");
        const distInp = $("pr-input-distance");
        const sportSelect = $("pr-sport-select");

        if (nameInp) nameInp.value = tag.dataset.name;
        if (distInp) distInp.value = tag.dataset.dist;
        if (tag.dataset.unit) _setDistanceUnit(tag.dataset.unit);
        if (sportSelect && tag.dataset.sport) {
          sportSelect.value = tag.dataset.sport;
          _selectedSportId = tag.dataset.sport;
        }
        _liveCardioCalc();
      });
    });
  }
}

function _liveStrengthCalc() {
  const w = parseFloat($("pr-input-weight")?.value);
  const r = parseInt($("pr-input-reps")?.value);
  const preview = $("pr-1rm-preview");
  const valEl   = $("pr-1rm-value");
  const pct90   = $("pr-pct-90");
  const pct80   = $("pr-pct-80");
  const pct70   = $("pr-pct-70");

  const orm = calcOneRM(w, r);
  if (orm !== null && preview && valEl) {
    preview.classList.remove("hidden");
    valEl.textContent = `${orm} kg`;
    if (pct90) pct90.textContent = `${Math.round(orm * 0.9 * 10) / 10} kg`;
    if (pct80) pct80.textContent = `${Math.round(orm * 0.8 * 10) / 10} kg`;
    if (pct70) pct70.textContent = `${Math.round(orm * 0.7 * 10) / 10} kg`;
  } else if (preview) {
    preview.classList.add("hidden");
  }
}

function _liveCardioCalc() {
  const rawDist = parseFloat($("pr-input-distance")?.value);
  const durH = $("pr-input-dur-h")?.value || 0;
  const durM = $("pr-input-dur-m")?.value || 0;
  const durS = $("pr-input-dur-s")?.value || 0;
  const durHidden = $("pr-input-duration");
  const preview = $("pr-cardio-preview");
  const speedEl = $("pr-cardio-speed-value");
  const paceEl  = $("pr-cardio-pace-value");

  const calc = calcSpeedAndPace(rawDist, _distanceUnit, null, durH, durM, durS);

  if (durHidden) durHidden.value = calc.formattedDuration;

  if (calc.speedKmh && preview && speedEl && paceEl) {
    preview.classList.remove("hidden");
    speedEl.textContent = `${calc.speedKmh} km/h`;
    paceEl.textContent = calc.paceStr || "—";
  } else if (preview) {
    preview.classList.add("hidden");
  }
}

function _populateExercisesDatalist() {
  const dl = $("pr-exercises-datalist");
  if (!dl) return;

  const names = new Set();
  if (Array.isArray(DEFAULT_EXERCISES)) {
    DEFAULT_EXERCISES.forEach(e => { if (e.name) names.add(e.name); });
  }
  if (Array.isArray(_customExercises)) {
    _customExercises.forEach(e => { if (e.name) names.add(e.name); });
  }

  dl.innerHTML = Array.from(names).map(n => `<option value="${_esc(n)}"></option>`).join('');
}

function _openModal(e) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
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

function _closeModal(e) {
  if (e && typeof e.stopPropagation === 'function') {
    e.stopPropagation();
  }
  const modal = $("pr-modal");
  const sheet = $("pr-modal-sheet");
  if (!modal || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => modal.classList.add("hidden"), 340);
}

function _resetForm() {
  ["pr-input-name", "pr-input-weight", "pr-input-reps",
   "pr-input-distance", "pr-input-dur-h", "pr-input-dur-m", "pr-input-dur-s", "pr-input-duration"].forEach(id => {
    const el = $(id);
    if (el) el.value = "";
  });

  const previewStr = $("pr-1rm-preview");
  if (previewStr) previewStr.classList.add("hidden");

  const previewCar = $("pr-cardio-preview");
  if (previewCar) previewCar.classList.add("hidden");

  const dateEl = $("pr-input-date");
  if (dateEl) dateEl.value = new Date().toISOString().split("T")[0];

  _setDistanceUnit("km");
  _setType("strength");
}

// ── Mentés ────────────────────────────────────────────────
async function _handleSave() {
  if (!_uid) {
    try {
      const localUser = JSON.parse(localStorage.getItem('lockin_local_user') || '{}');
      _uid = localUser.uid || 'local_user';
    } catch (_) {
      _uid = 'local_user';
    }
  }

  const sport = getSportById(_selectedSportId);
  const nameEl = $("pr-input-name");
  const name   = nameEl?.value.trim() || sport.name;

  const dateEl  = $("pr-input-date");
  const dateVal = dateEl?.value || new Date().toISOString().split("T")[0];

  let recordData = {
    name,
    sportId:   _selectedSportId,
    category:  _activeType === 'strength' ? 'strength' : 'cardio',
    type:      _activeType,
    date:      dateVal,
    createdAt: serverTimestamp(),
  };

  if (_activeType === "strength") {
    const w   = parseFloat($("pr-input-weight")?.value) || null;
    const r   = parseInt($("pr-input-reps")?.value)    || null;
    const orm = calcOneRM(w, r);
    recordData = {
      ...recordData,
      weight: w,
      reps: r,
      oneRM: orm
    };
  } else {
    const rawDist = parseFloat($("pr-input-distance")?.value) || null;
    const durH = $("pr-input-dur-h")?.value || 0;
    const durM = $("pr-input-dur-m")?.value || 0;
    const durS = $("pr-input-dur-s")?.value || 0;
    const durHidden = $("pr-input-duration")?.value || "";

    const calc = calcSpeedAndPace(rawDist, _distanceUnit, durHidden, durH, durM, durS);

    recordData = {
      ...recordData,
      distance: rawDist,
      distanceUnit: _distanceUnit,
      distanceKm: _distanceUnit === 'm' ? (rawDist ? rawDist / 1000 : null) : rawDist,
      duration: calc.formattedDuration || durHidden || null,
      durationSec: calc.totalSec || null,
      speedKmh: calc.speedKmh,
      pace: calc.paceStr
    };
  }

  const saveBtn = $("pr-save-btn");
  if (saveBtn) { saveBtn.textContent = "Mentés…"; saveBtn.disabled = true; }

  try {
    const docRef = await addDoc(collection(db, "users", _uid, "records"), recordData);
    recordData.id = docRef.id;
    _saveToLocal(recordData);
    _closeModal();
  } catch (err) {
    console.warn("[PR Hub] Firestore mentési hiba, helyi mentés fut:", err);
    recordData.id = "local_pr_" + Date.now().toString(36);
    _saveToLocal(recordData);
    _allRecords.unshift(recordData);
    _render();
    _updateStats();
    _closeModal();
  } finally {
    if (saveBtn) { saveBtn.textContent = "Rekord mentése"; saveBtn.disabled = false; }
  }
}

// ── Törlés ────────────────────────────────────────────────
async function _delete(recordId) {
  if (!recordId) return;
  try {
    if (_uid) {
      await deleteDoc(doc(db, "users", _uid, "records", recordId));
    }
  } catch (err) {
    console.warn("[PR Hub] Törlési figyelmeztetés:", err);
  }
  _deleteFromLocal(recordId);
  _allRecords = _allRecords.filter(r => r.id !== recordId);
  _render();
  _updateStats();
}
