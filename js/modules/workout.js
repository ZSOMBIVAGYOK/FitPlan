// ============================================================
// workout.js — Edzésnapló, Garmin Sportágak & Edzésprogramok
// FitPlan Pro | Indigo téma
// Gyakorlattár, Rutinok, Felszereléskezelő (Gear) & Garmin Datafields
// ============================================================

import { db } from '../firebase-config.js';
import {
  GARMIN_SPORTS,
  getSportById,
  GARMIN_DATAFIELDS,
  getDatafieldById,
  DEFAULT_EXERCISES
} from '../garmin-sports.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── DOM segéd ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Beépített minta edzésprogramok (max 1 minta edzés, törölhető) ────
const DEFAULT_ROUTINES = [
  {
    id: 'default_routine_1',
    isSample: true,
    name: 'Push Nap (Mell, Váll, Tricepsz)',
    sportId: 'strength_training',
    duration: 65,
    exercises: 'Fekvenyomás rúddal 4 × 8 (80 kg)\nFerdepados kézisúlyzós nyomás 3 × 10 (26 kg)\nVállból nyomás ülve 3 × 10 (20 kg)\nOldalemelés kézisúllyal 4 × 15 (10 kg)\nTricepsz letolás csigán 3 × 12 (35 kg)',
    notes: 'Kiváló feszülés a mellizmokban, progresszív terhelés'
  }
];

