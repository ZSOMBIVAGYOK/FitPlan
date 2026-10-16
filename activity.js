// ============================================================
// activity.js — Aktivitás, WHOOP 4.0 Dashboard, Edzés & Recovery
// FitPlan Pro | Elektromos Kék / Neon Téma
// WHOOP 4.0 Analitika, Garmin Sportágak, Gyakorlattár, Rutinok,
// Regenerációs Protokollok (SMR/Nyújtás) és Felszerelések (Gear)
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
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  increment
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

// ── Beépített minta adatok ─────────────────────────────────
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

const DEFAULT_RECOVERY_PROTOCOLS = [
  {
    name: 'Teljes test SMR Hengerezés & Mobilitás',
    type: 'smr',
    duration: 20,
    exercises: 'Vádli és Achilles hengerezés (2-2 perc)\nCombfeszítő és combközelítő (3-3 perc)\nIT-szalag és gluteus fókusz (3-3 perc)\nHáti gerinc extenzió és lapocka mobilitás (4 perc)',
    notes: 'Feszes trigger pontokon 30 mp tartás mély kilégzéssel'
  },
  {
    name: 'Alsótest Mélynyújtás (Csípőnyitó & Combhajlító)',
    type: 'stretch',
    duration: 25,
    exercises: 'Galambpóz (Pigeon pose) 2 × 90 mp oldalanként\nPillangóülés csípőnyújtás 2 perc\nCombhajlító nyújtás hevederrel 2-2 perc\nKobra póz és törzsnyújtás 2 perc',
    notes: 'Lábnapok után kötelező feszültségoldás'
  },
  {
    name: 'Kontraszt Szauna & Hidegvizes Terápia',
    type: 'contrast',
    duration: 45,
    exercises: '1. Kör: 15 perc Finn szauna (85°C) → 2 perc hideg merülés (10°C)\n2. Kör: 12 perc Szauna → 2 perc hideg zuhany\n3. Kör: 10 perc Szauna → 3 perc hideg merülés\nPihenés és rehidratáció 10 perc',
    notes: 'Gyulladáscsökkentés és vérkeringés fokozása'
  },
  {
    name: 'Idegrendszeri Lecsendesedés (Box Breathing & Shavasana)',
    type: 'breath',
    duration: 15,
    exercises: '4-4-4-4 Box breathing légzéstechnika 8 perc\nFekvő relaxáció és progresszív izomlazítás 7 perc',
    notes: 'Paraszimpatikus idegrendszer aktiválása lefekvés előtt'
  }
];

// ── Belső Állapot ──────────────────────────────────────────
let _uid = null;
let _selectedDate = todayString();
let _activeSubtab = 'whoop'; // 'whoop' | 'workouts' | 'routines' | 'recovery' | 'gear'
let _trendDays = 7; // 7 vagy 30 nap

let _unsubWhoop = null;
let _unsubWorkouts = null;
let _unsubRoutines = null;
let _unsubExercises = null;
let _unsubGears = null;
let _unsubSleep = null;
let _unsubProtocols = null;

let _allWhoopLogs = {}; // date -> log object
let _allWorkouts = [];
let _allRoutines = [];
let _allExercises = [];
let _allGears = [];
let _allSleepLogs = [];
let _allProtocols = [];

let _uiInitialized = false;

// ── Publikus Inicializáló és Leállító Függvények ───────────
export function initActivity(uid) {
  _uid = uid;
  _selectedDate = todayString();
  _activeSubtab = 'whoop';

  if (!_uiInitialized) {
    _bindUIEvents();
    _uiInitialized = true;
  }

  _subscribeToData();
}

export function destroyActivity() {
  _uid = null;
  if (_unsubWhoop) { _unsubWhoop(); _unsubWhoop = null; }
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRoutines) { _unsubRoutines(); _unsubRoutines = null; }
  if (_unsubExercises) { _unsubExercises(); _unsubExercises = null; }
  if (_unsubGears) { _unsubGears(); _unsubGears = null; }
  if (_unsubSleep) { _unsubSleep(); _unsubSleep = null; }
  if (_unsubProtocols) { _unsubProtocols(); _unsubProtocols = null; }

  _allWhoopLogs = {};
  _allWorkouts = [];
  _allRoutines = [];
  _allExercises = [];
  _allGears = [];
  _allSleepLogs = [];
  _allProtocols = [];
}

// ── Adatbázis Figyelők (Real-time onSnapshot) ───────────────
function _subscribeToData() {
  if (!_uid) return;

  // 1. WHOOP biometrikus naplók
  const qWhoop = query(collection(db, 'users', _uid, 'whoopLogs'));
  _unsubWhoop = onSnapshot(qWhoop, snap => {
    _allWhoopLogs = {};
    snap.docs.forEach(d => {
      _allWhoopLogs[d.id] = { id: d.id, ...d.data() };
    });
    _renderWhoopDashboard();
    _renderTrendChart();
  }, err => console.error('[activity] WHOOP sync error:', err));

  // 2. Edzések
  const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qWorkouts, snap => {
    _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderWorkoutsList();
    _updateWorkoutStats();
    _renderWhoopDashboard();
    _renderWhoopTodayActivities();
  }, err => console.error('[activity] Workouts sync error:', err));

  // 3. Edzésrutinok
  const qRoutines = query(collection(db, 'users', _uid, 'routines'), orderBy('createdAt', 'desc'));
  _unsubRoutines = onSnapshot(qRoutines, snap => {
    _allRoutines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderRoutinesList();
  }, err => console.error('[activity] Routines sync error:', err));

  // 4. Egyéni gyakorlatok
  const qExercises = query(collection(db, 'users', _uid, 'exercises'), orderBy('createdAt', 'desc'));
  _unsubExercises = onSnapshot(qExercises, snap => {
    _allExercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderExercisesList();
  }, err => console.error('[activity] Exercises sync error:', err));

  // 5. Felszerelések (Gear)
  const qGears = query(collection(db, 'users', _uid, 'gear'), orderBy('createdAt', 'desc'));
  _unsubGears = onSnapshot(qGears, snap => {
    _allGears = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderGearShelf();
    _populateGearSelects();
  }, err => console.error('[activity] Gear sync error:', err));

  // 6. Alvásnapló
  const qSleep = query(collection(db, 'users', _uid, 'sleepLogs'), orderBy('createdAt', 'desc'));
  _unsubSleep = onSnapshot(qSleep, snap => {
    _allSleepLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderSleepList();
    _updateSleepStats();
    _renderWhoopDashboard();
  }, err => console.error('[activity] Sleep sync error:', err));

  // 7. Regenerációs protokollok
  const qProtocols = query(collection(db, 'users', _uid, 'recoveryProtocols'), orderBy('createdAt', 'desc'));
  _unsubProtocols = onSnapshot(qProtocols, snap => {
    _allProtocols = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderProtocolsList();
    _renderWhoopTodayActivities();
  }, err => console.error('[activity] Recovery protocols sync error:', err));
}

