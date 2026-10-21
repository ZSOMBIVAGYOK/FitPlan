// ============================================================
// courses.js — Pályák és Hivatalos Időeredmények modul
// FitPlan Pro | Cyan / Electric Blue téma
// Edzésekhez mentett pályák, szakaszok, sportági szűrés és PR mentés
// ============================================================

import { db } from '../firebase-config.js';
import { getSportById } from '../garmin-sports.js';
import {
  collection, onSnapshot, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Belső Állapot ──────────────────────────────────────────
let _uid = null;
let _unsubWorkouts = null;
let _unsubRecords = null;
let _allWorkouts = [];
let _allRecords = [];
let _activeSportFilter = 'all'; // 'all' vagy adott sportId (pl. 'running', 'cycling')
let _searchQuery = '';
let _isInitialized = false;

const $ = id => document.getElementById(id);

function _esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Inicializálás és Leállítás ─────────────────────────────
export function initCourses(uid) {
  _uid = uid || (typeof window !== 'undefined' && window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null);
  _loadLocalData();

  if (_uid && db && !_uid.startsWith('local_')) {
    // 1. Edzések feliratkozás a pályák valós idejű frissüléséhez
    if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
    const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
    _unsubWorkouts = onSnapshot(qWorkouts, snap => {
      _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const currentMod = typeof window !== 'undefined' && window.currentModule;
      if (currentMod === 'courses') {
        renderCoursesScreen();
      }
    }, err => console.warn('[courses] Workouts sync warning:', err));

    // 2. Rekordok feliratkozás a kupa / rekord állapot valós idejű jelzéséhez
    if (_unsubRecords) { _unsubRecords(); _unsubRecords = null; }
    const qRecords = query(collection(db, 'users', _uid, 'records'), orderBy('createdAt', 'desc'));
    _unsubRecords = onSnapshot(qRecords, snap => {
      _allRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const currentMod = typeof window !== 'undefined' && window.currentModule;
      if (currentMod === 'courses') {
        renderCoursesScreen();
      }
    }, err => console.warn('[courses] Records sync warning:', err));
  }

  _setupEventListeners();
  _isInitialized = true;
}

export function destroyCourses() {
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRecords) { _unsubRecords(); _unsubRecords = null; }
  _allWorkouts = [];
  _allRecords = [];
  _activeSportFilter = 'all';
  _searchQuery = '';
}

function _loadLocalData() {
  try {
    const effUid = _uid || 'default';
    const rawWos = localStorage.getItem('lockin_custom_workouts_' + effUid);
    if (rawWos) {
      const parsed = JSON.parse(rawWos);
      if (Array.isArray(parsed)) _allWorkouts = parsed;
    }
    const rawRecs = localStorage.getItem('lockin_records_' + effUid);
    if (rawRecs) {
      const parsed = JSON.parse(rawRecs);
      if (Array.isArray(parsed)) _allRecords = parsed;
    }
  } catch (e) {
    console.warn('[courses] load local error:', e);
  }
}

