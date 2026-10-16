// ============================================================
// recovery.js — Regeneráció, Alvásnapló & Regenerációs Programok
// FitPlan Pro | Violet téma
// SMR hengerezés, Nyújtás, Hidegterápia/Szauna, Alvásidő kalkuláció
// ============================================================

import { db } from "../firebase-config.js";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Beépített minta regenerációs protokollok ────────────────
const DEFAULT_RECOVERY_PROTOCOLS = [
  {
    name: "Teljes test SMR Hengerezés & Mobilitás",
    type: "smr",
    duration: 20,
    exercises: "Vádli és Achilles hengerezés (2-2 perc)\nCombfeszítő és combközelítő (3-3 perc)\nIT-szalag és gluteus fókusz (3-3 perc)\nHáti gerinc extenzió és lapocka mobilitás (4 perc)",
    notes: "Feszes trigger pontokon 30 mp tartás mély kilégzéssel"
  },
  {
    name: "Alsótest Mélynyújtás (Csípőnyitó & Combhajlító)",
    type: "stretch",
    duration: 25,
    exercises: "Galambpóz (Pigeon pose) 2 × 90 mp oldalanként\nPillangóülés csípőnyújtás 2 perc\nCombhajlító nyújtás hevederrel 2-2 perc\nKobra póz és törzsnyújtás 2 perc",
    notes: "Lábnapok után kötelező feszültségoldás"
  },
  {
    name: "Kontraszt Szauna & Hidegvizes Terápia",
    type: "contrast",
    duration: 45,
    exercises: "1. Kör: 15 perc Finn szauna (85°C) → 2 perc hideg merülés (10°C)\n2. Kör: 12 perc Szauna → 2 perc hideg zuhany\n3. Kör: 10 perc Szauna → 3 perc hideg merülés\nPihenés és rehidratáció 10 perc",
    notes: "Gyulladáscsökkentés és vérkeringés fokozása"
  },
  {
    name: "Idegrendszeri Lecsendesedés (Box Breathing & Shavasana)",
    type: "breath",
    duration: 15,
    exercises: "4-4-4-4 Box breathing légzéstechnika 8 perc\nFekvő relaxáció és progresszív izomlazítás 7 perc",
    notes: "Paraszimpatikus idegrendszer aktiválása lefekvés előtt"
  }
];

// ── Belső állapot ──────────────────────────────────────────
let _uid           = null;
let _unsubSleep    = null;
let _unsubRecovery = null;
let _allLogs       = [];
let _recoveryLogs  = [];
let _currentProtocolsList = [];
let _activeQuality = 3;
let _uiInitialized = false;

const $ = id => document.getElementById(id);

const QUALITY_EMOJI = { 1: "😴", 2: "😑", 3: "🙂", 4: "😊", 5: "🤩" };

function calcSleepHours(bedtime, wakeup) {
  if (!bedtime || !wakeup) return null;
  const [bh, bm] = bedtime.split(":").map(Number);
  const [wh, wm] = wakeup.split(":").map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;
  return Math.round(mins / 6) / 10;
}

function _yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function _today() {
  return new Date().toISOString().split("T")[0];
}

// ── Publikus API ───────────────────────────────────────────
export function initRecovery(uid) {
  _uid = uid;
  _allLogs = [];
  _recoveryLogs = [];

  if (!_uiInitialized) {
    _bindUI();
    _uiInitialized = true;
  }
  _subscribe(uid);
}

export function destroyRecovery() {
  if (_unsubSleep) { _unsubSleep(); _unsubSleep = null; }
  if (_unsubRecovery) { _unsubRecovery(); _unsubRecovery = null; }
  _uid     = null;
  _allLogs = [];
  _recoveryLogs = [];

  const list = $("rec-records-list");
  if (list) list.innerHTML = "";
  const recList = $("rec-protocols-list");
  if (recList) recList.innerHTML = "";
  _updateStats();
}