// ── WHOOP 4.0 Számítások & Adatelőkészítés ─────────────────
function _getWhoopDataForDate(dateStr) {
  const manual = _allWhoopLogs[dateStr];
  const dayWorkouts = _allWorkouts.filter(w => w.date === dateStr);
  const daySleep = _allSleepLogs.find(s => s.date === dateStr);

  // Terhelés (Strain) számítás a nap edzéseiből, ha nincs kézzel megadva
  const totalWorkoutMins = dayWorkouts.reduce((s, w) => s + (Number(w.duration) || 0), 0);
  const totalCalories = dayWorkouts.reduce((s, w) => s + (Number(w.calories) || (Number(w.duration) || 0) * 8.5), 0);

  // WHOOP Strain logaritmikus formula: 21 * (1 - e^(-mins * 0.018))
  let estimatedStrain = 0.0;
  if (totalWorkoutMins > 0) {
    estimatedStrain = Math.min(20.5, Math.round(21 * (1 - Math.exp(-totalWorkoutMins * 0.016)) * 10) / 10);
    if (estimatedStrain < 4.0) estimatedStrain = 4.0;
  }

  // Alvásidő percekben
  let actualSleepMinutes = 462; // Alapértelmezett: 7ó 42p
  if (daySleep && daySleep.durationHours) {
    actualSleepMinutes = Math.round(Number(daySleep.durationHours) * 60);
  }

  if (manual) {
    return {
      recovery: Number(manual.recovery) || 78,
      hrv: Number(manual.hrv) || 78,
      rhr: Number(manual.rhr) || 48,
      strain: manual.strain !== undefined ? Number(manual.strain) : (estimatedStrain || 0.0),
      activeKcal: manual.activeKcal !== undefined ? Number(manual.activeKcal) : Math.round(totalCalories),
      avgHr: Number(manual.avgHr) || 136,
      maxHr: Number(manual.maxHr) || 174,
      workoutMins: totalWorkoutMins,
      sleepActualMin: Number(manual.sleepActualMin) || actualSleepMinutes,
      sleepNeedMin: Number(manual.sleepNeedMin) || 495, // 8ó 15p
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

  // Okos becslés a naphoz
  return {
    recovery: 84,
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
      deepMin: Math.round(actualSleepMinutes * 0.23),
      remMin: Math.round(actualSleepMinutes * 0.25),
      lightMin: Math.round(actualSleepMinutes * 0.46),
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

// ── WHOOP 4.0 Műszerfal Renderelése ─────────────────────────
function _renderWhoopDashboard() {
  const container = $('activity-whoop-container');
  if (!container) return;

  const data = _getWhoopDataForDate(_selectedDate);
  const rec = Math.max(0, Math.min(100, Math.round(data.recovery)));

  // Színkód meghatározása
  // Zöld: 66-100%, Sárga: 33-65%, Piros: 0-32%
  let color = '#00E676';
  let badgeText = 'OPTIMÁLIS ÁLLAPOT';
  let badgeBg = 'bg-emerald-500/10 text-[#00E676] border-emerald-500/30';
  let glowColor = 'rgba(0, 230, 118, 0.4)';
  let coachingText = 'A szervezeted kiválóan regenerálódott, készen áll a magas intenzitású edzésre és maximális terhelésre.';
  let targetStrainRange = '14.0 – 17.5';

  if (rec < 33) {
    color = '#FF3D00';
    badgeText = 'ALACSONY REGENERÁCIÓ';
    badgeBg = 'bg-red-500/10 text-[#FF3D00] border-red-500/30';
    glowColor = 'rgba(255, 61, 0, 0.4)';
    coachingText = 'Alacsony regenerációs szint. Priorizáld a regenerációt: könnyű stretching, séta és korai fekvés javasolt.';
    targetStrainRange = '6.0 – 10.0';
  } else if (rec < 66) {
    color = '#FFD600';
    badgeText = 'KÖZEPES REGENERÁCIÓ';
    badgeBg = 'bg-amber-500/10 text-[#FFD600] border-amber-500/30';
    glowColor = 'rgba(255, 214, 0, 0.4)';
    coachingText = 'Kiegyensúlyozott állapot. Fenntartó vagy mérsékelt intenzitású edzésterhelés ajánlott.';
    targetStrainRange = '10.5 – 14.0';
  }

  // SVG körív progress számítás
  // Kerület = 2 * PI * r = 2 * 3.14159 * 44 = ~276.46
  const circumference = 276.46;
  const strokeOffset = circumference - (circumference * rec / 100);

  // Alvás arány
  const sleepRatio = Math.min(100, Math.round((data.sleepActualMin / data.sleepNeedMin) * 100));
  const stagesTotal = data.stages.deepMin + data.stages.remMin + data.stages.lightMin + data.stages.awakeMin || 1;
  const deepPct = Math.round((data.stages.deepMin / stagesTotal) * 100);
  const remPct = Math.round((data.stages.remMin / stagesTotal) * 100);
  const lightPct = Math.round((data.stages.lightMin / stagesTotal) * 100);
  const awakePct = Math.max(0, 100 - (deepPct + remPct + lightPct));

  // Strain % skála (0.0 - 21.0)
  const strainPct = Math.min(100, Math.round((data.strain / 21.0) * 100));

  container.innerHTML = `
    <!-- 1. DÁTUMVÁLASZTÓ ÉS FEJLÉC -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-4 mb-4 shadow-sm">
      <div class="flex items-center justify-between">
        <button id="whoop-prev-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1E1F24] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>

        <div class="text-center relative flex-1 cursor-pointer">
          <p class="text-xs font-bold text-cyan-600 dark:text-[#00E5FF] tracking-wider uppercase">WHOOP 4.0 Biometria</p>
          <h3 class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight">${formatDateHU(_selectedDate)}</h3>
          <input id="whoop-date-picker" type="date" value="${_selectedDate}" class="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>

        <button id="whoop-next-day-btn" class="w-9 h-9 rounded-2xl bg-gray-100 dark:bg-[#1E1F24] text-gray-700 dark:text-gray-300 flex items-center justify-center hover:bg-cyan-500/10 hover:text-cyan-400 active:scale-95 transition-all">
          <i class="fa-solid fa-chevron-right text-sm"></i>
        </button>
      </div>

      <div class="mt-3 pt-3 border-t border-gray-100 dark:border-[#2A2C32] flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full ${data.isManual ? 'bg-[#00E676] animate-pulse' : 'bg-cyan-400'}"></span>
          <span class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
            ${data.isManual ? 'Kézzel rögzített adatok' : 'Becsült biometria'}
          </span>
        </div>
        <button id="whoop-open-entry-btn" class="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] shadow-sm active:scale-95 transition-all flex items-center gap-1.5">
          <i class="fa-solid fa-sliders"></i>
          <span>Adatok szerkesztése</span>
        </button>
      </div>
    </div>

    <!-- 2. DINAMIKUS COACHING BANNER -->
    <div class="relative overflow-hidden rounded-3xl p-4 mb-4 border ${badgeBg} bg-white dark:bg-[#16171B] shadow-sm">
      <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0" style="background: ${glowColor}; color: ${color};">
          <i class="fa-solid fa-heart-pulse text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border" style="color: ${color}; border-color: ${color};">
              ${badgeText}
            </span>
            <span class="text-[11px] text-gray-400 font-medium">Ajánlott Strain: ${targetStrainRange}</span>
          </div>
          <p class="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-relaxed">${coachingText}</p>
        </div>
      </div>
    </div>

    <!-- 3. KÉT FŐ KÁRTYA GRIDBEN: RECOVERY & STRAIN -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

      <!-- A. RECOVERY KÁRTYA -->
      <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full" style="background-color: ${color};"></div>
            <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400 dark:text-gray-400">Recovery</h4>
          </div>
          <span class="text-[11px] font-bold" style="color: ${color};">${rec}%</span>
        </div>

        <!-- Körkörös Progress Indikátor -->
        <div class="flex flex-col items-center justify-center my-3 relative">
          <div class="relative w-36 h-36 flex items-center justify-center">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <!-- Háttér körív -->
              <circle cx="50" cy="50" r="44" stroke="currentColor" stroke-width="8" fill="transparent" class="text-gray-100 dark:text-[#2A2C32]" />
              <!-- Aktív animált ív -->
              <circle cx="50" cy="50" r="44" stroke="${color}" stroke-width="8" stroke-linecap="round" fill="transparent"
                      stroke-dasharray="${circumference}" stroke-dashoffset="${strokeOffset}"
                      style="transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 0 6px ${glowColor});" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span class="text-3xl font-black text-gray-900 dark:text-white tabular-nums leading-none tracking-tight">${rec}</span>
              <span class="text-[10px] font-extrabold uppercase tracking-widest mt-0.5" style="color: ${color};">%</span>
            </div>
          </div>
        </div>

        <!-- Almutatók (HRV, RHR, Alvás) -->
        <div class="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 dark:border-[#2A2C32] text-center">
          <div>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">HRV</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.hrv} <span class="text-[9px] font-normal text-gray-400">ms</span></p>
          </div>
          <div class="border-x border-gray-100 dark:border-[#2A2C32]">
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">RHR</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${data.rhr} <span class="text-[9px] font-normal text-gray-400">bpm</span></p>
          </div>
          <div>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Alvás</p>
            <p class="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">${sleepRatio}%</p>
          </div>
        </div>
      </div>

      <!-- B. DAY STRAIN KÁRTYA -->
      <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></div>
            <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400 dark:text-gray-400">Day Strain</h4>
          </div>
          <span class="text-[11px] font-bold text-[#00E5FF]">${data.strain} / 21.0</span>
        </div>

        <!-- Terhelési Vízszintes Skála -->
        <div class="my-4">
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-3xl font-black text-gray-900 dark:text-white tabular-nums leading-none tracking-tight">${data.strain}</span>
            <span class="text-xs font-bold text-[#00E5FF]">Cél: ${targetStrainRange}</span>
          </div>

          <!-- Progress Bar és Célzóna -->
          <div class="relative w-full h-3 bg-gray-100 dark:bg-[#1E1F24] rounded-full overflow-hidden p-0.5 border border-gray-200 dark:border-[#2A2C32]">
            <div class="h-full rounded-full bg-gradient-to-r from-cyan-400 to-[#00E5FF] transition-all duration-700" style="width: ${strainPct}%; box-shadow: 0 0 8px rgba(0, 229, 255, 0.5);"></div>
          </div>
          <div class="flex justify-between text-[9px] text-gray-400 mt-1 font-mono">
            <span>0.0</span>
            <span>7.0</span>
            <span>14.0</span>
            <span>21.0</span>
          </div>
        </div>

        <!-- Almutatók (Kcal, Avg HR, Max HR, Idő) -->
        <div class="grid grid-cols-4 gap-1 pt-3 border-t border-gray-100 dark:border-[#2A2C32] text-center">
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

    <!-- 4. ALVÁS ANALITIKA KÁRTYA (STACKED BAR DIAGRAMMAL) -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 mb-4 shadow-sm">
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

      <!-- Alvásszakaszok Vízszintes Halmozott Sávja -->
      <div class="w-full h-4 rounded-xl overflow-hidden flex gap-0.5 mb-3 bg-gray-100 dark:bg-[#1E1F24] p-0.5 border border-gray-200 dark:border-[#2A2C32]">
        <div style="width: ${deepPct}%;" class="bg-[#1e40af] rounded-l-lg" title="Mélyalvás: ${deepPct}%"></div>
        <div style="width: ${remPct}%;" class="bg-[#00E5FF]" title="REM: ${remPct}%"></div>
        <div style="width: ${lightPct}%;" class="bg-[#64748b]" title="Könnyű alvás: ${lightPct}%"></div>
        <div style="width: ${awakePct}%;" class="bg-[#f43f5e] rounded-r-lg" title="Ébren: ${awakePct}%"></div>
      </div>

      <!-- Szakaszok Jelmagyarázata -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4">
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1E1F24]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#1e40af]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Mély (SWS)</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.deepMin)} (${deepPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1E1F24]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">REM</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.remMin)} (${remPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1E1F24]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#64748b]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Könnyű</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.lightMin)} (${lightPct}%)</p>
          </div>
        </div>
        <div class="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-[#1E1F24]">
          <span class="w-2.5 h-2.5 rounded-full bg-[#f43f5e]"></span>
          <div>
            <p class="text-[10px] text-gray-400 font-semibold">Ébren</p>
            <p class="text-xs font-extrabold text-gray-800 dark:text-gray-100">${formatMinutesToHours(data.stages.awakeMin)} (${awakePct}%)</p>
          </div>
        </div>
      </div>

      <!-- Alvási Adósság és Hatékonyság -->
      <div class="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100 dark:border-[#2A2C32] text-xs">
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

    <!-- 5. HEALTH MONITOR (EGÉSZSÉGFIGYELŐ MÁTRIX) -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-shield-heart text-emerald-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Health Monitor (Baseline Mátrix)</h4>
        </div>
        <span class="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Minden mutató rendben ✓</span>
      </div>

      <div class="space-y-2.5">
        <!-- 1. Nyugalmi Pulzus -->
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1E1F24]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-heart"></i>
            </div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Nyugalmi pulzus (RHR)</p>
              <p class="text-[10px] text-gray-400">Tipikus sávod: 46–52 bpm</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${data.health.rhr} bpm</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <!-- 2. Pulzusvariabilitás -->
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1E1F24]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-wave-square"></i>
            </div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">HRV (Pulzusvariabilitás)</p>
              <p class="text-[10px] text-gray-400">Tipikus sávod: 70–85 ms</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${data.health.hrv} ms</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <!-- 3. Bőrhőmérséklet eltérés -->
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1E1F24]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-temperature-half"></i>
            </div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Bőrhőmérséklet eltérés</p>
              <p class="text-[10px] text-gray-400">Normál sáv: ±0.5 °C</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${data.health.skinTemp > 0 ? '+' : ''}${data.health.skinTemp} °C</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <!-- 4. Véroxigénszint -->
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1E1F24]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-droplet"></i>
            </div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Véroxigénszint (SpO₂)</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 95–100%</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${data.health.spo2}%</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>

        <!-- 5. Légzésszám -->
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-gray-50 dark:bg-[#1E1F24]">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-wind"></i>
            </div>
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Légzésszám</p>
              <p class="text-[10px] text-gray-400">Normál sáv: 14.0–16.5 rpm</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-extrabold text-gray-900 dark:text-white tabular-nums">${data.health.respRate} /perc</span>
            <span class="text-emerald-500 text-xs"><i class="fa-solid fa-circle-check"></i></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 6. NAPI NAPLÓ (JOURNAL QUICK-ENTRY) -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-book-bookmark text-amber-500 text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">WHOOP Journal (Napi szokások)</h4>
        </div>
        <span class="text-[10px] text-gray-400">Koppints a rögzítéshez</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.caffeine ? 'bg-amber-500/10 border-amber-500/40 text-amber-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="caffeine">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">☕</span>
            <i class="fa-solid ${data.journal.caffeine ? 'fa-circle-check text-amber-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Koffein 14:00 után</p>
        </button>

        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.alcohol ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="alcohol">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🍷</span>
            <i class="fa-solid ${data.journal.alcohol ? 'fa-circle-check text-red-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Alkohol fogyasztás</p>
        </button>

        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.sauna ? 'bg-orange-500/10 border-orange-500/40 text-orange-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="sauna">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🧖</span>
            <i class="fa-solid ${data.journal.sauna ? 'fa-circle-check text-orange-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Szauna / Hidegfürdő</p>
        </button>

        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.hydration ? 'bg-sky-500/10 border-sky-500/40 text-sky-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="hydration">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">💧</span>
            <i class="fa-solid ${data.journal.hydration ? 'fa-circle-check text-sky-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">3L+ Hidratáció</p>
        </button>

        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.stretch ? 'bg-violet-500/10 border-violet-500/40 text-violet-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="stretch">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">🧘</span>
            <i class="fa-solid ${data.journal.stretch ? 'fa-circle-check text-violet-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Nyújtás / SMR henger</p>
        </button>

        <button class="whoop-journal-btn p-3 rounded-2xl border text-left transition-all ${data.journal.supplement ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500' : 'bg-gray-50 dark:bg-[#1E1F24] border-gray-200 dark:border-[#2A2C32] text-gray-600 dark:text-gray-400'}" data-habit="supplement">
          <div class="flex items-center justify-between mb-1">
            <span class="text-lg">💊</span>
            <i class="fa-solid ${data.journal.supplement ? 'fa-circle-check text-emerald-500' : 'fa-circle text-gray-300 dark:text-gray-600'} text-xs"></i>
          </div>
          <p class="text-xs font-bold">Táplálékkiegészítő</p>
        </button>
      </div>
    </div>

    <!-- 7. TRENDVONALAK GRAFIKON (7 NAPOS / 30 NAPOS) -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 mb-4 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-chart-line text-[#00E5FF] text-sm"></i>
          <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Biometrikus Trendek</h4>
        </div>
        <div class="flex items-center gap-1 bg-gray-100 dark:bg-[#1E1F24] p-1 rounded-xl">
          <button id="whoop-trend-7d-btn" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${_trendDays === 7 ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}">7 nap</button>
          <button id="whoop-trend-30d-btn" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${_trendDays === 30 ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}">30 nap</button>
        </div>
      </div>

      <div class="flex items-center justify-center gap-4 text-[10px] font-bold text-gray-400 mb-2">
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-[#00E676]"></span> Recovery %</span>
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF]"></span> Strain</span>
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-violet-400"></span> HRV</span>
      </div>

      <div id="whoop-trend-chart-container" class="w-full h-44 flex items-center justify-center">
        <!-- SVG Trend Chart dinamikusan generálva -->
      </div>
    </div>

    <!-- 8. A NAP EDZÉSEI ÉS REGENERÁCIÓJA GYORSNÉZET -->
    <div class="bg-white dark:bg-[#16171B] border border-gray-200 dark:border-[#2A2C32] rounded-3xl p-5 mb-8 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-xs font-extrabold tracking-widest uppercase text-gray-400">Mai Edzések &amp; Szeánszok</h4>
        <div class="flex items-center gap-1.5">
          <button id="whoop-quick-add-wo-btn" class="px-2.5 py-1 rounded-xl bg-indigo-600 text-white text-[10px] font-bold active:scale-95 transition-all">
            + Edzés
          </button>
          <button id="whoop-quick-add-rec-btn" class="px-2.5 py-1 rounded-xl bg-violet-600 text-white text-[10px] font-bold active:scale-95 transition-all">
            + Regeneráció
          </button>
        </div>
      </div>
      <div id="whoop-today-activities-list" class="space-y-2">
        <!-- Dinamikusan renderelt napi edzések és regenerációs programok -->
      </div>
    </div>
  `;

  _bindWhoopDashboardEvents();
  _renderTrendChart();
  _renderWhoopTodayActivities();
}

// ── WHOOP Műszerfal Eseménykezelők ─────────────────────────
function _bindWhoopDashboardEvents() {
  const prevBtn = $('whoop-prev-day-btn');
  const nextBtn = $('whoop-next-day-btn');
  const datePicker = $('whoop-date-picker');
  const editBtn = $('whoop-open-entry-btn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      _selectedDate = d.toISOString().slice(0, 10);
      _renderWhoopDashboard();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const d = new Date(_selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      _selectedDate = d.toISOString().slice(0, 10);
      _renderWhoopDashboard();
    });
  }

  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      if (e.target.value) {
        _selectedDate = e.target.value;
        _renderWhoopDashboard();
      }
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', _openWhoopEntryModal);
  }

  // Journal gombok
  document.querySelectorAll('.whoop-journal-btn').forEach(btn => {
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
        console.error('[activity] Journal save error:', err);
      }
    });
  });

  // Trend gombok
  const btn7d = $('whoop-trend-7d-btn');
  const btn30d = $('whoop-trend-30d-btn');
  if (btn7d) {
    btn7d.addEventListener('click', () => {
      _trendDays = 7;
      _renderWhoopDashboard();
    });
  }
  if (btn30d) {
    btn30d.addEventListener('click', () => {
      _trendDays = 30;
      _renderWhoopDashboard();
    });
  }

  // Gyors hozzáadás gombok
  const addWoBtn = $('whoop-quick-add-wo-btn');
  const addRecBtn = $('whoop-quick-add-rec-btn');
  if (addWoBtn) addWoBtn.addEventListener('click', _openWorkoutModal);
  if (addRecBtn) addRecBtn.addEventListener('click', _openProtocolsModal);
}