function _getDeletedSampleIds(key) {
  try {
    const userKey = _uid ? `lockin_deleted_sample_${key}_${_uid}` : `lockin_deleted_sample_${key}_default`;
    const raw = localStorage.getItem(userKey) || localStorage.getItem(`lockin_deleted_sample_${key}_default`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function _markSampleDeleted(key, id) {
  try {
    const list = _getDeletedSampleIds(key);
    if (!list.includes(id)) {
      list.push(id);
      const userKey = _uid ? `lockin_deleted_sample_${key}_${_uid}` : `lockin_deleted_sample_${key}_default`;
      localStorage.setItem(userKey, JSON.stringify(list));
      localStorage.setItem(`lockin_deleted_sample_${key}_default`, JSON.stringify(list));
    }
  } catch (e) {
    console.error('Error saving deleted sample:', e);
  }
}

// ── Belső állapot ──────────────────────────────────────────
let _uid = null;
let _unsubWorkouts = null;
let _unsubRoutines = null;
let _unsubExercises = null;
let _unsubGears = null;

let _allRecords = [];
let _customRoutines = [];
let _currentRoutinesList = [];
let _exercises = [];
let _gears = [];
let _datafieldsRows = []; // [{ id, fieldId, value }]
let _activeExerciseCat = 'all';

let _uiInitialized = false;

// ── Dátum segéd ────────────────────────────────────────────
function _isoDate(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getAllExercises() {
  return [...DEFAULT_EXERCISES, ..._exercises];
}

export function getGearsList() {
  return [..._gears];
}

// ── Publikus API ───────────────────────────────────────────
export function initWorkout(uid) {
  _uid = uid;
  _allRecords = [];
  _customRoutines = [];
  _exercises = [];
  _gears = [];
  _datafieldsRows = [];

  if (!_uiInitialized) {
    _bindUI();
    _uiInitialized = true;
  }
  _subscribe();
}

export function destroyWorkout() {
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRoutines) { _unsubRoutines(); _unsubRoutines = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }
  if (_unsubGears) { _unsubGears(); _unsubGears = null; }

  _uid = null;
  _allRecords = [];
  _customRoutines = [];
  _exercises = [];
  _gears = [];
  _datafieldsRows = [];

  const list = $('wo-records-list');
  if (list) list.innerHTML = '';
  _renderStats();
}

// ── Firestore feliratkozások ───────────────────────────────
function _subscribe() {
  if (!_uid) return;

  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRoutines) { _unsubRoutines(); _unsubRoutines = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }
  if (_unsubGears) { _unsubGears(); _unsubGears = null; }

  // 1. Edzések
  const qW = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qW, snap => {
    _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allWorkoutsWorkout = _allRecords;
    _renderList();
    _renderStats();
  }, err => console.error('[workout] onSnapshot error', err));

  // 2. Mentett edzésprogramok
  const qR = query(collection(db, 'users', _uid, 'workoutRoutines'), orderBy('createdAt', 'desc'));
  _unsubRoutines = onSnapshot(qR, snap => {
    _customRoutines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderRoutinesModalList();
  }, err => console.error('[workout] routines onSnapshot error', err));

  // 3. Gyakorlattár (Exercise Library)
  const qEx = query(collection(db, 'users', _uid, 'exercises'), orderBy('createdAt', 'desc'));
  _unsubExercises = onSnapshot(qEx, snap => {
    _exercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const exModal = $('wo-exercises-modal');
    if (exModal && !exModal.classList.contains('hidden')) {
      const q = $('wo-ex-search')?.value || '';
      _renderExercisesList(q);
    }
    // Esemény küldése a PR Hub és egyéb modulok számára az új gyakorlatokról
    window.dispatchEvent(new CustomEvent('fitplan:exercises-updated', {
      detail: { exercises: getAllExercises() }
    }));
  }, err => console.error('[workout] exercises onSnapshot error', err));

  // 4. Felszerelés (Gear Tracker)
  const qG = query(collection(db, 'users', _uid, 'gear'), orderBy('createdAt', 'desc'));
  _unsubGears = onSnapshot(qG, snap => {
    _gears = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _populateGearSelect();
    const gearModal = $('wo-gear-modal');
    if (gearModal && !gearModal.classList.contains('hidden')) {
      _renderGearModalList();
    }
  }, err => console.error('[workout] gear onSnapshot error', err));
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

  list.querySelectorAll('.workout-item-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-wo-delete]')) return;
      const id = card.dataset.id;
      if (id && typeof window.openWorkoutDetailModal === 'function') {
        window.openWorkoutDetailModal(id);
      }
    });
  });

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

  // Datafields HTML
  const datafieldsHTML = (Array.isArray(r.datafields) && r.datafields.length > 0)
    ? `<div class="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-gray-100 dark:border-slate-800">
        ${r.datafields.map(df => `
          <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-100/60 dark:border-indigo-900/40">
            <i class="${df.icon || 'fa-solid fa-chart-simple'} text-[9px]"></i>
            <span>${_esc(df.value)} ${df.unit ? _esc(df.unit) : ''}</span>
          </span>
        `).join('')}
      </div>`
    : '';

  // Distance & Gear Badge
  const distanceBadge = (r.distance && r.distance > 0)
    ? `<span class="text-[10px] bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300 rounded-full px-2.5 py-0.5 font-semibold"><i class="fa-solid fa-route mr-1"></i>${r.distance} km</span>`
    : '';

  const gearBadge = r.gearName
    ? `<span class="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full px-2.5 py-0.5 font-semibold"><i class="fa-solid fa-shoe-prints mr-1"></i>${_esc(r.gearName)}</span>`
    : '';

  return `
    <div class="workout-item-card cursor-pointer bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl shadow-sm p-4 hover:shadow-md transition-shadow" data-id="${r.id}">
      <div class="flex items-center gap-3">
        <div class="flex-shrink-0 w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
          <i class="${sport.icon} text-indigo-600 dark:text-indigo-400 text-base"></i>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-bold text-gray-900 dark:text-white text-sm truncate">${_esc(r.name || sport.name)}</span>
            <span class="text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 rounded-full px-2.5 py-0.5 font-semibold">${_esc(duration)}</span>
            ${distanceBadge}
            ${gearBadge}
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
      </div>

      ${datafieldsHTML}
    </div>`;
}

async function _deleteRecord(id) {
  if (!_uid) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'workouts', id));
  } catch (err) {
    console.error('[workout] delete error', err);
  }
}

