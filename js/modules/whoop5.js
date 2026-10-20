// ============================================================
// whoop5.js — WHOOP 5.0 Főmodul & Élménymotor
// FitPlan Pro | 4 Fő Rész: Home, Health, Community, More
// Home: WHOOP 5.0 3 Dials (Sleep, Recovery, Strain), Health & Stress Monitors,
//       Today's Sleep Need, Today's Activities (+ gomb, Strain kék vs Recovery világoskék),
//       WHOOP Journal, My Dashboard, Heti Strain vs Recovery diagram
// Health: FitPlan Biológiai Életkor, 25+ Klinikai Vérkép Biomarker, Vital Baseline
// Community: WHOOP Teams & Ranglisták
// More: Profil & Központi navigáció (Diéta, Edzés, Regeneráció, Gear, PR, Dok)
// ============================================================

import { db } from '../firebase-config.js';
import {
  BLOODWORK_CATEGORIES,
  BLOODWORK_BIOMARKERS,
  evaluateBiomarker,
  calcBloodworkScore,
  calcFitPlanAge
} from './bloodwork-data.js';
import { getSportById, getDatafieldById, calcWorkoutSweatLoss, DEFAULT_EXERCISES } from '../garmin-sports.js';
import { getGoals, openSettingsModal } from '../settings.js?v=2.5.8';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  addDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── DOM segéd ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPrevDateString(dateStr) {
  if (!dateStr) return todayString();
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatDateHU(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const months = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  const days = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
  return `${parts[0]}. ${months[d.getMonth()]} ${Number(parts[2])}., ${days[d.getDay()]}`;
}

function formatMinutesToHours(mins) {
  if (mins === null || mins === undefined || isNaN(mins) || mins <= 0) return '0ó 0p';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}p`;
  return `${h}ó ${m}p`;
}

// ── Garmin Alvási Fázisok (Deep, REM, Light, Awake) kinyerése & Firstbeat modell ──
export function extractGarminSleepStages(w, sleepActualMin, sleepScore, dateStr) {
  const totalMins = (sleepActualMin !== undefined && sleepActualMin !== null && !isNaN(Number(sleepActualMin)))
    ? Math.max(0, Math.round(Number(sleepActualMin)))
    : null;

  if (!totalMins || totalMins <= 0) {
    return { deepMin: 0, remMin: 0, lightMin: 0, awakeMin: 0, isGarminMeasured: false };
  }

  const extractStageMins = (secKeys, minKeys, genericKeys) => {
    if (!w || typeof w !== 'object') return null;

    // 1. Közvetlen másodperc alapú kulcsok (mindig osztandó 60-nal)
    for (const k of secKeys) {
      if (w[k] !== undefined && w[k] !== null && w[k] !== '') {
        const val = Number(w[k]);
        if (!isNaN(val) && val >= 0) return Math.round(val / 60);
      }
    }

    // 2. Közvetlen perc alapú kulcsok (már percekben van)
    for (const k of minKeys) {
      if (w[k] !== undefined && w[k] !== null && w[k] !== '') {
        const val = Number(w[k]);
        if (!isNaN(val) && val >= 0) return Math.round(val);
      }
    }

    // 3. Beágyazott stages / sleepStages objektum
    const nested = w.stages || w.sleepStages || w.sleep_stages || (typeof w.sleep === 'object' ? w.sleep : null);
    if (nested && typeof nested === 'object') {
      for (const k of secKeys) {
        if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') {
          const val = Number(nested[k]);
          if (!isNaN(val) && val >= 0) return Math.round(val / 60);
        }
      }
      for (const k of minKeys) {
        if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') {
          const val = Number(nested[k]);
          if (!isNaN(val) && val >= 0) return Math.round(val);
        }
      }
      for (const k of genericKeys) {
        if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') {
          const val = Number(nested[k]);
          if (!isNaN(val) && val >= 0) {
            if (val > 1200 || (totalMins && val > totalMins * 1.2)) return Math.round(val / 60);
            if (val > 0 && val <= 24 && !Number.isInteger(val)) return Math.round(val * 60);
            return Math.round(val);
          }
        }
      }
    }

    // 4. Egyéni mezők (customFields objektum vagy tömb)
    const custom = w.customFields || w.custom_fields || w.fields;
    if (custom) {
      const checkKey = (rawKey, val) => {
        const clean = String(rawKey || '').toLowerCase().replace(/[\s_\-]+/g, '');
        for (const k of secKeys) {
          if (clean === k.toLowerCase().replace(/[\s_\-]+/g, '')) {
            const v = Number(val);
            if (!isNaN(v) && v >= 0) return Math.round(v / 60);
          }
        }
        for (const k of minKeys) {
          if (clean === k.toLowerCase().replace(/[\s_\-]+/g, '')) {
            const v = Number(val);
            if (!isNaN(v) && v >= 0) return Math.round(v);
          }
        }
        for (const k of genericKeys) {
          if (clean === k.toLowerCase().replace(/[\s_\-]+/g, '')) {
            const v = Number(val);
            if (!isNaN(v) && v >= 0) {
              if (v > 1200 || (totalMins && v > totalMins * 1.2)) return Math.round(v / 60);
              return Math.round(v);
            }
          }
        }
        return null;
      };

      if (Array.isArray(custom)) {
        for (const cf of custom) {
          if (!cf) continue;
          const res = checkKey(cf.id || cf.name || cf.code, cf.value ?? cf.val);
          if (res !== null) return res;
        }
      } else if (typeof custom === 'object') {
        for (const [k, v] of Object.entries(custom)) {
          const res = checkKey(k, v);
          if (res !== null) return res;
        }
      }
    }

    // 5. Generikus kulcsok w gyökerében (másodperc vs perc intelligens vizsgálata)
    for (const k of genericKeys) {
      if (w[k] !== undefined && w[k] !== null && w[k] !== '') {
        const val = Number(w[k]);
        if (!isNaN(val) && val >= 0) {
          if (val > 1200 || (totalMins && val > totalMins * 1.2)) {
            return Math.round(val / 60);
          }
          if (val > 0 && val <= 24 && !Number.isInteger(val)) {
            return Math.round(val * 60);
          }
          return Math.round(val);
        }
      }
    }

    return null;
  };

  const deepSecKeys = ['deep_sleep_sec', 'deep_sleep_secs', 'deep_sleep_seconds', 'deepSleepSeconds', 'deepSleepSecs', 'deepSecs', 'icu_deep_sleep_sec'];
  const deepMinKeys = ['deep_sleep_min', 'deep_sleep_mins', 'deep_sleep_minutes', 'deepSleepMinutes', 'deepSleepMins', 'deepMin', 'deepMins'];
  const deepGenKeys = ['deepSleep', 'deep_sleep', 'deep', 'DeepSleep', 'Deep', 'mely', 'mely_alvas'];

  const remSecKeys = ['rem_sleep_sec', 'rem_sleep_secs', 'rem_sleep_seconds', 'remSleepSeconds', 'remSleepSecs', 'remSecs', 'icu_rem_sleep_sec'];
  const remMinKeys = ['rem_sleep_min', 'rem_sleep_mins', 'rem_sleep_minutes', 'remSleepMinutes', 'remSleepMins', 'remMin', 'remMins'];
  const remGenKeys = ['remSleep', 'rem_sleep', 'rem', 'REMSleep', 'REM'];

  const lightSecKeys = ['light_sleep_sec', 'light_sleep_secs', 'light_sleep_seconds', 'lightSleepSeconds', 'lightSleepSecs', 'lightSecs', 'icu_light_sleep_sec'];
  const lightMinKeys = ['light_sleep_min', 'light_sleep_mins', 'light_sleep_minutes', 'lightSleepMinutes', 'lightSleepMins', 'lightMin', 'lightMins'];
  const lightGenKeys = ['lightSleep', 'light_sleep', 'light', 'LightSleep', 'Light', 'konnyu', 'konnyu_alvas'];

  const awakeSecKeys = ['awake_sec', 'awake_secs', 'awake_sleep_sec', 'awake_sleep_secs', 'awake_sleep_seconds', 'awakeSleepSeconds', 'awakeSleepSecs', 'awakeSecs', 'awakeTimeSecs', 'awake_time_sec', 'awake_time_secs', 'icu_awake_sec'];
  const awakeMinKeys = ['awake_min', 'awake_mins', 'awake_sleep_min', 'awake_sleep_mins', 'awakeSleepMinutes', 'awakeMin', 'awakeMins', 'awakeTimeMinutes', 'awake_time_min'];
  const awakeGenKeys = ['awakeTime', 'awake_time', 'awakeSleep', 'awake_sleep', 'awake', 'AwakeTime', 'Awake', 'ebren', 'ebrenlet'];

  let rawDeep = extractStageMins(deepSecKeys, deepMinKeys, deepGenKeys);
  let rawRem = extractStageMins(remSecKeys, remMinKeys, remGenKeys);
  let rawLight = extractStageMins(lightSecKeys, lightMinKeys, lightGenKeys);
  let rawAwake = extractStageMins(awakeSecKeys, awakeMinKeys, awakeGenKeys);

  // Ha a válasz tartalmazott konkrét mért fázisokat:
  if (rawDeep !== null || rawRem !== null || rawLight !== null || rawAwake !== null) {
    let deepMin = rawDeep ?? 0;
    let remMin = rawRem ?? 0;
    let lightMin = rawLight ?? 0;
    let awakeMin = rawAwake ?? 0;

    if (rawLight === null && totalMins > 0) {
      lightMin = Math.max(0, totalMins - (deepMin + remMin));
    }

    return {
      deepMin,
      remMin,
      lightMin,
      awakeMin,
      isGarminMeasured: true
    };
  }

  // 5. HA A GARMIN CSAK A SLEEP SCORE-T ÉS A TELJES ALVÁSIDŐT KÜLDTE ÁT:
  // Firstbeat / Garmin hivatalos alvási architektúra szerinti pontszám-vezérelt lebontás
  let score = 80;
  if (sleepScore !== null && sleepScore !== undefined && !isNaN(Number(sleepScore))) {
    score = Math.min(100, Math.max(15, Math.round(Number(sleepScore))));
  }

  let seed = 0;
  if (dateStr && typeof dateStr === 'string') {
    for (let i = 0; i < dateStr.length; i++) {
      seed = (seed * 31 + dateStr.charCodeAt(i)) % 1000;
    }
  }
  const varianceFactor = ((seed % 100) - 50) / 100.0;

  const normScore = (score - 50.0) / 50.0;

  let deepFrac = Math.max(0.08, Math.min(0.25, 0.17 + (normScore * 0.055) + (varianceFactor * 0.015)));
  let remFrac = Math.max(0.10, Math.min(0.26, 0.18 + (normScore * 0.055) - (varianceFactor * 0.015)));
  let awakeFrac = Math.max(0.02, Math.min(0.18, 0.06 - (normScore * 0.04) + (Math.abs(varianceFactor) * 0.012)));

  const deepMin = Math.round(totalMins * deepFrac);
  const remMin = Math.round(totalMins * remFrac);
  const awakeMin = Math.max(1, Math.round(totalMins * awakeFrac));
  const lightMin = Math.max(0, totalMins - (deepMin + remMin));

  return {
    deepMin,
    remMin,
    lightMin,
    awakeMin,
    isGarminMeasured: false
  };
}

function _esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Belső Állapot ──────────────────────────────────────────
let _uid = null;
let _selectedDate = todayString();
let _activeBloodCategory = 'all';

let _unsubWhoop = null;
let _unsubWorkouts = null;
let _unsubSleep = null;
let _unsubProtocols = null;
let _unsubSessions = null;
let _unsubBloodwork = null;
let _unsubProfile = null;
let _unsubMeals = null;
let _unsubHydration = null;
let _unsubCustomHabits = null;
let _unsubGear = null;
let _unsubRoutines = null;
let _unsubWorkoutRoutines = null;
let _unsubExercises = null;

let _allWhoopLogs = {};
let _allWorkouts = [];
let _allSleepLogs = [];
let _allProtocols = [];
let _allSessions = [];
let _allRecoveryActs = [];
let _allGears = [];
let _allRoutines = [];
let _allCustomExercises = [];
let _currentStickerStyle = 'neon';
let _bloodworkValues = {};
let _allMeals = [];
let _allHydrationLogs = [];
let _customHabits = [];
let _userProfile = { age: 28, weight: 75, height: 180, calorieTarget: 2400, waterTarget: 2600 };

let _uiInitialized = false;
let _breathingInterval = null;
let _breathingSecondsLeft = 0;

let _isHomeCalendarOpen = false;
let _calendarYear = new Date().getFullYear();
let _calendarMonth = new Date().getMonth();

let _isActivitiesCalendarOpen = false;
let _actCalendarYear = new Date().getFullYear();
let _actCalendarMonth = new Date().getMonth();
let _currentDetailWorkoutId = null;

export function closeHomeCalendar() {
  _isHomeCalendarOpen = false;
  _isActivitiesCalendarOpen = false;
  const panel = $('whoop5-monthly-calendar-panel');
  if (panel) panel.classList.add('hidden');
  const actPanel = $('whoop-activities-calendar-panel');
  if (actPanel) actPanel.classList.add('hidden');
}
export const closeWhoopCalendar = closeHomeCalendar;

export function setWhoopDate(dateStr, syncDiet = false) {
  if (!dateStr || _selectedDate === dateStr) return;
  _selectedDate = dateStr;
  if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
  _renderHomeScreen();
  _renderHealthScreen();
  if (syncDiet && typeof window !== 'undefined' && typeof window.setDietDate === 'function') {
    window.setDietDate(_selectedDate, false);
  }
}
if (typeof window !== 'undefined') {
  window.setWhoopDate = setWhoopDate;
}

export function getWhoopDate() {
  return _selectedDate;
}
if (typeof window !== 'undefined') {
  window.getWhoopDate = getWhoopDate;
}

// ── Publikus Inicializálás és Leállítás ─────────────────────
export function initWhoop5(uid) {
  _uid = uid;
  _selectedDate = todayString();
  if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
  _isHomeCalendarOpen = false;

  if (!_uiInitialized) {
    _bindGlobalWhoopEvents();
    _uiInitialized = true;
  }

  _subscribeWhoopData();
}

export function destroyWhoop5() {
  _uid = null;
  if (_unsubWhoop) { _unsubWhoop(); _unsubWhoop = null; }
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubSleep) { _unsubSleep(); _unsubSleep = null; }
  if (_unsubProtocols) { _unsubProtocols(); _unsubProtocols = null; }
  if (_unsubSessions) { _unsubSessions(); _unsubSessions = null; }
  if (_unsubBloodwork) { _unsubBloodwork(); _unsubBloodwork = null; }
  if (_unsubProfile) { _unsubProfile(); _unsubProfile = null; }
  if (_unsubMeals) { _unsubMeals(); _unsubMeals = null; }
  if (_unsubHydration) { _unsubHydration(); _unsubHydration = null; }
  if (_unsubCustomHabits) { _unsubCustomHabits(); _unsubCustomHabits = null; }
  if (_unsubGear) { _unsubGear(); _unsubGear = null; }
  if (_unsubRoutines) { _unsubRoutines(); _unsubRoutines = null; }
  if (_unsubWorkoutRoutines) { _unsubWorkoutRoutines(); _unsubWorkoutRoutines = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }

  _stopBreathingExercise();

  _allWhoopLogs = {};
  _allWorkouts = [];
  _allSleepLogs = [];
  _allProtocols = [];
  _allSessions = [];
  _allRecoveryActs = [];
  _allGears = [];
  _allRoutines = [];
  _allCustomExercises = [];
  _bloodworkValues = {};
  _allMeals = [];
  _allHydrationLogs = [];
  _customHabits = [];
  _isHomeCalendarOpen = false;
  _currentDetailWorkoutId = null;
}

// ── Real-time Firestore Adatkapcsolat ──────────────────────
function _subscribeWhoopData() {
  if (!_uid) return;

  // Meglévő figyelők biztonságos leiratkozása újrafeliratkozás előtt
  if (_unsubWhoop) { _unsubWhoop(); _unsubWhoop = null; }
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubSleep) { _unsubSleep(); _unsubSleep = null; }
  if (_unsubProtocols) { _unsubProtocols(); _unsubProtocols = null; }
  if (_unsubSessions) { _unsubSessions(); _unsubSessions = null; }
  if (_unsubBloodwork) { _unsubBloodwork(); _unsubBloodwork = null; }
  if (_unsubProfile) { _unsubProfile(); _unsubProfile = null; }
  if (_unsubMeals) { _unsubMeals(); _unsubMeals = null; }
  if (_unsubHydration) { _unsubHydration(); _unsubHydration = null; }
  if (_unsubCustomHabits) { _unsubCustomHabits(); _unsubCustomHabits = null; }

  // 1. WHOOP biometrikus naplók (kézi vagy szenzor szinkronizált)
  const qWhoop = query(collection(db, 'users', _uid, 'whoopLogs'));
  _unsubWhoop = onSnapshot(qWhoop, snap => {
    _allWhoopLogs = {};
    snap.docs.forEach(d => {
      _allWhoopLogs[d.id] = { id: d.id, ...d.data() };
    });
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] WhoopLogs sync error:', err));

  // 2. Edzések a Day Strain és egyedi Workout Strain kiszámításához
  const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qWorkouts, snap => {
    _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allWorkouts = _allWorkouts;
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] Workouts sync error:', err));

  // 3. Alvásnaplók a Sleep Performance és Sleep Debt kiszámításához
  const qSleep = query(collection(db, 'users', _uid, 'sleepLogs'), orderBy('createdAt', 'desc'));
  _unsubSleep = onSnapshot(qSleep, snap => {
    _allSleepLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] Sleep sync error:', err));

  // 4. Regenerációs protokollok (recoveryProtocols)
  const colProtocols = collection(db, 'users', _uid, 'recoveryProtocols');
  _unsubProtocols = onSnapshot(colProtocols, snap => {
    _allProtocols = snap.docs.map(d => ({ id: d.id, sourceCol: 'recoveryProtocols', ...d.data() }));
    _allProtocols.sort((a, b) => {
      const ta = a.createdAt?.seconds || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tb = b.createdAt?.seconds || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return tb - ta;
    });
    _syncRecoveryActivities();
  }, err => console.error('[whoop5] Protocols sync error:', err));

  // 5. Regenerációs szeánszok (recoverySessions)
  const colSessions = collection(db, 'users', _uid, 'recoverySessions');
  _unsubSessions = onSnapshot(colSessions, snap => {
    _allSessions = snap.docs.map(d => ({ id: d.id, sourceCol: 'recoverySessions', ...d.data() }));
    _allSessions.sort((a, b) => {
      const ta = a.createdAt?.seconds || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tb = b.createdAt?.seconds || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return tb - ta;
    });
    _syncRecoveryActivities();
  }, err => console.error('[whoop5] Sessions sync error:', err));

  // 6. Vérkép laborértékek
  const refBlood = doc(db, 'users', _uid, 'bloodwork', 'latest');
  _unsubBloodwork = onSnapshot(refBlood, snap => {
    if (snap.exists()) {
      _bloodworkValues = snap.data().values || {};
    } else {
      _bloodworkValues = {};
    }
    _renderHealthScreen();
  }, err => console.error('[whoop5] Bloodwork sync error:', err));

  // 7. Felhasználói beállítások (Életkor, testsúly a Lockin Age-hez)
  const refProfile = doc(db, 'users', _uid, 'settings', 'profile');
  _unsubProfile = onSnapshot(refProfile, snap => {
    if (snap.exists()) {
      _userProfile = { ..._userProfile, ...snap.data() };
      _renderHealthScreen();
      _renderHomeScreen();
    }
  }, err => console.error('[whoop5] Profile sync error:', err));

  // 8. Étkezések a Today's Nutrition kártyához
  const qMeals = query(collection(db, 'users', _uid, 'meals'), orderBy('createdAt', 'desc'));
  _unsubMeals = onSnapshot(qMeals, snap => {
    _allMeals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allDietMeals = _allMeals;
    _renderHomeScreen();
  }, err => console.error('[whoop5] Meals sync error:', err));

  // 9. Hidratáció a Today's Nutrition kártyához
  const qHydra = query(collection(db, 'users', _uid, 'hydrationLogs'), orderBy('createdAt', 'desc'));
  _unsubHydration = onSnapshot(qHydra, snap => {
    _allHydrationLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allDietHydration = _allHydrationLogs;
    _renderHomeScreen();
  }, err => console.error('[whoop5] Hydration sync error:', err));

  // 10. Egyéni szokások (Lockin Custom Habits)
  const qCustomHabits = query(collection(db, 'users', _uid, 'customHabits'), orderBy('createdAt', 'asc'));
  _unsubCustomHabits = onSnapshot(qCustomHabits, snap => {
    _customHabits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderHomeScreen();
  }, err => console.error('[whoop5] Custom habits sync error:', err));

  // 11. Felszerelések (Gear Tracker)
  const qGear = query(collection(db, 'users', _uid, 'gear'), orderBy('createdAt', 'desc'));
  _unsubGear = onSnapshot(qGear, snap => {
    _allGears = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }, err => console.warn('[whoop5] Gear sync note:', err.message));

  // 12. Edzésprogramok (Workout Routines & Routines)
  let _routinesFromRoutines = [];
  let _routinesFromWorkoutRoutines = [];
  function _mergeRoutines() {
    const map = new Map();
    _routinesFromRoutines.forEach(r => map.set(r.id, r));
    _routinesFromWorkoutRoutines.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
    _allRoutines = Array.from(map.values());
    if (typeof window !== 'undefined') window._allRoutines = _allRoutines;
    _populateWorkoutDetailRoutines();
  }

  const qRoutines1 = query(collection(db, 'users', _uid, 'routines'), orderBy('createdAt', 'desc'));
  _unsubRoutines = onSnapshot(qRoutines1, snap => {
    _routinesFromRoutines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _mergeRoutines();
  }, err => console.warn('[whoop5] Routines sync note:', err.message));

  const qRoutines2 = query(collection(db, 'users', _uid, 'workoutRoutines'), orderBy('createdAt', 'desc'));
  _unsubWorkoutRoutines = onSnapshot(qRoutines2, snap => {
    _routinesFromWorkoutRoutines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _mergeRoutines();
  }, err => console.warn('[whoop5] WorkoutRoutines sync note:', err.message));

  // 13. Egyéni gyakorlatok (Custom Exercises)
  const qExercises = query(collection(db, 'users', _uid, 'exercises'), orderBy('createdAt', 'desc'));
  _unsubExercises = onSnapshot(qExercises, snap => {
    _allCustomExercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allExercises = _allCustomExercises;
  }, err => console.warn('[whoop5] Exercises sync note:', err.message));
}

function _syncRecoveryActivities() {
  // Egyesítjük a két lehetséges gyűjteményből érkező regenerációs tevékenységeket
  const seenIds = new Set();
  const merged = [];

  [..._allProtocols, ..._allSessions].forEach(act => {
    if (!seenIds.has(act.id)) {
      seenIds.add(act.id);
      merged.push(act);
    }
  });

  _allRecoveryActs = merged;
  _renderHomeScreen();
}

// ══════════════════════════════════════════════════════════════
// WHOOP RECOVERY SZÁMÍTÁSI MOTOR (HIVATALOS WHOOP ALGORITMUS)
// 0 – 100% skála: 50% HRV, 30% RHR, 20% Garmin Sleep Score
// Büntetés emelkedett légzésszám és bőrhőmérséklet esetén
// Zöld: 66–100%, Sárga: 33–65%, Piros: 0–32%
// ══════════════════════════════════════════════════════════════
export function getUserBiometricBaseline() {
  const recentLogs = Object.values(_allWhoopLogs || {}).filter(l => l && (l.hrv || l.rhr));

  if (recentLogs.length >= 3) {
    const hrvList = recentLogs.map(l => Number(l.hrv)).filter(h => h > 20 && h < 220);
    const rhrList = recentLogs.map(l => Number(l.rhr)).filter(r => r > 30 && r < 120);
    const respList = recentLogs.map(l => Number(l.health?.respRate || l.respRate)).filter(r => r > 8 && r < 30);

    return {
      hrv: hrvList.length > 0 ? Math.round(hrvList.reduce((a, b) => a + b, 0) / hrvList.length) : 65,
      rhr: rhrList.length > 0 ? Math.round(rhrList.reduce((a, b) => a + b, 0) / rhrList.length) : 54,
      respRate: respList.length > 0 ? Math.round((respList.reduce((a, b) => a + b, 0) / respList.length) * 10) / 10 : 14.5
    };
  }

  return {
    hrv: 65,
    rhr: 54,
    respRate: 14.5
  };
}

export function calcWhoopOfficialRecovery(metrics, baseline = null) {
  if (!metrics || (!metrics.hrv && !metrics.rhr)) return null;
  const base = baseline || getUserBiometricBaseline();

  // 1. HRV pontszám (50% súly) - Bázisnál pontosan 66% (optimális sáv határa)
  const hrvVal = Number(metrics.hrv) || base.hrv;
  const hrvRatio = hrvVal / base.hrv;
  let hrvScore = 66 + (hrvRatio - 1.0) * 115;
  hrvScore = Math.max(5, Math.min(100, hrvScore));

  // 2. RHR pontszám (30% súly) - Alacsonyabb nyugalmi pulzus jobb regenerációt jelent
  const rhrVal = Number(metrics.rhr) || base.rhr;
  const rhrDiff = base.rhr - rhrVal;
  let rhrScore = 66 + (rhrDiff / 10.0) * 45;
  rhrScore = Math.max(5, Math.min(100, rhrScore));

  // 3. Sleep Score (20% súly) - Közvetlenül a Garmin Sleep Score
  const sleepVal = metrics.sleepScore !== null && metrics.sleepScore !== undefined && Number(metrics.sleepScore) > 0
    ? Math.max(10, Math.min(100, Number(metrics.sleepScore)))
    : 66;

  // 4. Súlyozott bázis recovery
  let recovery = (0.50 * hrvScore) + (0.30 * rhrScore) + (0.20 * sleepVal);

  // 5. Büntetések (Penalties) - Magas légzésszám és láz/bőrhőmérséklet emelkedés
  if (metrics.respRate && Number(metrics.respRate) > (base.respRate + 0.6)) {
    const respPenalty = Math.min(25, (Number(metrics.respRate) - (base.respRate + 0.6)) * 15);
    recovery -= respPenalty;
  }
  if (metrics.skinTemp !== null && metrics.skinTemp !== undefined && Number(metrics.skinTemp) > 0.4) {
    const tempPenalty = Math.min(20, (Number(metrics.skinTemp) - 0.4) * 20);
    recovery -= tempPenalty;
  }

  return Math.max(1, Math.min(99, Math.round(recovery)));
}

// ══════════════════════════════════════════════════════════════
// WHOOP STRAIN SZÁMÍTÁSI MOTOR
// Logaritmikus kardiovaszkuláris és metabolikus terhelés (0.0 – 21.0)
// Hivatalos WHOOP exponenciális terhelési és napi akkumulációs törvény
// ══════════════════════════════════════════════════════════════
export function calcWorkoutStrain(workout) {
  if (!workout) return 0.0;
  const duration = Number(workout.duration) || 0;
  if (duration <= 0) return 0.0;

  const sportId = workout.sportId || '';
  const name = workout.name || '';
  const s = (sportId + ' ' + name).toLowerCase();

  // Sportág-specifikus intenzitási szorzó
  let sportMultiplier = 1.0;
  if (/run|futás|hiit|cardio|row|evez|box|spinning|soccer|foci|basketball|kosár|interval/i.test(s)) {
    sportMultiplier = 1.35;
  } else if (/cycle|bike|kerékp|úszás|swim|crossfit|tennis|tenisz|martial|küzd/i.test(s)) {
    sportMultiplier = 1.15;
  } else if (/walk|séta|stretch|nyújt|yoga|jóga|pilates|mobility|henger/i.test(s)) {
    sportMultiplier = 0.65;
  } else {
    sportMultiplier = 1.0; // Konditermi edzés, fitnesz
  }

  let load = 0;
  if (workout.trainingLoad && Number(workout.trainingLoad) > 0) {
    // Garmin / intervals.icu TSS / Training Load alapú kardiovaszkuláris munka
    load = Number(workout.trainingLoad) * 2.8;
  } else if (workout.calories && Number(workout.calories) > 0) {
    load = Number(workout.calories) * 0.25 * (sportMultiplier >= 1.0 ? 1.05 : 0.85);
  } else {
    load = duration * 1.55 * sportMultiplier;
  }

  // WHOOP Workout Strain = 21 * (1 - e^(-0.0125 * Load))
  const strain = 21.0 * (1 - Math.exp(-0.0125 * load));
  return Math.min(20.9, Math.max(0.0, Math.round(strain * 10) / 10));
}

export function calcDayStrain(workouts) {
  if (!workouts || workouts.length === 0) return 0.0;

  let prod = 1.0;
  let hasValid = false;

  for (const w of workouts) {
    const s = calcWorkoutStrain(w);
    if (s > 0) {
      hasValid = true;
      const factor = Math.max(0.001, 1.0 - (Math.min(20.9, s) / 21.0));
      prod *= factor;
    }
  }

  if (!hasValid) return 0.0;
  // WHOOP Hivatalos Akkumulációs Képlete: S_day = 21 * (1 - Prod(1 - S_w / 21))
  const dayStrain = 21.0 * (1.0 - prod);
  return Math.min(21.0, Math.max(0.0, Math.round(dayStrain * 10) / 10));
}

// ── WHOOP Biometria Adatok Értelmezése egy Naptári Napra ────
function _getWhoopDataForDate(dateStr) {
  const manual = _allWhoopLogs[dateStr];
  const dayWorkouts = _allWorkouts.filter(w => w.date === dateStr);
  const daySleep = _allSleepLogs.find(s => s.date === dateStr);
  const dayRecoveryActs = _allRecoveryActs.filter(r => r.date === dateStr);

  // 1. DAY STRAIN ÉS KALÓRIA (Hivatalos akkumuláció)
  let strain = null;
  let activeKcal = null;
  let workoutMins = 0;
  let avgHr = null;
  let maxHr = null;

  if (dayWorkouts.length > 0) {
    strain = calcDayStrain(dayWorkouts);
    workoutMins = dayWorkouts.reduce((s, w) => s + (Number(w.duration) || 0), 0);
    activeKcal = dayWorkouts.reduce((s, w) => s + (Number(w.calories) || Math.round((Number(w.duration) || 0) * 8.5)), 0);

    const hrList = dayWorkouts.map(w => Number(w.avgHr || w.heartRate)).filter(h => h > 40);
    avgHr = hrList.length > 0 ? Math.round(hrList.reduce((a, b) => a + b, 0) / hrList.length) : null;
    const maxList = dayWorkouts.map(w => Number(w.maxHr)).filter(h => h > 40);
    maxHr = maxList.length > 0 ? Math.max(...maxList) : null;
  } else if (manual && manual.strain !== undefined && manual.strain !== null && manual.strain !== '') {
    strain = Number(manual.strain);
    activeKcal = manual.activeKcal !== undefined ? Number(manual.activeKcal) : 0;
    avgHr = manual.avgHr ? Number(manual.avgHr) : null;
    maxHr = manual.maxHr ? Number(manual.maxHr) : null;
    workoutMins = manual.workoutMins ? Number(manual.workoutMins) : 0;
  }

  // 2. SLEEP PERFORMANCE & GARMIN SLEEP SCORE
  let sleepActualMin = null;
  let stages = null;
  let sleepEfficiency = null;
  let sleepScore = null;

  if (manual && manual.sleepScore !== undefined && manual.sleepScore !== null && manual.sleepScore !== '') {
    sleepScore = Number(manual.sleepScore);
  } else if (manual && manual.sleepEfficiency !== undefined && manual.sleepEfficiency !== null && manual.sleepEfficiency !== '') {
    sleepScore = Number(manual.sleepEfficiency);
  } else if (daySleep && daySleep.quality) {
    sleepScore = Math.min(100, Math.round(Number(daySleep.quality) * 20));
  }

  if (manual && manual.sleepActualMin !== undefined && manual.sleepActualMin !== null) {
    sleepActualMin = Number(manual.sleepActualMin);
    if (manual.stages && (manual.stages.deepMin !== undefined || manual.stages.remMin !== undefined)) {
      stages = {
        deepMin: Number(manual.stages.deepMin) || 0,
        remMin: Number(manual.stages.remMin) || 0,
        lightMin: Number(manual.stages.lightMin) || 0,
        awakeMin: Number(manual.stages.awakeMin) || 0
      };
      if (sleepActualMin > 120 && (stages.deepMin + stages.remMin + stages.lightMin) < 30) {
        stages = extractGarminSleepStages(manual, sleepActualMin, sleepScore, dateStr);
      }
    } else {
      stages = extractGarminSleepStages(manual, sleepActualMin, sleepScore, dateStr);
    }
    sleepEfficiency = sleepScore !== null ? sleepScore : 94;
  } else if (daySleep && daySleep.durationHours) {
    sleepActualMin = Math.round(Number(daySleep.durationHours) * 60);
    if (daySleep.stages && (daySleep.stages.deepMin !== undefined || daySleep.stages.remMin !== undefined)) {
      stages = {
        deepMin: Number(daySleep.stages.deepMin) || 0,
        remMin: Number(daySleep.stages.remMin) || 0,
        lightMin: Number(daySleep.stages.lightMin) || 0,
        awakeMin: Number(daySleep.stages.awakeMin) || 0
      };
      if (sleepActualMin > 120 && (stages.deepMin + stages.remMin + stages.lightMin) < 30) {
        stages = extractGarminSleepStages(daySleep, sleepActualMin, sleepScore, dateStr);
      }
    } else {
      stages = extractGarminSleepStages(daySleep, sleepActualMin, sleepScore, dateStr);
    }
    sleepEfficiency = sleepScore !== null ? sleepScore : 90;
  }

  // 3. TODAY'S SLEEP NEED (Alapszükséglet + Előző napi adósság + Napi Strain többlet)
  const baseNeedMin = 465; // 7ó 45p
  const prevDate = getPrevDateString(dateStr);
  const prevManual = _allWhoopLogs[prevDate];
  const prevSleep = _allSleepLogs.find(s => s.date === prevDate);

  let prevActualMin = null;
  if (prevManual && prevManual.sleepActualMin !== undefined) {
    prevActualMin = Number(prevManual.sleepActualMin);
  } else if (prevSleep && prevSleep.durationHours) {
    prevActualMin = Math.round(Number(prevSleep.durationHours) * 60);
  }

  let sleepDebtMin = 0;
  if (prevActualMin !== null && prevActualMin < baseNeedMin) {
    sleepDebtMin = Math.round(baseNeedMin - prevActualMin);
  }

  const currentStrainVal = strain !== null ? strain : 0;
  const strainSleepNeedMin = Math.round(currentStrainVal * 2.5);
  const sleepNeedMin = baseNeedMin + sleepDebtMin + strainSleepNeedMin;

  // 4. RECOVERY & BIOMETRIA (Garmin adatok & WHOOP kalkuláció)
  let recovery = null;
  let hrv = null;
  let rhr = null;
  let health = {
    rhr: null,
    hrv: null,
    skinTemp: null,
    spo2: null,
    respRate: null
  };

  if (manual) {
    if (manual.hrv !== undefined && manual.hrv !== null && manual.hrv !== '') {
      hrv = Number(manual.hrv);
    }
    if (manual.rhr !== undefined && manual.rhr !== null && manual.rhr !== '') {
      rhr = Number(manual.rhr);
    }

    // Bőrhőmérséklet eltérés
    let skinTempVal = null;
    const rawSkin = manual.health?.skinTemp ?? manual.health?.skin_temp_delta ?? manual.health?.body_temp_delta ??
      manual.health?.tempDelta ?? manual.health?.skin_temp ?? manual.skinTemp ?? manual.skin_temp_delta ??
      manual.body_temp_delta ?? manual.skinTempDelta ?? manual.bodyTempDelta ?? manual.tempDelta ??
      manual.temp_delta ?? manual.skin_temp ?? manual.temperatureDelta ?? null;
    if (rawSkin !== null && rawSkin !== undefined && rawSkin !== '') {
      const n = Number(rawSkin);
      if (!isNaN(n)) skinTempVal = Math.round(n * 10) / 10;
    }

    // Véroxigén (SpO2)
    let spo2Val = null;
    const rawSpo2 = manual.health?.spo2 ?? manual.health?.spO2 ?? manual.health?.average_spo2 ??
      manual.health?.avgSpo2 ?? manual.spo2 ?? manual.spO2 ?? manual.average_spo2 ?? manual.averageSpo2 ??
      manual.avgSpo2 ?? manual.avg_spo2 ?? manual.minSpo2 ?? manual.min_spo2 ?? null;
    if (rawSpo2 !== null && rawSpo2 !== undefined && rawSpo2 !== '') {
      let n = Number(rawSpo2);
      if (!isNaN(n) && n > 0) {
        if (n <= 1) n = Math.round(n * 100);
        else n = Math.round(n);
        spo2Val = n;
      }
    }

    // Légzésszám
    let respVal = null;
    const rawResp = manual.health?.respRate ?? manual.health?.respiration ?? manual.health?.average_respiration ??
      manual.health?.avgRespiration ?? manual.respRate ?? manual.respiration ?? manual.average_respiration ??
      manual.averageRespiration ?? manual.avgRespiration ?? manual.avg_respiration ??
      manual.sleepRespiration ?? manual.sleep_respiration ?? manual.resp ?? null;
    if (rawResp !== null && rawResp !== undefined && rawResp !== '') {
      const n = Number(rawResp);
      if (!isNaN(n) && n > 0) {
        respVal = Math.round(n * 10) / 10;
      }
    }

    health = {
      rhr: manual.health?.rhr !== undefined && manual.health?.rhr !== null ? Number(manual.health.rhr) : rhr,
      hrv: manual.health?.hrv !== undefined && manual.health?.hrv !== null ? Number(manual.health.hrv) : hrv,
      skinTemp: skinTempVal,
      spo2: spo2Val,
      respRate: respVal
    };

    // Hivatalos WHOOP Recovery kalkuláció
    if (hrv !== null && rhr !== null) {
      recovery = calcWhoopOfficialRecovery({
        hrv,
        rhr,
        sleepScore,
        respRate: respVal,
        skinTemp: skinTempVal
      });
    } else if (manual.recovery !== undefined && manual.recovery !== null && manual.recovery !== '') {
      recovery = Number(manual.recovery);
    }
  }

  // Ha a kiválasztott napon (pl. mai nap) még nincs rögzített SpO2 / légzés / bőrhőmérséklet,
  // akkor vegyük a legfrissebb elérhető Garmin adatot a korábbi napokból, hogy ne legyen üres!
  if (health.spo2 === null || health.respRate === null || health.skinTemp === null) {
    const recentWithData = Object.values(_allWhoopLogs || {})
      .filter(l => l && (
        l.health?.spo2 || l.spo2 || l.spO2 || l.average_spo2 || l.avgSpo2 ||
        l.health?.respRate || l.respRate || l.respiration || l.average_respiration ||
        (l.health && (l.health.skinTemp !== undefined && l.health.skinTemp !== null)) ||
        (l.skinTemp !== undefined && l.skinTemp !== null) ||
        (l.skin_temp_delta !== undefined && l.skin_temp_delta !== null) ||
        (l.body_temp_delta !== undefined && l.body_temp_delta !== null) ||
        (l.tempDelta !== undefined && l.tempDelta !== null)
      ))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (recentWithData.length > 0) {
      for (const latest of recentWithData) {
        if (health.spo2 === null) {
          let s = latest.health?.spo2 ?? latest.health?.spO2 ?? latest.health?.average_spo2 ?? latest.spo2 ?? latest.spO2 ?? latest.average_spo2 ?? latest.avgSpo2 ?? null;
          if (s !== null && s !== undefined && s !== '' && !isNaN(Number(s))) {
            let numS = Number(s);
            if (numS > 0 && numS <= 1) numS = Math.round(numS * 100);
            else if (numS > 0) numS = Math.round(numS);
            health.spo2 = numS;
          }
        }
        if (health.respRate === null) {
          let r = latest.health?.respRate ?? latest.health?.respiration ?? latest.health?.average_respiration ?? latest.respRate ?? latest.respiration ?? latest.average_respiration ?? latest.avgRespiration ?? null;
          if (r !== null && r !== undefined && r !== '' && !isNaN(Number(r)) && Number(r) > 0) {
            health.respRate = Math.round(Number(r) * 10) / 10;
          }
        }
        if (health.skinTemp === null) {
          let t = latest.health?.skinTemp ?? latest.health?.skin_temp_delta ?? latest.health?.body_temp_delta ?? latest.health?.tempDelta ?? latest.skinTemp ?? latest.skin_temp_delta ?? latest.body_temp_delta ?? latest.tempDelta ?? latest.temperatureDelta ?? null;
          if (t !== null && t !== undefined && t !== '' && !isNaN(Number(t))) {
            health.skinTemp = Math.round(Number(t) * 10) / 10;
          }
        }
      }
    }
  }

  // 5. STRESS SCORE (0.0 – 3.0 skála)
  let stressScore = null;
  let stressCategory = null; // 'low' | 'med' | 'high'
  if (rhr !== null && hrv !== null) {
    const rawStress = ((rhr / 50) * 1.25) - ((hrv / 75) * 0.65);
    stressScore = Math.min(2.9, Math.max(0.2, Math.round(rawStress * 10) / 10));
    if (stressScore < 1.0) stressCategory = 'low';
    else if (stressScore < 2.0) stressCategory = 'med';
    else stressCategory = 'high';
  }

  const journal = {
    caffeine: Boolean(manual?.journal?.caffeine),
    alcohol: Boolean(manual?.journal?.alcohol),
    sauna: Boolean(manual?.journal?.sauna),
    hydration: Boolean(manual?.journal?.hydration),
    stretch: Boolean(manual?.journal?.stretch),
    supplement: Boolean(manual?.journal?.supplement),
    ...(manual?.journal || {})
  };

  return {
    date: dateStr,
    hasRecoveryData: recovery !== null,
    recovery,
    hrv,
    rhr,
    hasStrainData: strain !== null,
    strain,
    activeKcal,
    avgHr,
    maxHr,
    workoutMins,
    hasSleepData: sleepActualMin !== null,
    sleepActualMin,
    sleepScore,
    baseNeedMin,
    sleepDebtMin,
    strainSleepNeedMin,
    sleepNeedMin,
    sleepEfficiency,
    stages,
    health,
    hasHealthData: health.rhr !== null || health.hrv !== null || health.spo2 !== null || health.skinTemp !== null || health.respRate !== null,
    stressScore,
    stressCategory,
    journal,
    dayWorkouts,
    dayRecoveryActs,
    isManual: Boolean(manual)
  };
}

function _getNutritionDataForDate(dateStr) {
  const mealsSource = (_allMeals && _allMeals.length > 0) ? _allMeals : (typeof window !== 'undefined' && window._allDietMeals ? window._allDietMeals : []);
  const hydraSource = (_allHydrationLogs && _allHydrationLogs.length > 0) ? _allHydrationLogs : (typeof window !== 'undefined' && window._allDietHydration ? window._allDietHydration : []);

  const dayMeals = mealsSource.filter(m => m.date === dateStr);
  const dayHydra = hydraSource.filter(h => h.date === dateStr);

  const calories = Math.round(dayMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0));
  const protein = Math.round(dayMeals.reduce((s, m) => s + (Number(m.protein) || 0), 0));
  const carbs = Math.round(dayMeals.reduce((s, m) => s + (Number(m.carbs) || 0), 0));
  const fat = Math.round(dayMeals.reduce((s, m) => s + (Number(m.fat) || 0), 0));
  const waterMl = Math.round(dayHydra.reduce((s, h) => s + (Number(h.effectiveMl) || Number(h.ml) || Number(h.amount) || 0), 0));

  let goals = null;
  try {
    goals = typeof getGoals === 'function' ? getGoals() : ((typeof window !== 'undefined' && window.getGoals) ? window.getGoals() : null);
  } catch (e) {
    goals = (typeof window !== 'undefined' && window.getGoals) ? window.getGoals() : null;
  }

  const weight = Number(_userProfile?.weight) || (goals?.weight ? Number(goals.weight) : 75);
  const targetCalories = Number(_userProfile?.calorieGoal) || Number(_userProfile?.calorieTarget) || (goals?.calorieGoal ? Number(goals.calorieGoal) : 2200);
  const baseWaterMl = Number(_userProfile?.waterGoal) || Number(_userProfile?.waterTarget) || (goals?.waterGoal ? Number(goals.waterGoal) : Math.round(weight * 35));
  const targetProtein = Number(_userProfile?.proteinGoal) || (goals?.proteinGoal ? Number(goals.proteinGoal) : 150);

  // Garmin edzések becsült izzadásának (Estimated Sweat Loss) hozzáadása a napi folyadékigényhez
  const workoutsSource = (_allWorkouts && _allWorkouts.length > 0) ? _allWorkouts : (typeof window !== 'undefined' && window._allWorkouts ? window._allWorkouts : []);
  const dayWorkouts = workoutsSource.filter(w => w.date === dateStr);
  const daySweatLossMl = dayWorkouts.reduce((s, w) => s + calcWorkoutSweatLoss(w), 0);
  const targetWaterMl = baseWaterMl + daySweatLossMl;

  const calPct = Math.min(100, Math.round((calories / (targetCalories || 1)) * 100));
  const waterPct = Math.min(100, Math.round((waterMl / (targetWaterMl || 1)) * 100));

  return {
    calories,
    targetCalories,
    calPct,
    protein,
    targetProtein,
    carbs,
    fat,
    waterMl,
    baseWaterMl,
    daySweatLossMl,
    targetWaterMl,
    waterPct,
    hasMeals: dayMeals.length > 0 || dayHydra.length > 0
  };
}

function _calcHabitRecoveryImpacts() {
  const recoveryDays = Object.entries(_allWhoopLogs)
    .filter(([_, log]) => typeof log.recovery === 'number' && log.recovery > 0)
    .map(([date, log]) => ({ date, recovery: log.recovery, journal: log.journal || {} }));

  const totalDaysWithRecovery = recoveryDays.length;

  const defaultHabits = [
    { id: 'caffeine', name: 'Koffein 14:00 után', emoji: '☕' },
    { id: 'alcohol', name: 'Alkohol fogyasztás', emoji: '🍷' },
    { id: 'sauna', name: 'Szauna / Hidegfürdő', emoji: '🧖' },
    { id: 'hydration', name: '3L+ Hidratáció', emoji: '💧' },
    { id: 'stretch', name: 'Nyújtás / SMR henger', emoji: '🧘' },
    { id: 'supplement', name: 'Táplálékkiegészítő', emoji: '💊' }
  ];

  const allHabitDefs = [
    ...defaultHabits,
    ..._customHabits.map(h => ({ id: h.id, name: h.name, emoji: h.emoji || '📌' }))
  ];

  if (totalDaysWithRecovery < 7) {
    return {
      hasEnoughData: false,
      loggedDays: totalDaysWithRecovery,
      requiredDays: 7,
      impacts: []
    };
  }

  const impacts = allHabitDefs.map(habit => {
    const onDays = recoveryDays.filter(d => Boolean(d.journal[habit.id]));
    const offDays = recoveryDays.filter(d => !Boolean(d.journal[habit.id]));

    if (onDays.length < 2 || offDays.length < 2) {
      return {
        ...habit,
        diff: null,
        onCount: onDays.length,
        offCount: offDays.length,
        statusText: 'Kevés adat'
      };
    }

    const avgOn = onDays.reduce((s, d) => s + d.recovery, 0) / onDays.length;
    const avgOff = offDays.reduce((s, d) => s + d.recovery, 0) / offDays.length;
    const diff = Math.round(avgOn - avgOff);

    return {
      ...habit,
      diff,
      avgOn: Math.round(avgOn),
      avgOff: Math.round(avgOff),
      onCount: onDays.length,
      offCount: offDays.length
    };
  });

  return {
    hasEnoughData: true,
    loggedDays: totalDaysWithRecovery,
    requiredDays: 7,
    impacts
  };
}

// ── Havi Naptár HTML Generáló (Recovery Színek + Strain Kék Körív) ──
function _renderMonthlyCalendarHTML() {
  const monthsHU = [
    'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
    'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'
  ];
  const year = _calendarYear;
  const month = _calendarMonth;
  const monthName = monthsHU[month];

  // Hétfő-alapú kezdőnap index (Hétfő = 0, Vasárnap = 6)
  const firstDay = new Date(year, month, 1).getDay();
  const startDayIdx = (firstDay + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const todayStr = todayString();

  let daysHtml = '';

  // Üres cellák a hónap kezdete előtt
  for (let i = 0; i < startDayIdx; i++) {
    daysHtml += `<div class="w-9 h-9 flex items-center justify-center opacity-0 pointer-events-none"></div>`;
  }

  // Napok generálása
  for (let d = 1; d <= totalDays; d++) {
    const dayStr = String(d).padStart(2, '0');
    const mStr = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${mStr}-${dayStr}`;

    const isPastOrToday = dateStr <= todayStr;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === _selectedDate;

    if (isPastOrToday) {
      const dData = _getWhoopDataForDate(dateStr);
      let recColor = '#94A3B8'; // Semleges szürke ha még nincs adat
      if (dData.hasRecoveryData) {
        const rec = Math.round(dData.recovery);
        if (rec >= 66) recColor = '#00E676';
        else if (rec >= 33) recColor = '#FFD600';
        else recColor = '#FF3D00';
      }

      // Strain (0.0 - 21.0) skála körív
      const strainVal = dData.hasStrainData ? dData.strain : 0.0;
      const c = 87.96; // r=14, 2*pi*14
      const strainRatio = Math.min(21, Math.max(0, strainVal)) / 21;
      const strainOffset = c * (1 - strainRatio);

      daysHtml += `
        <div class="relative w-9 h-9 flex items-center justify-center cursor-pointer group whoop5-cal-day-cell transition-transform active:scale-95 ${
          isSelected ? 'ring-2 ring-[#00E5FF] rounded-full bg-[#00E5FF]/15' : (isToday ? 'ring-1 ring-white/40 rounded-full' : '')
        }" data-date="${dateStr}" title="${dateStr} · Recovery: ${dData.hasRecoveryData ? `${Math.round(dData.recovery)}%` : 'Nincs adat'} · Strain: ${strainVal.toFixed(1)}">
          <svg class="w-full h-full transform -rotate-90 pointer-events-none" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="14" stroke="currentColor" stroke-width="2.5" fill="transparent" class="text-gray-200 dark:text-[#252832]" />
            <circle cx="18" cy="18" r="14" stroke="#00E5FF" stroke-width="2.5" stroke-linecap="round" fill="transparent"
                    stroke-dasharray="${c}" stroke-dashoffset="${strainOffset}"
                    style="transition: stroke-dashoffset 0.4s ease; filter: drop-shadow(0 0 2px rgba(0, 229, 255, 0.4));" />
          </svg>
          <span class="absolute text-[11px] font-black pointer-events-none" style="color: ${recColor};">${d}</span>
        </div>
      `;
    } else {
      // Jövőbeli nap (halvány szürke, nincs recovery és strain)
      daysHtml += `
        <div class="w-9 h-9 flex items-center justify-center text-[11px] font-medium text-gray-400 dark:text-gray-600 rounded-full opacity-60">
          ${d}
        </div>
      `;
    }
  }

  return `
    <div id="whoop5-monthly-calendar-panel" class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-4 mb-4 shadow-sm animate-in fade-in duration-200">
      <!-- Naptár Fejléc és Lapozó -->
      <div class="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-[#22242C]">
        <div class="flex items-center gap-2">
          <button id="whoop5-cal-prev-month" class="w-8 h-8 rounded-xl bg-gray-100 dark:bg-[#1E2026] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:text-[#00E5FF] active:scale-95 transition-all" title="Előző hónap">
            <i class="fa-solid fa-chevron-left text-xs"></i>
          </button>
          <h4 class="text-xs font-black text-gray-900 dark:text-white tracking-wide uppercase">${year}. ${monthName}</h4>
          <button id="whoop5-cal-next-month" class="w-8 h-8 rounded-xl bg-gray-100 dark:bg-[#1E2026] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:text-[#00E5FF] active:scale-95 transition-all" title="Következő hónap">
            <i class="fa-solid fa-chevron-right text-xs"></i>
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <button id="whoop5-cal-today-btn" class="px-2.5 py-1 rounded-xl bg-cyan-500/10 hover:bg-cyan-500 text-cyan-400 hover:text-black text-[10px] font-extrabold active:scale-95 transition-all" title="Ugrás a mai napra">
            Ma
          </button>
          <button id="whoop5-cal-close-btn" class="w-7 h-7 rounded-xl text-gray-400 hover:text-white flex items-center justify-center active:scale-95 transition-colors" title="Naptár bezárása">
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Hét napjai fejléc -->
      <div class="grid grid-cols-7 gap-1 text-center mb-2">
        <span class="text-[10px] font-bold text-gray-400">H</span>
        <span class="text-[10px] font-bold text-gray-400">K</span>
        <span class="text-[10px] font-bold text-gray-400">Sze</span>
        <span class="text-[10px] font-bold text-gray-400">Cs</span>
        <span class="text-[10px] font-bold text-gray-400">P</span>
        <span class="text-[10px] font-bold text-gray-400">Szo</span>
        <span class="text-[10px] font-bold text-gray-400">V</span>
      </div>

      <!-- Napok Rácsa (7 oszlop) -->
      <div class="grid grid-cols-7 gap-1 justify-items-center">
        ${daysHtml}
      </div>

      <!-- Naptár Jelmagyarázat -->
      <div class="mt-3 pt-3 border-t border-gray-100 dark:border-[#22242C] flex items-center justify-between flex-wrap gap-2 text-[10px]">
        <div class="flex items-center gap-2">
          <span class="flex items-center gap-1 font-bold text-[#00E676]"><span class="w-2 h-2 rounded-full bg-[#00E676]"></span> 66-100%</span>
          <span class="flex items-center gap-1 font-bold text-[#FFD600]"><span class="w-2 h-2 rounded-full bg-[#FFD600]"></span> 33-65%</span>
          <span class="flex items-center gap-1 font-bold text-[#FF3D00]"><span class="w-2 h-2 rounded-full bg-[#FF3D00]"></span> 0-32%</span>
        </div>
        <div class="flex items-center gap-1 text-[#00E5FF] font-bold">
          <i class="fa-solid fa-circle-notch text-[9px]"></i>
          <span>Kék körív: Strain (0-21)</span>
        </div>
      </div>
    </div>
  `;
}