// ── WHOOP Trend Grafikon (Smooth SVG Line Chart) ────────────
function _renderTrendChart() {
  const chartBox = $('whoop-trend-chart-container');
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

  // Koordináta számítók
  // Recovery: 0 - 100%
  const getRecY = val => padY + plotH - (Math.max(0, Math.min(100, val)) / 100) * plotH;
  // Strain: 0 - 21
  const getStrainY = val => padY + plotH - (Math.max(0, Math.min(21, val)) / 21) * plotH;
  // HRV: 30 - 120 ms
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
      <defs>
        <linearGradient id="recGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00E676" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#00E676" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Rács vonalak -->
      <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="#2A2C32" stroke-width="0.75" stroke-dasharray="3,3" />
      <line x1="${padX}" y1="${padY + plotH / 2}" x2="${width - padX}" y2="${padY + plotH / 2}" stroke="#2A2C32" stroke-width="0.75" stroke-dasharray="3,3" />
      <line x1="${padX}" y1="${padY + plotH}" x2="${width - padX}" y2="${padY + plotH}" stroke="#2A2C32" stroke-width="1" />

      <!-- Vonalak -->
      <path d="${buildPath(hrvCoords)}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${buildPath(strainCoords)}" fill="none" stroke="#00E5FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${buildPath(recCoords)}" fill="none" stroke="#00E676" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Pontok -->
      ${recCoords.map((pt, i) => `
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" fill="#00E676" class="cursor-pointer">
          <title>${dates[i]}: ${recPoints[i]}% Recovery</title>
        </circle>
      `).join('')}

      <!-- Dátum címkék -->
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

// ── Mai Edzések és Regeneráció Gyorslista ───────────────────
function _renderWhoopTodayActivities() {
  const listEl = $('whoop-today-activities-list');
  if (!listEl) return;

  const dayWorkouts = _allWorkouts.filter(w => w.date === _selectedDate);
  const dayProtocols = _allProtocols.filter(p => p.date === _selectedDate);

  if (dayWorkouts.length === 0 && dayProtocols.length === 0) {
    listEl.innerHTML = `
      <p class="text-xs text-gray-400 italic text-center py-3">Még nem rögzítettél edzést vagy regenerációt erre a napra.</p>
    `;
    return;
  }

  let html = '';

  dayWorkouts.forEach(w => {
    const sport = getSportById(w.sportId || 'strength_training');
    html += `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-[#1E1F24] border border-gray-100 dark:border-[#2A2C32]">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-sm">
            <i class="${sport.icon || 'fa-solid fa-dumbbell'}"></i>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-900 dark:text-white">${w.name || sport.name}</p>
            <p class="text-[10px] text-gray-400 font-medium">${w.duration || 60} perc · ${w.calories ? `${w.calories} kcal` : sport.cat}</p>
          </div>
        </div>
        <span class="text-[10px] font-extrabold text-[#00E5FF] bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">Edzés</span>
      </div>
    `;
  });

  dayProtocols.forEach(p => {
    html += `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-[#1E1F24] border border-gray-100 dark:border-[#2A2C32]">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center text-sm">
            <i class="fa-solid fa-spa"></i>
          </div>
          <div>
            <p class="text-xs font-bold text-gray-900 dark:text-white">${p.name || 'Regenerációs szeánsz'}</p>
            <p class="text-[10px] text-gray-400 font-medium">${p.duration || 20} perc · ${p.type || 'SMR / Nyújtás'}</p>
          </div>
        </div>
        <span class="text-[10px] font-extrabold text-violet-500 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">Recovery</span>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

// ── WHOOP Adatbevitel Modál (Kézi rögzítés) ────────────────
function _openWhoopEntryModal() {
  const modal = $('whoop-entry-modal');
  const sheet = $('whoop-entry-sheet');
  if (!modal || !sheet) return;

  const current = _getWhoopDataForDate(_selectedDate);

  // Értékek beállítása
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

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
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
  } catch (err) {
    console.error('[activity] Error saving whoop log:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'WHOOP Adatok Mentése';
    }
  }
}

// ── FŐ ESEMÉNYKEZELŐK BEKÖTÉSE ─────────────────────────────
function _bindUIEvents() {
  // 1. Alfülek váltó gombjai
  document.querySelectorAll('.activity-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab || 'whoop';
      _switchSubtab(subtab);
    });
  });

  // 2. WHOOP Modál gombok
  const whoopClose = $('whoop-entry-close');
  const whoopBackdrop = $('whoop-entry-backdrop');
  const whoopSave = $('whoop-save-entry-btn');

  if (whoopClose) whoopClose.addEventListener('click', _closeWhoopEntryModal);
  if (whoopBackdrop) whoopBackdrop.addEventListener('click', _closeWhoopEntryModal);
  if (whoopSave) whoopSave.addEventListener('click', _saveWhoopEntry);

  // 3. Edzésnapló események bekötése
  _bindWorkoutModuleEvents();

  // 4. Regeneráció események bekötése
  _bindRecoveryModuleEvents();

  // 5. Felszerelés (Gear) események bekötése
  _bindGearEvents();

  // 6. Gyakorlatok & Rutinok 2 fülének kezelése (Programok vs Gyakorlatok)
  const rTabPrograms = $('routines-tab-programs');
  const rTabExercises = $('routines-tab-exercises');
  const rContentPrograms = $('routines-content-programs');
  const rContentExercises = $('routines-content-exercises');

  if (rTabPrograms && rTabExercises) {
    rTabPrograms.addEventListener('click', () => {
      rTabPrograms.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all bg-white dark:bg-[#22242C] text-indigo-600 dark:text-indigo-400 shadow-sm flex items-center justify-center gap-2';
      rTabExercises.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2';
      if (rContentPrograms) rContentPrograms.classList.remove('hidden');
      if (rContentExercises) rContentExercises.classList.add('hidden');
      _renderRoutinesList();
    });

    rTabExercises.addEventListener('click', () => {
      rTabExercises.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all bg-white dark:bg-[#22242C] text-indigo-600 dark:text-indigo-400 shadow-sm flex items-center justify-center gap-2';
      rTabPrograms.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2';
      if (rContentExercises) rContentExercises.classList.remove('hidden');
      if (rContentPrograms) rContentPrograms.classList.add('hidden');
      _renderExercisesList();
    });
  }

  // 7. Regeneráció 2 fülének kezelése (Programok vs Gyakorlatok)
  const recTabPrograms = $('recovery-tab-programs');
  const recTabExercises = $('recovery-tab-exercises');
  const recContentPrograms = $('recovery-content-programs');
  const recContentExercises = $('recovery-content-exercises');

  if (recTabPrograms && recTabExercises) {
    recTabPrograms.addEventListener('click', () => {
      recTabPrograms.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all bg-white dark:bg-[#22242C] text-violet-600 dark:text-violet-400 shadow-sm flex items-center justify-center gap-2';
      recTabExercises.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2';
      if (recContentPrograms) recContentPrograms.classList.remove('hidden');
      if (recContentExercises) recContentExercises.classList.add('hidden');
      _renderProtocolsList();
    });

    recTabExercises.addEventListener('click', () => {
      recTabExercises.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all bg-white dark:bg-[#22242C] text-violet-600 dark:text-violet-400 shadow-sm flex items-center justify-center gap-2';
      recTabPrograms.className = 'flex-1 py-2 rounded-xl text-xs font-extrabold transition-all text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center gap-2';
      if (recContentExercises) recContentExercises.classList.remove('hidden');
      if (recContentPrograms) recContentPrograms.classList.add('hidden');
      _renderRecoveryExercisesList();
    });
  }

  const recNewExBtn = $('rec-open-exercise-btn');
  if (recNewExBtn) {
    recNewExBtn.addEventListener('click', () => {
      _openExercisesModal();
      const catIn = $('wo-ex-category-in') || $('wo-input-ex-category');
      if (catIn) catIn.value = 'SMR';
    });
  }
}

function _switchSubtab(subtab) {
  _activeSubtab = subtab;

  // Header címke frissítése
  const titleEl = $('activity-header-title');
  if (titleEl) {
    if (subtab === 'routines') titleEl.textContent = 'Gyakorlatok & Rutinok (Edzéssablonok)';
    else if (subtab === 'recovery') titleEl.textContent = 'Regenerációs Programok & SMR';
    else if (subtab === 'gear') titleEl.textContent = 'Felszerelések (Gear Tracker)';
    else titleEl.textContent = 'Aktivitás & Tréning';
  }

  // Gombok stílusa (ha az outer nav létezik)
  document.querySelectorAll('.activity-subtab-btn').forEach(btn => {
    const isAct = btn.dataset.subtab === subtab;
    btn.className = `activity-subtab-btn flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
      isAct
        ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-[#00E5FF] shadow-sm'
        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
    }`;
  });

  // Nézetek elrejtése/megjelenítése
  const views = [
    { id: 'activity-view-whoop', key: 'whoop' },
    { id: 'activity-view-workouts', key: 'workouts' },
    { id: 'activity-view-routines', key: 'routines' },
    { id: 'activity-view-recovery', key: 'recovery' },
    { id: 'activity-view-gear', key: 'gear' }
  ];

  views.forEach(v => {
    const el = $(v.id);
    if (!el) return;
    if (v.key === subtab) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (subtab === 'whoop') {
    _renderWhoopDashboard();
  } else if (subtab === 'routines') {
    const rTabPrograms = $('routines-tab-programs');
    if (rTabPrograms) rTabPrograms.click();
    _renderRoutinesList();
    _renderExercisesList();
  } else if (subtab === 'recovery') {
    const recTabPrograms = $('recovery-tab-programs');
    if (recTabPrograms) recTabPrograms.click();
    _renderProtocolsList();
    _renderRecoveryExercisesList();
  } else if (subtab === 'gear') {
    _renderGearShelf();
  }
}
window.switchActivitySubtab = _switchSubtab;

// ══════════════════════════════════════════════════════════════
// EDZÉSNAPLÓ, GYAKORLATOK & RUTINOK (GARMIN SPORTÁGAKKAL)
// ══════════════════════════════════════════════════════════════

let _selectedSportId = 'strength_training';
let _activeDatafields = [];

function _bindWorkoutModuleEvents() {
  const fab = $('wo-fab');
  const closeBtn = $('wo-modal-close');
  const backdrop = $('wo-modal-backdrop');
  const saveBtn = $('wo-save-btn');
  const sportSelect = $('wo-sport-select') || $('wo-select-sport');
  const addDfBtn = $('wo-add-datafield-btn');

  if (fab) fab.addEventListener('click', _openWorkoutModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeWorkoutModal);
  if (backdrop) backdrop.addEventListener('click', _closeWorkoutModal);
  if (saveBtn) saveBtn.addEventListener('click', _saveWorkout);

  if (sportSelect) {
    sportSelect.addEventListener('change', (e) => {
      _selectedSportId = e.target.value;
      _updateSportUI();
    });
  }

  if (addDfBtn) addDfBtn.addEventListener('click', _addDatafieldRow);

  // Edzésbe beszúrás választó modál (+ gomb az edzés rögzítésnél)
  const insertExBtn = $('wo-insert-exercise-btn');
  if (insertExBtn) insertExBtn.addEventListener('click', _openExerciseOrRoutinePickerModal);

  const pickerClose = $('wo-exercise-or-routine-picker-close');
  const pickerBackdrop = $('wo-exercise-or-routine-picker-backdrop');
  if (pickerClose) pickerClose.addEventListener('click', _closeExerciseOrRoutinePickerModal);
  if (pickerBackdrop) pickerBackdrop.addEventListener('click', _closeExerciseOrRoutinePickerModal);

  const pickSingleExBtn = $('wo-pick-single-ex-btn');
  if (pickSingleExBtn) {
    pickSingleExBtn.addEventListener('click', () => {
      _closeExerciseOrRoutinePickerModal();
      _openExercisesModal();
    });
  }

  const pickRoutineBtn = $('wo-pick-routine-btn');
  if (pickRoutineBtn) {
    pickRoutineBtn.addEventListener('click', () => {
      _closeExerciseOrRoutinePickerModal();
      _openRoutinesModal();
    });
  }

  // Rutinok modál
  const openRoutinesBtn = $('wo-open-routines-btn');
  if (openRoutinesBtn) openRoutinesBtn.addEventListener('click', _openRoutinesModal);

  const routinesClose = $('wo-routines-close') || $('wo-routines-modal-close');
  const routinesBackdrop = $('wo-routines-backdrop') || $('wo-routines-modal-backdrop');
  const saveRoutineBtn = $('wo-save-custom-routine-btn') || $('wo-save-routine-btn');
  if (routinesClose) routinesClose.addEventListener('click', _closeRoutinesModal);
  if (routinesBackdrop) routinesBackdrop.addEventListener('click', _closeRoutinesModal);
  if (saveRoutineBtn) saveRoutineBtn.addEventListener('click', _saveRoutine);

  // Gyakorlatok modál
  const openExercisesBtn = $('wo-open-exercises-btn');
  if (openExercisesBtn) openExercisesBtn.addEventListener('click', _openExercisesModal);

  const exClose = $('wo-exercises-close') || $('wo-exercises-modal-close');
  const exBackdrop = $('wo-exercises-backdrop') || $('wo-exercises-modal-backdrop');
  const saveExBtn = $('wo-save-new-ex-btn') || $('wo-save-exercise-btn');
  if (exClose) exClose.addEventListener('click', _closeExercisesModal);
  if (exBackdrop) exBackdrop.addEventListener('click', _closeExercisesModal);
  if (saveExBtn) saveExBtn.addEventListener('click', _saveCustomExercise);

  const searchIn = $('wo-ex-search');
  if (searchIn) {
    searchIn.addEventListener('input', (e) => {
      _exerciseSearchQuery = e.target.value;
      _renderExercisesList();
    });
  }

  document.querySelectorAll('.wo-ex-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wo-ex-filter-btn').forEach(b => {
        b.className = 'wo-ex-filter-btn flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400';
      });
      btn.className = 'wo-ex-filter-btn flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 text-white';
      _activeExerciseCategory = btn.dataset.cat || 'all';
      _renderExercisesList();
    });
  });

  _populateSportDropdown();
  _populateDatafieldDropdown();
  _populateGearSelects();
}

function _populateSportDropdown() {
  const select = $('wo-sport-select') || $('wo-select-sport');
  const routineSportSelect = $('wo-new-routine-sport');
  if (!select && !routineSportSelect) return;

  const categories = {};
  GARMIN_SPORTS.forEach(s => {
    if (!categories[s.cat]) categories[s.cat] = [];
    categories[s.cat].push(s);
  });

  const optionsHtml = Object.entries(categories).map(([cat, list]) => `
    <optgroup label="${cat}">
      ${list.map(s => `<option value="${s.id}" ${s.id === 'strength_training' ? 'selected' : ''}>${s.name}</option>`).join('')}
    </optgroup>
  `).join('');

  if (select) select.innerHTML = optionsHtml;
  if (routineSportSelect) routineSportSelect.innerHTML = optionsHtml;
}

function _openExerciseOrRoutinePickerModal() {
  const modal = $('wo-exercise-or-routine-picker-modal');
  const sheet = $('wo-exercise-or-routine-picker-sheet');
  if (!modal || !sheet) return;
  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeExerciseOrRoutinePickerModal() {
  const modal = $('wo-exercise-or-routine-picker-modal');
  const sheet = $('wo-exercise-or-routine-picker-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _populateDatafieldDropdown() {
  const select = $('wo-select-datafield-picker');
  if (!select) return;

  const cats = {};
  GARMIN_DATAFIELDS.forEach(df => {
    const cat = df.cat || df.category || 'Egyéb';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(df);
  });

  select.innerHTML = `
    <option value="">+ Válassz hivatalos Garmin adatmezőt...</option>
    ${Object.entries(cats).map(([cat, fields]) => `
      <optgroup label="${cat}">
        ${fields.map(f => `<option value="${f.id}">${f.name || f.label || f.id} (${f.unit || ''})</option>`).join('')}
      </optgroup>
    `).join('')}
  `;
}

function _updateSportUI() {
  const sport = getSportById(_selectedSportId);
  const badge = $('wo-sport-badge-icon');
  if (badge && sport) {
    badge.className = `${sport.icon || 'fa-solid fa-dumbbell'} text-sm text-indigo-600 dark:text-indigo-400`;
  }
}

function _openWorkoutModal(dateStr = null) {
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) return;

  const dateIn = $('wo-input-date');
  if (dateIn) dateIn.value = dateStr || _selectedDate || todayString();

  _populateSportDropdown();
  _populateGearSelects();
  _populateDatafieldDropdown();
  _activeDatafields = [];
  _renderDatafieldRows();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}
window.openWorkoutModal = _openWorkoutModal;
window.populateGearSelects = _populateGearSelects;

function _closeWorkoutModal() {
  const modal = $('wo-modal');
  const sheet = $('wo-modal-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _addDatafieldRow() {
  const picker = $('wo-select-datafield-picker');
  if (!picker || !picker.value) return;

  const fieldId = picker.value;
  if (_activeDatafields.some(df => df.id === fieldId)) return;

  const dfDef = getDatafieldById(fieldId);
  if (!dfDef) return;

  _activeDatafields.push({
    id: dfDef.id,
    name: dfDef.name || dfDef.label || dfDef.id,
    label: dfDef.name || dfDef.label || dfDef.id,
    unit: dfDef.unit || '',
    value: ''
  });

  picker.value = '';
  _renderDatafieldRows();
}

function _renderDatafieldRows() {
  const container = $('wo-datafields-container');
  if (!container) return;

  if (_activeDatafields.length === 0) {
    container.innerHTML = '<p class="text-[11px] text-gray-400 italic">Nincs egyedi Garmin adatmező hozzáadva.</p>';
    return;
  }

  container.innerHTML = _activeDatafields.map((df, idx) => {
    const def = getDatafieldById(df.id);
    const title = df.name || df.label || (def ? def.name : df.id);
    const unit = df.unit || (def ? def.unit : '');
    return `
      <div class="flex items-center gap-2 p-2 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
        <div class="flex-1 min-w-0">
          <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">${title}${unit ? ` (${unit})` : ''}</label>
          <input type="text" placeholder="${def?.placeholder ? `pl. ${def.placeholder}` : 'pl. 142 vagy 5:15'}" value="${df.value || ''}" data-idx="${idx}"
                 class="wo-df-input w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-xl px-2.5 py-1 text-xs focus:outline-none" />
        </div>
        <button type="button" class="wo-df-remove-btn text-gray-400 hover:text-red-500 p-1.5" data-idx="${idx}">
          <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.wo-df-input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const i = parseInt(inp.dataset.idx, 10);
      if (_activeDatafields[i]) _activeDatafields[i].value = e.target.value;
    });
  });

  container.querySelectorAll('.wo-df-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      _activeDatafields.splice(i, 1);
      _renderDatafieldRows();
    });
  });
}