// ── Rutinok & Edzésprogramok Modal ──────────────────────────
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

  const deletedSampleIds = _getDeletedSampleIds('routines');
  const activeDefaultRoutines = (DEFAULT_ROUTINES || []).filter(r => !deletedSampleIds.includes(r.id) && !deletedSampleIds.includes(r.name));
  const allRoutines = [...activeDefaultRoutines, ..._customRoutines];
  _currentRoutinesList = allRoutines;

  if (allRoutines.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Nincs elérhető edzésprogram.</p>`;
    return;
  }

  listEl.innerHTML = allRoutines.map((routine, idx) => {
    const sport = getSportById(routine.sportId || 'strength_training');
    const isCustom = Boolean(routine.id && !routine.isSample);
    return `
      <div class="p-4 rounded-3xl bg-gray-50 dark:bg-slate-800/80 border border-gray-100 dark:border-slate-700/60 mb-3 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <i class="${sport.icon} text-indigo-500 text-sm"></i>
            <h4 class="text-sm font-bold text-gray-900 dark:text-white">${_esc(routine.name)}</h4>
            <span class="text-[9px] px-2 py-0.5 rounded-full font-semibold ${isCustom ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'}">
              ${isCustom ? 'Saját' : 'Minta'}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-400 font-medium">${routine.duration || 60} perc</span>
            ${isCustom ? `
              <button class="wo-delete-custom-routine-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${routine.id}" title="Program törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            ` : `
              <button class="wo-delete-custom-routine-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${routine.id || routine.name}" data-is-sample="true" title="Minta program törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            `}
          </div>
        </div>

        <div class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line bg-white dark:bg-slate-900 p-3 rounded-2xl border border-gray-100 dark:border-slate-800 mb-3 font-mono text-[11px] leading-relaxed">
          ${_esc(routine.exercises || '')}
        </div>

        <button class="wo-apply-routine-btn w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
          data-index="${idx}">
          <i class="fa-solid fa-arrow-down-to-bracket pointer-events-none"></i> Beemelés a mai edzésbe
        </button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.wo-apply-routine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      const routine = _currentRoutinesList[idx];
      if (routine) {
        _applyRoutineToToday(routine);
      }
    });
  });

  listEl.querySelectorAll('.wo-delete-custom-routine-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const isSample = btn.dataset.isSample === 'true';
      if (isSample) {
        _markSampleDeleted('routines', id);
        _renderRoutinesModalList();
        return;
      }
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'workoutRoutines', id));
        } catch (err) {
          console.error('[workout] Routine delete error:', err);
        }
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

