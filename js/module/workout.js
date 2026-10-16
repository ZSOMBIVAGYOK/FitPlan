// ============================================================
// workout.js — Edzésnapló, Garmin Sportágak & Edzésprogramok
// FitPlan Pro | Indigo téma
// Gyakorlattár, Rutinok 1-kattintásos beemelése, Heti statisztikák
// ============================================================

import { db } from '../firebase-config.js';
import { GARMIN_SPORTS, getSportById } from '../garmin-sports.js';
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

// ── DOM segéd ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Beépített minta edzésprogramok ─────────────────────────
const DEFAULT_ROUTINES = [
  {
    name: 'Push Nap (Mell, Váll, Tricepsz)',
    sportId: 'strength_training',
    duration: 65,
    exercises: 'Fekvenyomás rúddal 4 × 8 (80 kg)\nFerdepados kézisúlyzós nyomás 3 × 10 (26 kg)\nVállból nyomás ülve 3 × 10 (20 kg)\nOldalemelés kézisúllyal 4 × 15 (10 kg)\nTricepsz letolás csigán 3 × 12 (35 kg)',
    notes: 'Kiváló feszülés a mellizmokban, progresszív terhelés'
  },
  {
    name: 'Pull Nap (Hát, Bicepsz)',
    sportId: 'strength_training',
    duration: 60,
    exercises: 'Húzódzkodás saját testsúllyal 4 × 8\nDöntött törzsű evezés rúddal 4 × 8 (70 kg)\nCsigás lehúzás mellhez 3 × 10 (60 kg)\nFace pull (arcrahúzás) 3 × 15 (25 kg)\nBicepsz hajlítás francia rúddal 3 × 10 (30 kg)',
    notes: 'Erős lapockazárásra figyelve'
  },
  {
    name: 'Legs Nap (Guggolás & Láb)',
    sportId: 'strength_training',
    duration: 70,
    exercises: 'Guggolás rúddal 4 × 6 (100 kg)\nRomán felhúzás kézisúllyal 3 × 8 (32 kg)\nLábtoló gép 3 × 10 (160 kg)\nCombhajlító gép 3 × 12 (45 kg)\nVádliemelés állva 4 × 15',
    notes: 'Mély guggolások, teljes mozgástartomány'
  },
  {
    name: '5 km Zóna 2 Kardió Futás',
    sportId: 'running',
    duration: 32,
    exercises: 'Bemelegítés séta 3 perc\n5 km egyenletes futás Zóna 2 pulzustartományban (~5:40 /km)\nLevezetés és légzésgyakorlat 3 perc',
    notes: 'Könnyed regeneráló aerob futás'
  }
];

// ── Belső állapot ──────────────────────────────────────────
let _uid = null;
let _unsubWorkouts = null;
let _unsubRoutines = null;

let _allRecords = [];
let _customRoutines = [];
let _uiInitialized = false;

// ── Dátum formázás ─────────────────────────────────────────
function _isoDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Publikus API ───────────────────────────────────────────
export function initWorkout(uid) {
  _uid = uid;
  _allRecords = [];
  _customRoutines = [];

  if (!_uiInitialized) {
    _bindUI();
    _uiInitialized = true;
  }
  _subscribe();
}

export function destroyWorkout() {
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRoutines) { _unsubRoutines(); _unsubRoutines = null; }
  _uid = null;
  _allRecords = [];
  _customRoutines = [];

  const list = $('wo-records-list');
  if (list) list.innerHTML = '';
  _renderStats();
}

// ── Firestore feliratkozások ───────────────────────────────
function _subscribe() {
  if (!_uid) return;

  // Edzések
  const qW = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qW, snap => {
    _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderList();
    _renderStats();
  }, err => console.error('[workout] onSnapshot error', err));

  // Mentett edzésprogramok
  const qR = query(collection(db, 'users', _uid, 'workoutRoutines'), orderBy('createdAt', 'desc'));
  _unsubRoutines = onSnapshot(qR, snap => {
    _customRoutines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderRoutinesModalList();
  }, err => console.error('[workout] routines onSnapshot error', err));
}