async function _saveWorkout() {
  if (!_uid) return;

  const nameIn = $('wo-input-name');
  const dateIn = $('wo-input-date');
  const durIn = $('wo-input-duration');
  const calIn = $('wo-input-calories');
  const exIn = $('wo-input-exercises');
  const notesIn = $('wo-input-notes');
  const gearSelect = $('wo-gear-select') || $('wo-select-gear');
  const kmIn = $('wo-input-distance');
  const saveBtn = $('wo-save-btn');

  const sport = getSportById(_selectedSportId);
  const name = nameIn?.value.trim() || sport?.name || 'Edzés';
  const date = dateIn?.value || todayString();
  const duration = parseInt(durIn?.value, 10) || 60;
  const calories = parseInt(calIn?.value, 10) || 0;
  const exercises = exIn?.value.trim() || '';
  const notes = notesIn?.value.trim() || '';
  const gearId = gearSelect?.value || '';
  const distanceKm = parseFloat(kmIn?.value) || 0;

  const payload = {
    name,
    sportId: _selectedSportId,
    date,
    duration,
    calories,
    distanceKm,
    gearId,
    exercises,
    notes,
    datafields: _activeDatafields,
    createdAt: serverTimestamp()
  };

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'workouts'), payload);

    // Ha választottunk felszerelést, kumuláljuk a km-t és az órát
    if (gearId) {
      const hoursAdded = Math.round((duration / 60) * 10) / 10;
      await updateDoc(doc(db, 'users', _uid, 'gear', gearId), {
        totalKm: increment(distanceKm),
        totalHours: increment(hoursAdded)
      });
    }

    _closeWorkoutModal();
    if (nameIn) nameIn.value = '';
    if (exIn) exIn.value = '';
    if (notesIn) notesIn.value = '';
  } catch (err) {
    console.error('[activity] Error saving workout:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Edzés mentése';
    }
  }
}