// ── Firestore feliratkozás ─────────────────────────────────
function _subscribe(uid) {
  // 1. Alvásnapló
  const qSleep = query(collection(db, "users", uid, "sleepLogs"), orderBy("createdAt", "desc"));
  _unsubSleep = onSnapshot(qSleep, snap => {
    _allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _render();
    _updateStats();
  }, err => console.error("[Recovery] Sleep Firestore hiba:", err));

  // 2. Regenerációs szeánszok (nyújtás, SMR, stb.)
  const qRec = query(collection(db, "users", uid, "recoverySessions"), orderBy("createdAt", "desc"));
  _unsubRecovery = onSnapshot(qRec, snap => {
    _recoveryLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderRecoverySessions();
  }, err => console.error("[Recovery] Sessions Firestore hiba:", err));
}

// ── Renderelés: Alváskártyák ───────────────────────────────
function _render() {
  const list = $("rec-records-list");
  if (!list) return;

  if (_allLogs.length === 0) {
    list.innerHTML = `
      <div class="text-center py-10">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-violet-50 dark:bg-violet-950/40
                    flex items-center justify-center mb-4">
          <i class="fa-solid fa-moon text-violet-400 text-2xl"></i>
        </div>
        <p class="text-gray-400 text-sm font-medium">Még nincs alvás naplózva!</p>
      </div>`;
    return;
  }

  list.innerHTML = _allLogs.map(_cardHTML).join("");

  list.querySelectorAll(".rec-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _delete(btn.dataset.id);
    });
  });
}

function _cardHTML(r) {
  const dateStr = r.date
    ? new Date(r.date + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : "";

  const timeRange = (r.bedtime && r.wakeup)
    ? `${r.bedtime} → ${r.wakeup}`
    : "";

  const emoji    = QUALITY_EMOJI[r.quality] || "";
  const duration = r.durationHours != null ? r.durationHours : "—";
  const notesHTML = r.notes
    ? `<p class="text-xs text-gray-400 mt-1 truncate">${_esc(r.notes)}</p>`
    : "";

  return `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-4
                flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">

      <div class="w-11 h-11 rounded-2xl bg-violet-50 dark:bg-violet-950/40
                  flex items-center justify-center flex-shrink-0">
        <i class="fa-solid fa-moon text-violet-600 dark:text-violet-400 text-base"></i>
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-sm font-bold text-gray-900 dark:text-white truncate">
          ${dateStr} ${emoji}
        </p>
        <p class="text-xs text-gray-400 mt-0.5">${timeRange}</p>
        ${notesHTML}
      </div>

      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-violet-600 dark:text-violet-400 tabular-nums leading-tight">
          ${duration}
        </p>
        <p class="text-[10px] text-gray-400 mt-0.5">óra</p>
      </div>

      <button class="rec-delete-btn ml-1 w-7 h-7 rounded-full bg-gray-50 dark:bg-slate-800
                     flex items-center justify-center text-gray-300 dark:text-gray-600
                     hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
              data-id="${r.id}" title="Törlés">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>`;
}

function _renderRecoverySessions() {
  const container = $("rec-sessions-list");
  if (!container) return;

  if (_recoveryLogs.length === 0) {
    container.innerHTML = `
      <p class="text-xs text-gray-400 dark:text-gray-600 text-center py-3 italic">Még nem rögzítettél regenerációs protokollt.</p>
    `;
    return;
  }

  container.innerHTML = _recoveryLogs.map(s => `
    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-violet-50/50 dark:bg-slate-800/60 border border-violet-100 dark:border-slate-700/60 text-xs">
      <div class="flex-1 min-w-0 pr-2">
        <div class="flex items-center gap-2">
          <span class="font-bold text-gray-800 dark:text-gray-200 truncate">${_esc(s.name)}</span>
          <span class="text-[10px] font-semibold bg-violet-100 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">${s.duration} perc</span>
        </div>
        <p class="text-[10px] text-gray-400 mt-0.5">${s.date || ''} · ${s.exercises ? s.exercises.split('\n')[0] : ''}</p>
      </div>
      <button class="rec-delete-session-btn text-gray-300 hover:text-red-500 p-1" data-id="${s.id}">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.rec-delete-session-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _deleteSession(btn.dataset.id);
    });
  });
}

function _esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ── Statisztikák ───────────────────────────────────────────
function _updateStats() {
  const elAvg   = $("rec-stat-avg");
  const elBest  = $("rec-stat-best");
  const elTotal = $("rec-stat-total");

  if (elTotal) elTotal.textContent = _allLogs.length;

  const withDuration = _allLogs.filter(l => l.durationHours != null);

  if (withDuration.length > 0) {
    const sum  = withDuration.reduce((acc, l) => acc + l.durationHours, 0);
    const avg  = Math.round((sum / withDuration.length) * 10) / 10;
    const best = Math.max(...withDuration.map(l => l.durationHours));

    if (elAvg)  elAvg.textContent  = `${avg} ó`;
    if (elBest) elBest.textContent = `${best} ó`;
  } else {
    if (elAvg)  elAvg.textContent  = "— ó";
    if (elBest) elBest.textContent = "— ó";
  }
}

// ── Regenerációs Protokollok Modal ─────────────────────────
function _openProtocolsModal() {
  const modal = $("rec-protocols-modal");
  const sheet = $("rec-protocols-sheet");
  if (!modal || !sheet) return;

  _renderProtocolsList();

  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = "translateY(0)";
    });
  });
}

function _closeProtocolsModal() {
  const modal = $("rec-protocols-modal");
  const sheet = $("rec-protocols-sheet");
  if (!modal || !sheet) return;
  sheet.style.transform = "translateY(100%)";
  setTimeout(() => modal.classList.add("hidden"), 340);
}

function _renderProtocolsList() {
  const listEl = $("rec-protocols-items");
  if (!listEl) return;

  _currentProtocolsList = DEFAULT_RECOVERY_PROTOCOLS;

  listEl.innerHTML = DEFAULT_RECOVERY_PROTOCOLS.map((p, idx) => `
    <div class="p-4 rounded-3xl bg-gray-50 dark:bg-slate-800/80 border border-gray-100 dark:border-slate-700/60 mb-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-bold text-gray-900 dark:text-white">${_esc(p.name)}</h4>
        <span class="text-xs font-semibold text-violet-600 dark:text-violet-400">${p.duration} perc</span>
      </div>

      <div class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line bg-white dark:bg-slate-900 p-3 rounded-2xl border border-gray-100 dark:border-slate-800 mb-3 text-[11px] leading-relaxed">
        ${_esc(p.exercises)}
      </div>

      <button class="rec-apply-protocol-btn w-full py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
        data-index="${idx}">
        <i class="fa-solid fa-arrow-down-to-bracket pointer-events-none"></i> Beemelés a mai naplóba
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('.rec-apply-protocol-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      const proto = _currentProtocolsList[idx];
      if (proto) {
        _applyProtocolToToday(proto);
      }
    });
  });
}