// ── Pályák Begyűjtése az Összes Edzésből ──────────────────
export function getAllSavedCourses() {
  const allWosMap = new Map();

  // 1. Saját belső edzéslista
  _allWorkouts.forEach(w => {
    if (w && w.id) allWosMap.set(String(w.id), w);
  });

  // 2. Globális ablak szintű edzésforrások (Whoop5, Activity, Workout modulok)
  if (typeof window !== 'undefined') {
    const sources = [
      window._allWorkouts,
      window._allWorkoutsActivity,
      window._allWorkoutsWorkout
    ];
    sources.forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(w => {
          if (w && w.id && !allWosMap.has(String(w.id))) {
            allWosMap.set(String(w.id), w);
          }
        });
      }
    });
  }

  // 3. LocalStorage ellenőrzése
  try {
    const effUid = _uid || (typeof window !== 'undefined' && window.auth && window.auth.currentUser ? window.auth.currentUser.uid : 'default');
    const raw = localStorage.getItem('lockin_custom_workouts_' + effUid);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(w => {
          if (w && w.id && !allWosMap.has(String(w.id))) {
            allWosMap.set(String(w.id), w);
          }
        });
      }
    }
  } catch (_) {}

  const coursesList = [];

  allWosMap.forEach(workout => {
    const rawSportId = workout.sportId || (workout.sport && (workout.sport.id || workout.sport.sportId)) || 'running';
    const sport = getSportById(rawSportId);
    const workoutName = workout.name || sport.name;
    const workoutDate = workout.date || '';

    // Ha van 'courses' tömb az edzésen
    if (Array.isArray(workout.courses) && workout.courses.length > 0) {
      workout.courses.forEach((c, idx) => {
        const name = (c.name || '').trim();
        const time = (c.time || '').trim();
        if (name || time) {
          coursesList.push({
            id: `${workout.id}_c_${idx}`,
            workoutId: workout.id,
            workoutName: workoutName,
            name: name || 'Névtelen pálya',
            time: time || '—',
            date: workoutDate,
            sportId: sport.id,
            sportName: sport.name,
            sportIcon: sport.icon,
            workout: workout
          });
        }
      });
    } else if (workout.courseName || workout.courseTime) {
      // Fallback egyszerűbb rekordokhoz
      const name = (workout.courseName || '').trim();
      const time = (workout.courseTime || '').trim();
      if (name || time) {
        coursesList.push({
          id: `${workout.id}_c_0`,
          workoutId: workout.id,
          workoutName: workoutName,
          name: name || 'Névtelen pálya',
          time: time || '—',
          date: workoutDate,
          sportId: sport.id,
          sportName: sport.name,
          sportIcon: sport.icon,
          workout: workout
        });
      }
    }
  });

  // Rendezés dátum szerint csökkenő sorrendben (legfrissebb elöl)
  coursesList.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return coursesList;
}

// ── Rekord Egyezés Ellenőrzése ─────────────────────────────
function _isCourseInPersonalRecords(courseName, courseTime) {
  if (!courseName) return false;
  if (typeof window !== 'undefined' && typeof window.isCourseInPr === 'function') {
    if (window.isCourseInPr(courseName, courseTime)) return true;
  }

  const cName = courseName.toLowerCase().trim();
  const cTime = (courseTime || '').toLowerCase().trim();

  // Ellenőrizzük a helyi és Firestore rekordokat
  return _allRecords.some(r => {
    const rName = (r.name || r.exerciseName || '').toLowerCase().trim();
    const rTime = (r.duration || '').toLowerCase().trim();
    if (cTime && rTime && cTime !== '—') {
      return rName === cName && rTime === cTime;
    }
    return rName === cName;
  });
}

// ── Fő Képernyő Kirajzolása ───────────────────────────────
export function renderCoursesScreen() {
  const panel = $('panel-courses');
  if (!panel) return;

  const allCourses = getAllSavedCourses();

  // 1. Statisztikák frissítése
  const totalCount = allCourses.length;
  const uniqueSports = new Set(allCourses.map(c => c.sportId));
  const prsCount = allCourses.filter(c => _isCourseInPersonalRecords(c.name, c.time)).length;

  const totalEl = $('courses-stat-total');
  const sportsEl = $('courses-stat-sports');
  const prsEl = $('courses-stat-prs');

  if (totalEl) totalEl.textContent = totalCount;
  if (sportsEl) sportsEl.textContent = uniqueSports.size;
  if (prsEl) prsEl.textContent = prsCount;

  // 2. Alkategóriák szűrősáv (Összes, majd a sportágak)
  _renderSubcategoriesBar(allCourses);

  // 3. Pályák és Eredmények lista
  _renderCoursesList(allCourses);
}