function _renderWorkoutsList() {
  const container = $('wo-records-list');
  if (!container) return;

  if (_allWorkouts.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-6">
        <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 mx-auto flex items-center justify-center mb-3">
          <i class="fa-solid fa-dumbbell text-xl"></i>
        </div>
        <p class="text-xs font-bold text-gray-700 dark:text-gray-300">Még nincs rögzített edzésed</p>
        <p class="text-[11px] text-gray-400 mt-1">Koppints a + gombra vagy emelj be egy rutint a Rutinok fülről!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = _allWorkouts.map(w => {
    const sport = getSportById(w.sportId || 'strength_training');
    const gear = _allGears.find(g => g.id === w.gearId);
    return `
      <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm transition-all">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-3 flex-1 min-w-0 pr-2">
            <div class="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <i class="${sport.icon || 'fa-solid fa-dumbbell'} text-base"></i>
            </div>
            <div class="min-w-0">
              <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">${w.name || sport.name}</h4>
              <p class="text-[10px] text-gray-400 font-medium">
                ${w.date} · <span class="text-indigo-600 dark:text-indigo-400 font-bold">${w.duration || 60} perc</span>
                ${w.distanceKm ? ` · ${w.distanceKm} km` : ''}
                ${w.calories ? ` · ${w.calories} kcal` : ''}
              </p>
            </div>
          </div>
          <button class="wo-delete-btn text-gray-300 hover:text-red-500 p-1.5 transition-colors" data-id="${w.id}">
            <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
          </button>
        </div>

        ${gear ? `
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-[10px] text-gray-600 dark:text-gray-300 mb-2">
            <i class="fa-solid fa-shoe-prints text-indigo-500"></i>
            <span>${gear.brand || ''} ${gear.name}</span>
          </div>
        ` : ''}

        ${w.exercises ? `
          <div class="p-2.5 rounded-2xl bg-gray-50 dark:bg-slate-800/60 font-mono text-[10px] text-gray-600 dark:text-gray-300 whitespace-pre-line leading-relaxed my-1">
            ${w.exercises}
          </div>
        ` : ''}

        ${w.datafields && w.datafields.length > 0 ? `
          <div class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-slate-800">
            ${w.datafields.map(df => {
              const def = getDatafieldById(df.id);
              const label = (df.name && df.name !== 'undefined') ? df.name : ((df.label && df.label !== 'undefined') ? df.label : (def ? def.name : df.id));
              const unit = df.unit || (def ? def.unit : '');
              return `
                <span class="text-[9px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-md font-semibold">
                  ${label}: ${df.value} ${unit}
                </span>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.wo-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'workouts', id));
        } catch (err) {
          console.error('[activity] Error deleting workout:', err);
        }
      }
    });
  });
}

function _updateWorkoutStats() {
  const weekEl = $('wo-stat-week');
  const totalEl = $('wo-stat-total');
  const streakEl = $('wo-stat-streak');

  if (totalEl) totalEl.textContent = _allWorkouts.length;

  // Heti darabszám
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffMon);
  const monStr = mon.toISOString().slice(0, 10);

  const weekCount = _allWorkouts.filter(w => w.date >= monStr).length;
  if (weekEl) weekEl.textContent = weekCount;

  // Napsorozat (streak)
  const dateSet = new Set(_allWorkouts.map(w => w.date));
  let streak = 0;
  let curr = new Date();
  while (true) {
    const s = curr.toISOString().slice(0, 10);
    if (dateSet.has(s)) {
      streak++;
      curr.setDate(curr.getDate() - 1);
    } else {
      break;
    }
  }
  if (streakEl) streakEl.textContent = streak;
}

// ══════════════════════════════════════════════════════════════
// RUTINOK ÉS GYAKORLATTÁR
// ══════════════════════════════════════════════════════════════

function _openRoutinesModal() {
  const modal = $('wo-routines-modal');
  const sheet = $('wo-routines-sheet');
  if (!modal || !sheet) return;
  _populateSportDropdown();
  _renderRoutinesList();
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

function _renderRoutinesList() {
  const containers = [$('wo-routines-list'), $('wo-routines-modal-list')].filter(Boolean);
  if (containers.length === 0) return;

  const all = [...DEFAULT_ROUTINES, ..._allRoutines];

  const html = all.map((r, idx) => {
    const isCustom = Boolean(r.id);
    const sport = getSportById(r.sportId || 'strength_training');
    return `
      <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 flex items-center justify-center text-xs">
              <i class="${sport.icon || 'fa-solid fa-dumbbell'}"></i>
            </div>
            <div>
              <h4 class="text-xs font-bold text-gray-900 dark:text-white">${r.name}</h4>
              <p class="text-[10px] text-gray-400">${r.duration || 60} perc · ${sport.name}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[9px] px-2 py-0.5 rounded-full font-bold ${isCustom ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'}">
              ${isCustom ? 'Saját' : 'Minta'}
            </span>
            ${isCustom ? `
              <button class="wo-delete-routine-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${r.id}" title="Program törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/60 font-mono text-[10px] text-gray-600 dark:text-gray-300 whitespace-pre-line leading-relaxed mb-3">
          ${r.exercises || ''}
        </div>

        <button class="wo-apply-routine-btn w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
                data-idx="${idx}">
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Beemelés a mai edzésbe</span>
        </button>
      </div>
    `;
  }).join('');

  containers.forEach(container => {
    container.innerHTML = html;

    container.querySelectorAll('.wo-apply-routine-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const routine = all[idx];
        if (!routine) return;

        _closeRoutinesModal();
        _openWorkoutModal();

        const nameIn = $('wo-input-name');
        const durIn = $('wo-input-duration');
        const exIn = $('wo-input-exercises');
        const sportSel = $('wo-sport-select') || $('wo-select-sport');

        if (nameIn) nameIn.value = routine.name;
        if (durIn) durIn.value = routine.duration || 60;
        if (exIn) exIn.value = routine.exercises || '';
        if (sportSel && routine.sportId) {
          sportSel.value = routine.sportId;
          _selectedSportId = routine.sportId;
          _updateSportUI();
        }
      });
    });

    container.querySelectorAll('.wo-delete-routine-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id && _uid) {
          try {
            await deleteDoc(doc(db, 'users', _uid, 'routines', id));
          } catch (err) {
            console.error('[activity] Error deleting routine:', err);
          }
        }
      });
    });
  });
}