async function _applyProtocolToToday(proto) {
  if (!_uid) return;
  try {
    await addDoc(collection(db, "users", _uid, "recoverySessions"), {
      name: proto.name,
      type: proto.type || "stretch",
      duration: proto.duration || 20,
      exercises: proto.exercises || "",
      notes: proto.notes || "",
      date: _today(),
      createdAt: serverTimestamp()
    });
    _closeProtocolsModal();
  } catch (err) {
    console.error("[Recovery] Protocol mentési hiba:", err);
  }
}

async function _deleteSession(id) {
  if (!_uid || !id) return;
  try {
    await deleteDoc(doc(db, "users", _uid, "recoverySessions", id));
  } catch (err) {
    console.error(err);
  }
}

// ── Alvás Modal ────────────────────────────────────────────
function _openModal() {
  const modal = $("rec-modal");
  const sheet = $("rec-modal-sheet");
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
  const modal = $("rec-modal");
  const sheet = $("rec-modal-sheet");
  if (!modal || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => modal.classList.add("hidden"), 340);
}

function _resetForm() {
  const dateEl    = $("rec-input-date");
  const bedtimeEl = $("rec-input-bedtime");
  const wakeupEl  = $("rec-input-wakeup");
  const notesEl   = $("rec-input-notes");
  const preview   = $("rec-duration-preview");

  if (dateEl)    dateEl.value    = _yesterday();
  if (bedtimeEl) bedtimeEl.value = "";
  if (wakeupEl)  wakeupEl.value  = "";
  if (notesEl)   notesEl.value   = "";
  if (preview)   preview.setAttribute("hidden", "");

  _activeQuality = 3;
  _updateQualityUI();
}

