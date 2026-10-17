// ============================================================
// bodymap.js — Garmin-szintű Anatómiai Testtérkép (Izomterhelés & Regeneráció)
// Lockin 5.0 Pro | Elölnézeti és Hátulnézeti Hőtérkép
// ============================================================

import { db } from '../firebase-config.js';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = id => document.getElementById(id);

// ── Izomcsoport definíciók és szinonimák ────────────────────
export const MUSCLE_GROUPS = {
  chest: {
    id: 'chest',
    name: 'Mellkas',
    latin: 'Pectoralis Major',
    view: 'front',
    keywords: ['mell', 'fekvenyomás', 'bench', 'chest', 'fekvőtámasz', 'push-up', 'tolódzkodás', 'dips', 'tárogatás'],
    defaultRelief: 'Mellkas és vállöv nyújtás'
  },
  shoulders: {
    id: 'shoulders',
    name: 'Vállak',
    latin: 'Deltoids',
    view: 'both',
    keywords: ['váll', 'deltoid', 'shoulder', 'overhead', 'military', 'oldalemelés', 'katonai nyomás', 'elölemelés', 'face pull'],
    defaultRelief: 'Vállmobilitás és lapocka mobilizálás'
  },
  biceps: {
    id: 'biceps',
    name: 'Bicepsz',
    latin: 'Biceps Brachii',
    view: 'front',
    keywords: ['bicepsz', 'biceps', 'bicep', 'kar hajlítás', 'curl', 'húzódzkodás', 'chin-up'],
    defaultRelief: 'Bicepsz és alkar nyújtás'
  },
  triceps: {
    id: 'triceps',
    name: 'Tricepsz',
    latin: 'Triceps Brachii',
    view: 'back',
    keywords: ['tricepsz', 'triceps', 'tricep', 'letolás', 'pushdown', 'lórúgás', 'kickback', 'francia nyomás', 'szűknyomás'],
    defaultRelief: 'Tricepsz felkar-nyújtás'
  },
  forearms: {
    id: 'forearms',
    name: 'Alkar',
    latin: 'Brachioradialis & Flexors',
    view: 'both',
    keywords: ['alkar', 'forearm', 'csukló', 'fogás', 'grip', 'farmer', 'lógás'],
    defaultRelief: 'Csukló- és alkarnyújtás'
  },
  abs: {
    id: 'abs',
    name: 'Hasizom',
    latin: 'Rectus Abdominis',
    view: 'front',
    keywords: ['has', 'hasizom', 'abs', 'core', 'plank', 'felülés', 'crunch', 'hasprés', 'lábemelés', 'hollow body'],
    defaultRelief: 'Kobra póz és törzs extenzió'
  },
  obliques: {
    id: 'obliques',
    name: 'Ferde hasizom',
    latin: 'External Obliques',
    view: 'front',
    keywords: ['ferde has', 'oblique', 'russian twist', 'oldalsó has', 'side plank', 'oldalplank', 'törzsfordítás'],
    defaultRelief: 'Törzsrotációs csavarás'
  },
  quads: {
    id: 'quads',
    name: 'Combfeszítő',
    latin: 'Quadriceps Femoris',
    view: 'front',
    keywords: ['combfeszítő', 'comb', 'quad', 'quadriceps', 'guggolás', 'squat', 'lábtoló', 'leg press', 'kitörés', 'lunge', 'futás', 'run', 'kerékpár', 'cycling', 'bringa'],
    defaultRelief: 'Combfeszítő SMR hengerlés & kanapé nyújtás'
  },
  adductors: {
    id: 'adductors',
    name: 'Belső comb (Közelítők)',
    latin: 'Adductor Magnus & Longus',
    view: 'front',
    keywords: ['belső comb', 'combközelítő', 'adductor', 'sumo guggolás', 'terpesz'],
    defaultRelief: 'Békapóz és belső comb nyújtás'
  },
  calves: {
    id: 'calves',
    name: 'Vádli & Lábszár',
    latin: 'Gastrocnemius & Soleus',
    view: 'both',
    keywords: ['vádli', 'calf', 'calves', 'vádliemelés', 'ugrókötél', 'sprint', 'futás', 'lábszár', 'achilles'],
    defaultRelief: 'Vádli hengerlés & lépcsős saroksüllyesztés'
  },
  traps: {
    id: 'traps',
    name: 'Trapézizom / Csuklya',
    latin: 'Trapezius',
    view: 'back',
    keywords: ['trapéz', 'csuklya', 'trap', 'trapezius', 'vállvonogatás', 'shrug', 'face pull', 'felhúzás'],
    defaultRelief: 'Nyak- és csuklyanyújtás labdával'
  },
  lats: {
    id: 'lats',
    name: 'Széles hátizom',
    latin: 'Latissimus Dorsi',
    view: 'back',
    keywords: ['széles hát', 'hát', 'lat', 'latissimus', 'húzódzkodás', 'pull-up', 'evezés', 'row', 'csigás lehúzás', 'pulldown', 'úszás', 'swim'],
    defaultRelief: 'Széles hátizom hengerlés és bordakosár nyújtás'
  },
  lower_back: {
    id: 'lower_back',
    name: 'Alsó hát / Derék',
    latin: 'Erector Spinae',
    view: 'back',
    keywords: ['alsó hát', 'derék', 'lower back', 'gerinc', 'erector', 'felhúzás', 'deadlift', 'hiperextenzió', 'jó reggelt'],
    defaultRelief: 'Macska-tehén póz és gyermekpóz lazítás'
  },
  glutes: {
    id: 'glutes',
    name: 'Farizom',
    latin: 'Gluteus Maximus & Medius',
    view: 'back',
    keywords: ['farizom', 'far', 'glute', 'gluteus', 'fenék', 'hip thrust', 'csípőtolás', 'guggolás', 'kitörés', 'román felhúzás'],
    defaultRelief: 'Galambpóz (Pigeon pose) és Gluteus SMR'
  },
  hamstrings: {
    id: 'hamstrings',
    name: 'Combhajlító',
    latin: 'Biceps Femoris / Hamstrings',
    view: 'back',
    keywords: ['combhajlító', 'hamstring', 'felhúzás', 'román felhúzás', 'lábhajlító', 'leg curl', 'jó reggelt'],
    defaultRelief: 'Combhajlító nyújtás hevederrel'
  },
  neck: {
    id: 'neck',
    name: 'Nyak',
    latin: 'Sternocleidomastoideus & Splenius',
    view: 'front',
    keywords: ['nyak', 'neck', 'nyakizom'],
    defaultRelief: 'Kíméletes nyaki mobilitás és légzőgyakorlat'
  }
};

