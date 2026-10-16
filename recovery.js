// ============================================================
// recovery.js — Regeneráció / Alvásnapló modul
// FitPlan Pro | Violet téma
// Alvásidő kalkuláció + Firestore CRUD
// ============================================================

import { db } from "../firebase-config.js";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Belső állapot ──────────────────────────────────────────
let _uid           = null;
let _unsubscribe   = null;
let _allLogs       = [];
let _activeQuality = 3;

// ── Segédek ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Minőség emoji táblázat
const QUALITY_EMOJI = { 1: "😴", 2: "😑", 3: "🙂", 4: "😊", 5: "🤩" };

// Alvásidő kiszámítása (HH:MM → órák, tizedes)
function calcSleepHours(bedtime, wakeup) {
  if (!bedtime || !wakeup) return null;
  const [bh, bm] = bedtime.split(":").map(Number);
  const [wh, wm] = wakeup.split(":").map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;
  return Math.round(mins / 6) / 10;
}

// Tegnapi dátum (YYYY-MM-DD) — alvásnapló alapértelmezése
function _yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

let _uiInitialized = false;

// ── Publikus API ───────────────────────────────────────────

/** Modult inicializál bejelentkezés után. */
export function initRecovery(uid) {
  _uid = uid;
  if (!_uiInitialized) {
    _setupFAB();
    _setupModal();
    _uiInitialized = true;
  }
  _subscribe(uid);
}

/** Firestore leiratkozás és felület takarítás (kijelentkezéskor). */
export function destroyRecovery() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _uid     = null;
  _allLogs = [];

  const list = $("rec-records-list");
  if (list) list.innerHTML = "";
  _updateStats();
}

// ── Firestore feliratkozás ─────────────────────────────────
function _subscribe(uid) {
  const q = query(
    collection(db, "users", uid, "sleepLogs"),
    orderBy("createdAt", "desc")
  );

  _unsubscribe = onSnapshot(q,
    snap => {
      _allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
      _updateStats();
    },
    err => console.error("[Recovery] Firestore hiba:", err)
  );
}

// ── Kártyák renderelése ────────────────────────────────────
function _render() {
  const list = $("rec-records-list");
  if (!list) return;

  if (_allLogs.length === 0) {
    list.innerHTML = `
      <div class="text-center py-16">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-violet-50
                    flex items-center justify-center mb-4">
          <i class="fa-solid fa-moon text-violet-300 text-2xl"></i>
        </div>
        <p class="text-gray-400 text-sm font-medium">Még nincs alvás naplózva!</p>
      </div>`;
    return;
  }

  list.innerHTML = _allLogs.map(_cardHTML).join("");

  // Törlés esemény
  list.querySelectorAll(".rec-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _delete(btn.dataset.id);
    });
  });
}

function _cardHTML(r) {
  const dateStr = r.date
    ? new Date(r.date + "T12:00:00").toLocaleDateString("hu-HU",
        { month: "short", day: "numeric" })
    : "";

  const timeRange = (r.bedtime && r.wakeup)
    ? `${r.bedtime} → ${r.wakeup}`
    : "";

  const emoji    = QUALITY_EMOJI[r.quality] || "";
  const duration = r.durationHours != null ? r.durationHours : "—";
  const notesHTML = r.notes
    ? `<p class="text-xs text-gray-400 mt-1 truncate">${r.notes}</p>`
    : "";

  return `
    <div class="bg-white border border-gray-100 rounded-2xl p-4
                flex items-center gap-3 shadow-sm">

      <div class="w-10 h-10 rounded-xl bg-violet-50
                  flex items-center justify-center flex-shrink-0">
        <i class="fa-solid fa-moon text-violet-500 text-sm"></i>
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-gray-800 truncate">
          ${dateStr} ${emoji}
        </p>
        <p class="text-xs text-gray-400 mt-0.5">${timeRange}</p>
        ${notesHTML}
      </div>

      <div class="text-right flex-shrink-0">
        <p class="text-lg font-bold text-violet-600 tabular-nums leading-tight">
          ${duration}
        </p>
        <p class="text-[10px] text-gray-400 mt-0.5">óra</p>
      </div>

      <button class="rec-delete-btn ml-1 w-7 h-7 rounded-full bg-gray-50
                     flex items-center justify-center text-gray-300
                     hover:bg-red-50 hover:text-red-400 transition-colors flex-shrink-0"
              data-id="${r.id}" title="Törlés">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>`;
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

// ── FAB ────────────────────────────────────────────────────
function _setupFAB() {
  const fab = $("rec-fab");
  if (!fab) return;
  fab.addEventListener("click", _openModal);
}

// ── Modal ──────────────────────────────────────────────────
function _setupModal() {
  const closeBtn  = $("rec-modal-close");
  const backdrop  = $("rec-modal-backdrop");
  const saveBtn   = $("rec-save-btn");
  const bedtimeIn = $("rec-input-bedtime");
  const wakeupIn  = $("rec-input-wakeup");

  if (closeBtn) closeBtn.addEventListener("click",  _closeModal);
  if (backdrop) backdrop.addEventListener("click",  _closeModal);
  if (saveBtn)  saveBtn.addEventListener("click",   _handleSave);

  // Élő időtartam előnézet
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
  if (bedtimeIn) bedtimeIn.addEventListener("change", _liveDuration);
  if (wakeupIn)  wakeupIn.addEventListener("input",   _liveDuration);
  if (wakeupIn)  wakeupIn.addEventListener("change",  _liveDuration);

  // Minőség gombok
  document.querySelectorAll(".rec-quality-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeQuality = Number(btn.dataset.q);
      _updateQualityUI();
    });
  });
}

function _updateQualityUI() {
  document.querySelectorAll(".rec-quality-btn").forEach(btn => {
    const active = Number(btn.dataset.q) === _activeQuality;
    btn.style.borderColor      = active ? "#7c3aed" : "#e5e7eb";
    btn.style.backgroundColor  = active ? "#f5f3ff" : "#f9fafb";
  });
}

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

// ── Mentés ────────────────────────────────────────────────
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

// ── Törlés ────────────────────────────────────────────────
async function _delete(logId) {
  if (!_uid || !logId) return;
  try {
    await deleteDoc(doc(db, "users", _uid, "sleepLogs", logId));
  } catch (err) {
    console.error("[Recovery] Törlési hiba:", err);
  }
}