// ── Alkategóriák Szűrősáv Kirajzolása ──────────────────────
function _renderSubcategoriesBar(allCourses) {
  const container = $('courses-subcategories-bar');
  const activeBadge = $('courses-active-filter-badge');
  if (!container) return;

  // Megszámoljuk a pályákat sportáganként
  const sportCounts = {};
  allCourses.forEach(c => {
    sportCounts[c.sportId] = (sportCounts[c.sportId] || 0) + 1;
  });

  const availableSportIds = Object.keys(sportCounts);

  // Ha az aktív szűrő már nem létezik a listában, állítsuk vissza 'all'-ra
  if (_activeSportFilter !== 'all' && !availableSportIds.includes(_activeSportFilter)) {
    _activeSportFilter = 'all';
  }

  const isAllActive = _activeSportFilter === 'all';
  if (activeBadge) {
    if (isAllActive) {
      activeBadge.textContent = 'Összes';
    } else {
      const activeSport = getSportById(_activeSportFilter);
      activeBadge.textContent = activeSport.name;
    }
  }

  // 1. Összes gomb
  let html = `
    <button type="button" class="course-subcat-chip flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 cursor-pointer ${
      isAllActive
        ? 'bg-cyan-600 text-white shadow-sm'
        : 'bg-white dark:bg-[#181A20] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#262832] hover:border-cyan-500/50'
    }" data-sport="all">
      <span>Összes</span>
      <span class="ml-1 opacity-80 text-[10px]">(${allCourses.length})</span>
    </button>
  `;

  // 2. Minden olyan sport alkategóriaként, ami már hozzá van adva
  availableSportIds.forEach(sId => {
    const sport = getSportById(sId);
    const count = sportCounts[sId];
    const isActive = _activeSportFilter === sId;

    html += `
      <button type="button" class="course-subcat-chip flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
        isActive
          ? 'bg-cyan-600 text-white shadow-sm'
          : 'bg-white dark:bg-[#181A20] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#262832] hover:border-cyan-500/50'
      }" data-sport="${_esc(sId)}">
        <i class="${sport.icon} text-xs"></i>
        <span>${_esc(sport.name)}</span>
        <span class="opacity-80 text-[10px]">(${count})</span>
      </button>
    `;
  });

  container.innerHTML = html;

  // Eseménykezelők a chipekre
  container.querySelectorAll('.course-subcat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeSportFilter = btn.dataset.sport || 'all';
      _renderSubcategoriesBar(allCourses);
      _renderCoursesList(allCourses);
    });
  });
}