async function _saveRoutine() {
  if (!_uid) return;
  const nameIn = $('wo-new-routine-name') || $('wo-routine-name-in');
  const durIn = $('wo-new-routine-duration') || $('wo-routine-dur-in');
  const exIn = $('wo-new-routine-exercises') || $('wo-routine-exercises-in');
  const notesIn = $('wo-routine-notes-in');
  const sportSel = $('wo-new-routine-sport');

  const name = nameIn?.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, 'users', _uid, 'routines'), {
      name,
      sportId: sportSel?.value || 'strength_training',
      duration: parseInt(durIn?.value, 10) || 60,
      exercises: exIn?.value.trim() || '',
      notes: notesIn?.value.trim() || '',
      createdAt: serverTimestamp()
    });

    if (nameIn) nameIn.value = '';
    if (exIn) exIn.value = '';
    if (notesIn) notesIn.value = '';
    _closeRoutinesModal();
    _renderRoutinesList();
  } catch (err) {
    console.error('[activity] Routine save error:', err);
  }
}

// ── Gyakorlattár ──────────────────────────────────────────
function _openExercisesModal() {
  const modal = $('wo-exercises-modal');
  const sheet = $('wo-exercises-sheet');
  if (!modal || !sheet) return;
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

let _activeExerciseCategory = 'all';
let _exerciseSearchQuery = '';

function _renderExercisesList() {
  const container = $('wo-exercises-items') || $('wo-exercises-list');
  if (!container) return;

  let all = [...DEFAULT_EXERCISES, ..._allExercises];

  if (_activeExerciseCategory !== 'all') {
    all = all.filter(ex => (ex.category || '').toLowerCase() === _activeExerciseCategory.toLowerCase());
  }

  if (_exerciseSearchQuery.trim()) {
    const q = _exerciseSearchQuery.toLowerCase();
    all = all.filter(ex =>
      (ex.name && ex.name.toLowerCase().includes(q)) ||
      (ex.targetMuscle && ex.targetMuscle.toLowerCase().includes(q)) ||
      (ex.muscle && ex.muscle.toLowerCase().includes(q))
    );
  }

  if (all.length === 0) {
    container.innerHTML = `
      <p class="text-xs text-gray-400 italic text-center py-4">Nem található ilyen gyakorlat.</p>
    `;
    return;
  }

  container.innerHTML = all.map(ex => `
    <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 hover:border-indigo-500/40 transition-colors">
      <div class="min-w-0 flex-1 mr-2 cursor-pointer wo-ex-item-info" data-name="${ex.name}">
        <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${ex.name}</p>
        <p class="text-[10px] text-gray-400 font-semibold truncate">${ex.targetMuscle || ex.muscle || ex.category || 'Általános'}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex-shrink-0">
          ${ex.category || 'Gyakorlat'}
        </span>
        <button type="button" class="wo-insert-single-ex-btn px-2.5 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] active:scale-95 transition-all flex items-center gap-1 flex-shrink-0"
                data-name="${ex.name}">
          <i class="fa-solid fa-plus text-[9px]"></i>
          <span>Beszúrás</span>
        </button>
      </div>
    </div>
  `).join('');

  const insertHandler = (name) => {
    const exIn = $('wo-input-exercises');
    if (exIn) {
      const cur = exIn.value.trim();
      const line = `${name} 3 × 10`;
      exIn.value = cur ? `${cur}\n${line}` : line;
    }
    _closeExercisesModal();
    const woModal = $('wo-modal');
    if (woModal && woModal.classList.contains('hidden')) {
      _openWorkoutModal();
    }
  };

  container.querySelectorAll('.wo-insert-single-ex-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      insertHandler(btn.dataset.name);
    });
  });

  container.querySelectorAll('.wo-ex-item-info').forEach(info => {
    info.addEventListener('click', () => {
      insertHandler(info.dataset.name);
    });
  });
}