// ── Today's Activities Havi Edzésnaptár HTML Generáló ─────────
function _renderActivitiesCalendarHTML() {
  const monthsHU = [
    'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
    'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'
  ];
  const year = _actCalendarYear;
  const month = _actCalendarMonth;
  const monthName = monthsHU[month];

  // Hétfő-alapú kezdőnap index (Hétfő = 0, Vasárnap = 6)
  const firstDay = new Date(year, month, 1).getDay();
  const startDayIdx = (firstDay + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const todayStr = todayString();

  let daysHtml = '';

  // Üres cellák a hónap kezdete előtt
  for (let i = 0; i < startDayIdx; i++) {
    daysHtml += `<div class="w-8 h-8 flex items-center justify-center opacity-0 pointer-events-none"></div>`;
  }

  // Napok generálása
  for (let d = 1; d <= totalDays; d++) {
    const dayStr = String(d).padStart(2, '0');
    const mStr = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${mStr}-${dayStr}`;

    const isSelected = dateStr === _selectedDate;
    const isToday = dateStr === todayStr;
    const dayWos = _allWorkouts.filter(w => w.date === dateStr);
    const hasWorkouts = dayWos.length > 0;

    let primaryIcon = 'fa-solid fa-dumbbell';
    if (hasWorkouts) {
      const sp = getSportById(dayWos[0].sportId || 'running');
      primaryIcon = sp.icon || 'fa-solid fa-person-running';
    }

    daysHtml += `
      <div class="relative w-8 h-8 flex flex-col items-center justify-center cursor-pointer rounded-xl transition-all active:scale-95 whoop-act-cal-day-cell ${
        isSelected
          ? 'bg-[#00E5FF] text-black font-black shadow-md shadow-[#00E5FF]/20 ring-2 ring-[#00E5FF]'
          : (hasWorkouts
              ? 'bg-[#00E5FF]/15 text-[#00E5FF] font-bold border border-[#00E5FF]/30 hover:bg-[#00E5FF]/25'
              : (isToday ? 'border border-gray-400 text-gray-900 dark:text-white font-bold' : 'text-gray-400 dark:text-gray-500 hover:text-white hover:bg-gray-100 dark:hover:bg-[#1E2026]'))
      }" data-date="${dateStr}" title="${dateStr}${hasWorkouts ? ` (${dayWos.length} edzés)` : ''}">
        <span class="text-[10px] leading-none">${d}</span>
        ${hasWorkouts ? `
          <i class="${primaryIcon} text-[8px] mt-0.5 pointer-events-none"></i>
        ` : ''}
      </div>
    `;
  }

  // A kiválasztott nap edzései
  const selectedDayWos = _allWorkouts.filter(w => w.date === _selectedDate);

  return `
    <div id="whoop-activities-calendar-panel" class="mb-4 p-4 rounded-3xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-200 dark:border-[#2A2C34] animate-in fade-in duration-200">
      <!-- Naptár Fejléc és Lapozó -->
      <div class="flex items-center justify-between pb-3 mb-3 border-b border-gray-200 dark:border-[#2A2C34]">
        <div class="flex items-center gap-2">
          <button id="whoop-act-cal-prev-month" type="button" class="w-7 h-7 rounded-lg bg-white dark:bg-[#252832] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:text-[#00E5FF] active:scale-95 transition-all" title="Előző hónap">
            <i class="fa-solid fa-chevron-left text-[10px]"></i>
          </button>
          <h4 class="text-xs font-black text-gray-900 dark:text-white tracking-wide uppercase">${year}. ${monthName}</h4>
          <button id="whoop-act-cal-next-month" type="button" class="w-7 h-7 rounded-lg bg-white dark:bg-[#252832] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:text-[#00E5FF] active:scale-95 transition-all" title="Következő hónap">
            <i class="fa-solid fa-chevron-right text-[10px]"></i>
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button id="whoop-act-cal-today-btn" type="button" class="px-2 py-1 rounded-lg bg-white dark:bg-[#252832] text-[10px] font-bold text-gray-700 dark:text-gray-300 hover:text-[#00E5FF]">Ma</button>
          <button id="whoop-act-cal-close-btn" type="button" class="w-7 h-7 rounded-lg bg-white dark:bg-[#252832] text-gray-400 hover:text-white flex items-center justify-center active:scale-95" title="Bezárás">
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Hét napjai fejléc -->
      <div class="grid grid-cols-7 gap-1 text-center mb-2">
        <span class="text-[9px] font-bold text-gray-400 uppercase">H</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">K</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">Sze</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">Cs</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">P</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">Szo</span>
        <span class="text-[9px] font-bold text-gray-400 uppercase">V</span>
      </div>

      <!-- Napok Rácsa -->
      <div class="grid grid-cols-7 gap-1 items-center justify-items-center mb-3">
        ${daysHtml}
      </div>

      <!-- Kiválasztott nap edzései -->
      <div class="pt-3 border-t border-gray-200 dark:border-[#2A2C34]">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            ${formatDateHU(_selectedDate)} · ${selectedDayWos.length} rögzített edzés
          </p>
        </div>

        ${selectedDayWos.length === 0 ? `
          <p class="text-xs text-gray-400 italic py-2">Ezen a napon nem volt rögzített edzés.</p>
        ` : `
          <div class="space-y-2">
            ${selectedDayWos.map(w => {
              const sp = getSportById(w.sportId || 'running');
              const sVal = calcWorkoutStrain(w);
              return `
                <div class="whoop-act-cal-wo-card p-3 rounded-2xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#2A2C34] hover:border-[#00E5FF]/40 cursor-pointer flex items-center justify-between transition-all active:scale-[0.99]" data-id="${w.id}">
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-[#00E5FF]/10 text-[#00E5FF] flex items-center justify-center text-sm">
                      <i class="${sp.icon || 'fa-solid fa-person-running'}"></i>
                    </div>
                    <div>
                      <h5 class="text-xs font-bold text-gray-900 dark:text-white">${w.name || sp.name}</h5>
                      <p class="text-[10px] text-gray-400">
                        ${w.duration || 0} perc ${w.distanceKm ? `· ${Number(w.distanceKm).toFixed(2)} km` : ''} ${w.calories ? `· ${w.calories} kcal` : ''}
                      </p>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="text-xs font-black text-[#00E5FF] tabular-nums">${sVal.toFixed(1)}</span>
                    <p class="text-[9px] font-bold text-gray-400 uppercase">Strain</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}


// ══════════════════════════════════════════════════════════════
// 1. HOME KÉPERNYŐ (LOCKIN KÖZPONTI MŰSZERFAL)
// ══════════════════════════════════════════════════════════════
export function _renderHomeScreen() {
  const container = $('whoop5-home-container');
  if (!container) return;

  const data = _getWhoopDataForDate(_selectedDate);
  const nutrition = _getNutritionDataForDate(_selectedDate);
  const habitImpactData = _calcHabitRecoveryImpacts();

  // ── Recovery szín & coaching ─────────────────────────────────
  let recColor = '#4B5563';
  let recBadgeText = 'NINCS RECOVERY ADAT';
  let recBadgeBg = 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  let recGlow = 'none';
  let coachingText = 'Még nem rögzítettél biometriát vagy alvást mára. Koppints a fenti „Kézi bevitel” gombra!';
  let targetStrainRange = '—';

  if (data.hasRecoveryData) {
    const rec = Math.max(0, Math.min(100, Math.round(data.recovery)));
    if (rec >= 66) {
      recColor = '#00E676';
      recBadgeText = 'OPTIMÁLIS REGENERÁCIÓ';
      recBadgeBg = 'bg-emerald-500/10 text-[#00E676] border-emerald-500/30';
      recGlow = 'drop-shadow(0 0 7px rgba(0, 230, 118, 0.4))';
      coachingText = 'A szervezeted kiválóan regenerálódott, készen áll a magas intenzitású edzésre és maximális terhelésre.';
      targetStrainRange = '14.0 – 17.5';
    } else if (rec >= 33) {
      recColor = '#FFD600';
      recBadgeText = 'KÖZEPES REGENERÁCIÓ';
      recBadgeBg = 'bg-amber-500/10 text-[#FFD600] border-amber-500/30';
      recGlow = 'drop-shadow(0 0 7px rgba(255, 214, 0, 0.4))';
      coachingText = 'Kiegyensúlyozott állapot. Fenntartó vagy mérsékelt intenzitású edzésterhelés javasolt.';
      targetStrainRange = '10.5 – 14.0';
    } else {
      recColor = '#FF3D00';
      recBadgeText = 'ALACSONY REGENERÁCIÓ';
      recBadgeBg = 'bg-red-500/10 text-[#FF3D00] border-red-500/30';
      recGlow = 'drop-shadow(0 0 7px rgba(255, 61, 0, 0.4))';
      coachingText = 'Alacsony regenerációs szint. Priorizáld a pihenést: könnyű mobilitás, aktív séta és korai fekvés ajánlott.';
      targetStrainRange = '6.0 – 10.0';
    }
  }

  // ── Körívek (Circle Progress Arcs) ───────────────────────────
  // 1. Sleep ring (r=36, c=226.19) - Garmin Sleep Score
  const cSmall = 226.19;
  const sleepRatio = data.hasSleepData ? Math.min(100, Math.round((data.sleepActualMin / data.sleepNeedMin) * 100)) : 0;
  const garminSleepScore = (data.sleepScore !== null && data.sleepScore !== undefined)
    ? Math.min(100, Math.max(0, Math.round(Number(data.sleepScore))))
    : (data.hasSleepData ? sleepRatio : null);
  const sleepOffset = garminSleepScore !== null ? cSmall - (cSmall * garminSleepScore / 100) : cSmall;

  // Legutolsó mért alvás (Last sleep) és alvási fázisok (Garmin Sleep Score szinkron)
  let lastSleepData = data;
  let lastSleepScore = garminSleepScore;
  let isFallbackSleep = false;
  if (!lastSleepData.hasSleepData) {
    const recentWhoopDates = Object.keys(_allWhoopLogs || {})
      .filter(d => _allWhoopLogs[d] && (_allWhoopLogs[d].sleepActualMin || _allWhoopLogs[d].sleepScore))
      .sort((a, b) => b.localeCompare(a));
    const recentSleepDocDates = (_allSleepLogs || [])
      .filter(s => s && s.durationHours && s.date)
      .map(s => s.date)
      .sort((a, b) => b.localeCompare(a));
    const allRecentDates = [...new Set([...recentWhoopDates, ...recentSleepDocDates])].sort((a, b) => b.localeCompare(a));
    if (allRecentDates.length > 0) {
      const latestWhoop = _getWhoopDataForDate(allRecentDates[0]);
      if (latestWhoop && latestWhoop.hasSleepData) {
        lastSleepData = latestWhoop;
        lastSleepScore = (latestWhoop.sleepScore !== null && latestWhoop.sleepScore !== undefined)
          ? Math.min(100, Math.max(0, Math.round(Number(latestWhoop.sleepScore))))
          : Math.min(100, Math.round((latestWhoop.sleepActualMin / latestWhoop.sleepNeedMin) * 100));
        isFallbackSleep = true;
      }
    }
  }

  let stg = lastSleepData.stages;
  if (!stg || (lastSleepData.sleepActualMin > 120 && ((stg.deepMin || 0) + (stg.remMin || 0) + (stg.lightMin || 0)) < 30)) {
    stg = lastSleepData.hasSleepData
      ? extractGarminSleepStages(lastSleepData, lastSleepData.sleepActualMin, lastSleepScore, lastSleepData.date)
      : { deepMin: 0, remMin: 0, lightMin: 0, awakeMin: 0 };
  }

  const deepMin = stg.deepMin || 0;
  const remMin = stg.remMin || 0;
  const lightMin = stg.lightMin || 0;
  const awakeMin = stg.awakeMin || 0;
  const stageTotal = (deepMin + remMin + lightMin + awakeMin) || 1;
  const deepPct = lastSleepData.hasSleepData ? Math.round((deepMin / stageTotal) * 100) : 0;
  const remPct = lastSleepData.hasSleepData ? Math.round((remMin / stageTotal) * 100) : 0;
  const awakePct = (lastSleepData.hasSleepData && awakeMin > 0) ? Math.max(1, Math.round((awakeMin / stageTotal) * 100)) : 0;
  const lightPct = lastSleepData.hasSleepData ? Math.max(0, 100 - deepPct - remPct - awakePct) : 0;

  // 2. Recovery ring (r=42, c=263.89) - Hero középső karika
  const cHero = 263.89;
  const recVal = data.hasRecoveryData ? Math.max(0, Math.min(100, Math.round(data.recovery))) : 0;
  const recOffset = data.hasRecoveryData ? cHero - (cHero * recVal / 100) : cHero;

  // 3. Strain ring (r=36, c=226.19)
  const strainVal = data.hasStrainData ? data.strain : 0.0;
  const strainPct = data.hasStrainData ? Math.min(100, (strainVal / 21.0) * 100) : 0;
  const strainOffset = data.hasStrainData ? cSmall - (cSmall * strainPct / 100) : cSmall;

  container.innerHTML = `
    <!-- Top Bar: LOCKIN Status & Date Switcher -->
    <div class="bg-white dark:bg-[#121316] border border-gray-200 dark:border-[#22242C] rounded-3xl p-4 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-[#22242C]">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF] animate-pulse"></span>
          <span class="text-xs font-black tracking-wider text-gray-900 dark:text-white uppercase font-sans">LOCKIN · PRO</span>
        </div>
        <div class="flex items-center gap-2">
          <!-- Naptár Gomb (Home-only) -->
          <button id="whoop5-toggle-calendar-btn" class="px-3 py-1 rounded-xl bg-gray-100 dark:bg-[#1B1C22] text-gray-700 dark:text-gray-200 hover:text-[#00E5FF] dark:hover:text-[#00E5FF] font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1.5 border border-gray-200 dark:border-[#2A2C34]" title="Havi naptár megnyitása">
            <i class="fa-solid fa-calendar-days text-[#00E5FF]"></i>
            <span>Naptár</span>
          </button>
          <button id="whoop5-open-entry-btn" class="px-3 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1.5">
            <i class="fa-solid fa-pen text-[10px]"></i>
            <span>Kézi bevitel</span>
          </button>
        </div>
      </div>

      <!-- Dátum Lapozó -->
      <div class="flex items-center justify-between">
        <button id="whoop5-prev-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1B1C22] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <div id="whoop5-header-date-click" class="text-center relative flex-1 cursor-pointer">
          <h3 class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight">${formatDateHU(_selectedDate)}</h3>
          <p class="text-[11px] text-gray-400 font-medium flex items-center justify-center gap-1">
            <i class="fa-solid fa-calendar text-[#00E5FF] text-[10px]"></i>
            <span>Havi nézet</span>
          </p>
          <input id="whoop5-date-picker" type="date" value="${_selectedDate}" class="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>
        <button id="whoop5-next-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1B1C22] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-right text-sm"></i>
        </button>
      </div>
    </div>

    <!-- HAVI NAPTÁR PANEL (HA NYITVA VAN) -->
    ${_isHomeCalendarOpen ? _renderMonthlyCalendarHTML() : ''}

    <!-- 1. FELÜL A 3 KARIKA (SLEEP, RECOVERY, STRAIN) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="grid grid-cols-3 gap-2 items-center justify-items-center">

        <!-- A. SLEEP KARIKA -->
        <div class="flex flex-col items-center text-center w-full">
          <div class="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="36" stroke="currentColor" stroke-width="6.5" fill="transparent" class="text-gray-100 dark:text-[#22242C]" />
              <circle cx="44" cy="44" r="36" stroke="#00E5FF" stroke-width="6.5" stroke-linecap="round" fill="transparent"
                      stroke-dasharray="${cSmall}" stroke-dashoffset="${sleepOffset}"
                      style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.4));" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span class="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-none">
                ${garminSleepScore !== null ? `${garminSleepScore}%` : '—'}
              </span>
              <span class="text-[9px] font-semibold text-gray-400 mt-1">
                ${data.hasSleepData ? formatMinutesToHours(data.sleepActualMin) : '—'}
              </span>
            </div>
          </div>
          <span class="text-[11px] font-black uppercase tracking-wider text-gray-400 mt-2">SLEEP</span>
        </div>

        <!-- B. RECOVERY KARIKA (KÖZÉPSŐ HERO) -->
        <div class="flex flex-col items-center text-center w-full">
          <div class="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="7.5" fill="transparent" class="text-gray-100 dark:text-[#22242C]" />
              <circle cx="50" cy="50" r="42" stroke="${recColor}" stroke-width="7.5" stroke-linecap="round" fill="transparent"
                      stroke-dasharray="${cHero}" stroke-dashoffset="${recOffset}"
                      style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1); filter: ${recGlow};" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span class="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tabular-nums leading-none">
                ${data.hasRecoveryData ? `${recVal}%` : '—'}
              </span>
              <span class="text-[9px] font-semibold mt-1" style="color: ${recColor};">
                ${data.hasRecoveryData && data.hrv ? `${data.hrv} ms` : '—'}
              </span>
            </div>
          </div>
          <span class="text-[11px] font-black uppercase tracking-wider text-gray-400 mt-2" style="color: ${data.hasRecoveryData ? recColor : ''}">RECOVERY</span>
        </div>

        <!-- C. STRAIN KARIKA -->
        <div class="flex flex-col items-center text-center w-full">
          <div class="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="36" stroke="currentColor" stroke-width="6.5" fill="transparent" class="text-gray-100 dark:text-[#22242C]" />
              <circle cx="44" cy="44" r="36" stroke="#00E5FF" stroke-width="6.5" stroke-linecap="round" fill="transparent"
                      stroke-dasharray="${cSmall}" stroke-dashoffset="${strainOffset}"
                      style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.4));" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span class="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-none">
                ${data.hasStrainData ? strainVal.toFixed(1) : '—'}
              </span>
              <span class="text-[9px] font-semibold text-gray-400 mt-1">
                ${data.hasStrainData ? `${data.activeKcal || 0} kcal` : '0 kcal'}
              </span>
            </div>
          </div>
          <span class="text-[11px] font-black uppercase tracking-wider text-[#00E5FF] mt-2">STRAIN</span>
        </div>

      </div>

      <!-- Coaching status banner a 3 karika alatt -->
      <div class="mt-4 pt-4 border-t border-gray-100 dark:border-[#22242C] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${recBadgeBg}">
            ${recBadgeText}
          </span>
          <span class="text-[11px] text-gray-400 font-medium">Cél terhelés: ${targetStrainRange}</span>
        </div>
        <span class="text-[10px] text-gray-400 italic hidden sm:inline-block">${coachingText}</span>
      </div>
    </div>

    <!-- 2. ALATTA EGYMÁS MELLETT KICSISÉG: HEALTH MONITOR ÉS STRESS MONITOR -->
    <div class="grid grid-cols-2 gap-3 mb-4">

      <!-- Health Monitor Mini Kártya -->
      <div id="whoop-card-health-monitor" class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-2xl p-3.5 shadow-sm hover:border-[#00E5FF]/40 cursor-pointer transition-all active:scale-[0.98]">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-heart-pulse text-emerald-400 text-xs"></i>
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Health Monitor</span>
          </div>
          <i class="fa-solid fa-chevron-right text-[10px] text-gray-500"></i>
        </div>
        <div class="flex items-baseline gap-1.5 mb-1.5">
          <span class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">
            ${data.hasHealthData ? (data.health.rhr ? `${data.health.rhr} bpm` : 'Aktív') : '—'}
          </span>
          <span class="text-[10px] text-gray-400">${data.hasHealthData ? 'Nyugalmi' : 'Nincs adat'}</span>
        </div>
        <div class="flex items-center gap-1">
          ${data.hasHealthData ? `
            <span class="w-2 h-2 rounded-full bg-[#00E676]" title="RHR"></span>
            <span class="w-2 h-2 rounded-full bg-[#00E676]" title="HRV"></span>
            <span class="w-2 h-2 rounded-full bg-[#00E676]" title="SpO2"></span>
            <span class="w-2 h-2 rounded-full bg-[#00E676]" title="Bőrhőm."></span>
            <span class="w-2 h-2 rounded-full bg-[#00E676]" title="Légzés"></span>
            <span class="text-[9px] font-bold text-[#00E676] ml-1">5/5 Bázison</span>
          ` : `
            <span class="w-2 h-2 rounded-full bg-gray-500/40"></span>
            <span class="w-2 h-2 rounded-full bg-gray-500/40"></span>
            <span class="w-2 h-2 rounded-full bg-gray-500/40"></span>
            <span class="w-2 h-2 rounded-full bg-gray-500/40"></span>
            <span class="w-2 h-2 rounded-full bg-gray-500/40"></span>
            <span class="text-[9px] font-bold text-gray-400 ml-1">Koppints</span>
          `}
        </div>
      </div>

      <!-- Stress Monitor Mini Kártya -->
      <div id="whoop-card-stress-monitor" class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-2xl p-3.5 shadow-sm hover:border-[#00E5FF]/40 cursor-pointer transition-all active:scale-[0.98]">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-brain text-[#00E5FF] text-xs"></i>
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Stress Monitor</span>
          </div>
          <i class="fa-solid fa-chevron-right text-[10px] text-gray-500"></i>
        </div>
        <div class="flex items-baseline gap-1.5 mb-1.5">
          <span class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">
            ${data.stressScore !== null ? `${data.stressScore.toFixed(1)}` : '—'}
          </span>
          <span class="text-[10px] text-gray-400">${data.stressScore !== null ? '/ 3.0' : 'Nincs adat'}</span>
        </div>
        <div class="relative w-full h-1.5 bg-gray-100 dark:bg-[#22242C] rounded-full overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500"
               style="width: ${data.stressScore !== null ? Math.round((data.stressScore / 3.0) * 100) : 0}%;"></div>
        </div>
        <div class="flex items-center justify-between text-[9px] text-gray-400 mt-1 font-semibold">
          <span>${data.stressScore !== null ? (data.stressScore < 1.0 ? 'Alacsony' : data.stressScore < 2.0 ? 'Közepes' : 'Magas') : 'Koppints'}</span>
          <span class="text-[#00E5FF]"><i class="fa-solid fa-wind text-[8px] mr-0.5"></i>Légzés</span>
        </div>
      </div>

    </div>

    <!-- 2.5 ALATTA A TODAY'S NUTRITION (Mai Étrend & Makrók) -->
    <div id="whoop-nutrition-card" class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-emerald-500/50 rounded-3xl p-5 mb-4 shadow-sm transition-all cursor-pointer group">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-utensils text-emerald-500 text-sm group-hover:scale-110 transition-transform"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400 group-hover:text-emerald-500 transition-colors">Today's Nutrition</h4>
        </div>
        <div class="flex items-center gap-1.5" onclick="event.stopPropagation()">
          <button id="whoop-quick-add-meal-btn" type="button" class="px-2.5 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white font-extrabold text-[10px] active:scale-95 transition-all flex items-center gap-1" title="Új étkezés naplózása">
            <i class="fa-solid fa-plus text-[9px]"></i>
            <span>Étel</span>
          </button>
          <button id="whoop-quick-water-btn" type="button" class="px-2.5 py-1 rounded-xl bg-cyan-500/10 hover:bg-cyan-500 text-cyan-400 hover:text-black font-extrabold text-[10px] active:scale-95 transition-all flex items-center gap-1" title="+250ml víz hozzáadása">
            <span>💧 +250ml</span>
          </button>
          <button id="whoop-go-diet-btn" type="button" class="px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-[#1B1C22] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold text-[10px] active:scale-95 transition-all" title="Ugrás a Diéta modulra">
            <span>Diéta →</span>
          </button>
        </div>
      </div>

      <div class="flex items-baseline justify-between mb-2">
        <div>
          <span class="text-2xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight">
            ${nutrition.hasMeals ? `${nutrition.calories.toLocaleString()} <span class="text-xs font-semibold text-gray-400">kcal</span>` : '—'}
          </span>
          <span class="text-xs font-semibold text-gray-400 ml-1">/ ${nutrition.targetCalories.toLocaleString()} kcal cél</span>
        </div>
        <span class="text-[11px] font-bold ${nutrition.hasMeals ? 'text-emerald-500' : 'text-gray-400'}">
          ${nutrition.hasMeals ? `${nutrition.calPct}% elérve` : 'Még nincs étkezés rögzítve'}
        </span>
      </div>

      <!-- Haladási sáv -->
      <div class="relative w-full h-2.5 bg-gray-100 dark:bg-[#1B1C22] rounded-full overflow-hidden p-0.5 border border-gray-200 dark:border-[#2A2C34] mb-3">
        <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-700"
             style="width: ${nutrition.hasMeals ? Math.min(100, nutrition.calPct) : 0}%;"></div>
      </div>

      <!-- Makró és Hidratáció chipek -->
      <div class="grid grid-cols-4 gap-2 pt-2 border-t border-gray-100 dark:border-[#22242C] text-center">
        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Fehérje</p>
          <p class="text-xs font-extrabold text-emerald-500 tabular-nums mt-0.5">${nutrition.protein}g</p>
        </div>
        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Szénhidrát</p>
          <p class="text-xs font-extrabold text-amber-500 tabular-nums mt-0.5">${nutrition.carbs}g</p>
        </div>
        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Zsír</p>
          <p class="text-xs font-extrabold text-rose-500 tabular-nums mt-0.5">${nutrition.fat}g</p>
        </div>
        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Víz (💧)</p>
          <p class="text-xs font-extrabold text-cyan-400 tabular-nums mt-0.5">${(nutrition.waterMl / 1000).toFixed(1)} / ${(nutrition.targetWaterMl / 1000).toFixed(1)} L</p>
          ${nutrition.daySweatLossMl > 0 ? `<p class="text-[8px] font-semibold text-sky-400 dark:text-sky-300 mt-0.5" title="Becsült izzadás Garmin edzésekből">+${nutrition.daySweatLossMl}ml edzés</p>` : ''}
        </div>
      </div>
    </div>

    <!-- 3. LAST SLEEP & ALVÁSI FÁZISOK (Garmin Sleep Score és fázisok) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-moon text-indigo-400 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Last sleep</h4>
        </div>
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40" title="Garmin által előírt alvásigény a következő alvásra">
          <span class="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Következő ajánlás:</span>
          <span class="text-xs font-black text-indigo-500 dark:text-indigo-400 tabular-nums">${formatMinutesToHours(data.sleepNeedMin)}</span>
        </div>
      </div>

      <div class="flex items-baseline justify-between mb-3">
        <div class="flex items-baseline gap-2">
          <span class="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight">
            ${lastSleepData.hasSleepData ? formatMinutesToHours(lastSleepData.sleepActualMin) : '—'}
          </span>
          <span class="text-xs font-bold text-gray-400">mért alvás</span>
        </div>
        <div class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 font-black text-xs tabular-nums">
          <span>${lastSleepScore !== null ? `${lastSleepScore}%` : '—'}</span>
          <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Score</span>
        </div>
      </div>

      <!-- Alvási fázisok sávdiagram -->
      <div class="w-full h-3 rounded-full overflow-hidden flex gap-0.5 bg-gray-100 dark:bg-[#1B1C22] p-0.5 border border-gray-200 dark:border-[#2A2C34] mb-3">
        ${lastSleepData.hasSleepData ? `
          <div style="width: ${deepPct}%;" class="h-full bg-indigo-600 rounded-l-full transition-all duration-500" title="Mély: ${formatMinutesToHours(deepMin)} (${deepPct}%)"></div>
          <div style="width: ${remPct}%;" class="h-full bg-[#00E5FF] transition-all duration-500" title="REM: ${formatMinutesToHours(remMin)} (${remPct}%)"></div>
          <div style="width: ${lightPct}%;" class="h-full bg-indigo-400/80 transition-all duration-500" title="Könnyű: ${formatMinutesToHours(lightMin)} (${lightPct}%)"></div>
          <div style="width: ${awakePct}%;" class="h-full bg-rose-400 rounded-r-full transition-all duration-500" title="Ébren: ${formatMinutesToHours(awakeMin)} (${awakePct}%)"></div>
        ` : `
          <div class="w-full h-full bg-gray-200 dark:bg-gray-800 rounded-full"></div>
        `}
      </div>

      <!-- 4 alvási fázis részletezés -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100 dark:border-[#22242C] text-center">
        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22] flex flex-col items-center">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
            <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Mély</p>
          </div>
          <p class="text-xs font-extrabold text-gray-800 dark:text-gray-200 tabular-nums">
            ${lastSleepData.hasSleepData ? formatMinutesToHours(deepMin) : '—'}
          </p>
          <span class="text-[9px] font-semibold text-gray-400 mt-0.5">${lastSleepData.hasSleepData ? `${deepPct}%` : ''}</span>
        </div>

        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22] flex flex-col items-center">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-2 h-2 rounded-full bg-[#00E5FF]"></span>
            <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">REM</p>
          </div>
          <p class="text-xs font-extrabold text-gray-800 dark:text-gray-200 tabular-nums">
            ${lastSleepData.hasSleepData ? formatMinutesToHours(remMin) : '—'}
          </p>
          <span class="text-[9px] font-semibold text-gray-400 mt-0.5">${lastSleepData.hasSleepData ? `${remPct}%` : ''}</span>
        </div>

        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22] flex flex-col items-center">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
            <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Könnyű</p>
          </div>
          <p class="text-xs font-extrabold text-gray-800 dark:text-gray-200 tabular-nums">
            ${lastSleepData.hasSleepData ? formatMinutesToHours(lightMin) : '—'}
          </p>
          <span class="text-[9px] font-semibold text-gray-400 mt-0.5">${lastSleepData.hasSleepData ? `${lightPct}%` : ''}</span>
        </div>

        <div class="p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22] flex flex-col items-center">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-2 h-2 rounded-full bg-rose-400"></span>
            <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Ébren</p>
          </div>
          <p class="text-xs font-extrabold text-gray-800 dark:text-gray-200 tabular-nums">
            ${lastSleepData.hasSleepData ? formatMinutesToHours(awakeMin) : '—'}
          </p>
          <span class="text-[9px] font-semibold text-gray-400 mt-0.5">${lastSleepData.hasSleepData ? `${awakePct}%` : ''}</span>
        </div>
      </div>
    </div>

    <!-- 4. ALATTA A TODAY'S ACTIVITIES (Strain aktivitások kékek, Recovery aktivitások világoskékek) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-person-running text-[#00E5FF] text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Today's Activities</h4>
        </div>
        <!-- Jobb oldali gombok: Naptár ikon és Plusz jel -->
        <div class="flex items-center gap-2">
          <button id="whoop-activities-cal-btn" type="button" class="w-8 h-8 rounded-full bg-[#00E5FF]/10 hover:bg-[#00E5FF] text-[#00E5FF] hover:text-black flex items-center justify-center transition-all active:scale-95 shadow-sm" title="Edzésnaptár (Havi nézet)">
            <i class="fa-solid fa-calendar-days text-xs"></i>
          </button>
          <button id="whoop-add-activity-btn" type="button" class="w-8 h-8 rounded-full bg-[#00E5FF]/10 hover:bg-[#00E5FF] text-[#00E5FF] hover:text-black flex items-center justify-center transition-all active:scale-95 shadow-sm" title="Aktivitás rögzítése">
            <i class="fa-solid fa-plus text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Havi Edzésnaptár Nézet (Ha nyitva van) -->
      ${_isActivitiesCalendarOpen ? _renderActivitiesCalendarHTML() : ''}

      <div id="whoop-today-activities-list" class="space-y-2"></div>
    </div>

    <!-- 5. ALATTA A JOURNAL (Lockin Napi Szokások) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-book-bookmark text-amber-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Lockin Journal (Napi szokások)</h4>
        </div>
        <button id="whoop-add-habit-btn" type="button" class="px-2.5 py-1 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-500 hover:text-black font-extrabold text-[10px] active:scale-95 transition-all flex items-center gap-1 shadow-sm">
          <i class="fa-solid fa-plus text-[9px]"></i>
          <span>Új szokás</span>
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <!-- Beépített szokások -->
        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.caffeine ? 'bg-amber-500/10 border-amber-500/40 text-amber-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="caffeine">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">☕</span>
            <i class="fa-solid ${data.journal.caffeine ? 'fa-circle-check text-amber-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Koffein 14:00 után</p>
        </button>

        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.alcohol ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="alcohol">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🍷</span>
            <i class="fa-solid ${data.journal.alcohol ? 'fa-circle-check text-red-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Alkohol fogyasztás</p>
        </button>

        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.sauna ? 'bg-orange-500/10 border-orange-500/40 text-orange-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="sauna">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🧖</span>
            <i class="fa-solid ${data.journal.sauna ? 'fa-circle-check text-orange-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Szauna / Hidegfürdő</p>
        </button>

        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.hydration ? 'bg-sky-500/10 border-sky-500/40 text-sky-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="hydration">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">💧</span>
            <i class="fa-solid ${data.journal.hydration ? 'fa-circle-check text-sky-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">3L+ Hidratáció</p>
        </button>

        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.stretch ? 'bg-violet-500/10 border-violet-500/40 text-violet-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="stretch">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🧘</span>
            <i class="fa-solid ${data.journal.stretch ? 'fa-circle-check text-violet-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Nyújtás / SMR henger</p>
        </button>

        <button class="whoop5-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.supplement ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="supplement">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">💊</span>
            <i class="fa-solid ${data.journal.supplement ? 'fa-circle-check text-emerald-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Táplálékkiegészítő</p>
        </button>

        <!-- Egyéni szokások (Custom Habits) -->
        ${_customHabits.map(h => {
          const isChecked = Boolean(data.journal[h.id]);
          return `
            <div class="relative group">
              <button class="whoop5-journal-btn w-full p-3 rounded-2xl border text-left transition-all ${isChecked ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400' : 'bg-gray-50 dark:bg-[#1B1C22] border-gray-200 dark:border-[#2A2C34] text-gray-600 dark:text-gray-400'}" data-habit="${h.id}">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-lg">${h.emoji || '📌'}</span>
                  <i class="fa-solid ${isChecked ? 'fa-circle-check text-cyan-400' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
                </div>
                <p class="text-xs font-bold truncate pr-3">${h.name}</p>
              </button>
              <button class="whoop5-delete-custom-habit-btn absolute top-2 right-2 w-6 h-6 rounded-full bg-gray-200 dark:bg-[#252832] text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px]" data-habit-id="${h.id}" title="Szokás törlése">
                <i class="fa-solid fa-xmark pointer-events-none"></i>
              </button>
            </div>
          `;
        }).join('')}
      </div>

      <!-- 1 hét naplózás utáni regenerációs hatás (Recovery Impact Analysis) -->
      ${habitImpactData.hasEnoughData ? `
        <div class="mt-4 pt-4 border-t border-gray-100 dark:border-[#22242C]">
          <div class="flex items-center justify-between mb-2.5">
            <div class="flex items-center gap-1.5">
              <i class="fa-solid fa-chart-line text-[#00E676] text-xs"></i>
              <h5 class="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">Regenerációs Hatás (${habitImpactData.loggedDays} nap adatai)</h5>
            </div>
            <span class="text-[10px] font-bold text-[#00E676] bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Statisztikai összefüggés ✓</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${habitImpactData.impacts.map(imp => {
              if (imp.diff === null) {
                return `
                  <div class="p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#2A2C34] flex items-center justify-between">
                    <span class="text-xs truncate mr-1">${imp.emoji} ${imp.name}</span>
                    <span class="text-[10px] text-gray-400 font-bold">Folyamatban...</span>
                  </div>
                `;
              }
              const isPositive = imp.diff > 0;
              const isZero = imp.diff === 0;
              const color = isPositive ? 'text-[#00E676]' : (isZero ? 'text-gray-400' : 'text-[#FF3D00]');
              const bg = isPositive ? 'bg-emerald-500/10 border-emerald-500/20' : (isZero ? 'bg-gray-500/10 border-gray-500/20' : 'bg-red-500/10 border-red-500/20');
              const sign = isPositive ? '+' : '';
              return `
                <div class="p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#2A2C34] flex items-center justify-between">
                  <div class="min-w-0 mr-1">
                    <p class="text-[11px] font-bold text-gray-800 dark:text-gray-200 truncate">${imp.emoji} ${imp.name}</p>
                    <p class="text-[9px] text-gray-400">${imp.onCount} aktív nap</p>
                  </div>
                  <span class="text-xs font-black px-2 py-0.5 rounded-lg border ${bg} ${color} tabular-nums flex-shrink-0">
                    ${sign}${imp.diff}%
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : `
        <div class="mt-4 pt-3 border-t border-gray-100 dark:border-[#22242C]">
          <div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
            <i class="fa-solid fa-chart-pie text-amber-500 text-sm mt-0.5 flex-shrink-0"></i>
            <div class="flex-1">
              <div class="flex items-center justify-between">
                <p class="text-[11px] font-bold text-gray-900 dark:text-white">Regenerációs Hatáselemzés (Insights)</p>
                <span class="text-[10px] font-bold text-amber-500">${habitImpactData.loggedDays} / 7 nap</span>
              </div>
              <p class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                Még <b>${habitImpactData.requiredDays - habitImpactData.loggedDays} nap</b> naplózás szükséges a szokások pontos regenerációs hatáselemzéséhez. 1 hét után megmutatjuk, mely szokásaid hány %-kal növelik vagy rontják a Recovery-t!
              </p>
              <div class="w-full h-1.5 bg-gray-200 dark:bg-[#252730] rounded-full overflow-hidden mt-2">
                <div class="h-full bg-amber-500 rounded-full transition-all duration-500" style="width: ${Math.round((habitImpactData.loggedDays / 7) * 100)}%;"></div>
              </div>
            </div>
          </div>
        </div>
      `}
    </div>

    <!-- 6. ALATTA A MY DASHBOARD AZ EGYÉB ADATOKKAL -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-chart-simple text-[#00E5FF] text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">My Dashboard</h4>
        </div>
        <span class="text-[10px] text-gray-400">Élettani mutatók</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <!-- RHR -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Nyugalmi Pulzus</p>
          <p class="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
            ${data.hasHealthData && data.health.rhr ? `${data.health.rhr} <span class="text-xs font-normal text-gray-400">bpm</span>` : '—'}
          </p>
        </div>

        <!-- HRV -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pulzusvariabilitás</p>
          <p class="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
            ${data.hasHealthData && data.health.hrv ? `${data.health.hrv} <span class="text-xs font-normal text-gray-400">ms</span>` : '—'}
          </p>
        </div>

        <!-- SpO2 -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Véroxigén (SpO₂)</p>
          <p class="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
            ${data.health.spo2 !== null && data.health.spo2 !== undefined ? `${data.health.spo2} <span class="text-xs font-normal text-gray-400">%</span>` : '—'}
          </p>
        </div>

        <!-- Bőrhőm -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bőrhőmérséklet</p>
          <p class="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
            ${data.health.skinTemp !== null && data.health.skinTemp !== undefined ? `${data.health.skinTemp > 0 ? '+' : ''}${data.health.skinTemp} <span class="text-xs font-normal text-gray-400">°C</span>` : '—'}
          </p>
        </div>

        <!-- Légzésszám -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Légzésszám</p>
          <p class="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
            ${data.health.respRate !== null && data.health.respRate !== undefined ? `${data.health.respRate} <span class="text-xs font-normal text-gray-400">/perc</span>` : '—'}
          </p>
        </div>

        <!-- Aktív kalória -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Aktív Kalória</p>
          <p class="text-base font-extrabold text-[#00E5FF] tabular-nums mt-0.5">
            ${data.activeKcal !== null ? `${data.activeKcal} <span class="text-xs font-normal text-gray-400">kcal</span>` : '—'}
          </p>
        </div>
      </div>
    </div>

    <!-- 7. ALATTA GRAFIKONON A HETI STRAIN ÉS A RECOVERY EGYMÁSHOZ VISZONYÍTVA -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-8 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-chart-line text-[#00E5FF] text-sm"></i>
          <div>
            <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Strain vs. Recovery</h4>
            <p class="text-[10px] text-gray-400">Heti terhelési és regenerációs egyensúly</p>
          </div>
        </div>
        <div class="flex items-center gap-3 text-[10px] font-bold">
          <span class="flex items-center gap-1 text-[#00E676]"><span class="w-2.5 h-2.5 rounded-sm bg-[#00E676]"></span> Recovery %</span>
          <span class="flex items-center gap-1 text-[#00E5FF]"><span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></span> Strain (0-21)</span>
        </div>
      </div>

      <div id="whoop5-weekly-strain-recovery-chart" class="w-full h-48 flex items-center justify-center"></div>

      <div id="whoop5-weekly-summary-footer" class="mt-3 pt-3 border-t border-gray-100 dark:border-[#22242C] flex items-center justify-between text-xs"></div>
    </div>
  `;

  _bindHomeEvents();
  _renderHomeTodayActivities();
  _renderWeeklyStrainRecoveryChart();
}

// ── Home Események Bekötése ────────────────────────────────
function _bindHomeEvents() {
  const prevBtn = $('whoop5-prev-day-btn');
  const nextBtn = $('whoop5-next-day-btn');
  const datePicker = $('whoop5-date-picker');
  const entryBtn = $('whoop5-open-entry-btn');
  const addActBtn = $('whoop-add-activity-btn');
  const cardHealth = $('whoop-card-health-monitor');
  const cardStress = $('whoop-card-stress-monitor');

  // Havi naptár gomb és dátum fejléc nyitás/csukás
  const toggleCalBtn = $('whoop5-toggle-calendar-btn');
  const dateHeaderClick = $('whoop5-header-date-click');
  const toggleHandler = () => {
    _isHomeCalendarOpen = !_isHomeCalendarOpen;
    _renderHomeScreen();
  };
  if (toggleCalBtn) toggleCalBtn.addEventListener('click', toggleHandler);
  if (dateHeaderClick) {
    dateHeaderClick.addEventListener('click', (e) => {
      if (e.target.id === 'whoop5-date-picker') return;
      toggleHandler();
    });
  }

  // Naptár navigációs gombok
  const calPrevBtn = $('whoop5-cal-prev-month');
  if (calPrevBtn) {
    calPrevBtn.addEventListener('click', () => {
      _calendarMonth--;
      if (_calendarMonth < 0) {
        _calendarMonth = 11;
        _calendarYear--;
      }
      _renderHomeScreen();
    });
  }

  const calNextBtn = $('whoop5-cal-next-month');
  if (calNextBtn) {
    calNextBtn.addEventListener('click', () => {
      _calendarMonth++;
      if (_calendarMonth > 11) {
        _calendarMonth = 0;
        _calendarYear++;
      }
      _renderHomeScreen();
    });
  }

  const calTodayBtn = $('whoop5-cal-today-btn');
  if (calTodayBtn) {
    calTodayBtn.addEventListener('click', () => {
      const now = new Date();
      _calendarYear = now.getFullYear();
      _calendarMonth = now.getMonth();
      _selectedDate = todayString();
      if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
      _renderHomeScreen();
      _renderHealthScreen();
    });
  }

  const calCloseBtn = $('whoop5-cal-close-btn');
  if (calCloseBtn) {
    calCloseBtn.addEventListener('click', () => {
      _isHomeCalendarOpen = false;
      _renderHomeScreen();
    });
  }

  // Naptár napjaira kattintás
  document.querySelectorAll('.whoop5-cal-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = cell.dataset.date;
      if (d) {
        _selectedDate = d;
        if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
        _renderHomeScreen();
        _renderHealthScreen();
      }
    });
  });

  // Today's Activities Edzésnaptár eseményei
  const actCalBtn = $('whoop-activities-cal-btn');
  if (actCalBtn) {
    actCalBtn.addEventListener('click', () => {
      _isActivitiesCalendarOpen = !_isActivitiesCalendarOpen;
      _renderHomeScreen();
    });
  }

  const actCalPrevBtn = $('whoop-act-cal-prev-month');
  if (actCalPrevBtn) {
    actCalPrevBtn.addEventListener('click', () => {
      _actCalendarMonth--;
      if (_actCalendarMonth < 0) {
        _actCalendarMonth = 11;
        _actCalendarYear--;
      }
      _renderHomeScreen();
    });
  }

  const actCalNextBtn = $('whoop-act-cal-next-month');
  if (actCalNextBtn) {
    actCalNextBtn.addEventListener('click', () => {
      _actCalendarMonth++;
      if (_actCalendarMonth > 11) {
        _actCalendarMonth = 0;
        _actCalendarYear++;
      }
      _renderHomeScreen();
    });
  }

  const actCalTodayBtn = $('whoop-act-cal-today-btn');
  if (actCalTodayBtn) {
    actCalTodayBtn.addEventListener('click', () => {
      const now = new Date();
      _actCalendarYear = now.getFullYear();
      _actCalendarMonth = now.getMonth();
      _selectedDate = todayString();
      if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
      _renderHomeScreen();
    });
  }

  const actCalCloseBtn = $('whoop-act-cal-close-btn');
  if (actCalCloseBtn) {
    actCalCloseBtn.addEventListener('click', () => {
      _isActivitiesCalendarOpen = false;
      _renderHomeScreen();
    });
  }

  document.querySelectorAll('.whoop-act-cal-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = cell.dataset.date;
      if (d) {
        _selectedDate = d;
        if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
        _renderHomeScreen();
      }
    });
  });

  document.querySelectorAll('.whoop-act-cal-wo-card').forEach(card => {
    card.addEventListener('click', () => {
      const wid = card.dataset.id;
      if (wid) _openWorkoutDetailModal(wid);
    });
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      _selectedDate = d.toISOString().slice(0, 10);
      if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
      _renderHomeScreen();
      _renderHealthScreen();
      if (typeof window !== 'undefined' && typeof window.setDietDate === 'function') {
        window.setDietDate(_selectedDate, false);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      _selectedDate = d.toISOString().slice(0, 10);
      if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
      _renderHomeScreen();
      _renderHealthScreen();
      if (typeof window !== 'undefined' && typeof window.setDietDate === 'function') {
        window.setDietDate(_selectedDate, false);
      }
    });
  }

  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      if (e.target.value) {
        _selectedDate = e.target.value;
        if (typeof window !== 'undefined') window._whoopSelectedDate = _selectedDate;
        _renderHomeScreen();
        _renderHealthScreen();
        if (typeof window !== 'undefined' && typeof window.setDietDate === 'function') {
          window.setDietDate(_selectedDate, false);
        }
      }
    });
  }

  if (entryBtn) {
    entryBtn.addEventListener('click', () => {
      _openWhoopEntryModal();
    });
  }

  if (addActBtn) {
    addActBtn.addEventListener('click', () => {
      _openActivityPickerModal();
    });
  }

  if (cardHealth) {
    cardHealth.addEventListener('click', () => {
      _openHealthModal();
    });
  }

  if (cardStress) {
    cardStress.addEventListener('click', () => {
      _openStressModal();
    });
  }

  // Nutrition kártya és gombok bekötése
  const nutritionCard = $('whoop-nutrition-card');
  if (nutritionCard) {
    nutritionCard.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (typeof window !== 'undefined') {
        if (typeof window.setDietDate === 'function') window.setDietDate(_selectedDate, false);
        if (typeof window.showModule === 'function') window.showModule('diet');
      }
    });
  }

  const quickMealBtn = $('whoop-quick-add-meal-btn');
  if (quickMealBtn) {
    quickMealBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined') {
        if (typeof window.setDietDate === 'function') window.setDietDate(_selectedDate, false);
        if (typeof window.showModule === 'function') window.showModule('diet');
      }
      setTimeout(() => {
        const fab = $('diet-fab');
        if (fab) fab.click();
      }, 120);
    });
  }

  const quickWaterBtn = $('whoop-quick-water-btn');
  if (quickWaterBtn) {
    quickWaterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _logQuickWater();
    });
  }

  const goDietBtn = $('whoop-go-diet-btn');
  if (goDietBtn) {
    goDietBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined') {
        if (typeof window.setDietDate === 'function') window.setDietDate(_selectedDate, false);
        if (typeof window.showModule === 'function') window.showModule('diet');
      }
    });
  }

  // Új szokás gomb
  const addHabitBtn = $('whoop-add-habit-btn');
  if (addHabitBtn) {
    addHabitBtn.addEventListener('click', () => _openCustomHabitModal());
  }

  // Egyéni szokás törlése
  document.querySelectorAll('.whoop5-delete-custom-habit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const habitId = btn.dataset.habitId;
      if (!habitId || !_uid) return;
      try {
        await deleteDoc(doc(db, 'users', _uid, 'customHabits', habitId));
      } catch (err) {
        console.error('[whoop5] Delete custom habit error:', err);
      }
    });
  });

  // Journal gombok valós idejű szinkronizálása
  document.querySelectorAll('.whoop5-journal-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const habit = btn.dataset.habit;
      if (!habit || !_uid) return;
      const current = _getWhoopDataForDate(_selectedDate);
      const nextVal = !current.journal[habit];
      try {
        await setDoc(doc(db, 'users', _uid, 'whoopLogs', _selectedDate), {
          journal: {
            ...current.journal,
            [habit]: nextVal
          },
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error('[whoop5] Journal save error:', err);
      }
    });
  });
}