// ── Pályák Listájának Kirajzolása ─────────────────────────
function _renderCoursesList(allCourses) {
  const container = $('courses-records-list');
  if (!container) return;

  // 1. Szűrés sportág (alkategória) szerint
  let filtered = allCourses;
  if (_activeSportFilter !== 'all') {
    filtered = filtered.filter(c => c.sportId === _activeSportFilter);
  }

  // 2. Keresés szöveg szerint
  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase().trim();
    filtered = filtered.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.time && c.time.toLowerCase().includes(q)) ||
      (c.sportName && c.sportName.toLowerCase().includes(q)) ||
      (c.workoutName && c.workoutName.toLowerCase().includes(q))
    );
  }

  // Üres állapot kezelése
  if (filtered.length === 0) {
    if (allCourses.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 px-4 rounded-3xl bg-white dark:bg-[#141519] border border-dashed border-gray-200 dark:border-[#262832] shadow-xs">
          <div class="w-14 h-14 mx-auto rounded-2xl bg-cyan-500/10 text-cyan-500 dark:text-[#00E5FF] flex items-center justify-center text-2xl mb-3">
            <i class="fa-solid fa-map-location-dot"></i>
          </div>
          <h4 class="text-sm font-bold text-gray-900 dark:text-white">Még nincs elmentett pálya vagy hivatalos időeredmény</h4>
          <p class="text-xs text-gray-400 mt-1.5 max-w-sm mx-auto">
            Nyiss meg egy állóképességi edzést az Edzésnaplóban, és a <strong class="text-gray-700 dark:text-gray-200">„Pályák &amp; Hivatalos Időeredmények”</strong> szekciónál rögzíts mért szakaszokat!
          </p>
          <button type="button" onclick="if (window.showModule) { window.showModule('activity'); if (window.switchActivitySubtab) window.switchActivitySubtab('workouts'); }"
                  class="mt-4 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs active:scale-95 transition-all inline-flex items-center gap-1.5 shadow-sm">
            <i class="fa-solid fa-person-running"></i>
            <span>Ugrás az Edzésnaplóhoz</span>
          </button>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="text-center py-10 px-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#262832]">
          <i class="fa-solid fa-filter-circle-xmark text-2xl text-gray-400 mb-2"></i>
          <p class="text-xs font-bold text-gray-700 dark:text-gray-300">Nincs találat a kiválasztott sportághoz vagy kereséshez</p>
          <button type="button" onclick="const b = document.querySelector('.course-subcat-chip[data-sport=\\'all\\']'); if (b) b.click();"
                  class="mt-3 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 font-bold text-xs hover:text-cyan-500 transition-colors">
            Összes mutatása
          </button>
        </div>
      `;
    }
    return;
  }

  // Kártyák összeállítása
  const html = filtered.map(item => {
    const isInPr = _isCourseInPersonalRecords(item.name, item.time);
    const dateFormatted = item.date
      ? new Date(item.date + 'T12:00:00').toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'Korábbi edzés';

    return `
      <div class="course-card bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-cyan-500/40 rounded-3xl p-4 shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
        <div class="flex items-center gap-3.5 flex-1 min-w-0">
          <!-- Sport Ikon Badge -->
          <div class="w-11 h-11 rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] flex items-center justify-center flex-shrink-0 text-base shadow-inner group-hover:scale-105 transition-transform">
            <i class="${item.sportIcon}"></i>
          </div>

          <!-- Pálya Neve és Edzés Infó -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-sm font-extrabold text-gray-900 dark:text-white truncate">${_esc(item.name)}</h4>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#1E2026] text-gray-600 dark:text-gray-300 border border-gray-200/60 dark:border-[#2A2C34]">
                ${_esc(item.sportName)}
              </span>
            </div>
            <div class="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span><i class="fa-regular fa-calendar text-[10px] mr-1"></i>${dateFormatted}</span>
              <span>•</span>
              <button type="button" class="course-open-workout-btn text-cyan-600 dark:text-cyan-400 hover:underline font-medium truncate max-w-[200px] text-left cursor-pointer" data-wid="${_esc(item.workoutId)}" title="Edzés megnyitása">
                ${_esc(item.workoutName)}
              </button>
            </div>
          </div>
        </div>

        <!-- Időeredmény és Rekord Hozzáadása Gomb -->
        <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-[#1E2028]">
          <div class="text-left sm:text-right">
            <p class="text-[9px] font-bold uppercase tracking-wider text-gray-400">Hivatalos Idő</p>
            <div class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-[#00E5FF] font-mono font-black text-sm">
              <i class="fa-regular fa-clock text-[10px] opacity-75"></i>
              <span>${_esc(item.time)}</span>
            </div>
          </div>

          <!-- KIS KUPA GOMB (Hozzáadás a rekordokhoz) -->
          <button type="button"
                  class="course-trophy-btn px-3 py-2 rounded-2xl font-extrabold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                    isInPr
                      ? 'bg-amber-500/15 text-amber-500 border border-amber-500/40 shadow-xs'
                      : 'bg-gray-100 dark:bg-[#1E2026] text-gray-500 dark:text-gray-400 hover:text-amber-500 hover:bg-amber-500/10 border border-gray-200 dark:border-[#2A2C34]'
                  }"
                  data-name="${_esc(item.name)}"
                  data-time="${_esc(item.time)}"
                  data-sport="${_esc(item.sportId)}"
                  data-date="${_esc(item.date)}"
                  data-wname="${_esc(item.workoutName)}"
                  title="${isInPr ? 'Már szerepel a Személyes Rekordok között' : 'Pálya és időeredmény mentése a Rekordokhoz'}">
            <i class="fa-solid fa-trophy text-xs ${isInPr ? 'text-amber-500' : 'text-gray-400'}"></i>
            <span class="text-[11px]">${isInPr ? 'Rekord ✓' : 'Rekord'}</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  // 1. Kupa gombok eseménykezelése
  container.querySelectorAll('.course-trophy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _handleTrophyClick(btn);
    });
  });

  // 2. Edzés megnyitás gombok eseménykezelése
  container.querySelectorAll('.course-open-workout-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wid = btn.dataset.wid;
      if (wid && typeof window.openWorkoutDetailModal === 'function') {
        window.openWorkoutDetailModal(wid);
      }
    });
  });
}

