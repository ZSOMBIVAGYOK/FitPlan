// ============================================================
// FitPlan Pro — WORKOUT Module
// Color scheme: Indigo (#4338ca / #eef2ff / #818cf8)
// Firestore: users/{uid}/workouts  orderBy('createdAt', 'desc')
// ============================================================

import { db } from '../firebase-config.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Helpers ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Private state ─────────────────────────────────────────────
let _uid        = null;
let _unsub      = null;
let _allRecords = [];
let _closing    = false;

let _uiInitialized = false;

// ── Initialise ────────────────────────────────────────────────
export function initWorkout(uid) {
  _uid = uid;
  if (!_uiInitialized) {
    _bindFAB();
    _bindModal();
    _bindSave();
    _uiInitialized = true;
  }
  _subscribe();
}

export function destroyWorkout() {
  if (_unsub) { _unsub(); _unsub = null; }
  _uid        = null;
  _allRecords = [];

  const list = $('wo-records-list');
  if (list) list.innerHTML = '';
  _renderStats();
}

// ── Firestore subscription ────────────────────────────────────
function _subscribe() {
  if (!_uid) return;
  const q = query(
    collection(db, 'users', _uid, 'workouts'),
    orderBy('createdAt', 'desc')
  );
  _unsub = onSnapshot(q, snap => {
    _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderList();
    _renderStats();
  }, err => {
    console.error('[workout] onSnapshot error', err);
  });
}