function _updateQualityUI() {
  document.querySelectorAll(".rec-quality-btn").forEach(btn => {
    const active = Number(btn.dataset.q) === _activeQuality;
    btn.style.borderColor      = active ? "#7c3aed" : "";
    btn.style.backgroundColor  = active ? "#f5f3ff" : "";
  });
}

async function _handleSave() {
  if (!_uid) return;

  const bedtimeEl = $("rec-input-bedtime");
  const wakeupEl  = $("rec-input-wakeup");
  const bedtime   = bedtimeEl?.value.trim() || null;
  const wakeup    = wakeupEl?.value.trim()  || null;

  if (!bedtime || !wakeup) {
    const target = !bedtime ? bedtimeEl : wakeupEl;
    if (target) {
      target.style.borderColor = "#7c3aed";
      target.focus();
      setTimeout(() => { target.style.borderColor = ""; }, 2000);
    }
    return;
  }

  const dateEl      = $("rec-input-date");
  const notesEl     = $("rec-input-notes");
  const dateVal     = dateEl?.value  || _yesterday();
  const notes       = notesEl?.value.trim() || "";
  const durationHours = calcSleepHours(bedtime, wakeup);

  const data = {
    date:          dateVal,
    bedtime,
    wakeup,
    durationHours,
    quality:       _activeQuality,
    notes,
    createdAt:     serverTimestamp(),
  };

  const saveBtn = $("rec-save-btn");
  if (saveBtn) { saveBtn.textContent = "Mentés…"; saveBtn.disabled = true; }

  try {
    await addDoc(collection(db, "users", _uid, "sleepLogs"), data);
    _closeModal();
  } catch (err) {
    console.error("[Recovery] Mentési hiba:", err);
  } finally {
    if (saveBtn) { saveBtn.textContent = "Alvás mentése"; saveBtn.disabled = false; }
  }
}

async function _delete(logId) {
  if (!_uid || !logId) return;
  try {
    await deleteDoc(doc(db, "users", _uid, "sleepLogs", logId));
  } catch (err) {
    console.error("[Recovery] Törlési hiba:", err);
  }
}

// ── UI és események bekötése ───────────────────────────────
function _bindUI() {
  const fab = $("rec-fab");
  if (fab) fab.addEventListener("click", _openModal);

  const closeBtn  = $("rec-modal-close");
  const backdrop  = $("rec-modal-backdrop");
  const saveBtn   = $("rec-save-btn");
  const bedtimeIn = $("rec-input-bedtime");
  const wakeupIn  = $("rec-input-wakeup");

  if (closeBtn) closeBtn.addEventListener("click",  _closeModal);
  if (backdrop) backdrop.addEventListener("click",  _closeModal);
  if (saveBtn)  saveBtn.addEventListener("click",   _handleSave);

  function _liveDuration() {
    const hours   = calcSleepHours(bedtimeIn?.value, wakeupIn?.value);
    const preview = $("rec-duration-preview");
    const valEl   = $("rec-duration-value");
    if (!preview || !valEl) return;

    if (hours !== null) {
      preview.removeAttribute("hidden");
      valEl.textContent = `${hours} ó`;
    } else {
      preview.setAttribute("hidden", "");
    }
  }

  if (bedtimeIn) bedtimeIn.addEventListener("input",  _liveDuration);
  if (wakeupIn)  wakeupIn.addEventListener("input",   _liveDuration);

  document.querySelectorAll(".rec-quality-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeQuality = Number(btn.dataset.q);
      _updateQualityUI();
    });
  });

  // Protokollok Modal bekötése
  const openProtoBtn = $("rec-open-protocols-btn");
  if (openProtoBtn) openProtoBtn.addEventListener("click", _openProtocolsModal);

  const protoClose = $("rec-protocols-close");
  const protoBackdrop = $("rec-protocols-backdrop");
  if (protoClose) protoClose.addEventListener("click", _closeProtocolsModal);
  if (protoBackdrop) protoBackdrop.addEventListener("click", _closeProtocolsModal);
}