// ── Statisztikák ───────────────────────────────────────────
function _renderStats() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  const weekCount = _allRecords.filter(r => {
    if (!r.date) return false;
    const d = new Date(r.date + 'T00:00:00');
    return d >= mon && d <= sun;
  }).length;

  const total = _allRecords.length;

  const dateSets = new Set(_allRecords.map(r => r.date).filter(Boolean));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  const todayStr = _isoDate(cursor);
  const yesterdayStr = _isoDate(new Date(cursor.getTime() - 86400000));
  if (!dateSets.has(todayStr) && !dateSets.has(yesterdayStr)) {
    streak = 0;
  } else {
    if (!dateSets.has(todayStr)) {
      cursor.setDate(cursor.getDate() - 1);
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

// ── Edzéslista renderelés ──────────────────────────────────
function _renderList() {
  const list = $('wo-records-list');
  if (!list) return;

  if (_allRecords.length === 0) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center mb-4">
          <i class="fa-solid fa-dumbbell text-2xl text-indigo-400"></i>
        </div>
        <p class="text-gray-400 text-sm font-medium">Még nincs edzés naplózva!</p>
        <p class="text-xs text-gray-300 dark:text-gray-600 mt-1">Válassz egy edzésprogramot vagy koppints a + gombra!</p>
      </div>`;
    return;
  }

  list.innerHTML = _allRecords.map(r => _cardHTML(r)).join('');

  list.querySelectorAll('[data-wo-delete]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.woDelete;
      if (id) _deleteRecord(id);
    });
  });
}

function _cardHTML(r) {
  const sport = getSportById(r.sportId || 'strength_training');
  const exerciseLines = r.exercises
    ? r.exercises.split('\n').filter(l => l.trim() !== '')
    : [];
  const exCount  = exerciseLines.length;
  const duration = r.duration ? `${r.duration} perc` : '—';
  const noteHTML = r.notes
    ? `<p class="text-xs text-gray-400 truncate mt-0.5">${_esc(r.notes)}</p>`
    : '';

  return `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
      <div class="flex-shrink-0 w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
        <i class="${sport.icon} text-indigo-600 dark:text-indigo-400 text-base"></i>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-gray-900 dark:text-white text-sm truncate">${_esc(r.name || sport.name)}</span>
          <span class="text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 rounded-full px-2.5 py-0.5 font-semibold">${_esc(duration)}</span>
        </div>
        <p class="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
          <span>${_esc(r.date || '')}</span>
          <span>·</span>
          <span class="text-indigo-500 font-medium">${sport.name}</span>
        </p>
        ${noteHTML}
      </div>

      <div class="flex-shrink-0 text-right flex flex-col items-end gap-1">
        <span class="text-xs text-indigo-500 dark:text-indigo-400 font-bold whitespace-nowrap">${exCount} gyakorlat</span>
        <button
          data-wo-delete="${r.id}"
          class="text-gray-300 hover:text-red-500 transition-colors p-1"
          aria-label="Törlés"
        >
          <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
        </button>
      </div>
    </div>`;
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _deleteRecord(id) {
  if (!_uid) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'workouts', id));
  } catch (err) {
    console.error('[workout] delete error', err);
  }
}

// ── Rutinok & Gyakorlattár Modal ────────────────────────────
function _openRoutinesModal() {
  const modal = $('wo-routines-modal');
  const sheet = $('wo-routines-sheet');
  if (!modal || !sheet) return;

  _renderRoutinesModalList();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeRoutinesModal() {
  const modal = $('wo-routines-modal');
  const sheet = $('wo-routines-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _renderRoutinesModalList() {
  const listEl = $('wo-routines-list');
  if (!listEl) return;

  const allRoutines = [...DEFAULT_ROUTINES, ..._customRoutines];

  listEl.innerHTML = allRoutines.map((routine, idx) => {
    const sport = getSportById(routine.sportId || 'strength_training');
    return `
      <div class="p-4 rounded-3xl bg-gray-50 dark:bg-slate-800/80 border border-gray-100 dark:border-slate-700/60 mb-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <i class="${sport.icon} text-indigo-500 text-sm"></i>
            <h4 class="text-sm font-bold text-gray-900 dark:text-white">${_esc(routine.name)}</h4>
          </div>
          <span class="text-xs text-gray-400 font-medium">${routine.duration || 60} perc</span>
        </div>

        <div class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line bg-white dark:bg-slate-900 p-3 rounded-2xl border border-gray-100 dark:border-slate-800 mb-3 font-mono text-[11px] leading-relaxed">
          ${_esc(routine.exercises || '')}
        </div>

        <button class="wo-apply-routine-btn w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
          data-routine='${JSON.stringify(routine).replace(/'/g, "&apos;")}'>
          <i class="fa-solid fa-arrow-down-to-bracket"></i> Beemelés a mai edzésbe
        </button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.wo-apply-routine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const routine = JSON.parse(btn.dataset.routine);
        _applyRoutineToToday(routine);
      } catch (err) {
        console.error(err);
      }
    });
  });
}