// ── Today's Activities Renderelése (Strain: Kék, Recovery: Világoskék) ──
function _renderHomeTodayActivities() {
  const listEl = $('whoop-today-activities-list');
  if (!listEl) return;

  const dayWorkouts = _allWorkouts.filter(w => w.date === _selectedDate);
  const dayRecoveryActs = _allRecoveryActs.filter(r => r.date === _selectedDate);

  if (dayWorkouts.length === 0 && dayRecoveryActs.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-6 px-4 bg-gray-50 dark:bg-[#1B1C22] rounded-2xl border border-dashed border-gray-200 dark:border-[#2A2C34]">
        <p class="text-xs text-gray-400 italic mb-2">Még nincs rögzített aktivitás mára.</p>
        <button id="whoop-empty-add-act-btn" class="px-3.5 py-1.5 rounded-xl bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black font-extrabold text-xs transition-all active:scale-95 inline-flex items-center gap-1.5">
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Edzés vagy regeneráció hozzáadása</span>
        </button>
      </div>
    `;

    const emptyBtn = $('whoop-empty-add-act-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', _openActivityPickerModal);
    return;
  }

  let html = '';

  // 1. Strain Aktivitások (Edzések) — Elektromos Kék (#00E5FF)
  dayWorkouts.forEach(w => {
    const sport = getSportById(w.sportId || 'strength_training');
    const strainVal = calcWorkoutStrain(w);
    const isImported = w.source === 'intervals.icu';

    html += `
      <div class="whoop-workout-card cursor-pointer flex items-center justify-between p-3.5 rounded-2xl bg-gray-50 dark:bg-[#181A20] border-l-4 border-l-[#00E5FF] border border-gray-100 dark:border-[#252832] hover:border-[#00E5FF]/40 active:scale-[0.99] transition-all" data-id="${w.id}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-[#00E5FF]/15 text-[#00E5FF] flex items-center justify-center text-sm flex-shrink-0">
            <i class="${sport.icon || 'fa-solid fa-dumbbell'}"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">${w.name || sport.name}</h4>
              ${isImported ? '<span class="text-[9px] font-black px-1.5 py-0.5 rounded bg-cyan-500/15 text-[#00E5FF] border border-cyan-500/30">GARMIN</span>' : ''}
            </div>
            <p class="text-[10px] text-gray-400 font-medium mt-0.5">
              ${w.duration || 60} perc · ${w.calories ? `${w.calories} kcal · ` : ''}${w.distanceKm ? `${Number(w.distanceKm).toFixed(1)} km · ` : ''}${sport.cat || 'Edzés'}
            </p>
            ${w.courseName ? `
              <p class="text-[10px] text-cyan-400 font-semibold truncate mt-0.5 flex items-center gap-1">
                <i class="fa-solid fa-map-location-dot text-[9px]"></i>
                <span>${w.courseName}${w.courseTime ? ` (${w.courseTime})` : ''}</span>
              </p>
            ` : ''}
            ${w.notes && !w.notes.startsWith('Garmin / Intervals.icu import') ? `
              <p class="text-[10px] text-gray-400 italic truncate mt-0.5 flex items-center gap-1">
                <i class="fa-regular fa-note-sticky text-[9px] text-[#00E5FF]"></i>
                <span>${_esc(w.notes)}</span>
              </p>
            ` : ''}
            ${(() => {
              const gNames = Array.isArray(w.gearNames) && w.gearNames.length > 0 ? w.gearNames : (w.gearName ? [w.gearName] : []);
              if (gNames.length === 0) return '';
              return `
                <div class="flex items-center gap-1 flex-wrap mt-1">
                  ${gNames.map(gn => `
                    <span class="text-[9px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-[#22242C] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <i class="fa-solid fa-shoe-prints text-[8px] text-[#00E5FF]"></i>
                      <span class="truncate max-w-[120px]">${_esc(gn)}</span>
                    </span>
                  `).join('')}
                </div>
              `;
            })()}
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[10px] font-black text-[#00E5FF] bg-[#00E5FF]/10 px-2.5 py-1 rounded-full border border-[#00E5FF]/20">
            Strain ${strainVal.toFixed(1)}
          </span>
          <button class="whoop-delete-act-btn w-7 h-7 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" data-type="workout" data-id="${w.id}" title="Törlés">
            <i class="fa-solid fa-trash text-xs pointer-events-none"></i>
          </button>
        </div>
      </div>
    `;
  });

  // 2. Recovery Aktivitások (Protokollok & SMR) — Világoskék (#38BDF8)
  dayRecoveryActs.forEach(r => {
    let icon = 'fa-solid fa-spa';
    const typeLower = (r.type || '').toLowerCase();
    if (typeLower.includes('sauna') || typeLower.includes('szauna') || typeLower.includes('hideg')) {
      icon = 'fa-solid fa-hot-tub-person';
    } else if (typeLower.includes('stretch') || typeLower.includes('nyújt')) {
      icon = 'fa-solid fa-person-praying';
    } else if (typeLower.includes('smr') || typeLower.includes('roller')) {
      icon = 'fa-solid fa-circle-notch';
    }

    html += `
      <div class="whoop-recovery-card cursor-pointer flex items-center justify-between p-3.5 rounded-2xl bg-gray-50 dark:bg-[#181A20] border-l-4 border-l-[#38BDF8] border border-gray-100 dark:border-[#252832] hover:border-[#38BDF8]/40 active:scale-[0.99] transition-all" data-id="${r.id}" data-col="${r.sourceCol || 'recoveryProtocols'}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-sky-500/15 text-[#38BDF8] flex items-center justify-center text-sm flex-shrink-0">
            <i class="${icon}"></i>
          </div>
          <div class="min-w-0">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">${r.name || 'Regenerációs program'}</h4>
            <p class="text-[10px] text-gray-400 font-medium">
              ${r.duration || 20} perc · ${r.type || 'SMR / Nyújtás'}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[10px] font-black text-[#38BDF8] bg-sky-500/10 px-2.5 py-1 rounded-full border border-sky-500/20">
            Recovery
          </span>
          <button class="whoop-edit-rec-btn w-7 h-7 rounded-lg text-gray-400 hover:text-[#38BDF8] hover:bg-sky-500/10 flex items-center justify-center transition-colors" data-id="${r.id}" data-col="${r.sourceCol || 'recoveryProtocols'}" title="Szerkesztés">
            <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
          </button>
          <button class="whoop-delete-act-btn w-7 h-7 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" data-type="recovery" data-col="${r.sourceCol || 'recoveryProtocols'}" data-id="${r.id}" title="Törlés">
            <i class="fa-solid fa-trash text-xs pointer-events-none"></i>
          </button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  // Edzéskártyára kattintás -> Részletek megnyitása nagyobb nézetben
  listEl.querySelectorAll('.whoop-workout-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.whoop-delete-act-btn')) return;
      const wid = card.dataset.id;
      if (wid) _openWorkoutDetailModal(wid);
    });
  });

  // Regenerációs kártyára kattintás -> Szerkesztő modal megnyitása
  listEl.querySelectorAll('.whoop-recovery-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.whoop-delete-act-btn') || e.target.closest('.whoop-edit-rec-btn')) return;
      const id = card.dataset.id;
      const col = card.dataset.col;
      if (id) _openRecoveryEditModal(id, col);
    });
  });

  listEl.querySelectorAll('.whoop-edit-rec-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const col = btn.dataset.col;
      if (id) _openRecoveryEditModal(id, col);
    });
  });

  // Törlés eseménykezelő
  listEl.querySelectorAll('.whoop-delete-act-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      const col = btn.dataset.col || 'recoveryProtocols';
      if (!id || !_uid) return;

      try {
        if (type === 'workout') {
          await deleteDoc(doc(db, 'users', _uid, 'workouts', id));
          _allWorkouts = _allWorkouts.filter(w => String(w.id) !== String(id));
          _renderHomeTodayActivities();
        } else {
          await _deleteRecoveryActivity(id, col);
        }
      } catch (err) {
        console.error('[whoop5] Error deleting activity:', err);
      }
    });
  });
}

