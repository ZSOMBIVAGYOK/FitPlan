// ============================================================
// whoop5.js — WHOOP 5.0 Főmodul & Élménymotor
// FitPlan Pro | 4 Fő Rész: Home, Health, Community, More
// Home: WHOOP 5.0 Dials (Recovery, Strain, Sleep), Journal, Trend
// Health: FitPlan Biológiai Életkor, Vérkép Elemző, Health Monitor
// Community: WHOOP Teams placeholder
// More: Profil & Átvezetés a Diéta, Edzés, Rekordok, Dok modulokhoz
// ============================================================

import { db } from '../firebase-config.js';
import {
  BLOODWORK_CATEGORIES,
  BLOODWORK_BIOMARKERS,
  evaluateBiomarker,
  calcBloodworkScore,
  calcFitPlanAge
} from './bloodwork-data.js';
import { getSportById } from '../garmin-sports.js';
import {
  collection,
  doc,
  setDoc,
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
  if (!mins || mins <= 0) return '0ó 0p';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}ó ${m}p`;
}

// ── Belső Állapot ──────────────────────────────────────────
let _uid = null;
let _selectedDate = todayString();
let _activeBloodCategory = 'all';
let _trendDays = 7;

let _unsubWhoop = null;
let _unsubWorkouts = null;
let _unsubSleep = null;
let _unsubBloodwork = null;
let _unsubProfile = null;

let _allWhoopLogs = {};
let _allWorkouts = [];
let _allSleepLogs = [];
let _bloodworkValues = {};
let _userProfile = { age: 28, weight: 75, height: 180 };

let _uiInitialized = false;

// ── Publikus Inicializálás és Leállítás ─────────────────────
export function initWhoop5(uid) {
  _uid = uid;
  _selectedDate = todayString();

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
  if (_unsubBloodwork) { _unsubBloodwork(); _unsubBloodwork = null; }
  if (_unsubProfile) { _unsubProfile(); _unsubProfile = null; }

  _allWhoopLogs = {};
  _allWorkouts = [];
  _allSleepLogs = [];
  _bloodworkValues = {};
}

// ── Real-time Firestore Adatkapcsolat ──────────────────────
function _subscribeWhoopData() {
  if (!_uid) return;

  // 1. WHOOP biometrikus naplók
  const qWhoop = query(collection(db, 'users', _uid, 'whoopLogs'));
  _unsubWhoop = onSnapshot(qWhoop, snap => {
    _allWhoopLogs = {};
    snap.docs.forEach(d => {
      _allWhoopLogs[d.id] = { id: d.id, ...d.data() };
    });
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] WhoopLogs sync error:', err));

  // 2. Edzések a Strain kiszámításához
  const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qWorkouts, snap => {
    _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] Workouts sync error:', err));

  // 3. Alvásnaplók
  const qSleep = query(collection(db, 'users', _uid, 'sleepLogs'), orderBy('createdAt', 'desc'));
  _unsubSleep = onSnapshot(qSleep, snap => {
    _allSleepLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderHomeScreen();
    _renderHealthScreen();
  }, err => console.error('[whoop5] Sleep sync error:', err));

  // 4. Vérkép laborértékek
  const refBlood = doc(db, 'users', _uid, 'bloodwork', 'latest');
  _unsubBloodwork = onSnapshot(refBlood, snap => {
    if (snap.exists()) {
      _bloodworkValues = snap.data().values || {};
    } else {
      _bloodworkValues = {};
    }
    _renderHealthScreen();
  }, err => console.error('[whoop5] Bloodwork sync error:', err));

  // 5. Felhasználói beállítások (Életkor a FitPlan Age-hez)
  const refProfile = doc(db, 'users', _uid, 'settings', 'profile');
  _unsubProfile = onSnapshot(refProfile, snap => {
    if (snap.exists()) {
      _userProfile = { ..._userProfile, ...snap.data() };
      _renderHealthScreen();
    }
  }, err => console.error('[whoop5] Profile sync error:', err));
}

// ── WHOOP Biometria Adatok Értelmezése egy Naptári Napra ────
function _getWhoopDataForDate(dateStr) {
  const manual = _allWhoopLogs[dateStr];
  const dayWorkouts = _allWorkouts.filter(w => w.date === dateStr);
  const daySleep = _allSleepLogs.find(s => s.date === dateStr);

  const totalWorkoutMins = dayWorkouts.reduce((s, w) => s + (Number(w.duration) || 0), 0);
  const totalCalories = dayWorkouts.reduce((s, w) => s + (Number(w.calories) || (Number(w.duration) || 0) * 8.5), 0);

  let estimatedStrain = 0.0;
  if (totalWorkoutMins > 0) {
    estimatedStrain = Math.min(20.5, Math.round(21 * (1 - Math.exp(-totalWorkoutMins * 0.016)) * 10) / 10);
    if (estimatedStrain < 4.0) estimatedStrain = 4.0;
  }

  let actualSleepMinutes = 462; // 7ó 42p alapértelmezett
  if (daySleep && daySleep.durationHours) {
    actualSleepMinutes = Math.round(Number(daySleep.durationHours) * 60);
  }

  if (manual) {
    return {
      recovery: Number(manual.recovery) || 78,
      hrv: Number(manual.hrv) || 78,
      rhr: Number(manual.rhr) || 48,
      strain: manual.strain !== undefined ? Number(manual.strain) : (estimatedStrain || 14.2),
      activeKcal: manual.activeKcal !== undefined ? Number(manual.activeKcal) : Math.round(totalCalories || 680),
      avgHr: Number(manual.avgHr) || 136,
      maxHr: Number(manual.maxHr) || 174,
      workoutMins: totalWorkoutMins,
      sleepActualMin: Number(manual.sleepActualMin) || actualSleepMinutes,
      sleepNeedMin: Number(manual.sleepNeedMin) || 495,
      sleepDebtMin: manual.sleepDebtMin !== undefined ? Number(manual.sleepDebtMin) : 33,
      sleepEfficiency: Number(manual.sleepEfficiency) || 94,
      stages: {
        deepMin: Number(manual.stages?.deepMin) || Math.round(actualSleepMinutes * 0.22),
        remMin: Number(manual.stages?.remMin) || Math.round(actualSleepMinutes * 0.25),
        lightMin: Number(manual.stages?.lightMin) || Math.round(actualSleepMinutes * 0.47),
        awakeMin: Number(manual.stages?.awakeMin) || Math.round(actualSleepMinutes * 0.06)
      },
      health: {
        rhr: Number(manual.health?.rhr) || Number(manual.rhr) || 48,
        hrv: Number(manual.health?.hrv) || Number(manual.hrv) || 78,
        skinTemp: manual.health?.skinTemp !== undefined ? Number(manual.health.skinTemp) : -0.2,
        spo2: Number(manual.health?.spo2) || 98,
        respRate: Number(manual.health?.respRate) || 14.8
      },
      journal: {
        caffeine: Boolean(manual.journal?.caffeine),
        alcohol: Boolean(manual.journal?.alcohol),
        sauna: Boolean(manual.journal?.sauna),
        hydration: Boolean(manual.journal?.hydration),
        stretch: Boolean(manual.journal?.stretch),
        supplement: Boolean(manual.journal?.supplement)
      },
      isManual: true
    };
  }

  return {
    recovery: 82,
    hrv: 78,
    rhr: 48,
    strain: estimatedStrain || 14.2,
    activeKcal: Math.round(totalCalories) || 720,
    avgHr: 136,
    maxHr: 174,
    workoutMins: totalWorkoutMins || 75,
    sleepActualMin: actualSleepMinutes,
    sleepNeedMin: 495,
    sleepDebtMin: 33,
    sleepEfficiency: 94,
    stages: {
      deepMin: Math.round(actualSleepMinutes * 0.22),
      remMin: Math.round(actualSleepMinutes * 0.25),
      lightMin: Math.round(actualSleepMinutes * 0.47),
      awakeMin: Math.round(actualSleepMinutes * 0.06)
    },
    health: {
      rhr: 48,
      hrv: 78,
      skinTemp: -0.2,
      spo2: 98,
      respRate: 14.8
    },
    journal: {
      caffeine: false,
      alcohol: false,
      sauna: false,
      hydration: false,
      stretch: false,
      supplement: false
    },
    isManual: false
  };
}

// ══════════════════════════════════════════════════════════════
// 1. HOME KÉPERNYŐ (WHOOP 5.0 KÖZPONTI MŰSZERFAL)
// ══════════════════════════════════════════════════════════════
export function _renderHomeScreen() {
  const container = $('whoop5-home-container');
  if (!container) return;

  const data = _getWhoopDataForDate(_selectedDate);
  const rec = Math.max(0, Math.min(100, Math.round(data.recovery)));

  let color = '#00E676';
  let badgeText = 'OPTIMÁLIS REGENERÁCIÓ';
  let badgeBg = 'bg-emerald-500/10 text-[#00E676] border-emerald-500/30';
  let glowColor = 'rgba(0, 230, 118, 0.4)';
  let coachingText = 'A szervezeted kiválóan regenerálódott, készen áll a magas intenzitású edzésre és maximális terhelésre.';
  let targetStrainRange = '14.0 – 17.5';

  if (rec < 33) {
    color = '#FF3D00';
    badgeText = 'ALACSONY REGENERÁCIÓ';
    badgeBg = 'bg-red-500/10 text-[#FF3D00] border-red-500/30';
    glowColor = 'rgba(255, 61, 0, 0.4)';
    coachingText = 'Alacsony regenerációs szint. Priorizáld a regenerációt: könnyű mobilitás, aktív séta és korai fekvés javasolt.';
    targetStrainRange = '6.0 – 10.0';
  } else if (rec < 66) {
    color = '#FFD600';
    badgeText = 'KÖZEPES REGENERÁCIÓ';
    badgeBg = 'bg-amber-500/10 text-[#FFD600] border-amber-500/30';
    glowColor = 'rgba(255, 214, 0, 0.4)';
    coachingText = 'Kiegyensúlyozott állapot. Fenntartó vagy mérsékelt intenzitású edzésterhelés ajánlott.';
    targetStrainRange = '10.5 – 14.0';
  }

  const circumference = 276.46;
  const strokeOffset = circumference - (circumference * rec / 100);

  const sleepRatio = Math.min(100, Math.round((data.sleepActualMin / data.sleepNeedMin) * 100));
  const stagesTotal = data.stages.deepMin + data.stages.remMin + data.stages.lightMin + data.stages.awakeMin || 1;
  const deepPct = Math.round((data.stages.deepMin / stagesTotal) * 100);
  const remPct = Math.round((data.stages.remMin / stagesTotal) * 100);
  const lightPct = Math.round((data.stages.lightMin / stagesTotal) * 100);
  const awakePct = Math.max(0, 100 - (deepPct + remPct + lightPct));
  const strainPct = Math.min(100, Math.round((data.strain / 21.0) * 100));

  container.innerHTML = `
    <!-- Top Bar: WHOOP 5.0 Status & Date Switcher -->
    <div class="bg-white dark:bg-[#121316] border border-gray-200 dark:border-[#22242C] rounded-3xl p-4 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100 dark:border-[#22242C]">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF] animate-pulse"></span>
          <span class="text-xs font-black tracking-wider text-gray-900 dark:text-white uppercase font-sans">WHOOP 5.0 · PRO</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-bold text-gray-400 bg-gray-100 dark:bg-[#1B1C22] px-2.5 py-1 rounded-full border border-gray-200 dark:border-[#2A2C34]">
            <i class="fa-solid fa-bolt text-amber-400 mr-1"></i>94% Töltöttség
          </span>
          <button id="whoop5-open-entry-btn" class="px-3 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all">
            Kézi bevitel
          </button>
        </div>
      </div>

      <!-- Dátum Lapozó -->
      <div class="flex items-center justify-between">
        <button id="whoop5-prev-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1B1C22] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <div class="text-center relative flex-1 cursor-pointer">
          <h3 class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight">${formatDateHU(_selectedDate)}</h3>
          <p class="text-[11px] text-gray-400 font-medium">Koppints a dátum módosításához</p>
          <input id="whoop5-date-picker" type="date" value="${_selectedDate}" class="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>
        <button id="whoop5-next-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1B1C22] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-right text-sm"></i>
        </button>
      </div>
    </div>

    <!-- Dinamikus Coaching Banner -->
    <div class="relative overflow-hidden rounded-3xl p-4 mb-4 border ${badgeBg} bg-white dark:bg-[#121316] shadow-sm">
      <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0" style="background: ${glowColor}; color: ${color};">
          <i class="fa-solid fa-heart-pulse text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border" style="color: ${color}; border-color: ${color};">
              ${badgeText}
            </span>
            <span class="text-[11px] text-gray-400 font-medium">Cél terhelés: ${targetStrainRange}</span>
          </div>
          <p class="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-relaxed">${coachingText}</p>
        </div>
      </div>
    </div>

    <!-- 3 Fő Oszlop / Kártya Grid: RECOVERY & DAY STRAIN -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

      <!-- 1. RECOVERY KÁRTYA -->
      <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full" style="background-color: ${color};"></div>
            <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Recovery</h4>
          </div>
          <span class="text-xs font-bold" style="color: ${color};">${rec}%</span>
        </div>

        <div class="flex flex-col items-center justify-center my-3 relative">
          <div class="relative w-36 h-36 flex items-center justify-center">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" stroke="currentColor" stroke-width="8" fill="transparent" class="text-gray-100 dark:text-[#22242C]" />
              <circle cx="50" cy="50" r="44" stroke="${color}" stroke-width="8" stroke-linecap="round" fill="transparent"
                      stroke-dasharray="${circumference}" stroke-dashoffset="${strokeOffset}"
                      style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 0 7px ${glowColor});" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span class="text-3xl font-black text-gray-900 dark:text-white tabular-nums leading-none tracking-tight">${rec}</span>
              <span class="text-[10px] font-extrabold uppercase tracking-widest mt-0.5" style="color: ${color};">%</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 dark:border-[#22242C] text-center">
          <div>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">HRV</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.hrv} <span class="text-[9px] font-normal text-gray-400">ms</span></p>
          </div>
          <div class="border-x border-gray-100 dark:border-[#22242C]">
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">RHR</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.rhr} <span class="text-[9px] font-normal text-gray-400">bpm</span></p>
          </div>
          <div>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Alvás</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${sleepRatio}%</p>
          </div>
        </div>
      </div>

      <!-- 2. DAY STRAIN KÁRTYA -->
      <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></div>
            <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Day Strain</h4>
          </div>
          <span class="text-xs font-bold text-[#00E5FF]">${data.strain} / 21.0</span>
        </div>

        <div class="my-4">
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-3xl font-black text-gray-900 dark:text-white tabular-nums leading-none tracking-tight">${data.strain}</span>
            <span class="text-xs font-bold text-[#00E5FF]">Célzóna: ${targetStrainRange}</span>
          </div>

          <div class="relative w-full h-3 bg-gray-100 dark:bg-[#1B1C22] rounded-full overflow-hidden p-0.5 border border-gray-200 dark:border-[#2A2C34]">
            <div class="h-full rounded-full bg-gradient-to-r from-cyan-400 to-[#00E5FF] transition-all duration-700" style="width: ${strainPct}%; box-shadow: 0 0 8px rgba(0, 229, 255, 0.5);"></div>
          </div>
          <div class="flex justify-between text-[9px] text-gray-400 mt-1 font-mono">
            <span>0.0</span>
            <span>7.0</span>
            <span>14.0</span>
            <span>21.0</span>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-1 pt-3 border-t border-gray-100 dark:border-[#22242C] text-center">
          <div>
            <p class="text-[9px] font-bold text-gray-400 uppercase">Aktív kcal</p>
            <p class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.activeKcal}</p>
          </div>
          <div>
            <p class="text-[9px] font-bold text-gray-400 uppercase">Átlag HR</p>
            <p class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.avgHr}</p>
          </div>
          <div>
            <p class="text-[9px] font-bold text-gray-400 uppercase">Csúcs HR</p>
            <p class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.maxHr}</p>
          </div>
          <div>
            <p class="text-[9px] font-bold text-gray-400 uppercase">Edzésidő</p>
            <p class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${formatMinutesToHours(data.workoutMins)}</p>
          </div>
        </div>
      </div>

    </div>

    <!-- 3. SLEEP PERFORMANCE KÁRTYA -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-moon text-indigo-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Sleep Performance</h4>
        </div>
        <div class="text-right">
          <span class="text-sm font-extrabold text-indigo-500">${formatMinutesToHours(data.sleepActualMin)}</span>
          <span class="text-xs text-gray-400 font-medium"> / ${formatMinutesToHours(data.sleepNeedMin)} (${sleepRatio}%)</span>
        </div>
      </div>

      <!-- Halmozott Sávdiagram -->
      <div class="w-full h-4 rounded-xl overflow-hidden flex gap-0.5 mb-3 bg-gray-100 dark:bg-[#1B1C22] p-0.5 border border-gray-200 dark:border-[#2A2C34]">
        <div style="width: ${deepPct}%;" class="bg-[#1e40af] rounded-l-lg" title="Mélyalvás"></div>
        <div style="width: ${remPct}%;" class="bg-[#00E5FF]" title="REM alvás"></div>
        <div style="width: ${lightPct}%;" class="bg-[#64748b]" title="Könnyű alvás"></div>
        <div style="width: ${awakePct}%;" class="bg-[#f43f5e] rounded-r-lg" title="Ébren töltött idő"></div>
      </div>

      <!-- Szakaszok Jelmagyarázat -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4">
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#1e40af]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Mély (SWS)</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.deepMin)} (${deepPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">REM</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.remMin)} (${remPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#64748b]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Könnyű</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.lightMin)} (${lightPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1B1C22]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#f43f5e]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Ébren</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.awakeMin)} (${awakePct}%)</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100 dark:border-[#22242C] text-xs">
        <div class="flex items-center justify-between">
          <span class="text-gray-400 font-medium">Alvási adósság:</span>
          <span class="font-extrabold text-amber-500">${data.sleepDebtMin} perc</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-400 font-medium">Alvási hatékonyság:</span>
          <span class="font-extrabold text-emerald-500">${data.sleepEfficiency}%</span>
        </div>
      </div>
    </div>

    <!-- 4. WHOOP JOURNAL (NAPI SZOKÁSOK) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-book-bookmark text-amber-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">WHOOP Journal (Napi szokások)</h4>
        </div>
        <span class="text-[10px] text-gray-400 font-medium">Koppints a rögzítéshez</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
      </div>
    </div>

    <!-- 5. TREND GRAFIKON (7 / 30 NAPOS) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-chart-line text-[#00E5FF] text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Biometrikus Trendek</h4>
        </div>
        <div class="flex items-center gap-1 bg-gray-100 dark:bg-[#1B1C22] p-1 rounded-xl">
          <button id="whoop5-trend-7d-btn" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${_trendDays === 7 ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}">7 nap</button>
          <button id="whoop5-trend-30d-btn" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${_trendDays === 30 ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}">30 nap</button>
        </div>
      </div>

      <div class="flex items-center justify-center gap-4 text-[10px] font-bold text-gray-400 mb-2">
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-[#00E676]"></span> Recovery %</span>
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></span> Strain</span>
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-violet-400"></span> HRV</span>
      </div>

      <div id="whoop5-trend-chart-box" class="w-full h-44 flex items-center justify-center"></div>
    </div>

    <!-- 6. MAI RÖGZÍTETT EDZÉSEK -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-8 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Mai Aktivitások</h4>
        <button id="whoop5-start-activity-btn" class="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md active:scale-95 transition-all flex items-center gap-1.5">
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Edzés indítása</span>
        </button>
      </div>
      <div id="whoop5-today-activities-list" class="space-y-2"></div>
    </div>
  `;

  _bindHomeEvents();
  _renderHomeTrendChart();
  _renderHomeTodayActivities();
}

function _bindHomeEvents() {
  const prevBtn = $('whoop5-prev-day-btn');
  const nextBtn = $('whoop5-next-day-btn');
  const datePicker = $('whoop5-date-picker');
  const entryBtn = $('whoop5-open-entry-btn');
  const actBtn = $('whoop5-start-activity-btn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      _selectedDate = d.toISOString().slice(0, 10);
      _renderHomeScreen();
      _renderHealthScreen();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      _selectedDate = d.toISOString().slice(0, 10);
      _renderHomeScreen();
      _renderHealthScreen();
    });
  }

  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      if (e.target.value) {
        _selectedDate = e.target.value;
        _renderHomeScreen();
        _renderHealthScreen();
      }
    });
  }

  if (entryBtn) {
    entryBtn.addEventListener('click', () => {
      const m = $('whoop-entry-modal');
      const sheet = $('whoop-entry-sheet');
      if (m && sheet) {
        _populateWhoopEntryModal();
        m.classList.remove('hidden');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
        });
      }
    });
  }

  if (actBtn) {
    actBtn.addEventListener('click', () => {
      const woModal = $('wo-modal');
      const sheet = $('wo-modal-sheet');
      if (woModal && sheet) {
        woModal.classList.remove('hidden');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => sheet.style.transform = 'translateY(0)');
        });
      }
    });
  }

  // Journal gombok bekötése
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

  const btn7d = $('whoop5-trend-7d-btn');
  const btn30d = $('whoop5-trend-30d-btn');
  if (btn7d) {
    btn7d.addEventListener('click', () => {
      _trendDays = 7;
      _renderHomeScreen();
    });
  }
  if (btn30d) {
    btn30d.addEventListener('click', () => {
      _trendDays = 30;
      _renderHomeScreen();
    });
  }
}

function _renderHomeTrendChart() {
  const chartBox = $('whoop5-trend-chart-box');
  if (!chartBox) return;

  const daysCount = _trendDays || 7;
  const dates = [];
  const base = new Date(_selectedDate + 'T12:00:00');

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const recPoints = [];
  const strainPoints = [];
  const hrvPoints = [];

  dates.forEach(d => {
    const entry = _getWhoopDataForDate(d);
    recPoints.push(entry.recovery);
    strainPoints.push(entry.strain);
    hrvPoints.push(entry.hrv);
  });

  const width = 340;
  const height = 150;
  const padX = 25;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const stepX = dates.length > 1 ? plotW / (dates.length - 1) : plotW;

  const getRecY = val => padY + plotH - (Math.max(0, Math.min(100, val)) / 100) * plotH;
  const getStrainY = val => padY + plotH - (Math.max(0, Math.min(21, val)) / 21) * plotH;
  const getHrvY = val => padY + plotH - ((Math.max(30, Math.min(120, val)) - 30) / 90) * plotH;

  const recCoords = recPoints.map((val, i) => ({ x: padX + i * stepX, y: getRecY(val) }));
  const strainCoords = strainPoints.map((val, i) => ({ x: padX + i * stepX, y: getStrainY(val) }));
  const hrvCoords = hrvPoints.map((val, i) => ({ x: padX + i * stepX, y: getHrvY(val) }));

  function buildPath(pts) {
    if (pts.length === 0) return '';
    return pts.reduce((acc, pt, i) => {
      if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      return `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');
  }

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-full overflow-visible">
      <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="#22242C" stroke-width="0.75" stroke-dasharray="3,3" />
      <line x1="${padX}" y1="${padY + plotH / 2}" x2="${width - padX}" y2="${padY + plotH / 2}" stroke="#22242C" stroke-width="0.75" stroke-dasharray="3,3" />
      <line x1="${padX}" y1="${padY + plotH}" x2="${width - padX}" y2="${padY + plotH}" stroke="#22242C" stroke-width="1" />

      <path d="${buildPath(hrvCoords)}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${buildPath(strainCoords)}" fill="none" stroke="#00E5FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${buildPath(recCoords)}" fill="none" stroke="#00E676" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      ${recCoords.map((pt, i) => `
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" fill="#00E676" class="cursor-pointer">
          <title>${dates[i]}: ${recPoints[i]}% Recovery</title>
        </circle>
      `).join('')}

      ${dates.map((d, i) => {
        if (daysCount === 30 && i % 5 !== 0 && i !== dates.length - 1) return '';
        const x = padX + i * stepX;
        const dayLabel = d.slice(8);
        return `<text x="${x.toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="9" fill="#9ca3af" font-weight="600">${dayLabel}</text>`;
      }).join('')}
    </svg>
  `;

  chartBox.innerHTML = svg;
}

function _renderHomeTodayActivities() {
  const listEl = $('whoop5-today-activities-list');
  if (!listEl) return;

  const dayWorkouts = _allWorkouts.filter(w => w.date === _selectedDate);

  if (dayWorkouts.length === 0) {
    listEl.innerHTML = `
      <p class="text-xs text-gray-400 italic text-center py-4 bg-gray-50 dark:bg-[#1B1C22] rounded-2xl">Még nem rögzítettél edzést mára. Koppints az "Edzés indítása" gombra!</p>
    `;
    return;
  }

  listEl.innerHTML = dayWorkouts.map(w => {
    const sport = getSportById(w.sportId || 'strength_training');
    return `
      <div class="flex items-center justify-between p-3.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22] border border-gray-100 dark:border-[#22242C]">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-cyan-500/10 text-[#00E5FF] flex items-center justify-center text-sm">
            <i class="${sport.icon || 'fa-solid fa-dumbbell'}"></i>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-900 dark:text-white">${w.name || sport.name}</p>
            <p class="text-[10px] text-gray-400 font-medium">${w.duration || 60} perc · ${w.calories ? `${w.calories} kcal` : sport.cat}</p>
          </div>
        </div>
        <span class="text-[10px] font-extrabold text-[#00E5FF] bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/20">Edzés</span>
      </div>
    `;
  }).join('');
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

  // Kategóriák szerinti szűrt vérkép lista
  const filteredBiomarkers = _activeBloodCategory === 'all'
    ? BLOODWORK_BIOMARKERS
    : BLOODWORK_BIOMARKERS.filter(b => b.category === _activeBloodCategory);

  container.innerHTML = `
    <!-- Top Header -->
    <div class="bg-white dark:bg-[#121316] border border-gray-200 dark:border-[#22242C] rounded-3xl p-4 mb-4 shadow-sm flex items-center justify-between">
      <div>
        <span class="text-[10px] font-black uppercase tracking-widest text-[#00E5FF]">WHOOP 5.0 LONGEVITY</span>
        <h2 class="text-base font-extrabold text-gray-900 dark:text-white">Health &amp; FitPlan Age Központ</h2>
      </div>
      <button id="whoop5-open-bloodwork-btn" class="px-3.5 py-2 rounded-2xl bg-[#00E5FF] hover:bg-cyan-400 text-black font-extrabold text-xs shadow-md shadow-cyan-500/20 active:scale-95 transition-all flex items-center gap-1.5">
        <i class="fa-solid fa-file-medical"></i>
        <span>Vérkép Lelet Bevitele</span>
      </button>
    </div>

    <!-- 1. FITPLAN AGE (BIOLÓGIAI ÉLETKOR HERO KÁRTYA) -->
    <div class="relative overflow-hidden bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-6 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-hourglass-half text-[#00E5FF] text-base"></i>
          <h3 class="text-xs font-extrabold uppercase tracking-widest text-gray-400">FitPlan Biological Age</h3>
        </div>
        <span class="text-xs font-bold px-3 py-1 rounded-full border ${diffBadgeBg}">
          ${diffSign}${ageResult.diff} év ${isYounger ? 'fiatalabb' : 'idősebb'}
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center my-3 items-center">
        <!-- Naptári kor -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[10px] font-bold text-gray-400 uppercase">Naptári Életkor</p>
          <p class="text-2xl font-black text-gray-700 dark:text-gray-300 tabular-nums mt-1">${ageResult.chronoAge} <span class="text-xs font-semibold text-gray-400">év</span></p>
        </div>

        <!-- Biológiai Életkor Kiemelve -->
        <div class="p-4 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-emerald-500/10 to-transparent border border-cyan-500/30">
          <p class="text-[11px] font-extrabold uppercase tracking-widest text-[#00E5FF]">FitPlan Életkorod</p>
          <p class="text-4xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight mt-1" style="color: ${diffBadgeColor}">
            ${ageResult.biologicalAge} <span class="text-sm font-bold text-gray-400">év</span>
          </p>
          <p class="text-[10px] font-bold text-gray-400 mt-1">Öregedési tempó: <span class="text-[#00E676]">${ageResult.paceOfAging}x</span> / év</p>
        </div>

        <!-- Vérkép Státusz Index -->
        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <p class="text-[10px] font-bold text-gray-400 uppercase">Vérkép Biomarker Index</p>
          <p class="text-2xl font-black text-emerald-500 tabular-nums mt-1">${bloodResult.scorePct}%</p>
          <p class="text-[10px] text-gray-400 mt-0.5">${bloodResult.optimalCount} / ${bloodResult.totalCount} optimális</p>
        </div>
      </div>

      <!-- Tényezők Részletes Bontása (Mi fiatalít és mi öregít?) -->
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

    <!-- 2. VÉRKÉP ELEMZŐ (BLOOD TEST / CLINICAL LAB BIOMARKERS) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-4 shadow-sm">
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

              <!-- Érték & Kijelző -->
              <div class="flex items-center justify-between sm:justify-end gap-3 sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-200 dark:border-[#2A2C34]">
                <div>
                  <span class="text-base font-black tabular-nums tracking-tight" style="color: ${evaluation.color}">
                    ${userVal}
                  </span>
                  <span class="text-[10px] text-gray-400 font-bold ml-0.5">${bm.unit}</span>
                </div>
                <button class="whoop5-edit-single-bm-btn p-2 rounded-xl bg-gray-200 dark:bg-[#252730] hover:text-[#00E5FF] text-gray-400 text-xs transition-colors" data-bmid="${bm.id}" data-name="${bm.name}" data-unit="${bm.unit}" data-val="${userVal}" title="Érték módosítása">
                  <i class="fa-solid fa-pen-to-square pointer-events-none"></i>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- 3. HEALTH MONITOR (WHOOP 5 VITAL BASELINE MÁTRIX) -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-8 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-shield-heart text-emerald-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Health Monitor (Vital Baseline)</h4>
        </div>
        <span class="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">Minden mutató rendben ✓</span>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-xs"><i class="fa-solid fa-heart"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Nyugalmi Pulzus (RHR)</p>
              <p class="text-[10px] text-gray-400">Bázissávod: 46–52 bpm</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.rhr} bpm</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xs"><i class="fa-solid fa-wave-square"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Pulzusvariabilitás (HRV)</p>
              <p class="text-[10px] text-gray-400">Bázissávod: 70–85 ms</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.hrv} ms</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-xs"><i class="fa-solid fa-temperature-half"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Bőrhőmérséklet eltérés</p>
              <p class="text-[10px] text-gray-400">Normál sáv: ±0.5 °C</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.skinTemp > 0 ? '+' : ''}${whoopData.health.skinTemp} °C</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-xs"><i class="fa-solid fa-droplet"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Véroxigénszint (SpO₂)</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 95–100%</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.spo2}%</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1B1C22]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center text-xs"><i class="fa-solid fa-wind"></i></div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Légzésszám</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 14.0–16.5 /perc</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${whoopData.health.respRate} /perc</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>
      </div>
    </div>
  `;

  _bindHealthEvents();
}

function _bindHealthEvents() {
  // Kategória szűrő gombok
  document.querySelectorAll('.whoop5-blood-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeBloodCategory = btn.dataset.cat || 'all';
      _renderHealthScreen();
    });
  });

  // Lelet beviteli modál nyitása
  const openBloodModalBtn = $('whoop5-open-bloodwork-btn');
  if (openBloodModalBtn) {
    openBloodModalBtn.addEventListener('click', _openBloodworkModal);
  }

  // Egyedi biomarker gyors szerkesztő
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
      <span class="text-[10px] font-black tracking-widest text-[#00E5FF] uppercase">WHOOP 5.0 COMMUNITY</span>
      <h3 class="text-xl font-black text-gray-900 dark:text-white mt-1">Csapatok &amp; Ranglisták</h3>
      <p class="text-xs text-gray-400 max-w-sm mx-auto mt-2 leading-relaxed">
        Hamarosan összeállíthatod saját sportcsapatodat, és versenyezhetsz barátaiddal a napi Recovery és heti Strain ranglistákon.
      </p>
      <div class="mt-6 pt-6 border-t border-gray-100 dark:border-[#22242C] flex justify-center gap-3">
        <span class="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#1B1C22] text-gray-500 dark:text-gray-400">
          <i class="fa-solid fa-lock mr-1.5"></i>Fejlesztés alatt (V5.0 Phase 2)
        </span>
      </div>
    </div>
  `;
}