let _uid = null;
let _unsubWorkouts = null;
let _unsubRecovery = null;
let _allWorkouts = [];
let _allRecoveryLogs = [];
let _muscleScores = {};
let _selectedMuscleId = 'quads';

// ── Modul Inicializálása ────────────────────────────────────
export function initBodyMap(uid) {
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRecovery) { _unsubRecovery(); _unsubRecovery = null; }

  _uid = uid;
  if (!_uid) return;

  _bindBodyMapEvents();

  // Azonnali kezdeti kalkuláció és kirajzolás
  _recalculateMuscleHeat();
  _renderBodyMap();

  // Múltbeli edzések és regenerációs adatok figyelése
  const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qWorkouts, snap => {
    _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _recalculateMuscleHeat();
    _renderBodyMap();
  }, err => {
    console.warn('[bodymap] onSnapshot workouts note:', err.message);
    _recalculateMuscleHeat();
    _renderBodyMap();
  });

  const qRec = query(collection(db, 'users', _uid, 'recoveryProtocols'), orderBy('createdAt', 'desc'));
  _unsubRecovery = onSnapshot(qRec, snap => {
    _allRecoveryLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _recalculateMuscleHeat();
    _renderBodyMap();
  }, err => {
    // A recoveryProtocols gyűjtemény még nem létezik vagy üres — csendes kezelés
    console.warn('[bodymap] recoveryProtocols note:', err.message);
    _allRecoveryLogs = [];
    _recalculateMuscleHeat();
    _renderBodyMap();
  });
}

export function destroyBodyMap() {
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  if (_unsubRecovery) { _unsubRecovery(); _unsubRecovery = null; }
  _uid = null;
  _allWorkouts = [];
  _allRecoveryLogs = [];
}