async function _saveCustomExercise() {
  if (!_uid) return;
  const nameIn = $('wo-new-ex-name');
  const catIn = $('wo-new-ex-cat');
  const muscleIn = $('wo-new-ex-muscle');
  const name = nameIn?.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, 'users', _uid, 'exercises'), {
      name,
      muscle: muscleIn?.value.trim() || catIn?.value || 'Mell',
      category: 'Saját gyakorlat',
      createdAt: serverTimestamp()
    });
    if (nameIn) nameIn.value = '';
    if (muscleIn) muscleIn.value = '';
  } catch (err) {
    console.error('[activity] Error saving custom exercise:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// FELSZERELÉSEK (GEAR) KEZELŐJE
// ══════════════════════════════════════════════════════════════

function _bindGearEvents() {
  const openGearBtn = $('wo-open-gear-btn');
  const closeBtn = $('wo-gear-close') || $('wo-gear-modal-close');
  const backdrop = $('wo-gear-backdrop') || $('wo-gear-modal-backdrop');
  const saveBtn = $('wo-save-gear-btn');

  if (openGearBtn) openGearBtn.addEventListener('click', _openGearModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeGearModal);
  if (backdrop) backdrop.addEventListener('click', _closeGearModal);
  if (saveBtn) saveBtn.addEventListener('click', _saveGear);
}

function _openGearModal() {
  const modal = $('wo-gear-modal');
  const sheet = $('wo-gear-sheet');
  if (!modal || !sheet) return;
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

async function _saveGear() {
  if (!_uid) return;
  const nameIn = $('wo-new-gear-name') || $('wo-gear-name-in');
  const brandIn = $('wo-gear-brand-in');
  const typeIn = $('wo-new-gear-type') || $('wo-gear-type-in');
  const maxKmIn = $('wo-new-gear-maxkm') || $('wo-gear-maxkm-in');
  const initKmIn = $('wo-new-gear-initkm');
  const initHoursIn = $('wo-new-gear-inithours');
  const saveBtn = $('wo-save-gear-btn');

  const name = nameIn?.value.trim();
  if (!name) return;

  const brand = brandIn?.value.trim() || '';
  const type = typeIn?.value || 'shoes';
  const maxKm = parseFloat(maxKmIn?.value) || 800;
  const totalKm = parseFloat(initKmIn?.value) || 0;
  const totalHours = parseFloat(initHoursIn?.value) || 0;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'gear'), {
      name,
      brand,
      type,
      maxKm,
      totalKm,
      totalHours,
      active: true,
      createdAt: serverTimestamp()
    });

    if (nameIn) nameIn.value = '';
    if (brandIn) brandIn.value = '';
    if (initKmIn) initKmIn.value = '';
    if (initHoursIn) initHoursIn.value = '';
    _closeGearModal();
  } catch (err) {
    console.error('[activity] Error saving gear:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Felszerelés mentése';
    }
  }
}

function _renderGearShelf() {
  const container = $('wo-gear-list');
  const shelfContainer = $('activity-gear-shelf-container');

  const targets = [container, shelfContainer].filter(Boolean);
  if (targets.length === 0) return;

  const html = _allGears.length === 0 ? `
    <div class="text-center py-8 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-6">
      <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 mx-auto flex items-center justify-center mb-3">
        <i class="fa-solid fa-shoe-prints text-xl"></i>
      </div>
      <p class="text-xs font-bold text-gray-700 dark:text-gray-300">Nincs még regisztrált felszerelésed</p>
      <p class="text-[11px] text-gray-400 mt-1">Adj hozzá futócipőt vagy kerékpárt, és kövesd a megtett kilométereket!</p>
    </div>
  ` : _allGears.map(g => {
    const kmPct = g.maxKm ? Math.min(100, Math.round(((g.totalKm || 0) / g.maxKm) * 100)) : 0;
    return `
      <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm">
              <i class="${g.type === 'bike' ? 'fa-solid fa-bicycle' : (g.type === 'watch' ? 'fa-solid fa-stopwatch' : 'fa-solid fa-shoe-prints')}"></i>
            </div>
            <div>
              <h4 class="text-xs font-bold text-gray-900 dark:text-white">${g.brand ? `${g.brand} ` : ''}${g.name}</h4>
              <p class="text-[10px] text-gray-400">${g.totalKm ? `${Math.round(g.totalKm * 10) / 10} km` : '0 km'} · ${g.totalHours || 0} óra</p>
            </div>
          </div>
          <button class="wo-delete-gear-btn text-gray-300 hover:text-red-500 p-1.5" data-id="${g.id}">
            <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
          </button>
        </div>

        ${g.maxKm ? `
          <div class="mt-2">
            <div class="flex justify-between text-[10px] text-gray-400 font-semibold mb-1">
              <span>Használat</span>
              <span>${Math.round(g.totalKm || 0)} / ${g.maxKm} km (${kmPct}%)</span>
            </div>
            <div class="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full rounded-full ${kmPct > 85 ? 'bg-red-500' : 'bg-indigo-600'}" style="width: ${kmPct}%;"></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  targets.forEach(t => {
    t.innerHTML = html;
    t.querySelectorAll('.wo-delete-gear-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id && _uid) {
          try {
            await deleteDoc(doc(db, 'users', _uid, 'gear', id));
          } catch (err) {
            console.error('[activity] Error deleting gear:', err);
          }
        }
      });
    });
  });
}

function _populateGearSelects() {
  const select = $('wo-gear-select') || $('wo-select-gear');
  if (!select) return;

  select.innerHTML = `
    <option value="">Felszerelés kiválasztása (opcionális)...</option>
    ${_allGears.map(g => `<option value="${g.id}">${g.brand ? `${g.brand} ` : ''}${g.name} (${Math.round(g.totalKm || 0)} km)</option>`).join('')}
  `;
}

// ══════════════════════════════════════════════════════════════
// REGENERÁCIÓ (SMR, NYÚJTÁS, SZAUNA, ALVÁSNAPLÓ)
// ══════════════════════════════════════════════════════════════