// ── Beépített minta edzésprogramok és regenerációs sablonok ──
const DEFAULT_ROUTINES = [
  {
    id: 'default_routine_1',
    isSample: true,
    name: 'Push Nap (Mell, Váll, Tricepsz)',
    sportId: 'strength_training',
    category: 'strength',
    duration: 65,
    exercises: 'Fekvenyomás rúddal: 4 × 8 (80 kg)\nFerdepados kézisúlyzós nyomás: 3 × 10 (26 kg)\nVállból nyomás ülve: 3 × 10 (20 kg)\nOldalemelés kézisúllyal: 4 × 15 (10 kg)\nTricepsz letolás csigán: 3 × 12 (35 kg)',
    notes: 'Kiváló feszülés a mellizmokban, progresszív terhelés'
  },
  {
    id: 'default_routine_endurance_1',
    isSample: true,
    name: '5 km Zóna 2 Kardió Futás',
    sportId: 'running',
    category: 'endurance',
    duration: 35,
    distanceKm: 5,
    exercises: 'Bemelegítő dinamikus nyújtás: 1 × 5p\n5 km egyenletes Zóna 2 futás: 1 × 35p\nLevezető séta és légzésgyakorlat: 1 × 5p',
    notes: 'Beszélgetős tempó, pulzus 135-145 bpm között tartva'
  }
];