// 1 kattintásos beemelés a mai naplóba
async function _applyRoutineToToday(routine) {
  if (!_uid) return;
  const today = _isoDate(new Date());

  try {
    await addDoc(collection(db, 'users', _uid, 'workouts'), {
      name: routine.name,
      sportId: routine.sportId || 'strength_training',
      duration: routine.duration || 60,
      exercises: routine.exercises || '',
      notes: routine.notes ? `[Rutinból]: ${routine.notes}` : 'Edzésprogramból beemelve',
      date: today,
      createdAt: serverTimestamp(),
    });
    _closeRoutinesModal();
  } catch (err) {
    console.error('[workout] apply routine error:', err);
  }
}

// ── Kézi edzésrögzítés Modal ────────────────────────────────
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
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
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

  const sportSelect = $('wo-sport-select');
  if (sportSelect) sportSelect.value = 'strength_training';
}

async function _saveRecord() {
  if (!_uid) return;

  const nameEl      = $('wo-input-name');
  const dateEl      = $('wo-input-date');
  const durEl       = $('wo-input-duration');
  const exercisesEl = $('wo-input-exercises');
  const notesEl     = $('wo-input-notes');
  const sportSelect = $('wo-sport-select');
  const saveBtn     = $('wo-save-btn');

  const sportId   = sportSelect ? sportSelect.value : 'strength_training';
  const sport     = getSportById(sportId);
  const name      = nameEl ? (nameEl.value.trim() || sport.name) : sport.name;
  const date      = dateEl ? dateEl.value.trim() : _isoDate(new Date());
  const duration  = durEl ? Number(durEl.value) || 0 : 0;
  const exercises = exercisesEl ? exercisesEl.value.trim() : '';
  const notes     = notesEl ? notesEl.value.trim() : '';

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'workouts'), {
      name,
      sportId,
      date,
      duration,
      exercises,
      notes,
      createdAt: serverTimestamp(),
    });
    _closeModal();
  } catch (err) {
    console.error('[workout] save error', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Edzés mentése';
    }
  }
}

// ── UI és Eseménykezelők bekötése ──────────────────────────
function _bindUI() {
  // Garmin sportágak feltöltése a legördülő menübe
  const sportSelect = $('wo-sport-select');
  if (sportSelect) {
    sportSelect.innerHTML = GARMIN_SPORTS.map(s => `
      <option value="${s.id}">${s.name} (${s.cat})</option>
    `).join('');
  }

  // Rutinok gomb
  const routinesBtn = $('wo-open-routines-btn');
  if (routinesBtn) routinesBtn.addEventListener('click', _openRoutinesModal);

  const routinesClose = $('wo-routines-close');
  const routinesBackdrop = $('wo-routines-backdrop');
  if (routinesClose) routinesClose.addEventListener('click', _closeRoutinesModal);
  if (routinesBackdrop) routinesBackdrop.addEventListener('click', _closeRoutinesModal);

  // Új rutin mentése gomb
  const saveCustomRoutineBtn = $('wo-save-custom-routine-btn');
  if (saveCustomRoutineBtn) {
    saveCustomRoutineBtn.addEventListener('click', async () => {
      const name = $('wo-new-routine-name')?.value.trim();
      const exercises = $('wo-new-routine-exercises')?.value.trim();
      const duration = parseInt($('wo-new-routine-duration')?.value) || 60;
      const sportId = $('wo-new-routine-sport')?.value || 'strength_training';

      if (!name || !exercises) return;

      try {
        await addDoc(collection(db, 'users', _uid, 'workoutRoutines'), {
          name, exercises, duration, sportId, createdAt: serverTimestamp()
        });
        $('wo-new-routine-name').value = '';
        $('wo-new-routine-exercises').value = '';
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Kézi edzés hozzáadása (FAB + modal)
  const fab = $('wo-fab');
  if (fab) fab.addEventListener('click', _openModal);

  const backdrop = $('wo-modal-backdrop');
  const closeBtn = $('wo-modal-close');
  if (backdrop) backdrop.addEventListener('click', _closeModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);

  const saveBtn = $('wo-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _saveRecord);
}