// ── Gyakorlattár (Exercise Library) Modal ───────────────────
function _openExercisesModal() {
  const modal = $('wo-exercises-modal');
  const sheet = $('wo-exercises-sheet');
  if (!modal || !sheet) return;

  _activeExerciseCat = 'all';
  _updateExerciseCategoryFilterButtons();
  _renderExercisesList();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeExercisesModal() {
  const modal = $('wo-exercises-modal');
  const sheet = $('wo-exercises-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _updateExerciseCategoryFilterButtons() {
  document.querySelectorAll('.wo-ex-filter-btn').forEach(btn => {
    const cat = btn.dataset.cat || 'all';
    const active = cat === _activeExerciseCat;
    btn.className = `wo-ex-filter-btn flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
      active
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400'
    }`;
  });
}

function _renderExercisesList(searchQuery = '') {
  const listEl = $('wo-exercises-items');
  if (!listEl) return;

  const q = searchQuery.toLowerCase().trim();
  const all = getAllExercises();

  const filtered = all.filter(ex => {
    const matchCat = (_activeExerciseCat === 'all') || (ex.category === _activeExerciseCat);
    const matchSearch = !q || (ex.name && ex.name.toLowerCase().includes(q)) || (ex.targetMuscle && ex.targetMuscle.toLowerCase().includes(q));
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Nincs találat a keresési feltételekre.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(ex => {
    const isCustom = Boolean(ex.id && !DEFAULT_EXERCISES.some(d => d.id === ex.id));
    const sport = getSportById(ex.sportId || 'strength_training');
    return `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/80 hover:bg-indigo-50/50 transition-colors">
        <div class="flex items-center gap-2.5 flex-1 min-w-0 pr-2">
          <div class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
            <i class="${sport.icon} text-xs"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-bold text-gray-900 dark:text-white truncate">${_esc(ex.name)}</span>
              <span class="text-[9px] bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-semibold">${ex.category || 'Erőnlét'}</span>
              ${isCustom ? '<span class="text-[9px] bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full font-semibold">Saját</span>' : ''}
            </div>
            ${ex.targetMuscle ? `<p class="text-[10px] text-gray-400 mt-0.5">${_esc(ex.targetMuscle)}</p>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button class="wo-insert-exercise-to-form-btn px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] active:scale-95 transition-all flex items-center gap-1 shadow-sm"
            data-name="${_esc(ex.name)}">
            <i class="fa-solid fa-plus text-[9px] pointer-events-none"></i>
            <span>Beszúrás</span>
          </button>
          ${isCustom ? `
            <button class="wo-delete-exercise-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${ex.id}" title="Gyakorlat törlése">
              <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.wo-insert-exercise-to-form-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exName = btn.dataset.name;
      _insertExerciseIntoActiveForm(exName);
      _closeExercisesModal();
    });
  });

  listEl.querySelectorAll('.wo-delete-exercise-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'exercises', id));
        } catch (err) {
          console.error('[workout] exercise delete error:', err);
        }
      }
    });
  });
}

function _createWorkoutModuleExerciseStrip(exerciseName) {
  const row = document.createElement('div');
  const escName = (exerciseName || 'Gyakorlat').replace(/"/g, '&quot;');
  row.className = 'wo-structured-ex-row p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all';
  row.dataset.name = exerciseName;
  row.innerHTML = `
    <div class="flex items-center justify-between sm:justify-start gap-2.5 min-w-0 flex-1">
      <div class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs flex-shrink-0">
        <i class="fa-solid fa-dumbbell"></i>
      </div>
      <div class="min-w-0 flex-1">
        <h5 class="wo-ex-name-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate" title="${escName}">${escName}</h5>
        <p class="text-[10px] text-gray-400 font-medium truncate">Gyakorlat</p>
      </div>
      <button type="button" class="wo-remove-ex-row-btn sm:hidden w-7 h-7 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" title="Eltávolítás">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
    <div class="flex items-center gap-2 justify-end flex-shrink-0">
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700">
        <input type="number" step="0.5" min="0" placeholder="—" value=""
               class="wo-ex-weight w-12 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Súly (kg)" />
        <span class="text-[10px] text-gray-400 font-bold select-none">kg</span>
      </div>
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700">
        <input type="number" min="1" max="99" value="4"
               class="wo-ex-sets w-8 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Sorozatok száma" />
        <span class="text-[10px] text-gray-400 font-bold select-none">sor.</span>
      </div>
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700">
        <input type="number" min="1" max="999" value="10"
               class="wo-ex-reps w-10 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Ismétlések száma" />
        <span class="text-[10px] text-gray-400 font-bold select-none">ism.</span>
      </div>
      <button type="button" class="wo-remove-ex-row-btn hidden sm:flex w-7 h-7 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 items-center justify-center transition-colors" title="Eltávolítás">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `;
  row.querySelectorAll('.wo-remove-ex-row-btn').forEach(btn => btn.onclick = () => row.remove());
  return row;
}

function _insertExerciseIntoActiveForm(exerciseName) {
  const routineModal = $('wo-routines-modal');
  const routineContainer = $('wo-routine-structured-exercises-container');
  if (routineModal && !routineModal.classList.contains('hidden') && routineContainer) {
    routineContainer.appendChild(_createWorkoutModuleExerciseStrip(exerciseName));
    window._activeExerciseTarget = null;
    return;
  }

  const protoModal = $('rec-protocols-modal');
  const protoContainer = $('rec-proto-structured-exercises-container');
  if (protoModal && !protoModal.classList.contains('hidden') && protoContainer) {
    protoContainer.appendChild(_createWorkoutModuleExerciseStrip(exerciseName));
    window._activeExerciseTarget = null;
    return;
  }

  const detailModal = $('wo-detail-modal');
  const isDetailOpen = detailModal && !detailModal.classList.contains('hidden');
  const detailContainer = $('wo-detail-exercises-container');
  if (isDetailOpen && detailContainer) {
    if (typeof window._createDetailExerciseRow === 'function') {
      detailContainer.appendChild(window._createDetailExerciseRow({
        name: exerciseName,
        sets: 4,
        reps: 10,
        weight: ''
      }));
    } else {
      detailContainer.appendChild(_createWorkoutModuleExerciseStrip(exerciseName));
    }
    window._activeExerciseTarget = null;
    return;
  }

  const woModal = $('wo-modal');
  const structuredContainer = $('wo-structured-exercises-container');
  if (woModal && !woModal.classList.contains('hidden') && structuredContainer) {
    structuredContainer.appendChild(_createWorkoutModuleExerciseStrip(exerciseName));
    return;
  }

  // Otherwise, open wo-modal with this exercise prefilled as a strip
  _openModal();
  setTimeout(() => {
    const sc = $('wo-structured-exercises-container');
    if (sc) sc.appendChild(_createWorkoutModuleExerciseStrip(exerciseName));
  }, 100);
}

async function _saveNewExercise() {
  if (!_uid) return;
  const nameIn = $('wo-new-ex-name');
  const catIn = $('wo-new-ex-cat');
  const muscleIn = $('wo-new-ex-muscle');
  const saveBtn = $('wo-save-new-ex-btn');

  const name = nameIn?.value.trim();
  if (!name) {
    if (nameIn) {
      nameIn.style.borderColor = '#ef4444';
      nameIn.focus();
      setTimeout(() => { nameIn.style.borderColor = ''; }, 1500);
    }
    return;
  }

  const category = catIn?.value || 'Erőnlét';
  const targetMuscle = muscleIn?.value.trim() || '';

  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, 'users', _uid, 'exercises'), {
      name,
      category,
      targetMuscle,
      createdAt: serverTimestamp()
    });
    if (nameIn) nameIn.value = '';
    if (muscleIn) muscleIn.value = '';
  } catch (err) {
    console.error('[workout] save exercise error:', err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Felszereléskezelő (Gear Tracker) Modal ───────────────────
function _openGearModal() {
  if (typeof window.openGearModal === 'function') {
    window.openGearModal();
    return;
  }
  const modal = $('wo-gear-modal');
  const sheet = $('wo-gear-sheet');
  if (!modal || !sheet) return;

  _renderGearModalList();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeGearModal() {
  const modal = $('wo-gear-modal');
  const sheet = $('wo-gear-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _renderGearModalList() {
  if (typeof window.renderGearShelf === 'function') {
    window.renderGearShelf();
    return;
  }
  const listEl = $('wo-gear-list');
  if (!listEl) return;

  if (_gears.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Még nem regisztráltál felszerelést (pl. futócipő, kerékpár).</p>`;
    return;
  }

  const typeIcons = {
    shoes: 'fa-solid fa-shoe-prints',
    bike: 'fa-solid fa-bicycle',
    device: 'fa-solid fa-clock',
    other: 'fa-solid fa-gear'
  };

  const typeLabels = {
    shoes: 'Cipő',
    bike: 'Kerékpár',
    device: 'Óra / Eszköz',
    other: 'Egyéb'
  };

  listEl.innerHTML = _gears.map(g => {
    const icon = typeIcons[g.type] || typeIcons.other;
    const label = typeLabels[g.type] || typeLabels.other;
    const totalKm = Math.round((g.totalKm || 0) * 10) / 10;
    const totalHours = Math.round((g.totalHours || 0) * 10) / 10;
    const maxKm = g.maxKm ? Number(g.maxKm) : null;
    const pct = maxKm ? Math.min(100, Math.round((totalKm / maxKm) * 100)) : null;

    return `
      <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-800/80 border border-gray-100 dark:border-slate-700/60 shadow-sm">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-2.5 min-w-0 pr-2">
            <div class="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <i class="${icon} text-sm"></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">${_esc(g.name)}</h4>
                <span class="text-[9px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full font-semibold">${label}</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-0.5">
                <span class="font-bold text-gray-700 dark:text-gray-200">${totalKm} km</span> · <span class="font-bold text-gray-700 dark:text-gray-200">${totalHours} óra</span>
                ${maxKm ? ` / ${maxKm} km (${pct}%)` : ''}
              </p>
            </div>
          </div>
          <button class="wo-delete-gear-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${g.id}" title="Felszerelés törlése">
            <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
          </button>
        </div>

        ${maxKm ? `
          <div class="w-full bg-gray-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-2">
            <div class="${pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-indigo-600'} h-full rounded-full transition-all" style="width: ${pct}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.wo-delete-gear-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'gear', id));
        } catch (err) {
          console.error('[workout] gear delete error:', err);
        }
      }
    });
  });
}

function _populateGearSelect() {
  const select = $('wo-gear-select');
  if (!select) return;

  const curVal = select.value;
  select.innerHTML = `
    <option value="">Nincs megadva</option>
    ${_gears.map(g => `
      <option value="${g.id}">
        ${g.name} (${Math.round((g.totalKm || 0) * 10) / 10} km)
      </option>
    `).join('')}
  `;
  if (curVal) select.value = curVal;
}

async function _saveNewGear() {
  if (!_uid) return;
  const nameIn = $('wo-new-gear-name');
  const typeIn = $('wo-new-gear-type');
  const maxKmIn = $('wo-new-gear-maxkm');
  const initKmIn = $('wo-new-gear-initkm');
  const initHoursIn = $('wo-new-gear-inithours');
  const saveBtn = $('wo-save-gear-btn');

  const name = nameIn?.value.trim();
  if (!name) {
    if (nameIn) {
      nameIn.style.borderColor = '#ef4444';
      nameIn.focus();
      setTimeout(() => { nameIn.style.borderColor = ''; }, 1500);
    }
    return;
  }

  const type = typeIn?.value || 'shoes';
  const maxKm = parseFloat(maxKmIn?.value) || null;
  const totalKm = parseFloat(initKmIn?.value) || 0;
  const totalHours = parseFloat(initHoursIn?.value) || 0;

  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, 'users', _uid, 'gear'), {
      name,
      type,
      maxKm,
      totalKm,
      totalHours,
      createdAt: serverTimestamp()
    });
    if (nameIn) nameIn.value = '';
    if (maxKmIn) maxKmIn.value = '';
    if (initKmIn) initKmIn.value = '';
    if (initHoursIn) initHoursIn.value = '';
  } catch (err) {
    console.error('[workout] save gear error:', err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Garmin Datafields Dinamikus Kezelés ──────────────────────
function _renderDatafieldRows() {
  const container = $('wo-datafields-container');
  if (!container) return;

  if (_datafieldsRows.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-400 italic py-1 text-center">Nincs hozzáadott adatmező. Kattints a + gombra!</p>`;
    return;
  }

  container.innerHTML = _datafieldsRows.map((row, idx) => {
    const curDf = getDatafieldById(row.fieldId);
    return `
      <div class="flex items-center gap-2 p-2 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/40 rounded-xl" data-row-index="${idx}">
        <select class="wo-df-select bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 flex-1 max-w-[50%] focus:outline-none">
          ${GARMIN_DATAFIELDS.map(df => `
            <option value="${df.id}" ${df.id === row.fieldId ? 'selected' : ''}>
              ${df.name} (${df.unit || df.cat})
            </option>
          `).join('')}
        </select>

        <input type="text" class="wo-df-input bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-center flex-1 text-gray-800 dark:text-gray-100 focus:outline-none"
          placeholder="${curDf.placeholder || 'Érték'}" value="${_esc(row.value)}" />

        <span class="wo-df-unit-badge text-[10px] text-gray-400 font-semibold w-12 text-center truncate">${curDf.unit || ''}</span>

        <button type="button" class="wo-df-del-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-row-index="${idx}" title="Eltávolítás">
          <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.wo-df-select').forEach((sel, idx) => {
    sel.addEventListener('change', () => {
      _datafieldsRows[idx].fieldId = sel.value;
      const df = getDatafieldById(sel.value);
      const rowEl = sel.closest('[data-row-index]');
      if (rowEl) {
        const input = rowEl.querySelector('.wo-df-input');
        const unitBadge = rowEl.querySelector('.wo-df-unit-badge');
        if (input) input.placeholder = df.placeholder || 'Érték';
        if (unitBadge) unitBadge.textContent = df.unit || '';
      }
    });
  });

  container.querySelectorAll('.wo-df-input').forEach((input, idx) => {
    input.addEventListener('input', () => {
      _datafieldsRows[idx].value = input.value;
    });
  });

  container.querySelectorAll('.wo-df-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.rowIndex, 10);
      _datafieldsRows.splice(idx, 1);
      _renderDatafieldRows();
    });
  });
}

function _addDatafieldRow(defaultFieldId = 'avg_hr') {
  _datafieldsRows.push({
    fieldId: defaultFieldId,
    value: ''
  });
  _renderDatafieldRows();
}

// ── Kézi edzésrögzítés Modal ────────────────────────────────
function _openModal() {
  _resetForm();
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) return;

  _populateGearSelect();

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
    ['wo-input-distance',  ''],
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

  const gearSelect = $('wo-gear-select');
  if (gearSelect) gearSelect.value = '';

  _datafieldsRows = [];
  _renderDatafieldRows();
}

async function _saveRecord() {
  if (!_uid) return;

  const nameEl      = $('wo-input-name');
  const dateEl      = $('wo-input-date');
  const durEl       = $('wo-input-duration');
  const distEl      = $('wo-input-distance');
  const gearSelect  = $('wo-gear-select');
  const exercisesEl = $('wo-input-exercises');
  const notesEl     = $('wo-input-notes');
  const sportSelect = $('wo-sport-select');
  const saveBtn     = $('wo-save-btn');

  const sportId   = sportSelect ? sportSelect.value : 'strength_training';
  const sport     = getSportById(sportId);
  const name      = nameEl ? (nameEl.value.trim() || sport.name) : sport.name;
  const date      = dateEl ? dateEl.value.trim() : _isoDate(new Date());
  const duration  = durEl ? Number(durEl.value) || 0 : 0;
  const distance  = distEl ? parseFloat(distEl.value) || 0 : 0;
  const gearId    = gearSelect ? gearSelect.value || null : null;
  const exercises = exercisesEl ? exercisesEl.value.trim() : '';
  const notes     = notesEl ? notesEl.value.trim() : '';

  let gearIds = [];
  if (typeof window !== 'undefined' && window._selectedWorkoutGearIds && window._selectedWorkoutGearIds.size > 0) {
    gearIds = Array.from(window._selectedWorkoutGearIds);
  } else if (gearId) {
    gearIds = [gearId];
  }
  const gearNames = gearIds.map(id => _gears.find(g => g.id === id)?.name).filter(Boolean);

  let gearName = gearNames[0] || null;
  if (!gearName && gearId) {
    const selectedGear = _gears.find(g => g.id === gearId);
    gearName = selectedGear ? selectedGear.name : null;
  }

  const datafields = _datafieldsRows
    .filter(r => r.value && r.value.trim() !== '')
    .map(r => {
      const def = getDatafieldById(r.fieldId);
      return {
        id: def.id,
        name: def.name,
        value: r.value.trim(),
        unit: def.unit || '',
        icon: def.icon || 'fa-solid fa-chart-simple'
      };
    });

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés folyamatban...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'workouts'), {
      name,
      sportId,
      date,
      duration,
      distance: distance > 0 ? distance : null,
      gearId,
      gearName,
      gearIds,
      gearNames,
      exercises,
      notes,
      datafields,
      createdAt: serverTimestamp(),
    });

    // Ha van kiválasztott felszerelés, kilométer és üzemóra automatikus gyűjtése minden felszereléshez
    if (gearIds.length > 0 && (distance > 0 || duration > 0)) {
      for (const gid of gearIds) {
        try {
          const gearRef = doc(db, 'users', _uid, 'gear', gid);
          const updates = {};
          if (distance > 0) updates.totalKm = increment(distance);
          if (duration > 0) updates.totalHours = increment(Math.round((duration / 60) * 100) / 100);
          await updateDoc(gearRef, updates);
        } catch (gearErr) {
          console.warn('[workout] Gear accumulation error:', gearErr);
        }
      }
    }

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
  // Garmin sportágak feltöltése
  const sportSelect = $('wo-sport-select');
  if (sportSelect) {
    sportSelect.innerHTML = GARMIN_SPORTS.map(s => `
      <option value="${s.id}">${s.name} (${s.cat})</option>
    `).join('');
  }

  const newRoutineSportSelect = $('wo-new-routine-sport');
  if (newRoutineSportSelect) {
    newRoutineSportSelect.innerHTML = GARMIN_SPORTS.map(s => `
      <option value="${s.id}">${s.name}</option>
    `).join('');
  }

  // Rutinok gombok
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
      const container = $('wo-routine-structured-exercises-container');
      let exercises = '';
      if (container) {
        const lines = [];
        container.querySelectorAll('.wo-structured-ex-row').forEach(row => {
          const exName = row.dataset.name || row.querySelector('.wo-ex-name-display')?.textContent.trim() || 'Gyakorlat';
          const sets = parseInt(row.querySelector('.wo-ex-sets')?.value, 10) || 1;
          const reps = parseInt(row.querySelector('.wo-ex-reps')?.value, 10) || 1;
          const weightVal = row.querySelector('.wo-ex-weight')?.value.trim();
          const weight = weightVal ? parseFloat(weightVal) : null;
          lines.push(`${exName}: ${sets} × ${reps}${weight ? ` (${weight} kg)` : ''}`);
        });
        exercises = lines.join('\n');
      }
      if (!exercises) {
        exercises = $('wo-new-routine-exercises')?.value.trim() || '';
      }
      const duration = parseInt($('wo-new-routine-duration')?.value) || 60;
      const sportId = $('wo-new-routine-sport')?.value || 'strength_training';

      if (!name || !exercises) return;

      try {
        await addDoc(collection(db, 'users', _uid, 'workoutRoutines'), {
          name, exercises, duration, sportId, createdAt: serverTimestamp()
        });
        if ($('wo-new-routine-name')) $('wo-new-routine-name').value = '';
        if ($('wo-new-routine-exercises')) $('wo-new-routine-exercises').value = '';
        if (container) container.innerHTML = '';
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Gyakorlattár gombok
  const exercisesBtn = $('wo-open-exercises-btn');
  if (exercisesBtn) exercisesBtn.addEventListener('click', () => _openExercisesModal());

  const exercisesClose = $('wo-exercises-close');
  const exercisesBackdrop = $('wo-exercises-backdrop');
  if (exercisesClose) exercisesClose.addEventListener('click', _closeExercisesModal);
  if (exercisesBackdrop) exercisesBackdrop.addEventListener('click', _closeExercisesModal);

  const saveExBtn = $('wo-save-new-ex-btn');
  if (saveExBtn) saveExBtn.addEventListener('click', _saveNewExercise);

  const exSearch = $('wo-ex-search');
  if (exSearch) {
    exSearch.addEventListener('input', e => _renderExercisesList(e.target.value));
  }

  // Gyakorlattár kategória szűrők
  document.querySelectorAll('.wo-ex-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeExerciseCat = btn.dataset.cat || 'all';
      _updateExerciseCategoryFilterButtons();
      _renderExercisesList($('wo-ex-search')?.value || '');
    });
  });

  // Felszerelés (Gear) gombok
  const gearBtn = $('wo-open-gear-btn');
  if (gearBtn) gearBtn.addEventListener('click', _openGearModal);

  const gearClose = $('wo-gear-close');
  const gearBackdrop = $('wo-gear-backdrop');
  if (gearClose) gearClose.addEventListener('click', _closeGearModal);
  if (gearBackdrop) gearBackdrop.addEventListener('click', _closeGearModal);

  const saveGearBtn = $('wo-save-gear-btn');
  if (saveGearBtn) saveGearBtn.addEventListener('click', _saveNewGear);

  // Kézi edzés hozzáadása (FAB + modal)
  const fab = $('wo-fab');
  if (fab) fab.addEventListener('click', _openModal);

  const backdrop = $('wo-modal-backdrop');
  const closeBtn = $('wo-modal-close');
  if (backdrop) backdrop.addEventListener('click', _closeModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);

  const saveBtn = $('wo-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _saveRecord);

  // Garmin Adatmező hozzáadása gomb a modálban
  const addDfBtn = $('wo-add-datafield-btn');
  if (addDfBtn) {
    addDfBtn.addEventListener('click', () => {
      _addDatafieldRow('avg_hr');
    });
  }

  // Gyakorlat vagy Gyakorlatsor beillesztése választó modál (+ gomb)
  const insertExBtn = $('wo-insert-exercise-btn');
  if (insertExBtn) {
    insertExBtn.addEventListener('click', () => {
      const picker = $('wo-exercise-or-routine-picker-modal');
      const sheet = $('wo-exercise-or-routine-picker-sheet');
      if (picker && sheet) {
        picker.classList.remove('hidden');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            sheet.style.transform = 'translateY(0)';
          });
        });
      } else {
        _openExercisesModal();
      }
    });
  }
}