const DEFAULT_RECOVERY_PROTOCOLS = [
  {
    id: 'default_protocol_1',
    isSample: true,
    name: 'Teljes test SMR Hengerezés & Mobilitás',
    type: 'smr',
    category: 'recovery',
    duration: 20,
    relievedMuscles: ['all'],
    relievedMuscle: 'all',
    relievedMuscleLabel: 'Teljes test',
    exercises: 'Vádli és Achilles hengerezés: 1 × 4p\nCombfeszítő és combközelítő: 1 × 6p\nIT-szalag és gluteus fókusz: 1 × 6p\nHáti gerinc extenzió és lapocka mobilitás: 1 × 4p',
    notes: 'Feszes trigger pontokon 30 mp tartás mély kilégzéssel'
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

function _isEnduranceSport(sportId) {
  if (!sportId) return false;
  const s = getSportById(sportId);
  if (s && s.isCardio) return true;
  return [
    'running', 'cycling', 'pool_swimming', 'open_water_swimming',
    'rowing', 'indoor_rowing', 'triathlon', 'trail_running',
    'track_running', 'treadmill', 'road_biking', 'mountain_biking',
    'indoor_cycling', 'gravel_biking', 'walking', 'hiking', 'cross_country_skiing'
  ].includes(sportId);
}

function _getAllAvailableTemplates() {
  const deletedRoutines = _getDeletedSampleIds('routines');
  const deletedProtocols = _getDeletedSampleIds('protocols');

  const defaultRoutines = (DEFAULT_ROUTINES || []).filter(r =>
    !deletedRoutines.includes(r.id) && !deletedRoutines.includes(r.name)
  );

  const defaultProtocols = (DEFAULT_RECOVERY_PROTOCOLS || []).filter(p =>
    !deletedProtocols.includes(p.id) && !deletedProtocols.includes(p.name)
  );

  const userRoutines = Array.isArray(_allRoutines) && _allRoutines.length > 0
    ? _allRoutines
    : (typeof window !== 'undefined' && Array.isArray(window._allRoutines) ? window._allRoutines : []);

  const userProtocols = Array.isArray(_allProtocols) && _allProtocols.length > 0
    ? _allProtocols
    : (typeof window !== 'undefined' && Array.isArray(window._allProtocols) ? window._allProtocols : []);

  const combinedRoutines = [];
  const seenRoutineIds = new Set();
  [...userRoutines, ...defaultRoutines].forEach(r => {
    if (r && r.id && !seenRoutineIds.has(r.id)) {
      seenRoutineIds.add(r.id);
      combinedRoutines.push(r);
    }
  });

  const combinedProtocols = [];
  const seenProtocolIds = new Set();
  [...userProtocols, ...defaultProtocols].forEach(p => {
    if (p && p.id && !seenProtocolIds.has(p.id)) {
      seenProtocolIds.add(p.id);
      combinedProtocols.push(p);
    }
  });

  return { routines: combinedRoutines, protocols: combinedProtocols };
}

function _populateWorkoutDetailRoutines() {
  const routineSelect = $('wo-detail-routine-select');
  if (!routineSelect) return;

  const currentVal = routineSelect.value;
  const { routines, protocols } = _getAllAvailableTemplates();

  const strengthRoutines = routines.filter(r => r.category === 'strength' || (!r.category && !_isEnduranceSport(r.sportId)));
  const enduranceRoutines = routines.filter(r => r.category === 'endurance' || _isEnduranceSport(r.sportId));

  let optHtml = '<option value="">Válassz egy mentett edzésprogramot...</option>';

  if (strengthRoutines.length > 0) {
    optHtml += '<optgroup label="Erőnléti edzéssablonok">' +
      strengthRoutines.map(r => `<option value="r_${r.id}">${_esc(r.name)} (${r.duration || 60} perc)</option>`).join('') +
      '</optgroup>';
  }

  if (enduranceRoutines.length > 0) {
    optHtml += '<optgroup label="Kardió / Állóképességi sablonok">' +
      enduranceRoutines.map(r => `<option value="r_${r.id}">${_esc(r.name)} (${r.duration || 30} perc)</option>`).join('') +
      '</optgroup>';
  }

  if (protocols.length > 0) {
    optHtml += '<optgroup label="Regenerációs rutinok">' +
      protocols.map(p => `<option value="p_${p.id}">${_esc(p.name)} (${p.duration || 20} perc)</option>`).join('') +
      '</optgroup>';
  }

  routineSelect.innerHTML = optHtml;
  if (currentVal) {
    routineSelect.value = currentVal;
  }
}

// ── Garmin Training Effect (Aerob / Anaerob: 0.0 - 5.0) vizuális segéd & skála ──
function _getTEVisuals(valNum) {
  const v = Math.max(0, Math.min(5.0, Number(valNum) || 0));
  // 0-1 szürke, 1-2 kék, 2-3 zöld, 3-4 sárga, 4-5 piros
  let tierName = 'Nincs hatás';
  let tierColor = '#9CA3AF'; // szürke
  let badgeBg = 'bg-gray-500/10 dark:bg-gray-500/20';
  let badgeBorder = 'border-gray-400/30 dark:border-gray-600/40';
  let textColor = 'text-gray-500 dark:text-gray-400';
  let activeSegments = 1;

  if (v >= 4.0) {
    tierName = 'Csúcs / Túlterhelés';
    tierColor = '#EF4444'; // piros
    badgeBg = 'bg-red-500/15 dark:bg-red-500/25';
    badgeBorder = 'border-red-500/40';
    textColor = 'text-red-500 dark:text-red-400';
    activeSegments = 5;
  } else if (v >= 3.0) {
    tierName = 'Erősen fejlesztő';
    tierColor = '#F59E0B'; // sárga
    badgeBg = 'bg-amber-500/15 dark:bg-amber-500/25';
    badgeBorder = 'border-amber-500/40';
    textColor = 'text-amber-500 dark:text-amber-400';
    activeSegments = 4;
  } else if (v >= 2.0) {
    tierName = 'Fenntartó hatás';
    tierColor = '#10B981'; // zöld
    badgeBg = 'bg-emerald-500/15 dark:bg-emerald-500/25';
    badgeBorder = 'border-emerald-500/40';
    textColor = 'text-emerald-500 dark:text-emerald-400';
    activeSegments = 3;
  } else if (v >= 1.0) {
    tierName = 'Kisebb haszon';
    tierColor = '#3B82F6'; // kék
    badgeBg = 'bg-blue-500/15 dark:bg-blue-500/25';
    badgeBorder = 'border-blue-500/40';
    textColor = 'text-blue-500 dark:text-blue-400';
    activeSegments = 2;
  } else {
    tierName = 'Csekély hatás';
    tierColor = '#9CA3AF'; // szürke
    badgeBg = 'bg-gray-500/10 dark:bg-gray-500/20';
    badgeBorder = 'border-gray-400/30 dark:border-gray-600/40';
    textColor = 'text-gray-500 dark:text-gray-400';
    activeSegments = v > 0 ? 1 : 0;
  }

  // 5-szegmenses sáv: 0-1 szürke, 1-2 kék, 2-3 zöld, 3-4 sárga, 4-5 piros
  const segmentColors = [
    '#9CA3AF', // 0-1 szürke
    '#3B82F6', // 1-2 kék
    '#10B981', // 2-3 zöld
    '#F59E0B', // 3-4 sárga
    '#EF4444'  // 4-5 piros
  ];

  const barsHtml = segmentColors.map((color, idx) => {
    const isLit = (idx + 1) <= activeSegments;
    const bgStyle = isLit ? `background-color: ${color};` : 'background-color: rgba(156, 163, 175, 0.2);';
    return `<span class="h-1 flex-1 rounded-full transition-all" style="${bgStyle}"></span>`;
  }).join('');

  return { v, tierName, tierColor, badgeBg, badgeBorder, textColor, barsHtml };
}

function _calcEstimatedWorkoutTE(w) {
  if (!w) return { aerobic: 2.5, anaerobic: 0.0 };
  const dur = Number(w.duration) || 30;
  const avgHr = Number(w.avgHr || w.average_heartrate || w.heartRate) || 0;
  const maxHr = Number(w.maxHr || w.max_heartrate) || 185;

  let aerobic = 2.0;
  if (avgHr > 0) {
    const hrRatio = avgHr / maxHr;
    aerobic = 1.0 + (hrRatio - 0.5) * 4.5 * Math.min(2.0, Math.sqrt(dur / 35));
  } else if (w.trainingLoad) {
    aerobic = Math.min(5.0, Math.max(1.0, 1.2 + Math.sqrt(w.trainingLoad / 8)));
  } else {
    aerobic = Math.min(4.0, Math.max(1.0, dur / 25));
  }
  aerobic = Math.max(0.5, Math.min(5.0, Math.round(aerobic * 10) / 10));

  let anaerobic = 0.0;
  if (maxHr > 0 && avgHr > 0 && (maxHr / 185) >= 0.88) {
    anaerobic = Math.min(4.5, ((maxHr / 185) - 0.85) * 12.0);
  }
  anaerobic = Math.max(0.0, Math.min(5.0, Math.round(anaerobic * 10) / 10));

  return { aerobic, anaerobic };
}

// ── Edzés Részletező Modál (Garmin & Lockin Workout Detail) ───
export function openWorkoutDetailModal(workoutIdOrObj) {
  _openWorkoutDetailModal(workoutIdOrObj);
}
if (typeof window !== 'undefined') {
  window.openWorkoutDetailModal = openWorkoutDetailModal;
}

let _detailSelectedGearIds = new Set();

function _renderDetailSelectedGears() {
  const container = $('wo-detail-selected-gears-container');
  const gearSelect = $('wo-detail-gear-select');
  const gearKmBadge = $('wo-detail-gear-km-badge');

  if (container) {
    if (_detailSelectedGearIds.size === 0) {
      container.innerHTML = '<span class="text-[10px] text-gray-400 italic">Nincs felszerelés kiválasztva</span>';
    } else {
      const selectedArr = Array.from(_detailSelectedGearIds).map(id => _allGears.find(g => g.id === id)).filter(Boolean);
      container.innerHTML = selectedArr.map(g => {
        const icon = g.type === 'bike' ? 'fa-solid fa-bicycle' : (g.type === 'device' ? 'fa-solid fa-stopwatch' : 'fa-solid fa-shoe-prints');
        const totalDistKm = Math.round((Number(g.totalKm) || 0) * 10) / 10;
        const totalHours = Math.round((Number(g.totalHours) || 0) * 10) / 10;
        let remText = '';
        if (g.maintType === 'time') {
          const maintDays = Number(g.maintenanceDays) || 90;
          const lastDate = g.lastMaintainedDate ? new Date(g.lastMaintainedDate) : (g.createdAt?.toDate ? g.createdAt.toDate() : new Date());
          const diffMs = Math.max(0, new Date().getTime() - lastDate.getTime());
          const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const daysRem = Math.max(0, maintDays - daysPassed);
          remText = `${daysRem} nap hátra`;
        } else {
          const maintLimit = Number(g.maintenanceKm) || 500;
          const kmSince = Math.max(0, (Number(g.totalKm) || 0) - (Number(g.lastMaintainedKm) || 0));
          const remKm = Math.max(0, maintLimit - kmSince);
          remText = `${Math.round(remKm)} km hátra`;
        }

        return `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-gray-100 dark:bg-[#22242C] border border-gray-200 dark:border-[#2A2C34] text-xs font-semibold text-gray-800 dark:text-gray-100">
            <i class="${icon} text-[10px] text-[#00E5FF]"></i>
            <span class="font-bold">${_esc(g.brand ? g.brand + ' ' : '')}${_esc(g.name)}</span>
            <span class="text-[10px] text-[#00E5FF] font-semibold">${remText}</span>
            <span class="text-[9px] text-gray-400 font-mono">(${totalDistKm} km · ${totalHours} óra)</span>
            <button type="button" class="wo-remove-detail-gear-btn text-gray-400 hover:text-red-500 ml-1 p-0.5 transition-colors cursor-pointer" data-id="${g.id}" title="Eltávolítás">
              <i class="fa-solid fa-xmark text-[10px] pointer-events-none"></i>
            </button>
          </span>
        `;
      }).join('');

      container.querySelectorAll('.wo-remove-detail-gear-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          _detailSelectedGearIds.delete(id);
          _renderDetailSelectedGears();
        });
      });
    }
  }

  if (gearKmBadge) {
    gearKmBadge.textContent = _detailSelectedGearIds.size > 0 ? `${_detailSelectedGearIds.size} felszerelés hozzárendelve` : '';
  }

  if (gearSelect) {
    const unselectedGears = _allGears.filter(g => !_detailSelectedGearIds.has(g.id));
    gearSelect.innerHTML = '<option value="">+ Felszerelés hozzáadása...</option>' +
      unselectedGears.map(g => {
        const totalDistKm = Math.round((Number(g.totalKm) || 0) * 10) / 10;
        const totalHours = Math.round((Number(g.totalHours) || 0) * 10) / 10;
        let remText = '';
        if (g.maintType === 'time') {
          const maintDays = Number(g.maintenanceDays) || 90;
          const lastDate = g.lastMaintainedDate ? new Date(g.lastMaintainedDate) : (g.createdAt?.toDate ? g.createdAt.toDate() : new Date());
          const diffMs = Math.max(0, new Date().getTime() - lastDate.getTime());
          const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const daysRem = Math.max(0, maintDays - daysPassed);
          remText = `${daysRem} nap`;
        } else {
          const maintLimit = Number(g.maintenanceKm) || 500;
          const kmSince = Math.max(0, (Number(g.totalKm) || 0) - (Number(g.lastMaintainedKm) || 0));
          const remKm = Math.max(0, maintLimit - kmSince);
          remText = `${Math.round(remKm)} km`;
        }
        return `<option value="${g.id}">${_esc(g.brand ? g.brand + ' ' : '')}${_esc(g.name)} (${remText} hátra · Összesen: ${totalDistKm} km, ${totalHours} óra)</option>`;
      }).join('');
    gearSelect.value = '';
  }
}

function _openWorkoutDetailModal(workoutIdOrObj) {
  let workout = null;
  let workoutId = null;

  if (workoutIdOrObj && typeof workoutIdOrObj === 'object') {
    workout = workoutIdOrObj;
    workoutId = workout.id;
  } else {
    workoutId = workoutIdOrObj;
    const targetIdStr = String(workoutId);
    workout = _allWorkouts.find(w => String(w.id) === targetIdStr);
    if (!workout && typeof window !== 'undefined') {
      const candidates = (window._allWorkouts || []).concat(window._allWorkoutsActivity || []).concat(window._allWorkoutsWorkout || []);
      workout = candidates.find(w => String(w.id) === targetIdStr);
    }
  }

  if (!workout) {
    console.warn('[whoop5] Workout not found for detail modal:', workoutIdOrObj);
    return;
  }

  _currentDetailWorkoutId = workout.id || workoutId;

  const modal = $('wo-detail-modal');
  const sheet = $('wo-detail-sheet');
  if (!modal || !sheet) return;

  const sport = getSportById(workout.sportId || 'running');
  const isImported = workout.source === 'intervals.icu';
  const strainVal = calcWorkoutStrain(workout);

  // Fejléc
  const titleEl = $('wo-detail-title');
  const subtitleEl = $('wo-detail-subtitle');
  const iconEl = $('wo-detail-icon');

  if (titleEl) titleEl.textContent = workout.name || sport.name;
  if (subtitleEl) subtitleEl.textContent = `${formatDateHU(workout.date)} · ${sport.name} (${sport.cat || 'Edzés'})`;
  if (iconEl) iconEl.className = `${sport.icon || 'fa-solid fa-person-running'}`;

  // Zárolás jelző banner ha Garmin / intervals.icu importált
  const banner = $('wo-detail-imported-banner');
  if (banner) {
    if (isImported) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }

  // Fő metrikák (Időtartam, Táv, Kalória, Strain)
  const durEl = $('wo-detail-stat-duration');
  const distEl = $('wo-detail-stat-distance');
  const calEl = $('wo-detail-stat-calories');
  const strainEl = $('wo-detail-stat-strain');

  if (durEl) durEl.textContent = `${workout.duration || 0} perc`;
  if (distEl) distEl.textContent = workout.distanceKm ? `${Number(workout.distanceKm).toFixed(2)} km` : '—';
  if (calEl) calEl.textContent = workout.calories ? `${workout.calories} kcal` : '—';
  if (strainEl) strainEl.textContent = strainVal.toFixed(1);

  // Felszerelés (Gear Tracker) kiválasztása és kitöltése (több felszerelés is hozzárendelhető!)
  _detailSelectedGearIds.clear();
  const existingGearIds = Array.isArray(workout.gearIds) ? workout.gearIds : (workout.gearId ? [workout.gearId] : []);
  existingGearIds.forEach(id => _detailSelectedGearIds.add(id));

  // Ha nem volt hozzárendelve felszerelés, de van az adott edzésformához alapértelmezett, automatikusan hozzárendeljük
  if (_detailSelectedGearIds.size === 0 && workout.sportId) {
    _allGears.forEach(g => {
      const defSports = Array.isArray(g.defaultSports) ? g.defaultSports : (g.defaultSport ? [g.defaultSport] : []);
      if (defSports.includes(workout.sportId)) {
        _detailSelectedGearIds.add(g.id);
      }
    });
  }

  _renderDetailSelectedGears();

  const gearSelect = $('wo-detail-gear-select');
  if (gearSelect && !gearSelect.dataset.multiBound) {
    gearSelect.dataset.multiBound = 'true';
    gearSelect.onchange = () => {
      const val = gearSelect.value;
      if (val) {
        _detailSelectedGearIds.add(val);
        _renderDetailSelectedGears();
      }
    };
  }

  // Edzésprogramok / Rutinok listájának feltöltése és beemelése
  _populateWorkoutDetailRoutines();
  const routineSelect = $('wo-detail-routine-select');
  const applyRoutineBtn = $('wo-detail-apply-routine-btn');

  if (applyRoutineBtn) {
    applyRoutineBtn.onclick = () => {
      const selectedVal = routineSelect?.value;
      if (!selectedVal) return;

      const { routines: allR, protocols: allP } = _getAllAvailableTemplates();
      let routine = null;
      if (selectedVal.startsWith('p_')) {
        const pid = selectedVal.slice(2);
        routine = allP.find(p => p.id === pid);
      } else {
        const rid = selectedVal.startsWith('r_') ? selectedVal.slice(2) : selectedVal;
        routine = allR.find(r => r.id === rid);
      }

      if (!routine) return;

      const exContainer = $('wo-detail-exercises-container');
      if (!exContainer) return;

      // Ha az egyetlen meglévő sor üres volt (név nélkül vagy alapértelmezett), távolítsuk el
      const existingRows = exContainer.querySelectorAll('.wo-structured-ex-row');
      if (existingRows.length === 1) {
        const firstName = existingRows[0].dataset.name || existingRows[0].querySelector('.wo-ex-name-display')?.textContent.trim() || '';
        if (!firstName || firstName === 'Gyakorlat') {
          existingRows[0].remove();
        }
      }

      if (Array.isArray(routine.exerciseItems) && routine.exerciseItems.length > 0) {
        routine.exerciseItems.forEach(item => {
          exContainer.appendChild(_createDetailExerciseRow(item));
        });
      } else if (routine.exercises && typeof routine.exercises === 'string') {
        _insertRoutineExercisesToContainer(routine.exercises, 'wo-detail-exercises-container');
      }

      // Vizuális visszajelzés
      const origText = applyRoutineBtn.innerHTML;
      applyRoutineBtn.innerHTML = '<i class="fa-solid fa-check text-[10px] text-emerald-400 mr-1"></i>Beemelve!';
      applyRoutineBtn.classList.add('border-emerald-500/40', 'bg-emerald-500/20', 'text-emerald-300');
      setTimeout(() => {
        applyRoutineBtn.innerHTML = origText;
        applyRoutineBtn.classList.remove('border-emerald-500/40', 'bg-emerald-500/20', 'text-emerald-300');
      }, 1500);
    };
  }

  // Garmin Telemetria Datafield-ek (Pulzus, Watt, Kadencia, Izzadás stb.)
  const dfSection = $('wo-detail-datafields-section');
  const dfGrid = $('wo-detail-datafields-grid');
  if (dfSection && dfGrid) {
    let rawDfs = Array.isArray(workout.datafields) ? workout.datafields.map(d => ({ ...d })) : [];

    // Régi / hibás TSS mezők átalakítása Garmin Edzésterhelésre (pt)
    rawDfs.forEach(df => {
      if (df.id === 'training_load' || (df.name && df.name.includes('TSS')) || (df.label && df.label.includes('TSS')) || df.unit === 'TSS') {
        df.id = 'training_load';
        df.name = 'Edzésterhelés';
        df.label = 'Edzésterhelés';
        df.unit = 'pt';
        const loadNum = workout.trainingLoad ?? workout.icu_load ?? workout.acute_load ?? workout.TrainingLoad ?? workout.exercise_load;
        if (loadNum && Number(loadNum) > 0) {
          df.value = String(Math.round(Number(loadNum)));
        }
      }
    });

    // Ha nincs még edzésterhelés a datafield-ekben, de az edzésen szerepel
    const loadVal = workout.trainingLoad ?? workout.icu_load ?? workout.acute_load ?? workout.TrainingLoad ?? workout.exercise_load ?? workout.garmin_training_load ?? workout.icu_training_load ?? workout.load;
    if (loadVal !== undefined && loadVal !== null && Number(loadVal) > 0 && !rawDfs.some(d => d.id === 'training_load')) {
      rawDfs.push({
        id: 'training_load',
        name: 'Edzésterhelés',
        label: 'Edzésterhelés',
        value: String(Math.round(Number(loadVal))),
        unit: 'pt'
      });
    }

    // Aerob & Anaerob terhelés ellenőrzése és hozzáadása (0.0 - 5.0)
    const estTE = _calcEstimatedWorkoutTE(workout);

    let aeroDf = rawDfs.find(d => d.id === 'aerobic_te');
    let aeroVal = workout.aerobicTE ?? workout.aerobic_training_effect ?? workout.icu_training_effect ?? workout.AerobicEffect ?? workout.icu_aerobic_training_effect ?? (aeroDf && Number(aeroDf.value) > 0 ? Number(aeroDf.value) : estTE.aerobic);
    if (!aeroDf) {
      rawDfs.push({
        id: 'aerobic_te',
        name: 'Aerob terhelés',
        label: 'Aerob terhelés',
        value: (Math.round(Number(aeroVal) * 10) / 10).toFixed(1),
        unit: '/ 5.0'
      });
    } else {
      aeroDf.name = 'Aerob terhelés';
      aeroDf.label = 'Aerob terhelés';
      aeroDf.unit = '/ 5.0';
      aeroDf.value = (Math.round(Number(aeroVal) * 10) / 10).toFixed(1);
    }

    let anaeroDf = rawDfs.find(d => d.id === 'anaerobic_te');
    let anaeroVal = workout.anaerobicTE ?? workout.anaerobic_training_effect ?? workout.icu_anaerobic_training_effect ?? workout.AnaerobicEffect ?? (anaeroDf ? Number(anaeroDf.value) : estTE.anaerobic);
    if (!anaeroDf) {
      rawDfs.push({
        id: 'anaerobic_te',
        name: 'Anaerob terhelés',
        label: 'Anaerob terhelés',
        value: (Math.round(Number(anaeroVal || 0) * 10) / 10).toFixed(1),
        unit: '/ 5.0'
      });
    } else {
      anaeroDf.name = 'Anaerob terhelés';
      anaeroDf.label = 'Anaerob terhelés';
      anaeroDf.unit = '/ 5.0';
      anaeroDf.value = (Math.round(Number(anaeroVal || 0) * 10) / 10).toFixed(1);
    }

    const sweatVal = calcWorkoutSweatLoss(workout);
    if (sweatVal > 0 && !rawDfs.some(d => d.id === 'sweat_loss')) {
      rawDfs.push({
        id: 'sweat_loss',
        name: 'Becsült izzadás (Garmin)',
        label: 'Becsült izzadás',
        value: String(sweatVal),
        unit: 'ml'
      });
    }

    // Sorrend: 1. Edzésterhelés (pt), 2. Aerob terhelés, 3. Anaerob terhelés, majd pulzus, watt, izzadás stb.
    const priorityOrder = {
      'training_load': 1,
      'aerobic_te': 2,
      'anaerobic_te': 3,
      'avg_hr': 4,
      'max_hr': 5,
      'avg_watts': 6,
      'np_watts': 7,
      'sweat_loss': 8
    };

    rawDfs.sort((a, b) => {
      const pa = priorityOrder[a.id] || 99;
      const pb = priorityOrder[b.id] || 99;
      return pa - pb;
    });

    if (rawDfs.length > 0) {
      dfSection.classList.remove('hidden');
      dfGrid.innerHTML = rawDfs.map(df => {
        // Kiemelt kártya: Aerob vagy Anaerob terhelés (0-1 szürke, 1-2 kék, 2-3 zöld, 3-4 sárga, 4-5 piros)
        if (df.id === 'aerobic_te' || df.id === 'anaerobic_te') {
          const isAerobic = df.id === 'aerobic_te';
          const vis = _getTEVisuals(df.value);
          const icon = isAerobic ? 'fa-solid fa-lungs' : 'fa-solid fa-bolt-lightning';
          const title = isAerobic ? 'Aerob terhelés' : 'Anaerob terhelés';
          return `
            <div class="p-2.5 rounded-xl ${vis.badgeBg} ${vis.badgeBorder} border flex flex-col justify-between">
              <div class="flex items-center justify-between gap-1">
                <p class="text-[9px] font-bold ${vis.textColor} uppercase tracking-wider truncate flex items-center gap-1">
                  <i class="${icon} text-[9px]"></i>${title}
                </p>
                <span class="text-[8px] font-extrabold px-1 py-0.5 rounded ${vis.textColor} bg-white/40 dark:bg-black/30">
                  ${vis.tierName}
                </span>
              </div>
              <p class="text-xs font-black ${vis.textColor} tabular-nums mt-1">
                ${vis.v.toFixed(1)} <span class="text-[10px] font-normal text-gray-400">/ 5.0</span>
              </p>
              <div class="flex items-center gap-1 mt-1.5 w-full">
                ${vis.barsHtml}
              </div>
            </div>
          `;
        }

        // Kiemelt kártya: Garmin Edzésterhelés (pt)
        if (df.id === 'training_load') {
          return `
            <div class="p-2.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/30 border">
              <p class="text-[9px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider truncate flex items-center gap-1">
                <i class="fa-solid fa-fire text-[9px]"></i>Edzésterhelés
              </p>
              <p class="text-xs font-black text-amber-500 dark:text-amber-300 tabular-nums mt-0.5">
                ${df.value} <span class="text-[10px] font-normal text-gray-400">pt</span>
              </p>
            </div>
          `;
        }

        // Kiemelt kártya: Becsült izzadás (ml)
        if (df.id === 'sweat_loss') {
          return `
            <div class="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800/40 border">
              <p class="text-[9px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider truncate flex items-center gap-1">
                <i class="fa-solid fa-droplet text-[8px]"></i>${df.name || 'Becsült izzadás'}
              </p>
              <p class="text-xs font-black text-sky-600 dark:text-sky-300 tabular-nums mt-0.5">
                ${df.value} <span class="text-[10px] font-normal text-gray-400">ml</span>
              </p>
            </div>
          `;
        }

        const title = df.name || df.label || (getDatafieldById(df.id)?.name) || df.id;
        const unit = df.unit || (getDatafieldById(df.id)?.unit) || '';
        return `
          <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#1B1C22] border-gray-100 dark:border-[#2A2C34] border">
            <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate flex items-center gap-1">
              ${title}
            </p>
            <p class="text-xs font-black text-gray-900 dark:text-white tabular-nums mt-0.5">
              ${df.value} <span class="text-[10px] font-normal text-gray-400">${unit}</span>
            </p>
          </div>
        `;
      }).join('');
    } else {
      dfSection.classList.add('hidden');
      dfGrid.innerHTML = '';
    }
  }

  // Gyakorlatok és Szériák (Strukturált rubrikákkal)
  const exContainer = $('wo-detail-exercises-container');
  if (exContainer) {
    exContainer.innerHTML = '';
    if (workout.exerciseItems && Array.isArray(workout.exerciseItems) && workout.exerciseItems.length > 0) {
      workout.exerciseItems.forEach(item => {
        exContainer.appendChild(_createDetailExerciseRow(item));
      });
    } else if (workout.exercises && workout.exercises.trim()) {
      _insertRoutineExercisesToContainer(workout.exercises, 'wo-detail-exercises-container');
    }
  }

  const addExRowBtn = $('wo-detail-add-ex-row-btn');
  if (addExRowBtn) {
    addExRowBtn.onclick = () => {
      window._activeExerciseTarget = 'detail';
      if (typeof window._openExercisesModal === 'function') {
        window._openExercisesModal();
      } else {
        const modal = $('wo-exercises-modal');
        const sheet = $('wo-exercises-sheet');
        if (modal && sheet) {
          modal.classList.remove('hidden');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              sheet.style.transform = 'translateY(0)';
            });
          });
        }
      }
    };
  }

  // Állóképességi pálya és mért időeredmény szekció
  const enduranceSection = $('wo-detail-endurance-section');
  const coursesList = $('wo-detail-courses-list');
  const addCourseBtn = $('wo-detail-add-course-btn');

  const isEndurance = Boolean(sport.isCardio || [
    'running', 'cycling', 'pool_swimming', 'open_water_swimming',
    'rowing', 'indoor_rowing', 'triathlon', 'trail_running',
    'track_running', 'treadmill', 'road_biking', 'mountain_biking',
    'indoor_cycling', 'gravel_biking', 'walking', 'hiking', 'cross_country_skiing'
  ].includes(sport.id));

  if (enduranceSection) {
    if (isEndurance) {
      enduranceSection.classList.remove('hidden');
      if (coursesList) {
        coursesList.innerHTML = '';
        const existingCourses = (workout.courses && Array.isArray(workout.courses) && workout.courses.length > 0)
          ? workout.courses
          : (workout.courseName ? [{ name: workout.courseName, time: workout.courseTime || '' }] : [{ name: '', time: '' }]);

        existingCourses.forEach(c => {
          coursesList.appendChild(_renderCourseRowElement(c));
        });
      }

      if (addCourseBtn) {
        addCourseBtn.onclick = () => {
          if (coursesList) {
            coursesList.appendChild(_renderCourseRowElement({ name: '', time: '' }));
          }
        };
      }
    } else {
      enduranceSection.classList.add('hidden');
    }
  }

  // Megjegyzések (Notes)
  const notesInp = $('wo-detail-input-notes');
  if (notesInp) {
    const rawNotes = workout.notes || '';
    if (rawNotes.startsWith('Garmin / Intervals.icu import')) {
      notesInp.value = '';
      notesInp.placeholder = rawNotes;
    } else {
      notesInp.value = rawNotes;
      notesInp.placeholder = 'Írd le a tapasztalataidat, edzésérzést vagy részleteket...';
    }
  }

  // Megosztás (Share) gomb kötése
  const shareBtn = $('wo-detail-share-btn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      _openWorkoutShareModal(workoutId);
    };
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _createDetailExerciseRow(item = { name: '', muscle: 'chest', sets: 4, reps: 10, weight: '' }) {
  const row = document.createElement('div');
  const rawName = item.name || 'Gyakorlat';
  const escName = _esc(rawName);
  const muscleKey = item.muscle || 'chest';
  const setsVal = item.sets !== undefined && item.sets !== null && item.sets !== '' ? item.sets : 4;
  const repsVal = item.reps !== undefined && item.reps !== null && item.reps !== '' ? item.reps : 10;
  const weightVal = item.weight !== undefined && item.weight !== null ? item.weight : '';

  const muscleNames = {
    quads: 'Combfeszítő (Quads)',
    hamstrings: 'Combhajlító (Hamstrings)',
    glutes: 'Farizom (Glutes)',
    calves: 'Vádli (Calves)',
    adductors: 'Belső comb',
    chest: 'Mellkas (Chest)',
    shoulders: 'Vállak (Deltoids)',
    biceps: 'Bicepsz (Biceps)',
    triceps: 'Tricepsz (Triceps)',
    forearms: 'Alkar (Forearms)',
    lats: 'Széles hátizom (Lats)',
    traps: 'Trapézizom (Traps)',
    lower_back: 'Alsó hát / Derék',
    abs: 'Hasizom (Abs)',
    obliques: 'Ferde hasizom',
    neck: 'Nyak',
    all: 'Teljes test'
  };
  const muscleSub = item.targetMuscle || muscleNames[muscleKey] || item.category || 'Gyakorlat';

  row.className = 'wo-structured-ex-row p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-[#181A20] border border-gray-200 dark:border-[#2A2C34] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all';
  row.dataset.name = rawName;
  row.dataset.muscle = muscleKey;

  row.innerHTML = `
    <!-- Bal oldal: Ikon és Nem szerkeszthető név -->
    <div class="flex items-center justify-between sm:justify-start gap-2.5 min-w-0 flex-1">
      <div class="w-8 h-8 rounded-xl bg-cyan-500/15 text-[#00E5FF] flex items-center justify-center text-xs flex-shrink-0">
        <i class="fa-solid fa-dumbbell"></i>
      </div>
      <div class="min-w-0 flex-1">
        <h5 class="wo-ex-name-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate" title="${escName}">${escName}</h5>
        <p class="text-[10px] text-gray-400 font-medium truncate">${_esc(muscleSub)}</p>
      </div>
      <!-- Mobil Törlés (X) gomb -->
      <button type="button" class="wo-remove-ex-row-btn sm:hidden w-7 h-7 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" title="Eltávolítás">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>

    <!-- Jobb oldal: Súly (kg), Sorozat, Ismétlés, és Desktop Törlés (X) gomb -->
    <div class="flex items-center gap-2 justify-end flex-shrink-0">
      <!-- Súly (kg) -->
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-[#121316] px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-[#2A2C34]">
        <input type="number" step="0.5" min="0" placeholder="—" value="${weightVal}"
               class="wo-ex-weight w-12 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Súly (kg)" />
        <span class="text-[10px] text-gray-400 font-bold select-none">kg</span>
      </div>
      <!-- Sorozat -->
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-[#121316] px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-[#2A2C34]">
        <input type="number" min="1" max="99" value="${setsVal}"
               class="wo-ex-sets w-8 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Sorozatok száma" />
        <span class="text-[10px] text-gray-400 font-bold select-none">sor.</span>
      </div>
      <!-- Ismétlés -->
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-[#121316] px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-[#2A2C34]">
        <input type="number" min="1" max="999" value="${repsVal}"
               class="wo-ex-reps w-10 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none" title="Ismétlések száma" />
        <span class="text-[10px] text-gray-400 font-bold select-none">ism.</span>
      </div>
      <!-- Desktop Törlés (X) gomb -->
      <button type="button" class="wo-remove-ex-row-btn hidden sm:flex w-7 h-7 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 items-center justify-center transition-colors" title="Eltávolítás">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `;

  row.querySelectorAll('.wo-remove-ex-row-btn').forEach(btn => {
    btn.onclick = () => row.remove();
  });
  return row;
}
if (typeof window !== 'undefined') {
  window._createDetailExerciseRow = _createDetailExerciseRow;
}