export function _renderMoreScreen() {
  const container = $('whoop5-more-container');
  if (!container) return;

  container.innerHTML = `
    <!-- Felhasználói Profil Kártya -->
    <div class="bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] rounded-3xl p-5 mb-5 shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#00E5FF] to-emerald-400 text-black flex items-center justify-center font-black text-lg">
          <i class="fa-solid fa-bolt"></i>
        </div>
        <div>
          <h3 class="text-sm font-extrabold text-gray-900 dark:text-white">FitPlan 5.0 Pro Fiók</h3>
          <p class="text-[11px] text-gray-400">WHOOP 5.0 Architektúra &amp; Garmin szinkron</p>
        </div>
      </div>
      <span class="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-cyan-500/10 text-[#00E5FF] border border-cyan-500/30">
        PRO AKTÍV
      </span>
    </div>

    <!-- Központi Navigáció az Összes Meglévő Modulhoz -->
    <div class="space-y-3 pb-24">
      <p class="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider px-1">Összes Modul &amp; Funkció</p>

      <!-- Diéta -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-emerald-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="diet">
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

      <!-- Edzésnapló & Rutinok -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-indigo-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="activity" data-subtab="workouts">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-person-running"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Edzésnapló, Gyakorlatok &amp; Rutinok</h4>
            <p class="text-[10px] text-gray-400">Garmin sportágak, edzéstervek és egyéni datafield-ek</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-indigo-500 transition-colors"></i>
      </button>

      <!-- Regenerációs Protokollok -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-violet-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="activity" data-subtab="recovery">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-violet-500/10 text-violet-500 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-spa"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Regeneráció &amp; SMR Szeánszok</h4>
            <p class="text-[10px] text-gray-400">SMR hengerezés, mélynyújtás, szauna és alvásnapló</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400 group-hover:text-violet-500 transition-colors"></i>
      </button>

      <!-- Felszerelések -->
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-cyan-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="activity" data-subtab="gear">
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
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-amber-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="prhub">
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
      <button class="whoop5-nav-hub-btn w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-cyan-500/50 flex items-center justify-between transition-all group active:scale-98" data-target="documents">
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

      <!-- Beállítások & Profil -->
      <button id="whoop5-open-settings-btn" class="w-full p-4 rounded-3xl bg-white dark:bg-[#141519] border border-gray-200 dark:border-[#22242C] hover:border-gray-400 flex items-center justify-between transition-all group active:scale-98">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gray-500/10 text-gray-400 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-gear"></i>
          </div>
          <div class="text-left">
            <h4 class="text-xs font-bold text-gray-900 dark:text-white">Beállítások (Gear) &amp; Célok</h4>
            <p class="text-[10px] text-gray-400">Testsúly, kalóriacél, folyadékbevitel kalkuláció</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-xs text-gray-400"></i>
      </button>
    </div>
  `;

  // Események bekötése
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

  const settingsBtn = $('whoop5-open-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const gearBtn = $('btn-settings-gear') || $('btn-gear-settings');
      if (gearBtn) gearBtn.click();
    });
  }
}