function _bindRecoveryModuleEvents() {
  const fab = $('rec-fab');
  const closeBtn = $('rec-modal-close');
  const backdrop = $('rec-modal-backdrop');
  const saveBtn = $('rec-save-btn');
  const protoOpenBtn = $('rec-open-protocols-btn');

  if (fab) fab.addEventListener('click', _openSleepModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeSleepModal);
  if (backdrop) backdrop.addEventListener('click', _closeSleepModal);
  if (saveBtn) saveBtn.addEventListener('click', _saveSleep);
  if (protoOpenBtn) protoOpenBtn.addEventListener('click', _openProtocolsModal);

  // Protokollok modál
  const protoClose = $('rec-protocols-modal-close') || $('rec-protocols-close');
  const protoBackdrop = $('rec-protocols-modal-backdrop') || $('rec-protocols-backdrop');
  const protoSave = $('rec-save-protocol-btn');

  if (protoClose) protoClose.addEventListener('click', _closeProtocolsModal);
  if (protoBackdrop) protoBackdrop.addEventListener('click', _closeProtocolsModal);
  if (protoSave) protoSave.addEventListener('click', _saveProtocol);
}

function _openSleepModal() {
  const modal = $('rec-modal');
  const sheet = $('rec-modal-sheet');
  if (!modal || !sheet) return;

  const dateIn = $('rec-input-date');
  if (dateIn) dateIn.value = _selectedDate || todayString();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeSleepModal() {
  const modal = $('rec-modal');
  const sheet = $('rec-modal-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _openProtocolsModal() {
  const modal = $('rec-protocols-modal');
  const sheet = $('rec-protocols-sheet');
  if (!modal || !sheet) return;
  _renderProtocolsList();
  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}
window.openProtocolsModal = _openProtocolsModal;

function _closeProtocolsModal() {
  const modal = $('rec-protocols-modal');
  const sheet = $('rec-protocols-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

async function _saveSleep() {
  if (!_uid) return;
  const dateIn = $('rec-input-date');
  const bedIn = $('rec-input-bedtime');
  const wakeIn = $('rec-input-wakeup');
  const notesIn = $('rec-input-notes');
  const saveBtn = $('rec-save-btn');

  const bedtime = bedIn?.value || '23:00';
  const wakeup = wakeIn?.value || '07:00';

  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wakeup.split(':').map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;
  const durationHours = Math.round(mins / 6) / 10;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'sleepLogs'), {
      date: dateIn?.value || todayString(),
      bedtime,
      wakeup,
      durationHours,
      notes: notesIn?.value.trim() || '',
      createdAt: serverTimestamp()
    });
    _closeSleepModal();
  } catch (err) {
    console.error('[activity] Error saving sleep log:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Alvás mentése';
    }
  }
}

function _renderSleepList() {
  const container = $('rec-records-list');
  if (!container) return;

  if (_allSleepLogs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-6">
        <div class="w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-950/60 text-violet-500 mx-auto flex items-center justify-center mb-3">
          <i class="fa-solid fa-moon text-xl"></i>
        </div>
        <p class="text-xs font-bold text-gray-700 dark:text-gray-300">Nincs még alvási adatod</p>
        <p class="text-[11px] text-gray-400 mt-1">Rögzítsd lefekvési és ébredési idődet a pontos alvási analitikához!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = _allSleepLogs.map(s => `
    <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-violet-50 dark:bg-violet-950/60 text-violet-500 flex items-center justify-center text-sm">
          <i class="fa-solid fa-bed"></i>
        </div>
        <div>
          <h4 class="text-xs font-bold text-gray-900 dark:text-white">${s.date}</h4>
          <p class="text-[10px] text-gray-400 font-semibold">${s.bedtime} → ${s.wakeup}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm font-extrabold text-violet-600 dark:text-violet-400">${s.durationHours} óra</span>
        <button class="rec-delete-sleep-btn text-gray-300 hover:text-red-500 p-1.5" data-id="${s.id}">
          <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.rec-delete-sleep-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'sleepLogs', id));
        } catch (err) {
          console.error('[activity] Error deleting sleep:', err);
        }
      }
    });
  });
}

function _updateSleepStats() {
  const avgEl = $('rec-stat-avg');
  const bestEl = $('rec-stat-best');
  const totalEl = $('rec-stat-total');

  if (totalEl) totalEl.textContent = _allSleepLogs.length;

  if (_allSleepLogs.length === 0) {
    if (avgEl) avgEl.textContent = '—';
    if (bestEl) bestEl.textContent = '—';
    return;
  }

  const hoursList = _allSleepLogs.map(s => Number(s.durationHours) || 0).filter(h => h > 0);
  if (hoursList.length > 0) {
    const avg = Math.round((hoursList.reduce((s, h) => s + h, 0) / hoursList.length) * 10) / 10;
    const best = Math.max(...hoursList);
    if (avgEl) avgEl.textContent = `${avg} ó`;
    if (bestEl) bestEl.textContent = `${best} ó`;
  }
}

function _renderProtocolsList() {
  const containers = [$('rec-protocols-list'), $('rec-protocols-items')].filter(Boolean);
  if (containers.length === 0) return;

  const all = [...DEFAULT_RECOVERY_PROTOCOLS, ..._allProtocols];

  const html = all.map((p, idx) => {
    const isCustom = Boolean(p.id);
    return `
      <div class="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-500 flex items-center justify-center text-xs">
              <i class="fa-solid fa-spa"></i>
            </div>
            <div>
              <h4 class="text-xs font-bold text-gray-900 dark:text-white">${p.name}</h4>
              <p class="text-[10px] text-gray-400">${p.duration || 20} perc · ${p.type || 'SMR / Nyújtás'}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[9px] px-2 py-0.5 rounded-full font-bold ${isCustom ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'}">
              ${isCustom ? 'Saját' : 'Minta'}
            </span>
            ${isCustom ? `
              <button class="rec-delete-proto-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${p.id}" title="Program törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/60 font-mono text-[10px] text-gray-600 dark:text-gray-300 whitespace-pre-line leading-relaxed mb-3">
          ${p.exercises || ''}
        </div>

        <button class="rec-apply-protocol-btn w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
                data-idx="${idx}">
          <i class="fa-solid fa-check text-[10px]"></i>
          <span>Beemelés a mai napba (Rögzítés)</span>
        </button>
      </div>
    `;
  }).join('');

  containers.forEach(container => {
    container.innerHTML = html;

    container.querySelectorAll('.rec-apply-protocol-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const proto = all[idx];
        if (!proto || !_uid) return;

        try {
          await addDoc(collection(db, 'users', _uid, 'recoveryProtocols'), {
            name: proto.name,
            type: proto.type || 'smr',
            duration: proto.duration || 20,
            date: _selectedDate || todayString(),
            createdAt: serverTimestamp()
          });
          _closeProtocolsModal();
        } catch (err) {
          console.error('[activity] Error recording protocol:', err);
        }
      });
    });

    container.querySelectorAll('.rec-delete-proto-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id && _uid) {
          try {
            await deleteDoc(doc(db, 'users', _uid, 'recoveryProtocols', id));
          } catch (err) {
            console.error('[activity] Error deleting protocol:', err);
          }
        }
      });
    });
  });
}

async function _saveProtocol() {
  if (!_uid) return;
  const nameIn = $('rec-proto-name-in');
  const typeIn = $('rec-proto-type-in');
  const durIn = $('rec-proto-dur-in');
  const exIn = $('rec-proto-exercises-in');
  const saveBtn = $('rec-save-protocol-btn');

  const name = nameIn?.value.trim();
  if (!name) return;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'recoveryProtocols'), {
      name,
      type: typeIn?.value || 'smr',
      duration: parseInt(durIn?.value, 10) || 20,
      exercises: exIn?.value.trim() || '',
      date: _selectedDate || todayString(),
      createdAt: serverTimestamp()
    });

    if (nameIn) nameIn.value = '';
    if (exIn) exIn.value = '';
    _closeProtocolsModal();
    _renderProtocolsList();
  } catch (err) {
    console.error('[activity] Error creating custom protocol:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Mentés';
    }
  }
}

function _renderRecoveryExercisesList() {
  const container = $('rec-exercises-list');
  if (!container) return;

  const all = [...DEFAULT_EXERCISES, ..._allExercises];
  const recExercises = all.filter(ex => {
    const c = (ex.category || '').toLowerCase();
    const s = (ex.sportId || '').toLowerCase();
    const n = (ex.name || '').toLowerCase();
    return /smr|nyújt|stretch|légzés|breath|hideg|meleg|sauna|szauna|mobilit|henger/i.test(c + ' ' + s + ' ' + n);
  });

  if (recExercises.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-400 text-xs italic">
        Még nincs regenerációs gyakorlat. Kattints az "+ Új gyakorlat" gombra!
      </div>
    `;
    return;
  }

  container.innerHTML = recExercises.map(ex => `
    <div class="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-500 flex items-center justify-center text-xs">
          <i class="fa-solid fa-spa"></i>
        </div>
        <div>
          <h4 class="text-xs font-bold text-gray-900 dark:text-white">${ex.name}</h4>
          <p class="text-[10px] text-gray-400">${ex.targetMuscle || ex.muscle || ex.category || 'Regeneráció'} · <span class="text-violet-500 font-semibold">${ex.category || 'SMR / Nyújtás'}</span></p>
        </div>
      </div>
      <span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
        ${ex.category || 'SMR'}
      </span>
    </div>
  `).join('');
}