function _parseExerciseLine(line) {
  let name = line.trim();
  let sets = 4;
  let reps = 10;
  let weight = '';
  let muscle = 'chest';

  if (!name) return null;

  let rest = '';
  const colonIdx = line.indexOf(':');
  if (colonIdx !== -1) {
    name = line.slice(0, colonIdx).trim();
    rest = line.slice(colonIdx + 1).trim();
  } else {
    const srMatch = line.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (srMatch && srMatch.index !== undefined) {
      name = line.slice(0, srMatch.index).trim();
      rest = line.slice(srMatch.index).trim();
    }
  }

  if (rest) {
    const srMatch = rest.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (srMatch) {
      sets = parseInt(srMatch[1], 10) || 4;
      reps = parseInt(srMatch[2], 10) || 10;
    }
    const wMatch = rest.match(/\(([^)]+)\)/);
    if (wMatch) {
      const numMatch = wMatch[1].match(/(\d+(?:\.\d+)?)/);
      if (numMatch) weight = parseFloat(numMatch[1]) || '';
    } else {
      const directWeightMatch = rest.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (directWeightMatch) {
        weight = parseFloat(directWeightMatch[1]) || '';
      }
    }
  }

  const nameLower = name.toLowerCase();
  if (/guggol|squat|láb|leg|comb/i.test(nameLower)) muscle = 'quads';
  else if (/felhúz|deadlift/i.test(nameLower)) muscle = 'lower_back';
  else if (/húzódz|pull|evez|lat/i.test(nameLower)) muscle = 'lats';
  else if (/váll|shoulder|overhead|military|oldalemel|lateral/i.test(nameLower)) muscle = 'shoulders';
  else if (/biceps/i.test(nameLower)) muscle = 'biceps';
  else if (/triceps/i.test(nameLower)) muscle = 'triceps';
  else if (/has|abs|crunch|plank/i.test(nameLower)) muscle = 'abs';
  else if (/vádli|calf/i.test(nameLower)) muscle = 'calves';
  else if (/hajlító|hamstring|farizom|glute/i.test(nameLower)) muscle = 'hamstrings';

  return { name, muscle, sets, reps, weight };
}

function _insertRoutineExercisesToContainer(text, containerId) {
  const container = $(containerId);
  if (!container || !text) return;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(line => {
    const item = _parseExerciseLine(line);
    if (item) {
      container.appendChild(_createDetailExerciseRow(item));
    }
  });
}

function _renderCourseRowElement(course = { name: '', time: '' }) {
  const row = document.createElement('div');
  row.className = 'wo-course-row grid grid-cols-1 sm:grid-cols-5 gap-2 items-center bg-white dark:bg-[#121316] p-2.5 rounded-xl border border-gray-200 dark:border-[#2A2C34]';
  row.innerHTML = `
    <div class="sm:col-span-3">
      <input type="text" class="wo-course-name-input w-full bg-transparent text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none font-semibold"
             placeholder="Pálya / Szakasz neve (pl. 5km kör)" value="${_esc(course.name || '')}" />
    </div>
    <div class="sm:col-span-2 flex items-center gap-1.5">
      <input type="text" class="wo-course-time-input flex-1 bg-transparent text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none font-mono"
             placeholder="Idő (pl. 23:45)" value="${_esc(course.time || '')}" />
      <button type="button" class="wo-remove-course-btn w-6 h-6 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors" title="Pálya törlése">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `;

  row.querySelector('.wo-remove-course-btn').addEventListener('click', () => {
    const list = $('wo-detail-courses-list');
    if (list && list.querySelectorAll('.wo-course-row').length > 1) {
      row.remove();
    } else {
      const nIn = row.querySelector('.wo-course-name-input');
      const tIn = row.querySelector('.wo-course-time-input');
      if (nIn) nIn.value = '';
      if (tIn) tIn.value = '';
    }
  });

  return row;
}

function _closeWorkoutDetailModal() {
  const modal = $('wo-detail-modal');
  const sheet = $('wo-detail-sheet');
  const saveBtn = $('wo-detail-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.classList.remove('opacity-70', 'bg-emerald-600', 'hover:bg-emerald-500');
    saveBtn.classList.add('bg-cyan-600', 'hover:bg-cyan-500');
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk text-xs"></i><span>Módosítások mentése</span>';
  }
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
    _currentDetailWorkoutId = null;
  }, 340);
}