// ── Hőtérkép Kalkuláció ────────────────────────────────────
function _recalculateMuscleHeat() {
  const scores = {};
  const history = {};

  Object.keys(MUSCLE_GROUPS).forEach(k => {
    scores[k] = 0;
    history[k] = { loadedBy: [], relievedBy: [] };
  });

  const now = Date.now();
  const maxAgeHours = 168; // Szigorúan az elmúlt 1 hét (7 nap = 168 óra) terhelése számít bele

  // 1. Edzések terhelése (Heat növelése)
  _allWorkouts.forEach(w => {
    let wTime = now;
    if (w.createdAt && w.createdAt.toDate) {
      wTime = w.createdAt.toDate().getTime();
    } else if (w.date) {
      wTime = new Date(w.date + 'T12:00:00').getTime();
    }
    const ageHours = Math.max(0, (now - wTime) / (1000 * 3600));
    if (ageHours > maxAgeHours) return;

    // Időbeli lecsengés: újabb edzés erősebb terhelést hagy
    const decay = Math.max(0.15, 1 - (ageHours / maxAgeHours));

    const exText = ((w.exercises || '') + ' ' + (w.notes || '') + ' ' + (w.name || '')).toLowerCase();
    const sport = (w.sportId || '').toLowerCase();

    // Sportág alapértelmezett terhelése
    if (sport.includes('run') || sport.includes('fut')) {
      scores.quads += 35 * decay;
      scores.calves += 30 * decay;
      scores.hamstrings += 25 * decay;
      scores.glutes += 25 * decay;
      history.quads.loadedBy.push({ name: w.name || 'Futás', time: w.date || 'Nemrég' });
      history.calves.loadedBy.push({ name: w.name || 'Futás', time: w.date || 'Nemrég' });
    } else if (sport.includes('cycl') || sport.includes('kerékpár') || sport.includes('bringa')) {
      scores.quads += 45 * decay;
      scores.glutes += 30 * decay;
      scores.calves += 20 * decay;
      scores.lower_back += 15 * decay;
      history.quads.loadedBy.push({ name: w.name || 'Kerékpározás', time: w.date || 'Nemrég' });
    } else if (sport.includes('swim') || sport.includes('úsz')) {
      scores.lats += 35 * decay;
      scores.shoulders += 30 * decay;
      scores.chest += 20 * decay;
      scores.triceps += 20 * decay;
      scores.abs += 15 * decay;
    } else if (sport.includes('row') || sport.includes('evez')) {
      scores.lats += 40 * decay;
      scores.lower_back += 30 * decay;
      scores.quads += 25 * decay;
      scores.biceps += 25 * decay;
    }

    // Specifikus gyakorlatok elemzése szöveg alapján
    Object.entries(MUSCLE_GROUPS).forEach(([mKey, mDef]) => {
      let isHit = false;
      for (const kw of mDef.keywords) {
        if (exText.includes(kw)) {
          isHit = true;
          break;
        }
      }

      // Ha az edzés explicit rögzített izomcsoportot (targetMuscles)
      if (w.targetMuscles && Array.isArray(w.targetMuscles) && w.targetMuscles.includes(mKey)) {
        isHit = true;
      } else if (w.targetMuscle && String(w.targetMuscle).toLowerCase().includes(mDef.name.toLowerCase())) {
        isHit = true;
      }

      if (isHit) {
        scores[mKey] += 30 * decay;
        if (!history[mKey].loadedBy.some(h => h.name === (w.name || 'Edzés'))) {
          history[mKey].loadedBy.push({ name: w.name || 'Erőnléti edzés', time: w.date || 'Nemrég' });
        }
      }
    });
  });

  // 2. Regenerációs szeánszok (SMR, Nyújtás, Mobilitás - Heat csökkentése / hűtés)
  const allReliefSessions = [
    ..._allRecoveryLogs,
    ..._allWorkouts.filter(w => (w.sportId || '').toLowerCase().includes('yoga') || (w.notes || '').toLowerCase().includes('smr') || (w.notes || '').toLowerCase().includes('nyújt'))
  ];

  allReliefSessions.forEach(r => {
    let rTime = now;
    if (r.createdAt && r.createdAt.toDate) {
      rTime = r.createdAt.toDate().getTime();
    } else if (r.date) {
      rTime = new Date(r.date + 'T12:00:00').getTime();
    }
    const ageHours = Math.max(0, (now - rTime) / (1000 * 3600));
    if (ageHours > maxAgeHours) return;

    const decay = Math.max(0.2, 1 - (ageHours / maxAgeHours));
    const text = ((r.exercises || '') + ' ' + (r.notes || '') + ' ' + (r.name || '')).toLowerCase();

    // Teljes test szauna / kontrasztfürdő / általános nyújtás minden izmot hűt
    const isAllRelief = text.includes('szauna') || text.includes('teljes test') || text.includes('full body') ||
                        text.includes('kontraszt') || (r.relievedMuscles && r.relievedMuscles.includes('all')) ||
                        r.relievedMuscle === 'all';

    if (isAllRelief) {
      Object.keys(scores).forEach(k => {
        scores[k] = Math.max(0, scores[k] - 25 * decay);
        history[k].relievedBy.push({ name: r.name || 'Szauna & Hidegfürdő', time: r.date || 'Ma' });
      });
      return;
    }

    Object.entries(MUSCLE_GROUPS).forEach(([mKey, mDef]) => {
      let isRelieved = false;
      for (const kw of mDef.keywords) {
        if (text.includes(kw)) {
          isRelieved = true;
          break;
        }
      }

      if (r.relievedMuscles && Array.isArray(r.relievedMuscles) && r.relievedMuscles.includes(mKey)) {
        isRelieved = true;
      } else if (r.relievedMuscle && (String(r.relievedMuscle).toLowerCase().includes(mKey) || String(r.relievedMuscle).toLowerCase().includes(mDef.name.toLowerCase()))) {
        isRelieved = true;
      }

      if (isRelieved) {
        scores[mKey] = Math.max(0, scores[mKey] - 40 * decay);
        history[mKey].relievedBy.push({ name: r.name || 'SMR / Nyújtás', time: r.date || 'Ma' });
      }
    });
  });

  // Normalizálás [0, 100] közé kerekítve
  _muscleScores = {};
  Object.keys(MUSCLE_GROUPS).forEach(k => {
    _muscleScores[k] = {
      val: Math.min(100, Math.round(scores[k])),
      loadedBy: history[k].loadedBy.slice(0, 3),
      relievedBy: history[k].relievedBy.slice(0, 3)
    };
  });
}