// ══════════════════════════════════════════════════════════════
// VÉRKÉP LELET BEVITELI MODÁL (BLOODWORK MODAL)
// ══════════════════════════════════════════════════════════════
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

// ── WHOOP Biometria Kézi Beviteli Modál Feltöltése ──────────
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
  if (recIn) recIn.value = current.recovery;
  if (hrvIn) hrvIn.value = current.hrv;
  if (rhrIn) rhrIn.value = current.rhr;
  if (strainIn) strainIn.value = current.strain;
  if (sleepActIn) sleepActIn.value = (current.sleepActualMin / 60).toFixed(1);
  if (sleepNeedIn) sleepNeedIn.value = (current.sleepNeedMin / 60).toFixed(1);
  if (deepIn) deepIn.value = current.stages.deepMin;
  if (remIn) remIn.value = current.stages.remMin;
  if (lightIn) lightIn.value = current.stages.lightMin;
  if (awakeIn) awakeIn.value = current.stages.awakeMin;
  if (skinIn) skinIn.value = current.health.skinTemp;
  if (spo2In) spo2In.value = current.health.spo2;
  if (respIn) respIn.value = current.health.respRate;
}

function _closeWhoopEntryModal() {
  const modal = $('whoop-entry-modal');
  const sheet = $('whoop-entry-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
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

  const recovery = Math.max(0, Math.min(100, parseInt(recIn?.value, 10) || 75));
  const hrv = parseInt(hrvIn?.value, 10) || 75;
  const rhr = parseInt(rhrIn?.value, 10) || 50;
  const strain = Math.max(0, Math.min(21, parseFloat(strainIn?.value) || 12.0));
  const sleepActHours = parseFloat(sleepActIn?.value) || 7.5;
  const sleepNeedHours = parseFloat(sleepNeedIn?.value) || 8.0;

  const actualMins = Math.round(sleepActHours * 60);
  const needMins = Math.round(sleepNeedHours * 60);
  const debtMins = Math.max(0, needMins - actualMins);
  const efficiency = Math.min(100, Math.round((actualMins / needMins) * 100));

  const deepMin = parseInt(deepIn?.value, 10) || Math.round(actualMins * 0.22);
  const remMin = parseInt(remIn?.value, 10) || Math.round(actualMins * 0.25);
  const lightMin = parseInt(lightIn?.value, 10) || Math.round(actualMins * 0.47);
  const awakeMin = parseInt(awakeIn?.value, 10) || Math.round(actualMins * 0.06);

  const skinTemp = parseFloat(skinIn?.value) || 0.0;
  const spo2 = Math.min(100, parseInt(spo2In?.value, 10) || 98);
  const respRate = parseFloat(respIn?.value) || 15.0;

  const current = _getWhoopDataForDate(_selectedDate);

  const payload = {
    recovery,
    hrv,
    rhr,
    strain,
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
    health: {
      rhr,
      hrv,
      skinTemp,
      spo2,
      respRate
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
      saveBtn.textContent = 'WHOOP Adatok Mentése';
    }
  }
}

// ── Globális Események Bekötése ────────────────────────────
function _bindGlobalWhoopEvents() {
  const bwClose = $('bloodwork-close');
  const bwBackdrop = $('bloodwork-backdrop');
  const bwSave = $('bloodwork-save-btn');

  if (bwClose) bwClose.addEventListener('click', _closeBloodworkModal);
  if (bwBackdrop) bwBackdrop.addEventListener('click', _closeBloodworkModal);
  if (bwSave) bwSave.addEventListener('click', _saveBloodwork);

  const whoopClose = $('whoop-entry-close');
  const whoopBackdrop = $('whoop-entry-backdrop');
  const whoopSave = $('whoop-save-entry-btn');

  if (whoopClose) whoopClose.addEventListener('click', _closeWhoopEntryModal);
  if (whoopBackdrop) whoopBackdrop.addEventListener('click', _closeWhoopEntryModal);
  if (whoopSave) whoopSave.addEventListener('click', _saveWhoopEntry);
}