// ── Kupa Gombra Kattintás (Hozzáadás a Rekordokhoz) ────────
async function _handleTrophyClick(btn) {
  const name = btn.dataset.name;
  const time = btn.dataset.time;
  const sportId = btn.dataset.sport || 'running';
  const date = btn.dataset.date || new Date().toISOString().slice(0, 10);
  const workoutName = btn.dataset.wname || '';

  if (!name || !time || time === '—') {
    alert('Ehhez a pályához nincs érvényes mért időeredmény!');
    return;
  }

  // Ha már benne van
  if (_isCourseInPersonalRecords(name, time)) {
    _showToast(`🏆 „${name}” (${time}) már szerepel a Személyes Rekordok között!`);
    return;
  }

  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Mentés…</span>';

  let success = false;
  if (typeof window !== 'undefined' && typeof window.addRecordFromCourse === 'function') {
    success = await window.addRecordFromCourse({ name, time, sportId, date, workoutName });
  } else {
    // Közvetlen mentés ha pr-hub függvény még nem futott
    try {
      const effUid = _uid || (window.auth && window.auth.currentUser ? window.auth.currentUser.uid : 'default');
      const rec = {
        id: 'rec_c_' + Date.now().toString(36),
        name: name,
        sportId: sportId,
        category: 'cardio',
        type: 'cardio',
        date: date,
        duration: time,
        source: 'course',
        notes: workoutName ? `Hivatalos időeredmény (${workoutName})` : 'Pálya időeredmény',
        createdAt: new Date().toISOString()
      };
      _allRecords.unshift(rec);
      const rawRecs = localStorage.getItem('lockin_records_' + effUid);
      const recs = rawRecs ? JSON.parse(rawRecs) : [];
      recs.unshift(rec);
      localStorage.setItem('lockin_records_' + effUid, JSON.stringify(recs));
      success = true;
    } catch (err) {
      console.warn('[courses] direct PR add error:', err);
    }
  }

  if (success) {
    btn.className = 'course-trophy-btn px-3 py-2 rounded-2xl font-extrabold text-xs flex items-center gap-1.5 transition-all bg-amber-500/15 text-amber-500 border border-amber-500/40 shadow-xs cursor-pointer';
    btn.innerHTML = '<i class="fa-solid fa-trophy text-amber-500 text-xs"></i><span class="text-[11px]">Rekord ✓</span>';
    btn.title = 'Már szerepel a Személyes Rekordok között';

    // Statisztikák frissítése
    const prsEl = $('courses-stat-prs');
    if (prsEl) {
      const cur = parseInt(prsEl.textContent, 10) || 0;
      prsEl.textContent = cur + 1;
    }

    _showToast(`🏆 „${name}” (${time}) sikeresen hozzáadva a Rekordokhoz!`);
  } else {
    btn.innerHTML = originalHtml;
  }
  btn.disabled = false;
}

// ── Gyors Értesítés (Toast) ───────────────────────────────
function _showToast(msg) {
  const existing = document.getElementById('courses-toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'courses-toast-notification';
  toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-gray-900/90 dark:bg-black/90 backdrop-blur-md text-white text-xs font-bold border border-amber-500/40 shadow-2xl flex items-center gap-2 transition-all';
  toast.innerHTML = `<span>${_esc(msg)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ── Eseménykezelők Bekötése ───────────────────────────────
function _setupEventListeners() {
  const searchInput = $('courses-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value;
      _renderCoursesList(getAllSavedCourses());
    });
  }
}

// Ablak szintű elérhetőség
if (typeof window !== 'undefined') {
  window.renderCoursesScreen = renderCoursesScreen;
  window.getAllSavedCourses = getAllSavedCourses;
  window.openCoursesView = () => {
    if (window.showModule) window.showModule('courses');
  };
}