async function _saveWorkoutDetail() {
  if (!_currentDetailWorkoutId) return;

  const targetIdStr = String(_currentDetailWorkoutId).trim();
  let currentWorkout = _allWorkouts.find(w => String(w.id) === targetIdStr);
  if (!currentWorkout && typeof window !== 'undefined') {
    const candidates = (window._allWorkouts || []).concat(window._allWorkoutsActivity || []).concat(window._allWorkoutsWorkout || []);
    currentWorkout = candidates.find(w => String(w.id) === targetIdStr);
  }

  const notesInp = $('wo-detail-input-notes');
  const saveBtn = $('wo-detail-save-btn');
  const gearSelect = $('wo-detail-gear-select');

  // 1. Több pálya és időeredmény begyűjtése a dinamikus listából
  const courses = [];
  const courseRows = document.querySelectorAll('.wo-course-row');
  courseRows.forEach(row => {
    const name = row.querySelector('.wo-course-name-input')?.value.trim();
    const time = row.querySelector('.wo-course-time-input')?.value.trim();
    if (name || time) {
      courses.push({ name: name || '', time: time || '' });
    }
  });

  // 2. Strukturált gyakorlatok begyűjtése
  const exContainer = $('wo-detail-exercises-container');
  const exerciseItems = [];
  const exerciseLines = [];
  const collectedMuscles = [];

  if (exContainer) {
    exContainer.querySelectorAll('.wo-structured-ex-row').forEach(row => {
      const name = row.dataset.name || row.querySelector('.wo-ex-name-display')?.textContent.trim() || row.querySelector('.wo-ex-name-input')?.value.trim() || 'Gyakorlat';
      const muscle = row.dataset.muscle || row.querySelector('.wo-ex-muscle-select')?.value || '';
      const sets = parseInt(row.querySelector('.wo-ex-sets')?.value, 10) || 1;
      const reps = parseInt(row.querySelector('.wo-ex-reps')?.value, 10) || 1;
      const weightVal = row.querySelector('.wo-ex-weight')?.value.trim();
      const weight = weightVal ? parseFloat(weightVal) : null;

      exerciseItems.push({ name, muscle, sets, reps, weight });
      exerciseLines.push(`${name}: ${sets} × ${reps}${weight ? ` (${weight} kg)` : ''}`);
      if (muscle) collectedMuscles.push(muscle);
    });
  }

  const currentGearIds = Array.from(_detailSelectedGearIds);
  const prevGearIds = Array.isArray(currentWorkout?.gearIds) && currentWorkout.gearIds.length > 0
    ? currentWorkout.gearIds
    : (currentWorkout?.gearId ? [currentWorkout.gearId] : []);
  const currentGearNames = currentGearIds.map(id => _allGears.find(g => g.id === id)?.name).filter(Boolean);
  const selectedGearId = currentGearIds[0] || '';
  const chosenGear = _allGears.find(g => g.id === selectedGearId);

  let finalNotes = notesInp ? notesInp.value.trim() : '';
  // Ha az input üres maradt, de eredetileg volt megjegyzése az edzésnek, tartsuk meg
  if (!finalNotes && currentWorkout && currentWorkout.notes && currentWorkout.notes.startsWith('Garmin / Intervals.icu import')) {
    finalNotes = currentWorkout.notes;
  }

  const updatePayload = {
    notes: finalNotes,
    gearId: selectedGearId,
    gearName: chosenGear ? chosenGear.name : '',
    gearIds: currentGearIds,
    gearNames: currentGearNames,
    courses,
    courseName: courses.length > 0 ? courses[0].name : '',
    courseTime: courses.length > 0 ? courses[0].time : '',
    exercises: exerciseLines.join('\n'),
    exerciseItems,
    targetMuscles: collectedMuscles.length > 0 ? Array.from(new Set(collectedMuscles)) : [],
    updatedAt: serverTimestamp()
  };

  const calculatedSweat = calcWorkoutSweatLoss(currentWorkout);
  if (calculatedSweat > 0) {
    updatePayload.sweatLossMl = calculatedSweat;
  }

  // Update in-memory collections immediately (optimistic UI update)
  const syncObj = (arr) => {
    if (!Array.isArray(arr)) return;
    const found = arr.find(w => String(w.id) === targetIdStr);
    if (found) {
      Object.assign(found, updatePayload);
      found.notes = finalNotes;
    }
  };
  syncObj(_allWorkouts);
  if (typeof window !== 'undefined') {
    syncObj(window._allWorkouts);
    syncObj(window._allWorkoutsActivity);
    syncObj(window._allWorkoutsWorkout);
  }
  if (currentWorkout) {
    Object.assign(currentWorkout, updatePayload);
    currentWorkout.notes = finalNotes;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-70');
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Mentés...</span>';
  }

  try {
    if (_uid) {
      await setDoc(doc(db, 'users', _uid, 'workouts', targetIdStr), updatePayload, { merge: true });

      // Felszerelés kilométerek és üzemidő kétirányú szinkronizálása (több felszerelés támogatásával)
      if (currentWorkout) {
        const hours = Math.round(((currentWorkout.duration || 60) / 60) * 10) / 10;
        const km = Number(currentWorkout.distanceKm != null ? currentWorkout.distanceKm : currentWorkout.distance) || 0;

        // Eltávolított felszerelések: levonjuk belőle a kilométereket és órákat
        const removedGears = prevGearIds.filter(id => !currentGearIds.includes(id));
        for (const rid of removedGears) {
          await updateDoc(doc(db, 'users', _uid, 'gear', rid), {
            totalKm: increment(-km),
            totalHours: increment(-hours)
          }).catch(err => console.warn('[whoop5] Gear decrement note:', err));
        }

        // Újonnan hozzáadott felszerelések: hozzáadjuk a kilométereket és üzemidőt
        const addedGears = currentGearIds.filter(id => !prevGearIds.includes(id));
        for (const aid of addedGears) {
          await updateDoc(doc(db, 'users', _uid, 'gear', aid), {
            totalKm: increment(km),
            totalHours: increment(hours)
          }).catch(err => console.warn('[whoop5] Gear update note:', err));
        }
      }
    }

    // Refresh UI instantly
    _renderHomeScreen();
    _renderHomeTodayActivities();
    if (typeof window !== 'undefined') {
      if (typeof window._renderWorkoutsList === 'function') window._renderWorkoutsList();
      if (typeof window._renderWhoopTodayActivities === 'function') window._renderWhoopTodayActivities();
    }

    if (saveBtn) {
      saveBtn.innerHTML = '<i class="fa-solid fa-check text-xs text-emerald-300"></i><span class="text-emerald-300">Módosítások mentve!</span>';
      saveBtn.classList.remove('opacity-70', 'bg-cyan-600', 'hover:bg-cyan-500');
      saveBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    }

    setTimeout(() => {
      _closeWorkoutDetailModal();
    }, 600);
  } catch (err) {
    console.error('[whoop5] Nem sikerült menteni az edzés adatait:', err);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove('opacity-70');
      saveBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-xs text-rose-300"></i><span class="text-rose-300">Hiba történt</span>';
      setTimeout(() => {
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk text-xs"></i><span>Módosítások mentése</span>';
      }, 2000);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// REGENERÁCIÓS AKTIVITÁS SZERKESZTÉSE & TÖRLÉSE (TODAY'S ACTIVITIES)
// ══════════════════════════════════════════════════════════════

export function openRecoveryEditModal(activityId, colName) {
  _openRecoveryEditModal(activityId, colName);
}
if (typeof window !== 'undefined') {
  window.openRecoveryEditModal = openRecoveryEditModal;
  window.deleteRecoveryActivity = _deleteRecoveryActivity;
}

function _openRecoveryEditModal(activityId, colName) {
  const modal = $('whoop-recovery-edit-modal');
  const sheet = $('whoop-recovery-edit-sheet');
  if (!modal || !sheet) return;

  const col = colName || 'recoveryProtocols';
  const targetId = String(activityId);
  const rec = _allRecoveryActs.find(a => String(a.id) === targetId)
    || _allProtocols.find(a => String(a.id) === targetId)
    || _allSessions.find(a => String(a.id) === targetId);

  if (!rec) {
    console.warn('[whoop5] Recovery activity not found for edit:', activityId);
    return;
  }

  const idIn = $('whoop-rec-edit-id');
  const colIn = $('whoop-rec-edit-col');
  const nameIn = $('whoop-rec-edit-name');
  const typeSelect = $('whoop-rec-edit-type');
  const durIn = $('whoop-rec-edit-dur');
  const dateIn = $('whoop-rec-edit-date');
  const exIn = $('whoop-rec-edit-exercises');

  if (idIn) idIn.value = rec.id || '';
  if (colIn) colIn.value = rec.sourceCol || col;
  if (nameIn) nameIn.value = rec.name || '';
  if (durIn) durIn.value = rec.duration || 20;
  if (dateIn) dateIn.value = rec.date || _selectedDate || todayString();
  if (exIn) exIn.value = rec.exercises || rec.notes || '';

  if (typeSelect) {
    const rawType = (rec.type || '').trim();
    let matched = false;
    for (let opt of typeSelect.options) {
      if (opt.value.toLowerCase() === rawType.toLowerCase()) {
        typeSelect.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const tLow = rawType.toLowerCase();
      if (tLow.includes('smr') || tLow.includes('roller')) {
        typeSelect.value = 'SMR hengerlés';
      } else if (tLow.includes('stat') || (tLow.includes('nyújt') && !tLow.includes('dinam'))) {
        typeSelect.value = 'Statikus nyújtás';
      } else if (tLow.includes('dinam') || tLow.includes('mobil')) {
        typeSelect.value = 'Dinamikus mobilitás';
      } else if (tLow.includes('sauna') || tLow.includes('szauna') || tLow.includes('hideg')) {
        typeSelect.value = 'Szauna & Hidegfürdő';
      } else if (tLow.includes('légz') || tLow.includes('breath')) {
        typeSelect.value = 'Légzőgyakorlat';
      } else {
        typeSelect.value = 'Egyéb regeneráció';
      }
    }
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeRecoveryEditModal() {
  const modal = $('whoop-recovery-edit-modal');
  const sheet = $('whoop-recovery-edit-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

async function _saveRecoveryEdit() {
  if (!_uid) return;
  const id = $('whoop-rec-edit-id')?.value;
  const col = $('whoop-rec-edit-col')?.value || 'recoveryProtocols';
  const name = $('whoop-rec-edit-name')?.value?.trim();
  const type = $('whoop-rec-edit-type')?.value;
  const duration = parseInt($('whoop-rec-edit-dur')?.value, 10) || 20;
  const date = $('whoop-rec-edit-date')?.value || _selectedDate || todayString();
  const exercises = $('whoop-rec-edit-exercises')?.value?.trim() || '';
  const saveBtn = $('whoop-rec-edit-save-btn');

  if (!id || !name) return;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Mentés...</span>';
  }

  try {
    const payload = {
      name,
      type,
      duration,
      date,
      exercises,
      updatedAt: serverTimestamp()
    };

    await updateDoc(doc(db, 'users', _uid, col, id), payload);

    // Optimisztikus in-memory frissítés
    const updateInList = list => {
      const item = list.find(x => String(x.id) === String(id));
      if (item) Object.assign(item, payload);
    };
    updateInList(_allProtocols);
    updateInList(_allSessions);
    updateInList(_allRecoveryActs);

    _renderHomeTodayActivities();
    _closeRecoveryEditModal();
  } catch (err) {
    console.error('[whoop5] Error saving recovery activity:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i><span>Módosítások mentése</span>';
    }
  }
}

async function _deleteRecoveryActivity(id, colName) {
  if (!id || !_uid) return;
  const col = colName || 'recoveryProtocols';
  const targetId = String(id);

  try {
    await deleteDoc(doc(db, 'users', _uid, col, targetId));

    // Optimisztikus in-memory törlés
    _allProtocols = _allProtocols.filter(p => String(p.id) !== targetId);
    _allSessions = _allSessions.filter(s => String(s.id) !== targetId);
    _allRecoveryActs = _allRecoveryActs.filter(r => String(r.id) !== targetId);

    _renderHomeTodayActivities();
    _closeRecoveryEditModal();
  } catch (err) {
    console.error('[whoop5] Error deleting recovery activity:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// STRAVA-STÍLUSÚ ÁTLÁTSZÓ EDZÉS MATRICA KÉSZÍTŐ (STICKER SHARE)
// ══════════════════════════════════════════════════════════════

const _stickerLogoCache = {};

function _drawRoundedImage(ctx, img, x, y, width, height, radius = 7) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, width, height);
  ctx.restore();
}

function _openWorkoutShareModal(workoutId) {
  const targetIdStr = String(workoutId);
  const workout = _allWorkouts.find(w => String(w.id) === targetIdStr) ||
    (typeof window !== 'undefined' && ((window._allWorkouts || []).concat(window._allWorkoutsActivity || []).concat(window._allWorkoutsWorkout || [])).find(w => String(w.id) === targetIdStr));
  if (!workout) return;

  const modal = $('wo-share-modal');
  const sheet = $('wo-share-sheet');
  const closeBtn = $('wo-share-close');
  const backdrop = $('wo-share-backdrop');
  if (!modal || !sheet) return;

  // Logó képek előtöltése a matricához
  ['./logodark.jpg', './logolight.jpg'].forEach(src => {
    if (!_stickerLogoCache[src]) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const m = $('wo-share-modal');
        if (m && !m.classList.contains('hidden')) {
          _drawWorkoutShareSticker(workout);
        }
      };
      _stickerLogoCache[src] = img;
    }
  });

  _drawWorkoutShareSticker(workout);

  // Változásfigyelők
  const optIds = [
    'sticker-opt-logo', 'sticker-opt-title', 'sticker-opt-duration',
    'sticker-opt-distance', 'sticker-opt-pace', 'sticker-opt-hr',
    'sticker-opt-calories', 'sticker-opt-strain', 'sticker-opt-course',
    'sticker-opt-date'
  ];
  optIds.forEach(id => {
    const el = $(id);
    if (el) el.onchange = () => _drawWorkoutShareSticker(workout);
  });

  // Stílus váltó gombok
  document.querySelectorAll('.wo-sticker-style-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wo-sticker-style-btn').forEach(b => {
        b.classList.remove('active', 'border-[#00E5FF]', 'bg-[#00E5FF]/10', 'text-[#00E5FF]');
        b.classList.add('border-gray-700', 'bg-gray-800/60', 'text-gray-300');
      });
      btn.classList.add('active', 'border-[#00E5FF]', 'bg-[#00E5FF]/10', 'text-[#00E5FF]');
      btn.classList.remove('border-gray-700', 'bg-gray-800/60', 'text-gray-300');
      _currentStickerStyle = btn.dataset.style || 'neon';
      _drawWorkoutShareSticker(workout);
    };
  });

  // Vágólapra másolás (Átlátszó PNG)
  const copyBtn = $('wo-share-copy-btn');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const canvas = $('wo-share-canvas');
      if (!canvas) return;
      try {
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            const toast = $('wo-share-toast');
            if (toast) {
              toast.classList.remove('hidden');
              setTimeout(() => toast.classList.add('hidden'), 3500);
            }
          } else {
            _downloadCanvasAsPNG(canvas, `lockin_sticker_${workout.date || 'workout'}.png`);
          }
        }, 'image/png');
      } catch (err) {
        console.warn('[share] Clipboard API error, downloading file instead:', err);
        _downloadCanvasAsPNG(canvas, `lockin_sticker_${workout.date || 'workout'}.png`);
      }
    };
  }

  // PNG Letöltés gomb
  const dlBtn = $('wo-share-download-btn');
  if (dlBtn) {
    dlBtn.onclick = () => {
      const canvas = $('wo-share-canvas');
      if (canvas) _downloadCanvasAsPNG(canvas, `lockin_sticker_${workout.date || 'workout'}.png`);
    };
  }

  if (closeBtn) closeBtn.onclick = _closeWorkoutShareModal;
  if (backdrop) backdrop.onclick = _closeWorkoutShareModal;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeWorkoutShareModal() {
  const modal = $('wo-share-modal');
  const sheet = $('wo-share-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _drawWorkoutShareSticker(workout) {
  const canvas = $('wo-share-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 1. ÁTLÁTSZÓ TÖRLÉS — Nulla háttérszín, hogy fotóra lehessen helyezni!
  ctx.clearRect(0, 0, w, h);

  const sport = getSportById(workout.sportId || 'running');
  const strainVal = calcWorkoutStrain(workout);

  const optLogo = $('sticker-opt-logo')?.checked ?? true;
  const optTitle = $('sticker-opt-title')?.checked ?? true;
  const optDuration = $('sticker-opt-duration')?.checked ?? true;
  const optDist = $('sticker-opt-distance')?.checked ?? true;
  const optPace = $('sticker-opt-pace')?.checked ?? true;
  const optHr = $('sticker-opt-hr')?.checked ?? true;
  const optCal = $('sticker-opt-calories')?.checked ?? true;
  const optStrain = $('sticker-opt-strain')?.checked ?? true;
  const optCourse = $('sticker-opt-course')?.checked ?? true;
  const optDate = $('sticker-opt-date')?.checked ?? true;

  // Stílus színpaletta
  let primaryColor = '#00E5FF'; // Electric Cyan
  let textColor = '#FFFFFF';
  let accentColor = '#00E676';
  let labelColor = '#94A3B8';

  if (_currentStickerStyle === 'minimal_white') {
    primaryColor = '#FFFFFF';
    textColor = '#FFFFFF';
    accentColor = '#FFFFFF';
    labelColor = '#CBD5E1';
  } else if (_currentStickerStyle === 'athletic_gold') {
    primaryColor = '#FC5200'; // Strava narancs
    textColor = '#FFFFFF';
    accentColor = '#FFB300';
    labelColor = '#FFA270';
  }

  // Árnyék beállítása, hogy bármilyen fotón (világoson és sötéten is) tökéletesen olvasható legyen
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  // 1. FEJLÉC: LOCKIN LOGÓ & CÍM
  let currentY = 50;

  if (optLogo) {
    const isDark = document.documentElement.classList.contains('dark');
    const logoSrc = isDark ? './logodark.jpg' : './logolight.jpg';
    let logoImg = (isDark ? $('header-logo-dark') : $('header-logo-light'));
    if (!logoImg || !logoImg.complete || !logoImg.naturalWidth) {
      if (!_stickerLogoCache[logoSrc]) {
        _stickerLogoCache[logoSrc] = new Image();
        _stickerLogoCache[logoSrc].src = logoSrc;
      }
      logoImg = _stickerLogoCache[logoSrc];
    }

    const logoSize = 30;
    const logoX = 35;
    const logoY = currentY - 24;
    let textX = logoX;

    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      _drawRoundedImage(ctx, logoImg, logoX, logoY, logoSize, logoSize, 7);
      textX = logoX + logoSize + 10;
    } else if (logoImg) {
      logoImg.onload = () => _drawWorkoutShareSticker(workout);
    }

    ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = primaryColor;
    ctx.fillText('LOCKIN', textX, currentY);

    const lockinW = ctx.measureText('LOCKIN').width;
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = labelColor;
    ctx.fillText('ATHLETIC PERFORMANCE', textX + lockinW + 12, currentY - 2);
    currentY += 45;
  }

  if (optTitle) {
    ctx.font = '800 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = textColor;
    const titleText = workout.name || sport.name;
    ctx.fillText(titleText, 35, currentY);
    currentY += 28;
  }

  if (optDate) {
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = labelColor;
    ctx.fillText(formatDateHU(workout.date) + ` · ${sport.name}`, 35, currentY);
    currentY += 40;
  }

  // 2. FŐ METRIKÁK KÁRTYÁI VAGY OSZLOPAI
  const metrics = [];

  if (optDist && workout.distanceKm) {
    metrics.push({ label: 'TÁVOLSÁG', val: `${Number(workout.distanceKm).toFixed(2)}`, unit: 'km' });
  }

  if (optDuration) {
    const mins = workout.duration || 0;
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    const durStr = hrs > 0 ? `${hrs}ó ${remM}p` : `${mins} perc`;
    metrics.push({ label: 'IDŐ', val: durStr, unit: '' });
  }

  if (optPace && workout.distanceKm && workout.duration) {
    const paceMin = (workout.duration / Number(workout.distanceKm));
    const pMin = Math.floor(paceMin);
    const pSec = Math.round((paceMin - pMin) * 60).toString().padStart(2, '0');
    metrics.push({ label: 'ÁTLAG TEMPÓ', val: `${pMin}:${pSec}`, unit: '/km' });
  }

  // Pulzus adatmezőből
  let avgHr = null;
  if (workout.datafields && Array.isArray(workout.datafields)) {
    const hrDf = workout.datafields.find(df => df.id === 'avg_hr' || (df.name && df.name.toLowerCase().includes('pulzus')));
    if (hrDf) avgHr = hrDf.value;
  }

  if (optHr && avgHr) {
    metrics.push({ label: 'ÁTLAG PULZUS', val: `${avgHr}`, unit: 'bpm' });
  }

  if (optCal && workout.calories) {
    metrics.push({ label: 'KALÓRIA', val: `${workout.calories}`, unit: 'kcal' });
  }

  if (optStrain) {
    metrics.push({ label: 'STRAIN', val: `${strainVal.toFixed(1)}`, unit: '' });
  }

  // Metrikák kirajzolása rácsban
  if (metrics.length > 0) {
    const cols = Math.min(3, metrics.length);
    const colWidth = (w - 70) / cols;

    metrics.slice(0, 6).forEach((m, idx) => {
      const colIdx = idx % 3;
      const rowIdx = Math.floor(idx / 3);
      const x = 35 + (colIdx * colWidth);
      const y = currentY + (rowIdx * 75);

      // Címke
      ctx.font = '700 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = labelColor;
      ctx.fillText(m.label, x, y);

      // Érték
      ctx.font = '900 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace';
      ctx.fillStyle = textColor;
      ctx.fillText(m.val, x, y + 34);

      if (m.unit) {
        const valWidth = ctx.measureText(m.val).width;
        ctx.font = '700 14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = primaryColor;
        ctx.fillText(m.unit, x + valWidth + 6, y + 34);
      }
    });

    currentY += (Math.ceil(metrics.length / 3) * 75) + 15;
  }

  // 3. PÁLYA / SZAKASZ HA VAN
  if (optCourse) {
    const course = workout.courseName || (workout.courses && workout.courses[0]?.name);
    const courseTime = workout.courseTime || (workout.courses && workout.courses[0]?.time);

    if (course) {
      ctx.font = '700 15px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = accentColor;
      ctx.fillText(`📍 ${course}${courseTime ? ` (${courseTime})` : ''}`, 35, currentY);
    }
  }

  // Árnyék kikapcsolása
  ctx.shadowColor = 'transparent';
}

function _downloadCanvasAsPNG(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Heti Strain vs. Recovery Diagram Renderelése ─────────────
function _renderWeeklyStrainRecoveryChart() {
  const chartBox = $('whoop5-weekly-strain-recovery-chart');
  const footerBox = $('whoop5-weekly-summary-footer');
  if (!chartBox) return;

  const dates = [];
  const base = new Date(_selectedDate + 'T12:00:00');
  const daysShortHU = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const chartData = dates.map(dStr => {
    const data = _getWhoopDataForDate(dStr);
    const dateObj = new Date(dStr + 'T12:00:00');
    return {
      date: dStr,
      dayLabel: daysShortHU[dateObj.getDay()],
      hasRecovery: data.hasRecoveryData,
      recovery: data.hasRecoveryData ? Math.max(0, Math.min(100, Math.round(data.recovery))) : null,
      hasStrain: data.hasStrainData,
      strain: data.hasStrainData ? data.strain : 0.0
    };
  });

  const width = 340;
  const height = 160;
  const padLeft = 30;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 25;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const stepX = plotW / 7;
  const barWidth = 14;

  const getStrainY = sVal => padTop + plotH - (Math.max(0, Math.min(21, sVal)) / 21) * plotH;
  const getRecH = rVal => (Math.max(0, Math.min(100, rVal)) / 100) * plotH;

  const strainCoords = chartData.map((d, i) => {
    const cx = padLeft + i * stepX + stepX / 2;
    const cy = getStrainY(d.strain);
    return { x: cx, y: cy, val: d.strain, has: d.hasStrain };
  });

  let strainPath = '';
  strainCoords.forEach((pt, i) => {
    if (i === 0) strainPath += `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    else strainPath += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  });

  let barsSvg = '';
  chartData.forEach((d, i) => {
    const cx = padLeft + i * stepX + stepX / 2;
    const bx = cx - barWidth / 2;

    if (d.hasRecovery) {
      const bh = getRecH(d.recovery);
      const by = padTop + plotH - bh;
      let barFill = '#00E676';
      if (d.recovery < 33) barFill = '#FF3D00';
      else if (d.recovery < 66) barFill = '#FFD600';

      barsSvg += `
        <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barWidth}" height="${bh.toFixed(1)}" rx="3" fill="${barFill}" opacity="0.85">
          <title>${d.date}: ${d.recovery}% Recovery</title>
        </rect>
      `;
    } else {
      // Üres / kihúzott oszlop ha nincs adat
      barsSvg += `
        <rect x="${bx.toFixed(1)}" y="${padTop}" width="${barWidth}" height="${plotH}" rx="3" fill="none" stroke="#2A2C34" stroke-width="1" stroke-dasharray="2,2" opacity="0.6">
          <title>${d.date}: Nincs Recovery adat</title>
        </rect>
      `;
    }

    // X tengely nap címkék
    const isCurrent = d.date === _selectedDate;
    barsSvg += `
      <text x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="9" font-weight="${isCurrent ? '800' : '600'}" fill="${isCurrent ? '#00E5FF' : '#9ca3af'}">
        ${d.dayLabel}
      </text>
    `;
  });

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-full overflow-visible">
      <!-- Vízszintes segédvonalak -->
      <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="#22242C" stroke-width="0.75" stroke-dasharray="2,2" />
      <line x1="${padLeft}" y1="${padTop + plotH / 2}" x2="${width - padRight}" y2="${padTop + plotH / 2}" stroke="#22242C" stroke-width="0.75" stroke-dasharray="2,2" />
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="#22242C" stroke-width="1" />

      <!-- Bal skála feliratok (Strain 0 - 21) -->
      <text x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end" font-size="8" fill="#00E5FF" font-weight="700">21</text>
      <text x="${padLeft - 6}" y="${padTop + plotH / 2 + 3}" text-anchor="end" font-size="8" fill="#00E5FF" font-weight="700">10</text>
      <text x="${padLeft - 6}" y="${padTop + plotH}" text-anchor="end" font-size="8" fill="#00E5FF" font-weight="700">0</text>

      <!-- Recovery Oszlopok -->
      ${barsSvg}

      <!-- Strain Vonal & Pontok -->
      <path d="${strainPath}" fill="none" stroke="#00E5FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
            style="filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.5));" />

      ${strainCoords.map((pt, i) => `
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${pt.has ? '4' : '2.5'}"
                fill="${pt.has ? '#00E5FF' : '#141519'}" stroke="#00E5FF" stroke-width="1.5" class="cursor-pointer">
          <title>${chartData[i].date}: ${chartData[i].hasStrain ? `${chartData[i].strain} Strain` : '0 Strain'}</title>
        </circle>
      `).join('')}
    </svg>
  `;

  chartBox.innerHTML = svg;

  // Footer statisztikák
  if (footerBox) {
    const validRecs = chartData.filter(d => d.hasRecovery).map(d => d.recovery);
    const validStrains = chartData.filter(d => d.hasStrain).map(d => d.strain);

    const avgRec = validRecs.length > 0 ? Math.round(validRecs.reduce((a, b) => a + b, 0) / validRecs.length) : null;
    const avgStrain = validStrains.length > 0 ? (Math.round((validStrains.reduce((a, b) => a + b, 0) / validStrains.length) * 10) / 10).toFixed(1) : null;

    footerBox.innerHTML = `
      <div>
        <span class="text-gray-400">Heti átlag Recovery:</span>
        <span class="font-extrabold ${avgRec ? (avgRec >= 66 ? 'text-[#00E676]' : avgRec >= 33 ? 'text-[#FFD600]' : 'text-[#FF3D00]') : 'text-gray-400'} ml-1">
          ${avgRec !== null ? `${avgRec}%` : '—'}
        </span>
      </div>
      <div>
        <span class="text-gray-400">Heti átlag Strain:</span>
        <span class="font-extrabold text-[#00E5FF] ml-1">
          ${avgStrain !== null ? avgStrain : '—'}
        </span>
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════════
// 2. HEALTH KÉPERNYŐ (FITPLAN AGE, VÉRKÉP ELEMZŐ, HEALTH MONITOR)
// ══════════════════════════════════════════════════════════════
export function _renderHealthScreen() {
  const container = $('whoop5-health-container');
  if (!container) return;

  const whoopData = _getWhoopDataForDate(_selectedDate);
  const chronoAge = Number(_userProfile?.age) || 28;
  const ageResult = calcFitPlanAge(chronoAge, whoopData, _bloodworkValues);
  const bloodResult = ageResult.bloodResult;

  const isYounger = ageResult.diff <= 0;
  const diffBadgeColor = isYounger ? '#00E676' : '#FF3D00';
  const diffBadgeBg = isYounger ? 'bg-emerald-500/10 border-emerald-500/30 text-[#00E676]' : 'bg-red-500/10 border-red-500/30 text-[#FF3D00]';
  const diffSign = isYounger ? '' : '+';

  const filteredBiomarkers = _activeBloodCategory === 'all'
    ? BLOODWORK_BIOMARKERS
    : BLOODWORK_BIOMARKERS.filter(b => b.category === _activeBloodCategory);

  container.innerHTML = `
    <!-- Top Header -->
    <div class="bg-white dark:bg-[#121316] border border-gray-200 dark:border-[#22242C] rounded-3xl p-4 mb-4 shadow-sm flex items-center justify-between">
      <div>
        <span class="text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">LOCKIN LONGEVITY</span>
        <h2 class="text-base font-extrabold text-gray-900 dark:text-white">Health &amp; Lockin Age Központ</h2>
      </div>
      <button id="whoop5-open-bloodwork-btn" class="px-3.5 py-2 rounded-2xl bg-[#00E5FF] hover:bg-cyan-400 text-black font-extrabold text-xs shadow-md shadow-cyan-500/20 active:scale-95 transition-all flex items-center gap-1.5">
        <i class="fa-solid fa-file-medical"></i>
        <span>Vérkép Lelet Bevitele</span>
      </button>
    </div>

    <!-- 1. LOCKIN BIOLOGICAL AGE HERO KÁRTYA -->
    <div class="relative overflow-hidden bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-6 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-hourglass-half text-[#00E5FF] text-base"></i>
          <h3 class="text-xs font-extrabold uppercase tracking-widest text-gray-400">Lockin Biological Age</h3>
        </div>
        <span class="text-xs font-bold px-3 py-1 rounded-full border ${diffBadgeBg}">
          ${diffSign}${ageResult.diff} év ${isYounger ? 'fiatalabb' : 'idősebb'}
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center my-3 items-center">
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[10px] font-bold text-gray-400 uppercase">Naptári Életkor</p>
          <p class="text-2xl font-black text-gray-700 dark:text-gray-300 tabular-nums mt-1">${ageResult.chronoAge} <span class="text-xs font-semibold text-gray-400">év</span></p>
        </div>

        <div class="p-4 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-emerald-500/10 to-transparent border border-cyan-500/30">
          <p class="text-[11px] font-extrabold uppercase tracking-widest text-[#00E5FF]">Lockin Életkorod</p>
          <p class="text-4xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight mt-1" style="color: ${diffBadgeColor}">
            ${ageResult.biologicalAge} <span class="text-sm font-bold text-gray-400">év</span>
          </p>
          <p class="text-[10px] font-bold text-gray-400 mt-1">Öregedési tempó: <span class="text-[#00E676]">${ageResult.paceOfAging}x</span> / év</p>
        </div>

        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[10px] font-bold text-gray-400 uppercase">Vérkép Biomarker Index</p>
          <p class="text-2xl font-black text-emerald-500 tabular-nums mt-1">${bloodResult.scorePct}%</p>
          <p class="text-[10px] text-gray-400 mt-0.5">${bloodResult.optimalCount} / ${bloodResult.totalCount} optimális</p>
        </div>
      </div>

      <div class="mt-4 pt-4 border-t border-gray-100 dark:border-[#22242C]">
        <p class="text-[11px] font-bold text-gray-400 uppercase mb-2">Biológiai Életkor Befolyásoló Tényezők:</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
            <p class="text-[10px] text-gray-400">Szív-érrendszer (RHR/HRV)</p>
            <p class="text-xs font-extrabold ${ageResult.breakdown.cardio <= 0 ? 'text-[#00E676]' : 'text-red-500'}">${ageResult.breakdown.cardio > 0 ? '+' : ''}${ageResult.breakdown.cardio} év</p>
          </div>
          <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
            <p class="text-[10px] text-gray-400">Alvás &amp; Sejtmegújulás</p>
            <p class="text-xs font-extrabold ${ageResult.breakdown.sleep <= 0 ? 'text-[#00E676]' : 'text-red-500'}">${ageResult.breakdown.sleep > 0 ? '+' : ''}${ageResult.breakdown.sleep} év</p>
          </div>
          <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
            <p class="text-[10px] text-gray-400">Edzésterhelés (Strain)</p>
            <p class="text-xs font-extrabold ${ageResult.breakdown.training <= 0 ? 'text-[#00E676]' : 'text-red-500'}">${ageResult.breakdown.training > 0 ? '+' : ''}${ageResult.breakdown.training} év</p>
          </div>
          <div class="p-2.5 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
            <p class="text-[10px] text-gray-400">Vérkép Labor Hatás</p>
            <p class="text-xs font-extrabold ${ageResult.breakdown.blood <= 0 ? 'text-[#00E676]' : 'text-red-500'}">${ageResult.breakdown.blood > 0 ? '+' : ''}${ageResult.breakdown.blood} év</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. HEALTH MONITOR (VITAL BASELINE) — Most a vérkép felett! -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-shield-heart text-emerald-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Health Monitor (Vital Baseline)</h4>
        </div>
        <span class="text-[10px] font-bold ${whoopData.hasHealthData ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-gray-400 bg-gray-500/10 border-gray-500/20'} px-2.5 py-0.5 rounded-full border">
          ${whoopData.hasHealthData ? 'Bázisvonal aktív ✓' : 'Nincs adat rögzítve'}
        </span>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-xs"><i class="fa-solid fa-heart"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Nyugalmi Pulzus (RHR)</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 46–58 bpm</p>
            </div>
          </div>
          <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.rhr ? `${whoopData.health.rhr} bpm` : '—'}</span>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xs"><i class="fa-solid fa-wave-square"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Pulzusvariabilitás (HRV)</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 65–90 ms</p>
            </div>
          </div>
          <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.hrv ? `${whoopData.health.hrv} ms` : '—'}</span>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-xs"><i class="fa-solid fa-temperature-half"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Bőrhőmérséklet eltérés</p>
              <p class="text-[10px] text-gray-400">Normál sáv: ±0.5 °C</p>
            </div>
          </div>
          <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.skinTemp !== null ? `${whoopData.health.skinTemp > 0 ? '+' : ''}${whoopData.health.skinTemp} °C` : '—'}</span>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-xs"><i class="fa-solid fa-droplet"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Véroxigénszint (SpO₂)</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 95–100%</p>
            </div>
          </div>
          <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.spo2 !== null ? `${whoopData.health.spo2}%` : '—'}</span>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center text-xs"><i class="fa-solid fa-wind"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Légzésszám</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 13.5–16.5 /perc</p>
            </div>
          </div>
          <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.respRate !== null ? `${whoopData.health.respRate} /perc` : '—'}</span>
        </div>
      </div>
    </div>

    <!-- 3. KLINIKAI VÉRKÉP ELEMZŐ (25+ KLINIKAI BIOMARKER) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-8 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-dna text-[#00E676] text-base"></i>
          <div>
            <h3 class="text-xs font-extrabold uppercase tracking-widest text-gray-400">Klinikai Vérkép Elemzés</h3>
            <p class="text-[10px] text-gray-400">Standard labor referencia sávok &amp; Longevity zónák</p>
          </div>
        </div>
        <span class="text-xs font-bold px-2.5 py-1 rounded-xl bg-emerald-500/10 text-[#00E676] border border-emerald-500/30">
          ${bloodResult.scorePct}% Optimális
        </span>
      </div>

      <!-- Kategória Szűrősáv -->
      <div class="flex gap-1.5 overflow-x-auto pb-2 mb-4 no-scrollbar">
        ${BLOODWORK_CATEGORIES.map(cat => `
          <button class="whoop5-blood-cat-btn flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            _activeBloodCategory === cat.id
              ? 'bg-[#00E5FF] text-black shadow-sm'
              : 'bg-gray-100 dark:bg-[#1B1C22] text-gray-600 dark:text-gray-400 hover:text-white'
          }" data-cat="${cat.id}">
            <i class="${cat.icon} mr-1 text-[10px]"></i>
            <span>${cat.name}</span>
          </button>
        `).join('')}
      </div>

      <!-- Biomarker Kártyák Rácsa -->
      <div class="space-y-2.5">
        ${filteredBiomarkers.map(bm => {
          const userVal = _bloodworkValues[bm.id] !== undefined ? _bloodworkValues[bm.id] : bm.defaultValue;
          const evaluation = evaluateBiomarker(bm, userVal);
          return `
            <div class="p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h4 class="text-xs font-bold text-gray-900 dark:text-white">${bm.name}</h4>
                  <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${evaluation.badgeClass}">
                    ${evaluation.text}
                  </span>
                </div>
                <p class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">${bm.desc}</p>
                <div class="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 mt-1 font-mono">
                  <span>Normál: ${bm.min} – ${bm.max} ${bm.unit}</span>
                  <span class="text-[#00E676]">Optimális: ${bm.optMin} – ${bm.optMax} ${bm.unit}</span>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-3 sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-200 dark:border-[#2A2C34]">
                <div>
                  <span class="text-base font-black tabular-nums tracking-tight" style="color: ${evaluation.color}">
                    ${userVal}
                  </span>
                  <span class="text-[10px] text-gray-400 font-bold ml-0.5">${bm.unit}</span>
                </div>
                <button class="whoop5-edit-single-bm-btn p-2 rounded-xl bg-gray-200 dark:bg-[#252730] hover:text-[#00E5FF] text-gray-400 text-xs transition-colors" data-bmid="${bm.id}" title="Érték módosítása">
                  <i class="fa-solid fa-pen-to-square pointer-events-none"></i>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  _bindHealthEvents();
}

function _bindHealthEvents() {
  document.querySelectorAll('.whoop5-blood-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeBloodCategory = btn.dataset.cat || 'all';
      _renderHealthScreen();
    });
  });

  const openBloodModalBtn = $('whoop5-open-bloodwork-btn');
  if (openBloodModalBtn) {
    openBloodModalBtn.addEventListener('click', () => _openBloodworkModal());
  }

  document.querySelectorAll('.whoop5-edit-single-bm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bmid = btn.dataset.bmid;
      _openBloodworkModal(bmid);
    });
  });
}

// ══════════════════════════════════════════════════════════════
// 3. COMMUNITY & MORE KÉPERNYŐK
// ══════════════════════════════════════════════════════════════
export function _renderCommunityScreen() {
  const container = $('whoop5-community-container');
  if (!container) return;

  container.innerHTML = `
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-8 text-center shadow-sm">
      <div class="w-16 h-16 rounded-3xl bg-cyan-500/10 text-[#00E5FF] flex items-center justify-center mx-auto mb-4 text-2xl">
        <i class="fa-solid fa-users"></i>
      </div>
      <span class="text-[10px] font-black tracking-widest text-[#00E5FF] uppercase">LOCKIN COMMUNITY</span>
      <h3 class="text-xl font-black text-gray-900 dark:text-white mt-1">Csapatok &amp; Ranglisták</h3>
      <p class="text-xs text-gray-400 max-w-sm mx-auto mt-2 leading-relaxed">
        Hamarosan összeállíthatod saját sportcsapatodat, és versenyezhetsz barátaiddal a napi Recovery és heti Strain ranglistákon.
      </p>
      <div class="mt-6 pt-6 border-t border-gray-100 dark:border-[#22242C] flex justify-center gap-3">
        <span class="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#1B1C22] text-gray-500 dark:text-gray-400">
          <i class="fa-solid fa-lock mr-1.5"></i>Fejlesztés alatt (Lockin Phase 2)
        </span>
      </div>
    </div>
  `;
}

export function _renderMoreScreen() {
  const container = $('whoop5-more-container');
  if (!container) return;

  const headerAvatar = $('user-avatar');
  const userAvatarSrc = headerAvatar?.src || (typeof getGoals === 'function' ? getGoals()?.photoURL : null) || './logolight.jpg';
  const userNameEl = $('user-name');
  const userNameText = 'Lockin Fiók';
  const hasCustomAvatar = userAvatarSrc && !userAvatarSrc.includes('gravatar.com') && !userAvatarSrc.includes('logolight');

  container.innerHTML = `
    <!-- Felhasználói Profil Kártya (Lockin Fiók & Beállítások oldal megnyitása) -->
    <div id="whoop5-more-profile-card"
         onclick="if (typeof window.showModule === 'function') { window.showModule('settings'); } else if (typeof window.openSettingsModal === 'function') { window.openSettingsModal(event); }"
         class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-emerald-500/50 rounded-3xl p-5 mb-5 shadow-sm flex items-center justify-between cursor-pointer hover:scale-[1.01] active:scale-98 transition-all group"
         title="Lockin Fiók &amp; Beállítások megnyitása">
      <div class="flex items-center gap-3">
        ${hasCustomAvatar ? `
          <div class="w-12 h-12 rounded-2xl overflow-hidden border-2 border-emerald-500/50 shadow-md group-hover:scale-105 transition-transform bg-gray-100 dark:bg-[#22242C] flex-shrink-0">
            <img src="${userAvatarSrc}" alt="Avatar" class="w-full h-full object-cover" onerror="this.onerror=null;this.src='./logolight.jpg';" />
          </div>
        ` : `
          <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#00E5FF] to-emerald-400 text-black flex items-center justify-center font-black text-lg group-hover:scale-105 transition-transform flex-shrink-0">
            <i class="fa-solid fa-bolt"></i>
          </div>
        `}
        <div>
          <h3 class="text-sm font-extrabold text-gray-900 dark:text-white group-hover:text-emerald-500 dark:group-hover:text-[#00E5FF] transition-colors">Lockin Fiók</h3>
          <p class="text-[11px] text-gray-400">Beállítások, biometria &amp; Garmin szinkron</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-cyan-500/10 text-[#00E5FF] border border-cyan-500/30">
          PRO AKTÍV
        </span>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-emerald-500 transition-colors"></i>
      </div>
    </div>

    <!-- Központi Navigáció az Összes Modulhoz -->
    <div class="space-y-3 pb-24">
      <p class="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider px-1">Összes Modul &amp; Funkció</p>

      <!-- Diéta -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-emerald-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="diet">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-apple-whole"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Diéta &amp; Táplálkozás</h4>
            <p class="text-[10px] text-gray-400">Ételmenü, Vonalkód olvasó, Receptek, Hidratáció</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-emerald-500 transition-colors"></i>
      </button>

      <!-- Edzéssablonok és regenerációs rutinok -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-indigo-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="activity" data-subtab="routines">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-layer-group"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Edzéssablonok és regenerációs rutinok</h4>
            <p class="text-[10px] text-gray-400">Állóképességi, erőfejlesztő és regenerációs sablonok és gyakorlatok</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-indigo-500 transition-colors"></i>
      </button>

      <!-- Edzésnapló & Aktivitások -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-indigo-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="activity" data-subtab="workouts">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-person-running"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Edzésnapló &amp; Összes Edzés</h4>
            <p class="text-[10px] text-gray-400">Garmin és Lockin rögzített edzések, részletes adatok</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-indigo-500 transition-colors"></i>
      </button>

      <!-- Felszerelések -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-cyan-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="activity" data-subtab="gear">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-shoe-prints"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Felszerelések (Gear Tracker)</h4>
            <p class="text-[10px] text-gray-400">Futócipők, kerékpárok kilométerszámlálója</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-cyan-400 transition-colors"></i>
      </button>

      <!-- Rekordok (PR Hub) -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-amber-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="prhub">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-trophy"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Személyes Rekordok (PR Hub)</h4>
            <p class="text-[10px] text-gray-400">1RM kalkuláció és egyéni csúcsok</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-amber-500 transition-colors"></i>
      </button>

      <!-- Dokumentumok -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-cyan-500/50 flex items-center justify-between transition-all group active:scale-98 cursor-pointer" data-target="documents">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-file-medical"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Egészségügyi Dokumentumok</h4>
            <p class="text-[10px] text-gray-400">Leletek, receptek, vizsgálati anyagok tárolása</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-cyan-500 transition-colors"></i>
      </button>
    </div>
  `;

  document.querySelectorAll('.whoop5-nav-hub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const subtab = btn.dataset.subtab;

      if (window.showModule) {
        window.showModule(target);
      }
      if (subtab && window.switchActivitySubtab) {
        window.switchActivitySubtab(subtab);
      }
    });
  });

  const profileCard = $('whoop5-more-profile-card');
  if (profileCard) {
    profileCard.addEventListener('click', (e) => {
      if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      }
      if (typeof window.showModule === 'function') {
        window.showModule('settings');
      } else if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal(e);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════
// 4. MODÁLIS ABLAKOK LOGIKÁJA
// ══════════════════════════════════════════════════════════════

// ── A. Health Monitor Modal ────────────────────────────────
function _openHealthModal() {
  const modal = $('whoop-health-modal');
  const sheet = $('whoop-health-sheet');
  const dateEl = $('whoop-health-modal-date');
  const listEl = $('whoop-health-vitals-list');
  const bannerIcon = $('whoop-health-banner-icon');
  const bannerTitle = $('whoop-health-status-title');
  const bannerDesc = $('whoop-health-status-desc');

  if (!modal || !sheet) return;

  const data = _getWhoopDataForDate(_selectedDate);
  if (dateEl) dateEl.textContent = formatDateHU(_selectedDate);

  if (data.hasHealthData) {
    if (bannerIcon) bannerIcon.className = 'fa-solid fa-circle-check text-xl text-[#00E676]';
    if (bannerTitle) bannerTitle.textContent = 'Minden élettani mutató bázisértéken belül';
    if (bannerDesc) bannerDesc.textContent = 'A kulcsfontosságú mutatók az egyéni referencia sávban mozognak.';
  } else {
    if (bannerIcon) bannerIcon.className = 'fa-solid fa-circle-info text-xl text-gray-400';
    if (bannerTitle) bannerTitle.textContent = 'Nincs rögzített adat mára';
    if (bannerDesc) bannerDesc.textContent = 'Koppints a Kézi bevitelre vagy rögzíts alvást a mutatók megjelenítéséhez.';
  }

  if (listEl) {
    const vitals = [
      {
        name: 'Nyugalmi Pulzus (RHR)',
        val: data.health.rhr ? `${data.health.rhr} bpm` : '—',
        baseline: '48 – 58 bpm',
        icon: 'fa-solid fa-heart',
        color: 'text-red-500',
        bg: 'bg-red-500/10'
      },
      {
        name: 'Pulzusvariabilitás (HRV)',
        val: data.health.hrv ? `${data.health.hrv} ms` : '—',
        baseline: '65 – 90 ms',
        icon: 'fa-solid fa-wave-square',
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10'
      },
      {
        name: 'Bőrhőmérséklet eltérés',
        val: data.health.skinTemp !== null ? `${data.health.skinTemp > 0 ? '+' : ''}${data.health.skinTemp} °C` : '—',
        baseline: '±0.5 °C',
        icon: 'fa-solid fa-temperature-half',
        color: 'text-amber-500',
        bg: 'bg-amber-500/10'
      },
      {
        name: 'Véroxigénszint (SpO₂)',
        val: data.health.spo2 !== null ? `${data.health.spo2}%` : '—',
        baseline: '95 – 100%',
        icon: 'fa-solid fa-droplet',
        color: 'text-cyan-500',
        bg: 'bg-cyan-500/10'
      },
      {
        name: 'Légzésszám',
        val: data.health.respRate !== null ? `${data.health.respRate} /perc` : '—',
        baseline: '13.5 – 16.5 /perc',
        icon: 'fa-solid fa-wind',
        color: 'text-violet-500',
        bg: 'bg-violet-500/10'
      }
    ];

    listEl.innerHTML = vitals.map(v => `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl ${v.bg} ${v.color} flex items-center justify-center text-xs">
            <i class="${v.icon}"></i>
          </div>
          <div>
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">${v.name}</h4>
            <p class="text-[10px] text-gray-400 font-medium">Bázissáv: ${v.baseline}</p>
          </div>
        </div>
        <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${v.val}</span>
      </div>
    `).join('');
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeHealthModal() {
  const modal = $('whoop-health-modal');
  const sheet = $('whoop-health-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

// ── B. Stress Monitor Modal & Légzésgyakorlat ───────────────
function _openStressModal() {
  const modal = $('whoop-stress-modal');
  const sheet = $('whoop-stress-sheet');
  const dateEl = $('whoop-stress-modal-date');
  const scoreVal = $('whoop-stress-score-val');
  const badgeDot = $('whoop-stress-badge-dot');
  const badgeText = $('whoop-stress-badge-text');
  const bar = $('whoop-stress-bar');

  if (!modal || !sheet) return;

  const data = _getWhoopDataForDate(_selectedDate);
  if (dateEl) dateEl.textContent = formatDateHU(_selectedDate);

  if (data.stressScore !== null) {
    if (scoreVal) scoreVal.textContent = data.stressScore.toFixed(1);
    const pct = Math.min(100, Math.round((data.stressScore / 3.0) * 100));
    if (bar) bar.style.width = `${pct}%`;

    if (data.stressScore < 1.0) {
      if (badgeDot) badgeDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      if (badgeText) badgeText.textContent = 'Alacsony stressz (Nyugalom & Regeneráció)';
    } else if (data.stressScore < 2.0) {
      if (badgeDot) badgeDot.className = 'w-2 h-2 rounded-full bg-amber-400';
      if (badgeText) badgeText.textContent = 'Közepes stressz (Napi éberség & aktivitás)';
    } else {
      if (badgeDot) badgeDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      if (badgeText) badgeText.textContent = 'Magas stressz (Fizikai vagy mentális megterhelés)';
    }
  } else {
    if (scoreVal) scoreVal.textContent = '—';
    if (bar) bar.style.width = '0%';
    if (badgeDot) badgeDot.className = 'w-2 h-2 rounded-full bg-gray-400';
    if (badgeText) badgeText.textContent = 'Nincs rögzített adat mára';
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeStressModal() {
  const modal = $('whoop-stress-modal');
  const sheet = $('whoop-stress-sheet');
  if (!modal || !sheet) return;
  _stopBreathingExercise();
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _toggleBreathingExercise() {
  if (_breathingInterval) {
    _stopBreathingExercise();
  } else {
    _startBreathingExercise();
  }
}

function _startBreathingExercise() {
  const circle = $('whoop-breath-circle');
  const textEl = $('whoop-breath-text');
  const btn = $('whoop-breath-toggle-btn');
  if (!circle || !textEl || !btn) return;

  _breathingSecondsLeft = 60;
  btn.textContent = 'Légzésgyakorlat Megállítása';
  btn.className = 'px-5 py-2 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-xs shadow-sm active:scale-95 transition-all';

  let phase = 0; // 0: Inhale (4s), 1: Hold (4s), 2: Exhale (4s), 3: Hold (4s)
  let subSec = 0;

  const updatePhase = () => {
    if (phase === 0) {
      textEl.textContent = `Belégzés (${4 - subSec})`;
      circle.style.transform = 'scale(1.25)';
      circle.style.borderColor = '#00E5FF';
      circle.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.6)';
    } else if (phase === 1) {
      textEl.textContent = `Tartás (${4 - subSec})`;
      circle.style.transform = 'scale(1.25)';
      circle.style.borderColor = '#38BDF8';
      circle.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.4)';
    } else if (phase === 2) {
      textEl.textContent = `Kilégzés (${4 - subSec})`;
      circle.style.transform = 'scale(0.85)';
      circle.style.borderColor = '#00E676';
      circle.style.boxShadow = '0 0 15px rgba(0, 230, 118, 0.6)';
    } else if (phase === 3) {
      textEl.textContent = `Tartás (${4 - subSec})`;
      circle.style.transform = 'scale(0.85)';
      circle.style.borderColor = '#64748B';
      circle.style.boxShadow = 'none';
    }

    subSec++;
    if (subSec >= 4) {
      subSec = 0;
      phase = (phase + 1) % 4;
    }
  };

  updatePhase();

  _breathingInterval = setInterval(() => {
    _breathingSecondsLeft--;
    if (_breathingSecondsLeft <= 0) {
      _stopBreathingExercise();
      if (textEl) textEl.textContent = 'Kész ✓';
      return;
    }
    updatePhase();
  }, 1000);
}

function _stopBreathingExercise() {
  if (_breathingInterval) {
    clearInterval(_breathingInterval);
    _breathingInterval = null;
  }
  const circle = $('whoop-breath-circle');
  const textEl = $('whoop-breath-text');
  const btn = $('whoop-breath-toggle-btn');

  if (circle) {
    circle.style.transform = 'scale(1.0)';
    circle.style.borderColor = '#00E5FF';
    circle.style.boxShadow = 'none';
  }
  if (textEl) textEl.textContent = 'Indítás';
  if (btn) {
    btn.textContent = 'Légzésgyakorlat Indítása (1 perc)';
    btn.className = 'px-5 py-2 rounded-2xl bg-[#00E5FF] hover:bg-cyan-400 text-black font-extrabold text-xs shadow-sm active:scale-95 transition-all';
  }
}

// ── C. Aktivitás Választó Modal ────────────────────────────
function _openActivityPickerModal() {
  const modal = $('whoop-activity-picker-modal');
  const sheet = $('whoop-activity-picker-sheet');
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeActivityPickerModal() {
  const modal = $('whoop-activity-picker-modal');
  const sheet = $('whoop-activity-picker-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

// ── D. WHOOP Kézi Biometria Modal ──────────────────────────
function _openWhoopEntryModal() {
  const modal = $('whoop-entry-modal');
  const sheet = $('whoop-entry-sheet');
  if (!modal || !sheet) return;

  _populateWhoopEntryModal();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeWhoopEntryModal() {
  const modal = $('whoop-entry-modal');
  const sheet = $('whoop-entry-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _populateWhoopEntryModal() {
  const current = _getWhoopDataForDate(_selectedDate);

  const recIn = $('whoop-input-recovery');
  const hrvIn = $('whoop-input-hrv');
  const rhrIn = $('whoop-input-rhr');
  const strainIn = $('whoop-input-strain');
  const sleepActIn = $('whoop-input-sleep-actual');
  const sleepNeedIn = $('whoop-input-sleep-need');
  const deepIn = $('whoop-input-deep');
  const remIn = $('whoop-input-rem');
  const lightIn = $('whoop-input-light');
  const awakeIn = $('whoop-input-awake');
  const skinIn = $('whoop-input-skin');
  const spo2In = $('whoop-input-spo2');
  const respIn = $('whoop-input-resp');
  const dateText = $('whoop-entry-modal-date');

  if (dateText) dateText.textContent = formatDateHU(_selectedDate);
  if (recIn) recIn.value = current.recovery !== null ? current.recovery : '';
  if (hrvIn) hrvIn.value = current.hrv !== null ? current.hrv : '';
  if (rhrIn) rhrIn.value = current.rhr !== null ? current.rhr : '';
  if (strainIn) strainIn.value = current.strain !== null ? current.strain : '';
  if (sleepActIn) sleepActIn.value = current.sleepActualMin !== null ? (current.sleepActualMin / 60).toFixed(1) : '';
  if (sleepNeedIn) sleepNeedIn.value = current.sleepNeedMin ? (current.sleepNeedMin / 60).toFixed(1) : '8.0';

  if (deepIn) deepIn.value = current.stages ? current.stages.deepMin : '';
  if (remIn) remIn.value = current.stages ? current.stages.remMin : '';
  if (lightIn) lightIn.value = current.stages ? current.stages.lightMin : '';
  if (awakeIn) awakeIn.value = current.stages ? current.stages.awakeMin : '';

  if (skinIn) skinIn.value = current.health.skinTemp !== null ? current.health.skinTemp : '';
  if (spo2In) spo2In.value = current.health.spo2 !== null ? current.health.spo2 : '';
  if (respIn) respIn.value = current.health.respRate !== null ? current.health.respRate : '';
}

async function _saveWhoopEntry() {
  if (!_uid) return;

  const recIn = $('whoop-input-recovery');
  const hrvIn = $('whoop-input-hrv');
  const rhrIn = $('whoop-input-rhr');
  const strainIn = $('whoop-input-strain');
  const sleepActIn = $('whoop-input-sleep-actual');
  const sleepNeedIn = $('whoop-input-sleep-need');
  const deepIn = $('whoop-input-deep');
  const remIn = $('whoop-input-rem');
  const lightIn = $('whoop-input-light');
  const awakeIn = $('whoop-input-awake');
  const skinIn = $('whoop-input-skin');
  const spo2In = $('whoop-input-spo2');
  const respIn = $('whoop-input-resp');
  const saveBtn = $('whoop-save-entry-btn');

  const recoveryVal = recIn?.value ? parseInt(recIn.value, 10) : null;
  const hrvVal = hrvIn?.value ? parseInt(hrvIn.value, 10) : null;
  const rhrVal = rhrIn?.value ? parseInt(rhrIn.value, 10) : null;
  const strainVal = strainIn?.value ? parseFloat(strainIn.value) : null;
  const sleepActHours = sleepActIn?.value ? parseFloat(sleepActIn.value) : null;
  const sleepNeedHours = sleepNeedIn?.value ? parseFloat(sleepNeedIn.value) : 8.0;

  const actualMins = sleepActHours !== null ? Math.round(sleepActHours * 60) : null;
  const needMins = Math.round(sleepNeedHours * 60);
  const debtMins = (actualMins !== null && needMins > actualMins) ? needMins - actualMins : 0;
  const efficiency = actualMins !== null ? Math.min(100, Math.round((actualMins / needMins) * 100)) : null;

  const fallbackStages = actualMins ? extractGarminSleepStages(null, actualMins, efficiency, _selectedDate) : null;
  const deepMin = deepIn?.value ? parseInt(deepIn.value, 10) : (fallbackStages?.deepMin ?? null);
  const remMin = remIn?.value ? parseInt(remIn.value, 10) : (fallbackStages?.remMin ?? null);
  const lightMin = lightIn?.value ? parseInt(lightIn.value, 10) : (fallbackStages?.lightMin ?? null);
  const awakeMin = awakeIn?.value ? parseInt(awakeIn.value, 10) : (fallbackStages?.awakeMin ?? null);

  const skinTemp = skinIn?.value ? parseFloat(skinIn.value) : null;
  const spo2 = spo2In?.value ? parseInt(spo2In.value, 10) : null;
  const respRate = respIn?.value ? parseFloat(respIn.value) : null;

  const current = _getWhoopDataForDate(_selectedDate);

  const payload = {
    recovery: recoveryVal,
    hrv: hrvVal,
    rhr: rhrVal,
    strain: strainVal,
    sleepActualMin: actualMins,
    sleepNeedMin: needMins,
    sleepDebtMin: debtMins,
    sleepEfficiency: efficiency,
    stages: {
      deepMin,
      remMin,
      lightMin,
      awakeMin
    },
    spo2,
    spO2: spo2,
    average_spo2: spo2,
    respRate,
    respiration: respRate,
    average_respiration: respRate,
    skinTemp,
    tempDelta: skinTemp,
    skin_temp_delta: skinTemp,
    body_temp_delta: skinTemp,
    health: {
      rhr: rhrVal,
      hrv: hrvVal,
      skinTemp,
      tempDelta: skinTemp,
      skin_temp_delta: skinTemp,
      body_temp_delta: skinTemp,
      spo2,
      spO2: spo2,
      average_spo2: spo2,
      respRate,
      respiration: respRate,
      average_respiration: respRate
    },
    journal: current.journal,
    updatedAt: serverTimestamp()
  };

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await setDoc(doc(db, 'users', _uid, 'whoopLogs', _selectedDate), payload, { merge: true });
    _closeWhoopEntryModal();
    _renderHomeScreen();
    _renderHealthScreen();
  } catch (err) {
    console.error('[whoop5] Error saving whoop log:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lockin Adatok Mentése';
    }
  }
}

// ── E. Klinikai Vérkép Labor Modal ─────────────────────────
function _openBloodworkModal(focusBmId = null) {
  const modal = $('bloodwork-modal');
  const sheet = $('bloodwork-sheet');
  if (!modal || !sheet) return;

  const fieldsContainer = $('bloodwork-fields-container');
  if (fieldsContainer) {
    fieldsContainer.innerHTML = BLOODWORK_BIOMARKERS.map(bm => {
      const currentVal = _bloodworkValues[bm.id] !== undefined ? _bloodworkValues[bm.id] : bm.defaultValue;
      return `
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#2A2C34]" id="bm-field-wrap-${bm.id}">
          <div class="flex items-center justify-between mb-1.5">
            <div>
              <span class="text-xs font-bold text-gray-900 dark:text-white">${bm.name}</span>
              <p class="text-[10px] text-gray-400">Normál: ${bm.min} – ${bm.max} ${bm.unit} | Opt: ${bm.optMin} – ${bm.optMax}</p>
            </div>
            <span class="text-[10px] text-gray-400 font-bold">${bm.unit}</span>
          </div>
          <input type="number" step="0.01" value="${currentVal}"
                 class="bloodwork-input w-full bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#2A2C34] rounded-xl px-3 py-2 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:border-[#00E5FF]"
                 data-bmid="${bm.id}" placeholder="${bm.defaultValue}" />
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
      if (focusBmId) {
        const targetEl = $(`bm-field-wrap-${focusBmId}`);
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

function _closeBloodworkModal() {
  const modal = $('bloodwork-modal');
  const sheet = $('bloodwork-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

async function _saveBloodwork() {
  if (!_uid) return;

  const saveBtn = $('bloodwork-save-btn');
  const inputs = document.querySelectorAll('.bloodwork-input');

  const newValues = {};
  inputs.forEach(input => {
    const id = input.dataset.bmid;
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      newValues[id] = val;
    }
  });

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés folyamatban...';
  }

  try {
    await setDoc(doc(db, 'users', _uid, 'bloodwork', 'latest'), {
      values: newValues,
      updatedAt: serverTimestamp()
    }, { merge: true });

    _bloodworkValues = newValues;
    _renderHealthScreen();
    _closeBloodworkModal();
  } catch (err) {
    console.error('[whoop5] Bloodwork save error:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Vérkép Értékek Mentése & Elemzés';
    }
  }
}

// ── E. Lockin Custom Habit Modal & Gyors Hidratáció ────────
function _openCustomHabitModal() {
  const modal = $('whoop-custom-habit-modal');
  const sheet = $('whoop-custom-habit-sheet');
  const nameInp = $('whoop-custom-habit-name');
  const emojiInp = $('whoop-custom-habit-emoji');
  const preview = $('whoop-custom-habit-preview-emoji');
  if (!modal || !sheet) return;
  if (nameInp) nameInp.value = '';
  if (emojiInp) emojiInp.value = '💊';
  if (preview) preview.textContent = '💊';
  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
  });
}

function _closeCustomHabitModal() {
  const modal = $('whoop-custom-habit-modal');
  const sheet = $('whoop-custom-habit-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

async function _saveCustomHabit() {
  if (!_uid) return;
  const nameInp = $('whoop-custom-habit-name');
  const emojiInp = $('whoop-custom-habit-emoji');
  const saveBtn = $('whoop-save-custom-habit-btn');

  const name = nameInp ? nameInp.value.trim() : '';
  const emoji = emojiInp && emojiInp.value.trim() ? emojiInp.value.trim() : '✨';

  if (!name) {
    if (nameInp) nameInp.focus();
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'customHabits'), {
      name,
      emoji,
      createdAt: serverTimestamp()
    });
    _closeCustomHabitModal();
  } catch (err) {
    console.error('[whoop5] Custom habit save error:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Szokás Mentése';
    }
  }
}

async function _logQuickWater() {
  if (!_uid) return;
  try {
    await addDoc(collection(db, 'users', _uid, 'hydrationLogs'), {
      date: _selectedDate,
      drinkType: 'water',
      ml: 250,
      effectiveMl: 250,
      factor: 1.0,
      createdAt: serverTimestamp()
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lockin:whoop-nutrition-updated'));
    }
  } catch (err) {
    console.error('[whoop5] Quick water error:', err);
  }
}

// ── Globális Események Bekötése ────────────────────────────
function _bindGlobalWhoopEvents() {
  // Globális cél frissítési esemény figyelése (Settings változásakor)
  window.addEventListener('fitplan:goals-updated', (e) => {
    if (e.detail) {
      _userProfile = { ..._userProfile, ...e.detail };
    }
    _renderHomeScreen();
  });

  // Diéta modul valós idejű szinkronizálása
  window.addEventListener('lockin:nutrition-updated', (e) => {
    if (e.detail?.meals) _allMeals = e.detail.meals;
    if (e.detail?.hydration) _allHydrationLogs = e.detail.hydration;
    _renderHomeScreen();
  });

  // Bloodwork modal
  const bwClose = $('bloodwork-close');
  const bwBackdrop = $('bloodwork-backdrop');
  const bwSave = $('bloodwork-save-btn');
  if (bwClose) bwClose.addEventListener('click', _closeBloodworkModal);
  if (bwBackdrop) bwBackdrop.addEventListener('click', _closeBloodworkModal);
  if (bwSave) bwSave.addEventListener('click', _saveBloodwork);

  // Whoop entry modal
  const whoopClose = $('whoop-entry-close');
  const whoopBackdrop = $('whoop-entry-backdrop');
  const whoopSave = $('whoop-save-entry-btn');
  if (whoopClose) whoopClose.addEventListener('click', _closeWhoopEntryModal);
  if (whoopBackdrop) whoopBackdrop.addEventListener('click', _closeWhoopEntryModal);
  if (whoopSave) whoopSave.addEventListener('click', _saveWhoopEntry);

  // Health modal
  const hClose = $('whoop-health-close');
  const hBackdrop = $('whoop-health-backdrop');
  const hGotoHealth = $('whoop-health-goto-health-btn');
  if (hClose) hClose.addEventListener('click', _closeHealthModal);
  if (hBackdrop) hBackdrop.addEventListener('click', _closeHealthModal);
  if (hGotoHealth) {
    hGotoHealth.addEventListener('click', () => {
      _closeHealthModal();
      if (window.showModule) window.showModule('health');
    });
  }

  // Stress modal
  const sClose = $('whoop-stress-close');
  const sBackdrop = $('whoop-stress-backdrop');
  const breathToggleBtn = $('whoop-breath-toggle-btn');
  if (sClose) sClose.addEventListener('click', _closeStressModal);
  if (sBackdrop) sBackdrop.addEventListener('click', _closeStressModal);
  if (breathToggleBtn) breathToggleBtn.addEventListener('click', _toggleBreathingExercise);

  // Activity Picker modal
  const pickClose = $('whoop-activity-picker-close');
  const pickBackdrop = $('whoop-activity-picker-backdrop');
  const pickWoBtn = $('whoop-pick-workout-btn');
  const pickRecBtn = $('whoop-pick-recovery-btn');

  if (pickClose) pickClose.addEventListener('click', _closeActivityPickerModal);
  if (pickBackdrop) pickBackdrop.addEventListener('click', _closeActivityPickerModal);

  if (pickWoBtn) {
    pickWoBtn.addEventListener('click', () => {
      _closeActivityPickerModal();
      if (typeof window.openWorkoutModal === 'function') {
        window.openWorkoutModal(_selectedDate);
      } else {
        const woModal = $('wo-modal');
        const sheet = $('wo-modal-sheet');
        const woDate = $('wo-input-date');
        if (woDate) woDate.value = _selectedDate;
        if (typeof window.populateGearSelects === 'function') {
          window.populateGearSelects();
        }
        if (woModal && sheet) {
          woModal.classList.remove('hidden');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
          });
        }
      }
    });
  }

  if (pickRecBtn) {
    pickRecBtn.addEventListener('click', () => {
      _closeActivityPickerModal();
      if (typeof window.openProtocolsModal === 'function') {
        window.openProtocolsModal();
      } else {
        const recProtoModal = $('rec-protocols-modal');
        const sheet = $('rec-protocols-sheet');
        if (recProtoModal && sheet) {
          recProtoModal.classList.remove('hidden');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
          });
        }
      }
    });
  }

  // Lockin Custom Habit modal
  const habitClose = $('whoop-custom-habit-close');
  const habitBackdrop = $('whoop-custom-habit-backdrop');
  const habitSave = $('whoop-save-custom-habit-btn');
  const habitEmojiInp = $('whoop-custom-habit-emoji');
  const habitPreview = $('whoop-custom-habit-preview-emoji');

  if (habitClose) habitClose.addEventListener('click', _closeCustomHabitModal);
  if (habitBackdrop) habitBackdrop.addEventListener('click', _closeCustomHabitModal);
  if (habitSave) habitSave.addEventListener('click', _saveCustomHabit);

  if (habitEmojiInp) {
    habitEmojiInp.addEventListener('input', () => {
      if (habitPreview) habitPreview.textContent = habitEmojiInp.value || '✨';
    });
  }

  document.querySelectorAll('.whoop-emoji-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const em = btn.textContent.trim();
      if (habitEmojiInp) habitEmojiInp.value = em;
      if (habitPreview) habitPreview.textContent = em;
    });
  });

  // Edzés Részletező Modál (Workout Detail Modal)
  const woDetClose = $('wo-detail-close');
  const woDetBackdrop = $('wo-detail-backdrop');
  const woDetSave = $('wo-detail-save-btn');

  if (woDetClose) woDetClose.addEventListener('click', _closeWorkoutDetailModal);
  if (woDetBackdrop) woDetBackdrop.addEventListener('click', _closeWorkoutDetailModal);
  if (woDetSave) woDetSave.addEventListener('click', _saveWorkoutDetail);

  // Regenerációs Aktivitás Szerkesztő Modál (Recovery Edit Modal)
  const recEditClose = $('whoop-recovery-edit-close');
  const recEditBackdrop = $('whoop-recovery-edit-backdrop');
  const recEditSave = $('whoop-rec-edit-save-btn');
  const recEditDelete = $('whoop-rec-edit-delete-btn');

  if (recEditClose) recEditClose.addEventListener('click', _closeRecoveryEditModal);
  if (recEditBackdrop) recEditBackdrop.addEventListener('click', _closeRecoveryEditModal);
  if (recEditSave) recEditSave.addEventListener('click', _saveRecoveryEdit);
  if (recEditDelete) {
    recEditDelete.addEventListener('click', () => {
      const id = $('whoop-rec-edit-id')?.value;
      const col = $('whoop-rec-edit-col')?.value || 'recoveryProtocols';
      if (id) _deleteRecoveryActivity(id, col);
    });
  }
}