// ── Stats ─────────────────────────────────────────────────────
function _renderStats() {
  // ── week count (Mon–Sun of current week) ──
  const now   = new Date();
  const day   = now.getDay();                          // 0 Sun … 6 Sat
  const diff  = (day === 0) ? -6 : 1 - day;           // offset to Monday
  const mon   = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  const sun   = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  const weekCount = _allRecords.filter(r => {
    if (!r.date) return false;
    const d = new Date(r.date + 'T00:00:00');
    return d >= mon && d <= sun;
  }).length;

  // ── total ──
  const total = _allRecords.length;

  // ── streak ──
  const dateSets = new Set(_allRecords.map(r => r.date).filter(Boolean));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // Allow streak to start from today OR yesterday
  const todayStr     = _isoDate(cursor);
  const yesterdayStr = _isoDate(new Date(cursor.getTime() - 86400000));
  if (!dateSets.has(todayStr) && !dateSets.has(yesterdayStr)) {
    streak = 0;
  } else {
    if (!dateSets.has(todayStr)) {
      cursor.setDate(cursor.getDate() - 1); // start from yesterday
    }
    while (dateSets.has(_isoDate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  const elWeek   = $('wo-stat-week');
  const elTotal  = $('wo-stat-total');
  const elStreak = $('wo-stat-streak');
  if (elWeek)   elWeek.textContent   = weekCount;
  if (elTotal)  elTotal.textContent  = total;
  if (elStreak) elStreak.textContent = streak;
}

function _isoDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── List rendering ────────────────────────────────────────────
function _renderList() {
  const list = $('wo-records-list');
  if (!list) return;

  if (_allRecords.length === 0) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
          <i class="fa-solid fa-dumbbell text-2xl text-indigo-400"></i>
        </div>
        <p class="text-gray-400 text-sm font-medium">Még nincs edzés naplózva!</p>
      </div>`;
    return;
  }

  list.innerHTML = _allRecords.map(r => _cardHTML(r)).join('');

  // bind delete buttons
  list.querySelectorAll('[data-wo-delete]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.woDelete;
      if (id) _deleteRecord(id);
    });
  });
}

function _cardHTML(r) {
  const exerciseLines = r.exercises
    ? r.exercises.split('\n').filter(l => l.trim() !== '')
    : [];
  const exCount  = exerciseLines.length;
  const duration = r.duration ? `${r.duration} perc` : '—';
  const noteHTML = r.notes
    ? `<p class="text-xs text-gray-400 truncate mt-0.5">${_esc(r.notes)}</p>`
    : '';

  return `
    <div class="bg-white border border-gray-100 rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3">
      <!-- Icon badge -->
      <div class="flex-shrink-0 w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
        <i class="fa-solid fa-dumbbell text-indigo-500 text-lg"></i>
      </div>

      <!-- Center info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-gray-800 text-sm truncate">${_esc(r.name || '—')}</span>
          <span class="text-xs bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5 font-medium whitespace-nowrap">${_esc(duration)}</span>
        </div>
        <p class="text-xs text-gray-400 mt-0.5">${_esc(r.date || '')}</p>
        ${noteHTML}
      </div>

      <!-- Exercise count -->
      <div class="flex-shrink-0 text-right flex flex-col items-end gap-1">
        <span class="text-xs text-indigo-500 font-medium whitespace-nowrap">${exCount} gyakorlat</span>
        <!-- Delete -->
        <button
          data-wo-delete="${r.id}"
          class="text-gray-300 hover:text-red-400 transition-colors p-1 -mr-1"
          aria-label="Törlés"
        >
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>
    </div>`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Delete ────────────────────────────────────────────────────
async function _deleteRecord(id) {
  if (!_uid) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'workouts', id));
  } catch (err) {
    console.error('[workout] delete error', err);
  }
}

// ── FAB ───────────────────────────────────────────────────────
function _bindFAB() {
  const fab = $('wo-fab');
  if (!fab) return;
  fab.addEventListener('click', _openModal);
}

// ── Modal ─────────────────────────────────────────────────────
function _bindModal() {
  const backdrop = $('wo-modal-backdrop');
  const closeBtn = $('wo-modal-close');
  if (backdrop) backdrop.addEventListener('click', _closeModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);
}

function _openModal() {
  _resetForm();
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeModal() {
  if (_closing) return;
  _closing = true;
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) { _closing = false; return; }

  sheet.style.transform = 'translateY(100%)';

  setTimeout(() => {
    modal.classList.add('hidden');
    _closing = false;
  }, 340);
}

function _resetForm() {
  const fields = [
    ['wo-input-name',      ''],
    ['wo-input-exercises', ''],
    ['wo-input-notes',     ''],
  ];
  fields.forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });

  const dateEl = $('wo-input-date');
  if (dateEl) dateEl.value = _isoDate(new Date());

  const durEl = $('wo-input-duration');
  if (durEl) durEl.value = '60';
}

// ── Save ──────────────────────────────────────────────────────
function _bindSave() {
  const btn = $('wo-save-btn');
  if (!btn) return;
  btn.addEventListener('click', _saveRecord);
}

async function _saveRecord() {
  if (!_uid) return;

  const nameEl      = $('wo-input-name');
  const dateEl      = $('wo-input-date');
  const durEl       = $('wo-input-duration');
  const exercisesEl = $('wo-input-exercises');
  const notesEl     = $('wo-input-notes');

  const name      = nameEl      ? nameEl.value.trim()      : '';
  const date      = dateEl      ? dateEl.value.trim()      : '';
  const duration  = durEl       ? Number(durEl.value) || 0 : 0;
  const exercises = exercisesEl ? exercisesEl.value.trim() : '';
  const notes     = notesEl     ? notesEl.value.trim()     : '';

  if (!name || !date) {
    // Highlight missing fields without confirm dialogs
    if (nameEl && !name) {
      nameEl.style.borderColor = '#ef4444';
      nameEl.focus();
      setTimeout(() => { nameEl.style.borderColor = ''; }, 1800);
    } else if (dateEl && !date) {
      dateEl.style.borderColor = '#ef4444';
      dateEl.focus();
      setTimeout(() => { dateEl.style.borderColor = ''; }, 1800);
    }
    return;
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'workouts'), {
      name,
      date,
      duration,
      exercises,
      notes,
      createdAt: serverTimestamp(),
    });
    _closeModal();
  } catch (err) {
    console.error('[workout] save error', err);
  }
}