// ── Szín meghatározása terheltség alapján ──────────────────
function _getMuscleColor(score) {
  if (score < 15) {
    // Pihent / Semleges szürke
    return '#374151'; // Slate-700
  } else if (score < 40) {
    // Enyhe terhelés / Sárgás narancs
    return '#f59e0b'; // Amber-500
  } else if (score < 70) {
    // Közepes terhelés / Élénk narancs-piros
    return '#f97316'; // Orange-500
  } else {
    // Erős terhelés / Mélyvörös
    return '#dc2626'; // Red-600
  }
}

function _getStatusLabel(score) {
  if (score < 15) return { text: 'Pihent / Kész a terhelésre', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  if (score < 40) return { text: 'Enyhe terhelés (Aktív)', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
  if (score < 70) return { text: 'Közepes terhelés (Fáradás)', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' };
  return { text: 'Erős terhelés (Regenerációt igényel)', color: 'text-red-400 bg-red-500/10 border-red-500/30' };
}

// ── Anatómiai SVG Test Generálása (Elölnézet & Hátulnézet) ──
function _generateFrontSvg() {
  const c = id => _getMuscleColor(_muscleScores[id]?.val || 0);

  return `
    <svg viewBox="0 0 200 420" class="w-full h-auto max-h-[380px] drop-shadow-md select-none">
      <defs>
        <filter id="glow-front" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <!-- Fej és arc sziluett (semleges) -->
      <path d="M100 20 C88 20 82 32 82 46 C82 62 90 74 100 74 C110 74 118 62 118 46 C118 32 112 20 100 20 Z" fill="#1f242d" stroke="#374151" stroke-width="1.5" />

      <!-- Nyak (Front) -->
      <path id="svg-m-neck" data-muscle="neck" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M93 74 L90 92 L110 92 L107 74 Z"
            fill="${c('neck')}" stroke="#111827" stroke-width="1.5" />

      <!-- Bal & Jobb Váll (Front Deltoids) -->
      <path id="svg-m-shoulders-fl" data-muscle="shoulders" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M87 93 C76 95 64 102 60 114 C56 126 60 138 65 142 C69 133 73 120 78 112 Z"
            fill="${c('shoulders')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-shoulders-fr" data-muscle="shoulders" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M113 93 C124 95 136 102 140 114 C144 126 140 138 135 142 C131 133 127 120 122 112 Z"
            fill="${c('shoulders')}" stroke="#111827" stroke-width="1.5" />

      <!-- Mellkas (Pectorals) -->
      <path id="svg-m-chest-l" data-muscle="chest" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M89 95 L78 112 C80 125 82 136 98 136 L98 96 Z"
            fill="${c('chest')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-chest-r" data-muscle="chest" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M111 95 L122 112 C120 125 118 136 102 136 L102 96 Z"
            fill="${c('chest')}" stroke="#111827" stroke-width="1.5" />

      <!-- Bicepsz (Bal & Jobb) -->
      <path id="svg-m-biceps-l" data-muscle="biceps" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M60 142 C56 152 56 166 60 176 C65 174 70 168 71 155 C72 144 67 138 60 142 Z"
            fill="${c('biceps')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-biceps-r" data-muscle="biceps" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M140 142 C144 152 144 166 140 176 C135 174 130 168 129 155 C128 144 133 138 140 142 Z"
            fill="${c('biceps')}" stroke="#111827" stroke-width="1.5" />

      <!-- Alkar (Bal & Jobb Front) -->
      <path id="svg-m-forearms-fl" data-muscle="forearms" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M59 178 C52 195 46 215 44 235 C49 237 54 234 57 222 C61 206 63 192 63 178 Z"
            fill="${c('forearms')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-forearms-fr" data-muscle="forearms" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M141 178 C148 195 154 215 156 235 C151 237 146 234 143 222 C139 206 137 192 137 178 Z"
            fill="${c('forearms')}" stroke="#111827" stroke-width="1.5" />

      <!-- Kezek (semleges szürke) -->
      <path d="M44 236 C42 245 40 255 45 260 C48 260 52 254 53 245 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <path d="M156 236 C158 245 160 255 155 260 C152 260 148 254 147 245 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />

      <!-- Hasizom (Rectus Abdominis 6-pack egység) -->
      <g id="svg-m-abs" data-muscle="abs" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125">
        <rect x="88" y="140" width="10" height="15" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
        <rect x="102" y="140" width="10" height="15" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
        <rect x="88" y="158" width="10" height="15" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
        <rect x="102" y="158" width="10" height="15" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
        <rect x="89" y="176" width="9" height="16" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
        <rect x="102" y="176" width="9" height="16" rx="3" fill="${c('abs')}" stroke="#111827" stroke-width="1" />
      </g>

      <!-- Ferde hasizom (Obliques Bal & Jobb) -->
      <path id="svg-m-obliques-l" data-muscle="obliques" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M78 140 C75 160 74 175 76 194 L85 194 L85 140 Z"
            fill="${c('obliques')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-obliques-r" data-muscle="obliques" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M122 140 C125 160 126 175 124 194 L115 194 L115 140 Z"
            fill="${c('obliques')}" stroke="#111827" stroke-width="1.5" />

      <!-- Medence / Ágyék (semleges szürke) -->
      <path d="M78 196 L122 196 L108 214 L92 214 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />

      <!-- Combfeszítő (Quadriceps Bal & Jobb) -->
      <path id="svg-m-quads-l" data-muscle="quads" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M76 202 C68 225 66 260 72 290 C78 296 85 296 88 288 C92 260 92 225 90 206 Z"
            fill="${c('quads')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-quads-r" data-muscle="quads" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M124 202 C132 225 134 260 128 290 C122 296 115 296 112 288 C108 260 108 225 110 206 Z"
            fill="${c('quads')}" stroke="#111827" stroke-width="1.5" />

      <!-- Combközelítők (Adductors) -->
      <path id="svg-m-adductors-l" data-muscle="adductors" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M91 214 C93 235 94 255 92 275 L98 250 Z"
            fill="${c('adductors')}" stroke="#111827" stroke-width="1" />
      <path id="svg-m-adductors-r" data-muscle="adductors" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M109 214 C107 235 106 255 108 275 L102 250 Z"
            fill="${c('adductors')}" stroke="#111827" stroke-width="1" />

      <!-- Térdek (semleges) -->
      <circle cx="80" cy="300" r="6" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <circle cx="120" cy="300" r="6" fill="#1f242d" stroke="#374151" stroke-width="1" />

      <!-- Sípcsont & Elülső Vádli (Calves Front) -->
      <path id="svg-m-calves-fl" data-muscle="calves" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M75 308 C68 330 68 360 74 385 L84 385 C86 360 86 330 83 308 Z"
            fill="${c('calves')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-calves-fr" data-muscle="calves" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M125 308 C132 330 132 360 126 385 L116 385 C114 360 114 330 117 308 Z"
            fill="${c('calves')}" stroke="#111827" stroke-width="1.5" />

      <!-- Lábfejek (semleges) -->
      <path d="M72 387 L64 405 L84 405 L84 387 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <path d="M128 387 L136 405 L116 405 L116 387 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
    </svg>
  `;
}

function _generateBackSvg() {
  const c = id => _getMuscleColor(_muscleScores[id]?.val || 0);

  return `
    <svg viewBox="0 0 200 420" class="w-full h-auto max-h-[380px] drop-shadow-md select-none">
      <!-- Fej és tarkó (semleges) -->
      <path d="M100 20 C88 20 82 32 82 46 C82 62 90 74 100 74 C110 74 118 62 118 46 C118 32 112 20 100 20 Z" fill="#1f242d" stroke="#374151" stroke-width="1.5" />

      <!-- Trapézizom / Csuklya (Trapezius) -->
      <path id="svg-m-traps" data-muscle="traps" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M93 74 L84 94 L75 110 L100 148 L125 110 L116 94 L107 74 Z"
            fill="${c('traps')}" stroke="#111827" stroke-width="1.5" />

      <!-- Hátsó Váll (Posterior Deltoids) -->
      <path id="svg-m-shoulders-bl" data-muscle="shoulders" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M74 110 C65 112 59 122 58 135 C59 144 65 145 68 138 C72 128 73 118 74 110 Z"
            fill="${c('shoulders')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-shoulders-br" data-muscle="shoulders" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M126 110 C135 112 141 122 142 135 C141 144 135 145 132 138 C128 128 127 118 126 110 Z"
            fill="${c('shoulders')}" stroke="#111827" stroke-width="1.5" />

      <!-- Tricepsz (Bal & Jobb Hátulnézet) -->
      <path id="svg-m-triceps-l" data-muscle="triceps" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M58 136 C54 148 54 165 59 176 C64 174 68 168 69 155 C70 144 67 138 58 136 Z"
            fill="${c('triceps')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-triceps-r" data-muscle="triceps" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M142 136 C146 148 146 165 141 176 C136 174 132 168 131 155 C130 144 133 138 142 136 Z"
            fill="${c('triceps')}" stroke="#111827" stroke-width="1.5" />

      <!-- Hátulsó alkar (Bal & Jobb) -->
      <path id="svg-m-forearms-bl" data-muscle="forearms" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M58 178 C51 195 45 215 44 235 C49 237 54 234 57 222 C61 206 63 192 63 178 Z"
            fill="${c('forearms')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-forearms-br" data-muscle="forearms" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M142 178 C149 195 155 215 156 235 C151 237 146 234 143 222 C139 206 137 192 137 178 Z"
            fill="${c('forearms')}" stroke="#111827" stroke-width="1.5" />

      <!-- Kézfejek (semleges) -->
      <path d="M44 236 C42 245 40 255 45 260 C48 260 52 254 53 245 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <path d="M156 236 C158 245 160 255 155 260 C152 260 148 254 147 245 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />

      <!-- Széles hátizom (Lats Bal & Jobb) -->
      <path id="svg-m-lats-l" data-muscle="lats" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M74 125 C68 145 68 165 74 185 L90 185 L98 150 Z"
            fill="${c('lats')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-lats-r" data-muscle="lats" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M126 125 C132 145 132 165 126 185 L110 185 L102 150 Z"
            fill="${c('lats')}" stroke="#111827" stroke-width="1.5" />

      <!-- Alsó hát / Derék (Lower back) -->
      <path id="svg-m-lower-back" data-muscle="lower_back" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M86 185 L114 185 L110 206 L90 206 Z"
            fill="${c('lower_back')}" stroke="#111827" stroke-width="1.5" />

      <!-- Farizom (Gluteus Maximus Bal & Jobb) -->
      <path id="svg-m-glutes-l" data-muscle="glutes" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M74 206 C66 220 66 245 74 256 C84 258 96 250 98 235 L98 206 Z"
            fill="${c('glutes')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-glutes-r" data-muscle="glutes" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M126 206 C134 220 134 245 126 256 C116 258 104 250 102 235 L102 206 Z"
            fill="${c('glutes')}" stroke="#111827" stroke-width="1.5" />

      <!-- Combhajlító (Hamstrings Bal & Jobb) -->
      <path id="svg-m-hamstrings-l" data-muscle="hamstrings" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M74 258 C68 275 68 295 74 308 L88 308 C94 295 96 275 96 258 Z"
            fill="${c('hamstrings')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-hamstrings-r" data-muscle="hamstrings" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M126 258 C132 275 132 295 126 308 L112 308 C106 295 104 275 104 258 Z"
            fill="${c('hamstrings')}" stroke="#111827" stroke-width="1.5" />

      <!-- Térdhajlat (semleges) -->
      <circle cx="81" cy="312" r="5" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <circle cx="119" cy="312" r="5" fill="#1f242d" stroke="#374151" stroke-width="1" />

      <!-- Hátulsó Vádli (Calves Back Bal & Jobb) -->
      <path id="svg-m-calves-bl" data-muscle="calves" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M74 316 C66 335 66 360 74 385 L84 385 C87 360 88 335 86 316 Z"
            fill="${c('calves')}" stroke="#111827" stroke-width="1.5" />
      <path id="svg-m-calves-br" data-muscle="calves" class="muscle-svg-item cursor-pointer transition-all duration-300 hover:brightness-125"
            d="M126 316 C134 335 134 360 126 385 L116 385 C113 360 112 335 114 316 Z"
            fill="${c('calves')}" stroke="#111827" stroke-width="1.5" />

      <!-- Sarok & Achilles (semleges) -->
      <path d="M72 387 L68 405 L84 405 L84 387 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
      <path d="M128 387 L132 405 L116 405 L116 387 Z" fill="#1f242d" stroke="#374151" stroke-width="1" />
    </svg>
  `;
}

// ── UI és Eseménykezelők renderelése ──────────────────────
function _renderBodyMap() {
  const frontContainer = $('bodymap-front-svg-wrap');
  const backContainer  = $('bodymap-back-svg-wrap');
  if (frontContainer) frontContainer.innerHTML = _generateFrontSvg();
  if (backContainer)  backContainer.innerHTML  = _generateBackSvg();

  _renderSummaryStats();
  _renderDetailCard(_selectedMuscleId);
  _renderMuscleList();

  // SVG kattintás eseménykezelők bekötése mindkét diagramra
  document.querySelectorAll('.muscle-svg-item').forEach(el => {
    el.addEventListener('click', () => {
      const muscleId = el.dataset.muscle;
      if (muscleId && MUSCLE_GROUPS[muscleId]) {
        _selectedMuscleId = muscleId;
        _renderDetailCard(muscleId);
        _highlightMuscle(muscleId);
      }
    });
  });
}

function _highlightMuscle(muscleId) {
  document.querySelectorAll('.muscle-svg-item').forEach(el => {
    if (el.dataset.muscle === muscleId) {
      el.style.stroke = '#00E5FF';
      el.style.strokeWidth = '2.5';
    } else {
      el.style.stroke = '#111827';
      el.style.strokeWidth = '1.5';
    }
  });
}

function _renderSummaryStats() {
  const loadedCountEl = $('bodymap-stat-loaded-count');
  const avgLoadEl     = $('bodymap-stat-avg-load');
  const freshCountEl  = $('bodymap-stat-fresh-count');

  const scores = Object.values(_muscleScores).map(s => s.val || 0);
  const total = scores.length || 1;
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / total);
  const loaded = scores.filter(s => s >= 30).length;
  const fresh  = scores.filter(s => s < 20).length;

  if (loadedCountEl) loadedCountEl.textContent = `${loaded} izomcsoport`;
  if (avgLoadEl)     avgLoadEl.textContent = `${avg}%`;
  if (freshCountEl)  freshCountEl.textContent = `${fresh} izomcsoport`;
}

function _renderDetailCard(muscleId) {
  const card = $('bodymap-detail-card');
  if (!card) return;

  const def = MUSCLE_GROUPS[muscleId] || MUSCLE_GROUPS.quads;
  const data = _muscleScores[muscleId] || { val: 0, loadedBy: [], relievedBy: [] };
  const status = _getStatusLabel(data.val);

  card.innerHTML = `
    <div class="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-[#22242C] pb-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" style="background-color: ${_getMuscleColor(data.val)}"></span>
          <h3 class="text-base font-extrabold text-gray-900 dark:text-white">${def.name}</h3>
        </div>
        <p class="text-xs text-gray-400 italic">${def.latin}</p>
      </div>
      <div class="text-right">
        <span class="text-2xl font-black tabular-nums text-gray-900 dark:text-white">${data.val}%</span>
        <p class="text-[10px] text-gray-400 uppercase tracking-wider">Terheltségi szint</p>
      </div>
    </div>

    <!-- Státusz Badge -->
    <div class="mb-4">
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${status.color}">
        <i class="fa-solid fa-gauge-high text-[11px]"></i>
        <span>${status.text}</span>
      </span>
    </div>

    <!-- Terhelő edzések listája -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#181A20] border border-gray-100 dark:border-[#252832]">
        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <i class="fa-solid fa-fire text-orange-500"></i>
          <span>Legutóbbi terhelés (Edzések)</span>
        </p>
        ${data.loadedBy.length === 0 ? `
          <p class="text-xs text-gray-400 italic">Nincs rögzített megterhelés az elmúlt 72 órában.</p>
        ` : `
          <ul class="space-y-1">
            ${data.loadedBy.map(h => `
              <li class="text-xs text-gray-800 dark:text-gray-200 flex items-center justify-between">
                <span class="truncate font-semibold">• ${h.name}</span>
                <span class="text-[10px] text-gray-400 flex-shrink-0">${h.time}</span>
              </li>
            `).join('')}
          </ul>
        `}
      </div>

      <!-- Regenerációs szeánszok -->
      <div class="p-3 rounded-2xl bg-gray-50 dark:bg-[#181A20] border border-gray-100 dark:border-[#252832]">
        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <i class="fa-solid fa-spa text-emerald-400"></i>
          <span>Regeneráció &amp; Lazítás</span>
        </p>
        ${data.relievedBy.length === 0 ? `
          <p class="text-xs text-gray-400 italic">Még nem végeztél rá nyújtást vagy SMR hengerlést.</p>
        ` : `
          <ul class="space-y-1">
            ${data.relievedBy.map(h => `
              <li class="text-xs text-gray-800 dark:text-gray-200 flex items-center justify-between">
                <span class="truncate font-semibold text-emerald-600 dark:text-emerald-400">✓ ${h.name}</span>
                <span class="text-[10px] text-gray-400 flex-shrink-0">${h.time}</span>
              </li>
            `).join('')}
          </ul>
        `}
      </div>
    </div>

    <!-- Javasolt regenerációs protokoll -->
    <div class="p-3.5 rounded-2xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/40 flex items-center justify-between">
      <div class="min-w-0 pr-3">
        <p class="text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">Ajánlott protokoll</p>
        <p class="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">${def.defaultRelief}</p>
      </div>
      <button type="button" id="bodymap-quick-relief-btn" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs flex-shrink-0 active:scale-95 transition-all shadow-sm flex items-center gap-1.5"
              data-muscle="${def.id}" data-name="${def.name}">
        <i class="fa-solid fa-spa text-xs"></i>
        <span>Regeneráció</span>
      </button>
    </div>
  `;

  const reliefBtn = $('bodymap-quick-relief-btn');
  if (reliefBtn) {
    reliefBtn.addEventListener('click', () => {
      if (window.openProtocolsModal) {
        window.openProtocolsModal();
      }
    });
  }
}

function _renderMuscleList() {
  const container = $('bodymap-muscles-list');
  if (!container) return;

  const sorted = Object.entries(MUSCLE_GROUPS).map(([id, def]) => ({
    id,
    ...def,
    score: _muscleScores[id]?.val || 0
  })).sort((a, b) => b.score - a.score);

  container.innerHTML = sorted.map(m => `
    <div class="muscle-list-row p-3 rounded-2xl bg-gray-50 dark:bg-[#141519] border border-gray-100 dark:border-[#22242C] hover:border-[#00E5FF]/40 cursor-pointer transition-all flex items-center justify-between ${m.id === _selectedMuscleId ? 'border-[#00E5FF] dark:border-[#00E5FF]' : ''}"
         data-id="${m.id}">
      <div class="flex items-center gap-3 min-w-0 flex-1 pr-3">
        <span class="w-3.5 h-3.5 rounded-full flex-shrink-0" style="background-color: ${_getMuscleColor(m.score)}"></span>
        <div class="min-w-0">
          <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${m.name}</p>
          <p class="text-[10px] text-gray-400 truncate">${m.latin}</p>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <!-- Progress bar -->
        <div class="w-20 bg-gray-200 dark:bg-[#252832] h-2 rounded-full overflow-hidden hidden sm:block">
          <div class="h-full rounded-full transition-all duration-500" style="width: ${m.score}%; background-color: ${_getMuscleColor(m.score)}"></div>
        </div>
        <span class="text-xs font-black tabular-nums w-10 text-right ${m.score >= 50 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}">${m.score}%</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.muscle-list-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      if (id) {
        _selectedMuscleId = id;
        _renderDetailCard(id);
        _highlightMuscle(id);
        _renderMuscleList();
      }
    });
  });
}

function _bindBodyMapEvents() {
  const filterAll = $('bodymap-filter-all');
  const filterLoaded = $('bodymap-filter-loaded');

  if (filterAll) {
    filterAll.addEventListener('click', () => {
      filterAll.className = 'px-3.5 py-1.5 rounded-xl font-bold text-xs bg-rose-600 text-white shadow-sm transition-all';
      if (filterLoaded) filterLoaded.className = 'px-3.5 py-1.5 rounded-xl font-bold text-xs text-gray-400 hover:text-white transition-all';
      _renderBodyMap();
    });
  }

  if (filterLoaded) {
    filterLoaded.addEventListener('click', () => {
      filterLoaded.className = 'px-3.5 py-1.5 rounded-xl font-bold text-xs bg-rose-600 text-white shadow-sm transition-all';
      if (filterAll) filterAll.className = 'px-3.5 py-1.5 rounded-xl font-bold text-xs text-gray-400 hover:text-white transition-all';
      // Csak terheltekre fókuszál
      const topLoaded = Object.entries(_muscleScores).sort((a, b) => b[1].val - a[1].val)[0];
      if (topLoaded) {
        _selectedMuscleId = topLoaded[0];
        _renderDetailCard(_selectedMuscleId);
        _highlightMuscle(_selectedMuscleId);
      }
    });
  }
}

export function renderBodyMap() {
  _recalculateMuscleHeat();
  _renderBodyMap();
}
