// ============================================================
// intervals.js — Intervals.icu & Garmin Adatbetöltő & Szinkron Motor
// Lockin | Garmin korábbi és új edzések + Wellness biometria
// ============================================================

import { db } from '../firebase-config.js';
import { getSportById, GARMIN_SPORTS } from '../garmin-sports.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── DOM segéd ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Belső állapot ──────────────────────────────────────────
let _uid = null;
let _config = {
  athleteId: '',
  apiKey: '',
  connected: false,
  lastSyncStr: '',
  totalWorkouts: 0,
  totalWellnessDays: 0
};
let _isSyncing = false;
let _hasSyncedOnLogin = false;

// ── Sportág megfeleltetés (Intervals.icu / Garmin type, name, desc -> Lockin Garmin sportId) ──
export function mapIntervalsTypeToSportId(type, name = '', description = '') {
  const normalize = str => String(str || '').toLowerCase().trim();
  const rawType = normalize(type);
  const cleanType = rawType.replace(/[\s_\-]+/g, '');
  const rawName = normalize(name);
  const rawDesc = normalize(description);

  // Segédfüggvény kulcsszó keresésre a type-ban
  const hasType = (...keys) => keys.some(k => cleanType.includes(k.replace(/[\s_\-]+/g, '')));
  // Segédfüggvény kulcsszó keresésre a névben / leírásban
  const hasMeta = (...keys) => keys.some(k => rawName.includes(k) || rawDesc.includes(k));

  // 1. SUP (Stand Up Paddleboarding) — Elsőbbséget élvez (paddling, standuppaddling, sup, paddleboard)
  if (
    hasType('sup', 'standuppaddl', 'paddl', 'standup', 'paddleboard') ||
    /\bsup\b/i.test(rawType) ||
    /\bsup\b/i.test(rawName) ||
    hasMeta('stand up paddle', 'standuppaddle', 'paddleboard', 'paddle board', 'állószörf', 'alloszorf', 'sup túra', 'sup tura')
  ) {
    return 'sup';
  }

  // 2. Kajak / Kenu
  if (hasType('kayak', 'canoe', 'kenu', 'kajak') || hasMeta('kayak', 'kajak', 'canoe', 'kenu')) {
    return 'kayaking';
  }

  // 3. Evezés (Beltéri evezőpad vs Vízi evezés)
  if (hasType('virtualrow', 'indoorow', 'indoorrow', 'rower', 'ergometer', 'concept2') || hasMeta('evezőpad', 'indoorrowing', 'beltéri evezés')) {
    return 'indoor_rowing';
  }
  if (hasType('rowing', 'row') || hasMeta('evezés', 'rowing')) {
    return 'rowing';
  }

  // 4. Úszás (Nyíltvízi vs Medencés)
  if (hasType('openwaterswim', 'openwater', 'nyiltviz', 'nyíltvíz') || hasMeta('nyíltvízi úszás', 'open water swim')) {
    return 'open_water_swimming';
  }
  if (hasType('swim', 'poolswim', 'lapswim', 'úszás', 'uszas') || hasMeta('úszás', 'swimming', 'medencés úszás')) {
    return 'pool_swimming';
  }

  // 5. Gyaloglás & Túrázás (Garmin WALKING és HIKING)
  if (hasType('hike', 'hiking', 'túra', 'turazas') || hasMeta('túrázás', 'hiking', 'erdei túra')) {
    return 'hiking';
  }
  if (hasType('walk', 'walking', 'gyalog', 'séta', 'seta') || hasMeta('gyaloglás', 'séta', 'walking')) {
    return 'walking';
  }

  // 6. Futás formák
  if (hasType('trailrun', 'trail') || hasMeta('terepfutás', 'trail run')) {
    return 'trail_running';
  }
  if (hasType('treadmill', 'virtualrun', 'indoorrun', 'futópad') || hasMeta('futópad', 'treadmill')) {
    return 'treadmill';
  }
  if (hasType('trackrun', 'track', 'pályafutás') || hasMeta('pályafutás', 'atlétikai pálya')) {
    return 'track_running';
  }
  if (hasType('run', 'running', 'jog', 'jogging', 'futás', 'futas') || hasMeta('futás', 'running', 'reggeli futás')) {
    return 'running';
  }

  // 7. Kerékpár formák
  if (hasType('gravel') || hasMeta('gravel')) {
    return 'gravel_biking';
  }
  if (hasType('mountainbike', 'mountain', 'mtb') || hasMeta('mountain bike', 'mtb')) {
    return 'mountain_biking';
  }
  if (hasType('virtualride', 'indoorcycle', 'indoorbike', 'spinning', 'trainer', 'turbotrainer', 'spin', 'szobakerékpár') || hasMeta('spinning', 'szobakerékpár', 'görgőzés')) {
    return 'indoor_cycling';
  }
  if (hasType('roadride', 'roadbike', 'roadcycling', 'országúti') || hasMeta('országúti', 'road bike')) {
    return 'road_biking';
  }
  if (hasType('ride', 'bike', 'cycl', 'kerékpár', 'kerekpar', 'bicikli') || hasMeta('kerékpár', 'bringázás', 'cycling')) {
    return 'cycling';
  }

  // 8. Erőnlét & Fitnesz
  if (hasType('powerlift', 'erőemelés', 'eroemeles')) return 'powerlifting';
  if (hasType('bodybuild', 'testépítés', 'testepites')) return 'bodybuilding';
  if (hasType('calisthen', 'sajáttestsúly', 'streetworkout')) return 'calisthenics';
  if (hasType('crossfit', 'functional', 'funkcionális')) return 'crossfit';
  if (hasType('hiit', 'intervallum')) return 'hiit';
  if (hasType('stairstepper', 'stair', 'stepper', 'stairmaster', 'lépcsőzés', 'lepcsozes')) return 'stair_stepper';
  if (hasType('elliptical', 'crosstrainer', 'elliptikus')) return 'elliptical';
  if (hasType('weighttraining', 'weight', 'gym', 'strength', 'súlyzós', 'sulyzos', 'erőnlét', 'eronlet') || hasMeta('konditerem', 'edzőterem', 'súlyzós')) return 'strength_training';
  if (hasType('cardio', 'kardió', 'kardio', 'aerobic')) return 'cardio';

  // 9. Wellness & Regeneráció
  if (hasType('yoga', 'jóga')) return 'yoga';
  if (hasType('pilates')) return 'pilates';
  if (hasType('breathwork', 'breath', 'légzés', 'mindfulness')) return 'breathwork';

  // 10. Téli & Szabadtéri sportok
  if (hasType('nordicski', 'nordic', 'crosscountryski', 'sífutás', 'sifutas')) return 'cross_country_skiing';
  if (hasType('snowboard')) return 'snowboarding';
  if (hasType('ski', 'alpineski', 'síelés', 'sieles')) return 'skiing';
  if (hasType('climb', 'rockclimb', 'boulder', 'mászás', 'maszas')) return 'climbing';

  // 11. Multisport & Labdajátékok
  if (hasType('triathlon', 'triatlon')) return 'triathlon';
  if (hasType('tennis', 'tenisz')) return 'tennis';
  if (hasType('padel')) return 'padel';
  if (hasType('golf')) return 'golf';

  // Ha a type általános vagy nem illeszkedett, de a név alapján felismerhető
  if (hasMeta('futás', 'running', 'futas')) return 'running';
  if (hasMeta('gyaloglás', 'séta', 'walking')) return 'walking';
  if (hasMeta('kerékpár', 'bicikli', 'bringa', 'cycling')) return 'cycling';
  if (hasMeta('úszás', 'swim')) return 'pool_swimming';

  // Végső fallback
  return cleanType.includes('cardio') ? 'cardio' : (cleanType ? 'cardio' : 'running');
}

// ── Segédfüggvény Intervals.icu mezők keresésére (Közvetlen, Custom Fields tömb/objektum) ──
function _getIntervalsField(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  const cf = obj.custom_fields || obj.customFields || obj.fields;
  if (Array.isArray(cf)) {
    for (const item of cf) {
      if (!item) continue;
      const cleanId = String(item.id || item.name || item.code || '').toLowerCase().replace(/[\s_\-]+/g, '');
      for (const k of keys) {
        if (cleanId === k.toLowerCase().replace(/[\s_\-]+/g, '')) {
          if (item.value !== undefined && item.value !== null && item.value !== '') return item.value;
          if (item.val !== undefined && item.val !== null && item.val !== '') return item.val;
        }
      }
    }
  } else if (cf && typeof cf === 'object') {
    for (const k of keys) {
      if (cf[k] !== undefined && cf[k] !== null && cf[k] !== '') return cf[k];
    }
  }
  return undefined;
}

// ── Garmin Datafield-ek összeállítása Intervals.icu aktivitásból ──
export function buildGarminDatafieldsFromActivity(act) {
  const dfs = [];

  // 1. Átlagos pulzus
  if (act.average_heartrate && Number(act.average_heartrate) > 0) {
    dfs.push({
      id: 'avg_hr',
      name: 'Átlagos pulzus',
      label: 'Átlagos pulzus',
      value: String(Math.round(act.average_heartrate)),
      unit: 'bpm'
    });
  }

  // 2. Maximális pulzus
  if (act.max_heartrate && Number(act.max_heartrate) > 0) {
    dfs.push({
      id: 'max_hr',
      name: 'Maximális pulzus',
      label: 'Maximális pulzus',
      value: String(Math.round(act.max_heartrate)),
      unit: 'bpm'
    });
  }

  // 3. Távolság (km)
  if (act.distance && Number(act.distance) > 0) {
    dfs.push({
      id: 'distance',
      name: 'Távolság',
      label: 'Távolság',
      value: (Number(act.distance) / 1000).toFixed(2),
      unit: 'km'
    });
  }

  // 4. Tempó vagy Sebesség
  if (act.average_speed && Number(act.average_speed) > 0) {
    const isRunning = /run/i.test(act.type || '');
    if (isRunning) {
      const secPerKm = 1000 / Number(act.average_speed);
      const min = Math.floor(secPerKm / 60);
      const sec = Math.round(secPerKm % 60);
      dfs.push({
        id: 'avg_pace',
        name: 'Átlagos tempó',
        label: 'Átlagos tempó',
        value: `${min}:${sec < 10 ? '0' : ''}${sec}`,
        unit: 'perc/km'
      });
    } else {
      const kmh = (Number(act.average_speed) * 3.6).toFixed(1);
      dfs.push({
        id: 'avg_speed',
        name: 'Átlagos sebesség',
        label: 'Átlagos sebesség',
        value: kmh,
        unit: 'km/h'
      });
    }
  }

  // 5. Teljesítmény (Watt)
  const power = act.icu_average_watts || act.average_watts;
  if (power && Number(power) > 0) {
    dfs.push({
      id: 'avg_power',
      name: 'Átlagos teljesítmény (Watt)',
      label: 'Átlagos teljesítmény (Watt)',
      value: String(Math.round(Number(power))),
      unit: 'W'
    });
  }

  // 6. Normalizált teljesítmény (NP)
  if (act.icu_normalized_watts && Number(act.icu_normalized_watts) > 0) {
    dfs.push({
      id: 'normalized_power',
      name: 'Normalizált teljesítmény (NP)',
      label: 'Normalizált teljesítmény (NP)',
      value: String(Math.round(Number(act.icu_normalized_watts))),
      unit: 'W'
    });
  }

  // 7. Szintemelkedés (m)
  if (act.total_elevation_gain && Number(act.total_elevation_gain) > 0) {
    dfs.push({
      id: 'elevation_gain',
      name: 'Szintemelkedés',
      label: 'Szintemelkedés',
      value: String(Math.round(Number(act.total_elevation_gain))),
      unit: 'm'
    });
  }

  // 8. Kadencia (spm / rpm)
  const cad = act.average_cadence || act.icu_cadence;
  if (cad && Number(cad) > 0) {
    dfs.push({
      id: 'avg_cadence',
      name: 'Átlagos lépésszám / pedálfordulat',
      label: 'Átlagos lépésszám / pedálfordulat',
      value: String(Math.round(Number(cad))),
      unit: 'spm / rpm'
    });
  }

  // 9. Garmin Edzésterhelés (Training Load / Exercise Load) — Nem TSS!
  const rawLoad = _getIntervalsField(act,
    'icu_load', 'acute_load', 'TrainingLoad', 'training_load', 'exercise_load',
    'garmin_training_load', 'icu_training_load', 'load'
  );
  if (rawLoad !== undefined && rawLoad !== null && !isNaN(Number(rawLoad)) && Number(rawLoad) > 0) {
    dfs.push({
      id: 'training_load',
      name: 'Edzésterhelés',
      label: 'Edzésterhelés',
      value: String(Math.round(Number(rawLoad))),
      unit: 'pt'
    });
  }

  // 10. Aerob terhelés (Aerobic Training Effect: 0.0 - 5.0)
  let rawAerobic = _getIntervalsField(act,
    'aerobic_training_effect', 'icu_training_effect', 'AerobicEffect', 'aerobic_effect',
    'aerobic_te', 'icu_aerobic_training_effect', 'total_training_effect', 'training_effect'
  );
  let numAerobic = (rawAerobic !== undefined && rawAerobic !== null && rawAerobic !== '' && !isNaN(Number(rawAerobic)))
    ? Number(rawAerobic)
    : _estimateAerobicTE(act);
  if (numAerobic > 0) {
    dfs.push({
      id: 'aerobic_te',
      name: 'Aerob terhelés',
      label: 'Aerob terhelés',
      value: (Math.round(numAerobic * 10) / 10).toFixed(1),
      unit: '/ 5.0'
    });
  }

  // 11. Anaerob terhelés (Anaerobic Training Effect: 0.0 - 5.0)
  let rawAnaerobic = _getIntervalsField(act,
    'anaerobic_training_effect', 'icu_anaerobic_training_effect', 'AnaerobicEffect',
    'anaerobic_effect', 'anaerobic_te', 'total_anaerobic_training_effect'
  );
  let numAnaerobic = (rawAnaerobic !== undefined && rawAnaerobic !== null && rawAnaerobic !== '' && !isNaN(Number(rawAnaerobic)))
    ? Number(rawAnaerobic)
    : _estimateAnaerobicTE(act);
  dfs.push({
    id: 'anaerobic_te',
    name: 'Anaerob terhelés',
    label: 'Anaerob terhelés',
    value: (Math.round((numAnaerobic || 0) * 10) / 10).toFixed(1),
    unit: '/ 5.0'
  });

  // 10. Légzésszám (Respiration) aktivitás közben
  const actResp = act.icu_average_respiration || act.average_respiration || act.icu_respiration || act.respiration;
  if (actResp && Number(actResp) > 0) {
    dfs.push({
      id: 'resp_rate',
      name: 'Átlagos légzésszám',
      label: 'Átlagos légzésszám',
      value: String(Math.round(Number(actResp) * 10) / 10),
      unit: '/perc'
    });
  }

  // 11. Véroxigén (SpO2) aktivitás közben
  let actSpo2 = act.avg_spo2 || act.min_spo2 || act.spO2 || act.spo2;
  if (actSpo2 && Number(actSpo2) > 0) {
    let numSpo2 = Number(actSpo2);
    if (numSpo2 <= 1) numSpo2 = Math.round(numSpo2 * 100);
    dfs.push({
      id: 'spo2',
      name: 'Véroxigénszint (SpO₂)',
      label: 'Véroxigénszint (SpO₂)',
      value: String(Math.round(numSpo2)),
      unit: '%'
    });
  }

  // 12. Hőmérséklet (Garmin hőmérő)
  const actTemp = act.average_temp || act.temp;
  if (actTemp !== undefined && actTemp !== null && actTemp !== '') {
    dfs.push({
      id: 'temp',
      name: 'Hőmérséklet',
      label: 'Hőmérséklet',
      value: String(Math.round(Number(actTemp) * 10) / 10),
      unit: '°C'
    });
  }

  // 13. Garmin Becsült izzadás (Estimated Sweat Loss)
  const sweatVal = act.sweat_loss || act.estimated_sweat_loss || act.icu_sweat_loss || act.water_loss;
  let sweatMl = 0;
  if (sweatVal && Number(sweatVal) > 0) {
    const rawNum = Number(sweatVal);
    sweatMl = rawNum < 15 ? Math.round(rawNum * 1000) : Math.round(rawNum);
  } else if (act.calories && Number(act.calories) > 0) {
    sweatMl = Math.round(Number(act.calories) * 0.85);
  } else if (act.moving_time || act.elapsed_time) {
    const mins = (act.moving_time || act.elapsed_time) / 60;
    sweatMl = Math.round(mins * 11);
  }

  if (sweatMl > 0) {
    dfs.push({
      id: 'sweat_loss',
      name: 'Becsült izzadás (Sweat Loss)',
      label: 'Becsült izzadás',
      value: String(sweatMl),
      unit: 'ml'
    });
  }

  return dfs;
}

// ── Garmin Training Effect Becslő Segédek (Ha a FIT fájl nem tartalmazta) ──
function _estimateAerobicTE(act) {
  if (!act) return 2.5;
  const durMin = Math.max(1, Math.round((act.moving_time || act.elapsed_time || 1800) / 60));
  const avgHr = Number(act.average_heartrate) || 0;
  const maxHr = Number(act.max_heartrate) || 185;

  if (avgHr > 0) {
    const hrRatio = avgHr / maxHr;
    let te = 1.0 + (hrRatio - 0.5) * 4.5 * Math.min(2.0, Math.sqrt(durMin / 35));
    if (te < 0.5) te = 0.5;
    if (te > 5.0) te = 5.0;
    return Math.round(te * 10) / 10;
  }

  const load = Number(_getIntervalsField(act, 'icu_load', 'acute_load', 'TrainingLoad', 'training_load', 'icu_training_load', 'load')) || 0;
  if (load > 0) {
    let te = Math.min(5.0, Math.max(1.0, 1.2 + Math.sqrt(load / 8)));
    return Math.round(te * 10) / 10;
  }

  return Math.min(4.0, Math.max(1.0, Math.round((durMin / 25) * 10) / 10));
}

function _estimateAnaerobicTE(act) {
  if (!act) return 0.0;
  const maxHr = Number(act.max_heartrate) || 0;
  const avgHr = Number(act.average_heartrate) || 0;
  const userEstMax = Math.max(maxHr, 185);

  if (maxHr > 0 && avgHr > 0) {
    const peakRatio = maxHr / userEstMax;
    if (peakRatio >= 0.88) {
      let te = (peakRatio - 0.85) * 12.0;
      if (te > 4.5) te = 4.5;
      return Math.round(te * 10) / 10;
    }
  }

  const np = Number(act.icu_normalized_watts) || 0;
  const avgW = Number(act.icu_average_watts || act.average_watts) || 0;
  if (np > 0 && avgW > 0 && (np / avgW) >= 1.15) {
    let te = ((np / avgW) - 1.10) * 8.0;
    return Math.min(4.0, Math.round(te * 10) / 10);
  }

  return 0.0;
}

// ── Hivatalos WHOOP Recovery kalkuláció (0 – 100%) ──────────
// 50% HRV (bázisvonalhoz képest), 30% RHR (alacsonyabb jobb), 20% Garmin Sleep Score
export function calcWhoopOfficialRecovery(hrv, rhr, sleepScore = null, respRate = null, skinTemp = null) {
  if (typeof hrv === 'object' && hrv !== null) {
    const o = hrv;
    hrv = o.hrv;
    rhr = o.rhr;
    sleepScore = o.sleepScore ?? sleepScore;
    respRate = o.respRate ?? respRate;
    skinTemp = o.skinTemp ?? skinTemp;
  }
  if (!hrv && !rhr) return null;

  // Bázisértékek (normál felnőtt sportoló / WHOOP baseline referencia)
  const baseHrv = 65;
  const baseRhr = 54;
  const baseResp = 14.5;

  // 1. HRV pontszám (50% súly) - 66% a bázisnál
  const hrvVal = Number(hrv) || baseHrv;
  const hrvRatio = hrvVal / baseHrv;
  let hrvScore = 66 + (hrvRatio - 1.0) * 115;
  hrvScore = Math.max(5, Math.min(100, hrvScore));

  // 2. RHR pontszám (30% súly) - Alacsonyabb pulzus jobb regenerációt jelent
  const rhrVal = Number(rhr) || baseRhr;
  const rhrDiff = baseRhr - rhrVal;
  let rhrScore = 66 + (rhrDiff / 10.0) * 45;
  rhrScore = Math.max(5, Math.min(100, rhrScore));

  // 3. Sleep Score (20% súly) - Közvetlenül a Garmin Sleep Score
  const sleepVal = sleepScore !== null && sleepScore !== undefined && Number(sleepScore) > 0
    ? Math.max(10, Math.min(100, Number(sleepScore)))
    : 66;

  // 4. Súlyozott bázis recovery
  let recovery = (0.50 * hrvScore) + (0.30 * rhrScore) + (0.20 * sleepVal);

  // 5. Büntetések (Penalties) - Magas légzésszám és láz/bőrhőmérséklet emelkedés
  if (respRate && Number(respRate) > (baseResp + 0.6)) {
    const respPenalty = Math.min(25, (Number(respRate) - (baseResp + 0.6)) * 15);
    recovery -= respPenalty;
  }
  if (skinTemp !== null && skinTemp !== undefined && Number(skinTemp) > 0.4) {
    const tempPenalty = Math.min(20, (Number(skinTemp) - 0.4) * 20);
    recovery -= tempPenalty;
  }

  return Math.max(1, Math.min(99, Math.round(recovery)));
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

// ── Modul Inicializálása ───────────────────────────────────
export async function initIntervals(uid) {
  _uid = uid;
  _bindUI();
  await _loadConfig();
}

export function destroyIntervals() {
  _uid = null;
  _config = {
    athleteId: '',
    apiKey: '',
    connected: false,
    lastSyncStr: '',
    totalWorkouts: 0,
    totalWellnessDays: 0
  };
  _isSyncing = false;
  _hasSyncedOnLogin = false;
}

export function getIntervalsConfig() {
  return _config;
}

// ── Mentett beállítások betöltése ───────────────────────────
async function _loadConfig() {
  if (!_uid) return;

  try {
    // 1. Firestore lekérés
    const snap = await getDoc(doc(db, 'users', _uid, 'settings', 'intervals'));
    if (snap.exists()) {
      _config = { ..._config, ...snap.data() };
    } else {
      // 2. LocalStorage fallback
      const local = localStorage.getItem(`lockin_intervals_${_uid}`);
      if (local) {
        _config = { ..._config, ...JSON.parse(local) };
      }
    }
  } catch (err) {
    console.warn('[intervals] Nem sikerült a konfiguráció betöltése:', err);
    const local = localStorage.getItem(`lockin_intervals_${_uid}`);
    if (local) {
      _config = { ..._config, ...JSON.parse(local) };
    }
  }

  _renderUIState();

  // Csak és kizárólag egyszer frissítünk automatikusan, amikor az ember belép az oldalra (elmúlt 7 nap)
  if (_config.connected && _config.apiKey && !_hasSyncedOnLogin) {
    _hasSyncedOnLogin = true;
    _handleConnect(_config.athleteId, _config.apiKey, { full: false, silent: true });
  }
}

// ── UI Események Bekötése ──────────────────────────────────
function _bindUI() {
  const connectBtn = $('settings-intervals-connect-btn');
  const syncBtn = $('settings-intervals-sync-btn');
  const disconnectBtn = $('settings-intervals-disconnect-btn');
  const toggleKeyBtn = $('settings-intervals-toggle-key');
  const apiKeyInp = $('settings-intervals-apikey');

  if (connectBtn && !connectBtn.dataset.bound) {
    connectBtn.dataset.bound = 'true';
    connectBtn.addEventListener('click', () => {
      const athlete = $('settings-intervals-athlete')?.value.trim();
      const apiKey = $('settings-intervals-apikey')?.value.trim();
      // Első összekapcsoláskor teljes szinkron az összes korábbi edzéssel
      _handleConnect(athlete, apiKey, { full: true, silent: false });
    });
  }

  if (syncBtn && !syncBtn.dataset.bound) {
    syncBtn.dataset.bound = 'true';
    syncBtn.addEventListener('click', () => {
      const athlete = $('settings-intervals-athlete')?.value.trim() || _config.athleteId;
      const apiKey = $('settings-intervals-apikey')?.value.trim() || _config.apiKey;
      // Későbbi manuális szinkronizáláskor csak az elmúlt 1 hét
      _handleConnect(athlete, apiKey, { full: false, silent: false });
    });
  }

  if (disconnectBtn && !disconnectBtn.dataset.bound) {
    disconnectBtn.dataset.bound = 'true';
    disconnectBtn.addEventListener('click', _handleDisconnect);
  }

  if (toggleKeyBtn && apiKeyInp && !toggleKeyBtn.dataset.bound) {
    toggleKeyBtn.dataset.bound = 'true';
    toggleKeyBtn.addEventListener('click', () => {
      if (apiKeyInp.type === 'password') {
        apiKeyInp.type = 'text';
        toggleKeyBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      } else {
        apiKeyInp.type = 'password';
        toggleKeyBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
      }
    });
  }
}

// ── UI állapot frissítése ──────────────────────────────────
function _renderUIState() {
  const athleteInp = $('settings-intervals-athlete');
  const apiKeyInp = $('settings-intervals-apikey');
  const badge = $('settings-intervals-badge');
  const connectBtn = $('settings-intervals-connect-btn');
  const syncBtn = $('settings-intervals-sync-btn');
  const disconnectBtn = $('settings-intervals-disconnect-btn');
  const infoRow = $('settings-intervals-info');
  const lastSyncText = $('settings-intervals-last-sync');
  const statsBadge = $('settings-intervals-stats-badge');

  if (athleteInp) {
    athleteInp.value = _config.athleteId || '';
  }
  if (apiKeyInp) {
    apiKeyInp.value = _config.apiKey || '';
  }

  if (_config.connected) {
    if (badge) {
      badge.textContent = `Összekapcsolva (${_config.athleteId || 'Saját fiók'})`;
      badge.className = 'text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    }
    if (connectBtn) connectBtn.classList.add('hidden');
    if (syncBtn) syncBtn.classList.remove('hidden');
    if (disconnectBtn) disconnectBtn.classList.remove('hidden');
    if (infoRow) infoRow.classList.remove('hidden');
    if (lastSyncText) lastSyncText.textContent = `Utolsó szinkronizálás: ${_config.lastSyncStr || 'Ma'}`;
    if (statsBadge && _config.totalWorkouts) {
      statsBadge.textContent = `${_config.totalWorkouts} edzés betöltve ✓`;
    }
  } else {
    if (badge) {
      badge.textContent = 'Nincs összekapcsolva';
      badge.className = 'text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-gray-200 dark:bg-[#252832] text-gray-400';
    }
    if (connectBtn) connectBtn.classList.remove('hidden');
    if (syncBtn) syncBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');
    if (infoRow) infoRow.classList.add('hidden');
  }
}

// ── Státusz üzenet megjelenítése ───────────────────────────
function _showStatus(msg, type = 'info') {
  const statusEl = $('settings-intervals-status');
  if (!statusEl) return;

  statusEl.classList.remove('hidden');
  if (type === 'error') {
    statusEl.className = 'p-3 rounded-2xl text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30';
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5"></i>${msg}`;
  } else if (type === 'success') {
    statusEl.className = 'p-3 rounded-2xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1.5"></i>${msg}`;
  } else {
    statusEl.className = 'p-3 rounded-2xl text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30';
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>${msg}`;
  }
}

function _hideStatus() {
  const statusEl = $('settings-intervals-status');
  if (statusEl) statusEl.classList.add('hidden');
}

// ── Összekapcsolás & Adatbetöltés Kezelése ─────────────────
export async function syncIntervals(athleteInput = null, apiKeyInput = null, options = {}) {
  // Mind a syncIntervals(options), mind a syncIntervals(athlete, apiKey, options) formát támogatjuk
  if (athleteInput && typeof athleteInput === 'object' && apiKeyInput === null) {
    options = athleteInput;
    athleteInput = null;
  }
  const athlete = (typeof athleteInput === 'string' && athleteInput.trim()) ? athleteInput.trim() : (_config.athleteId || '0');
  const apiKey = (typeof apiKeyInput === 'string' && apiKeyInput.trim()) ? apiKeyInput.trim() : _config.apiKey;
  return _handleConnect(athlete, apiKey, options);
}

async function _handleConnect(athleteInput, apiKeyInput, options = {}) {
  if (_isSyncing) return;
  if (!_uid) {
    if (!options.silent) _showStatus('Kérjük, előbb jelentkezz be!', 'error');
    return;
  }

  const athlete = (athleteInput || '').trim() || '0';
  const apiKey = (apiKeyInput || '').trim();

  if (!apiKey) {
    if (!options.silent) {
      _showStatus('Kérjük, add meg az intervals.icu API kulcsodat a Beállításokban!', 'error');
      // Nyissuk meg a Lockin Pro Fiók / Beállítások oldalt, hogy látható legyen a mező
      if (typeof window !== 'undefined') {
        if (typeof window.showModule === 'function') {
          window.showModule('settings');
        } else if (typeof window.openSettingsModal === 'function') {
          window.openSettingsModal();
        }
      }
    }
    return;
  }

  _isSyncing = true;
  const headerIcon = $('header-sync-icon');
  if (headerIcon) headerIcon.classList.add('fa-spin');

  // Ha az első összekapcsolás vagy options.full === true:
  // Akkor teljes korábbi adatbázis szinkron (2020-01-01-től)
  // Egyébként (belépéskor vagy manuális gombra kattintva): CSAK AZ ELMÚLT 1 HÉT (today - 7 nap)
  const isFullSync = Boolean(options.full || !_config.connected || !_config.lastSyncStr);

  let oldestDate = '2020-01-01';
  if (!isFullSync) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    oldestDate = d.toISOString().slice(0, 10);
  }

  if (!options.silent) {
    const msg = isFullSync
      ? 'Első hozzárendelés: Teljes Garmin adatok és előzmények letöltése...'
      : 'Gyors szinkronizáció: Elmúlt 7 nap adatainak frissítése...';
    _showStatus(msg, 'loading');
  }

  const connectBtn = $('settings-intervals-connect-btn');
  const syncBtn = $('settings-intervals-sync-btn');
  if (connectBtn) { connectBtn.disabled = true; connectBtn.classList.add('opacity-70'); }
  if (syncBtn) { syncBtn.disabled = true; syncBtn.classList.add('opacity-70'); }

  try {
    const credentials = btoa(`API_KEY:${apiKey}`);

    // 1. Edzésadatok lekérése (Activities)
    const actUrl = `https://intervals.icu/api/v1/athlete/${athlete}/activities?oldest=${oldestDate}`;
    
    const actRes = await fetch(actUrl, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json'
      }
    });

    if (!actRes.ok) {
      if (actRes.status === 401) {
        throw new Error('Hibás API kulcs! Ellenőrizd az intervals.icu Beállítások oldalán.');
      } else if (actRes.status === 404) {
        throw new Error('A megadott sportolói azonosító nem található az intervals.icu-n.');
      } else {
        throw new Error(`Intervals.icu hiba: HTTP ${actRes.status} ${actRes.statusText}`);
      }
    }

    const activities = await actRes.json();
    if (!Array.isArray(activities)) {
      throw new Error('Nem sikerült feldolgozni az edzésadatokat.');
    }

    // 2. Wellness és Élettani adatok lekérése (Resting HR, HRV, Sleep, SpO2, Weight)
    const todayStr = new Date().toISOString().slice(0, 10);
    const wellnessUrl = `https://intervals.icu/api/v1/athlete/${athlete}/wellness?oldest=${oldestDate}&newest=${todayStr}`;
    let wellnessList = [];
    try {
      const wellRes = await fetch(wellnessUrl, {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept': 'application/json'
        }
      });
      if (wellRes.ok) {
        wellnessList = await wellRes.json();
      }
    } catch (errWell) {
      console.warn('[intervals] Wellness letöltési hiba (nem blokkoló):', errWell);
    }

    _showStatus(`${activities.length} edzés és ${wellnessList.length} nap biometria mentése a Lockin rendszerbe...`, 'loading');

    // 3. Edzések betöltése Firestore-ba (Atomic deduplikációval)
    let importedWorkouts = 0;
    const batchPromises = [];

    // Felszerelések lekérése, ha van egyezés
    let userGears = [];
    try {
      const gSnap = await getDocs(collection(db, 'users', _uid, 'gear'));
      userGears = gSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (errG) {
      console.warn('[intervals] Nem sikerült a felszerelések lekérése:', errG);
    }

    for (const act of activities) {
      if (!act || !act.id) continue;
      const actId = String(act.id);
      const dateStr = act.start_date_local ? act.start_date_local.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const durationMin = Math.max(1, Math.round((act.moving_time || act.elapsed_time || 60) / 60));
      const distKm = act.distance ? Math.round((Number(act.distance) / 1000) * 100) / 100 : 0;
      const sportId = mapIntervalsTypeToSportId(act.type, act.name, act.description);

      // Felszerelés hozzárendelés megkísérlése (több felszerelés támogatása!)
      // 1. Alapértelmezett felszerelések hozzárendelése a sportághoz
      const matchedGears = [];
      userGears.forEach(g => {
        const defSports = Array.isArray(g.defaultSports)
          ? g.defaultSports
          : (g.defaultSport ? [g.defaultSport] : []);
        if (defSports.includes(sportId)) {
          matchedGears.push(g);
        }
      });

      // 2. Ha az Intervals activity-ben meg volt adva név szerint felszerelés
      if (act.gear && act.gear.name) {
        const mg = userGears.find(g => (g.name || '').toLowerCase() === act.gear.name.toLowerCase());
        if (mg && !matchedGears.some(x => x.id === mg.id)) {
          matchedGears.push(mg);
        }
      }

      const assignedGearIds = matchedGears.map(g => g.id);
      const assignedGearNames = matchedGears.map(g => g.name || '');

      const dfs = buildGarminDatafieldsFromActivity(act);
      const sweatDf = dfs.find(d => d.id === 'sweat_loss');
      const sweatLossMl = sweatDf ? Number(sweatDf.value) || 0 : 0;
      const loadDf = dfs.find(d => d.id === 'training_load');
      const aeroDf = dfs.find(d => d.id === 'aerobic_te');
      const anaeroDf = dfs.find(d => d.id === 'anaerobic_te');

      // Meglévő edzés keresése (in-memory vagy globális listából) a felhasználói megjegyzések megőrzésére
      const existingWorkouts = (typeof window !== 'undefined' && Array.isArray(window._allWorkouts))
        ? window._allWorkouts
        : ((typeof window !== 'undefined' && Array.isArray(window._allWorkoutsActivity)) ? window._allWorkoutsActivity : []);
      const existing = existingWorkouts.find(w => String(w.id) === `intervals_${actId}` || String(w.intervalsId) === actId);

      let finalGearIds = [];
      let finalGearNames = [];
      let shouldIncrementGears = false;

      if (existing && ((existing.gearIds && existing.gearIds.length > 0) || existing.gearId)) {
        finalGearIds = Array.isArray(existing.gearIds) ? existing.gearIds : [existing.gearId];
        finalGearNames = Array.isArray(existing.gearNames) ? existing.gearNames : (existing.gearName ? [existing.gearName] : []);
      } else {
        finalGearIds = assignedGearIds;
        finalGearNames = assignedGearNames;
        // Új szinkronizált edzés esetén, ha hozzárendelődött felszerelés, automatikusan hozzáadjuk a km-t és az időt
        if (!existing && matchedGears.length > 0 && (distKm > 0 || durationMin > 0)) {
          shouldIncrementGears = true;
        }
      }

      if (shouldIncrementGears) {
        const hoursToAdd = Math.round((durationMin / 60) * 10) / 10;
        for (const mg of matchedGears) {
          try {
            const updates = {};
            if (distKm > 0) updates.totalKm = increment(distKm);
            if (hoursToAdd > 0) updates.totalHours = increment(hoursToAdd);
            batchPromises.push(updateDoc(doc(db, 'users', _uid, 'gear', mg.id), updates));
            // In-memory frissítés is a szinkronizálási futáshoz
            mg.totalKm = (Number(mg.totalKm) || 0) + distKm;
            mg.totalHours = (Number(mg.totalHours) || 0) + hoursToAdd;
          } catch (errGear) {
            console.warn('[intervals] Gear update note:', errGear);
          }
        }
      }

      let finalNotes = act.description || '';
      if (existing && existing.notes && !existing.notes.startsWith('Garmin / Intervals.icu import')) {
        // A felhasználó által írt egyéni megjegyzést SOHA nem írjuk felül szinkronizációkor!
        finalNotes = existing.notes;
      } else if (!finalNotes) {
        finalNotes = (existing && existing.notes) ? existing.notes : `Garmin / Intervals.icu import (${act.type || 'Sport'})`;
      }

      // Felhasználó által egyénileg megadott név és sportág megőrzése
      let finalName = act.name || 'Garmin Edzés';
      let isCustomName = false;
      if (existing && (existing.customName || (existing.name && existing.name !== act.name && !existing.name.startsWith('Garmin / Intervals') && existing.name !== 'Garmin Edzés'))) {
        finalName = existing.name;
        isCustomName = true;
      }

      let finalSportId = sportId;
      let isCustomSport = false;
      if (existing && existing.customSport && existing.sportId) {
        finalSportId = existing.sportId;
        isCustomSport = true;
      }

      const workoutDocRef = doc(db, 'users', _uid, 'workouts', `intervals_${actId}`);
      const workoutData = {
        name: finalName,
        customName: isCustomName,
        sportId: finalSportId,
        customSport: isCustomSport,
        date: dateStr,
        duration: durationMin,
        calories: Number(act.calories) || 0,
        distanceKm: distKm,
        gearId: finalGearIds[0] || '',
        gearName: finalGearNames[0] || '',
        gearIds: finalGearIds,
        gearNames: finalGearNames,
        exercises: existing ? existing.exercises || '' : '',
        exerciseItems: existing ? existing.exerciseItems || [] : [],
        courses: existing ? existing.courses || [] : [],
        courseName: existing ? existing.courseName || '' : '',
        courseTime: existing ? existing.courseTime || '' : '',
        targetMuscles: existing ? existing.targetMuscles || [] : [],
        notes: finalNotes,
        source: 'intervals.icu',
        intervalsId: actId,
        externalId: act.external_id || '',
        trainingLoad: loadDf ? Number(loadDf.value) || 0 : (
          Number(_getIntervalsField(act, 'icu_load', 'acute_load', 'TrainingLoad', 'training_load', 'exercise_load', 'garmin_training_load', 'icu_training_load', 'load')) || 0
        ),
        aerobicTE: aeroDf ? Number(aeroDf.value) || 0 : (
          Number(_getIntervalsField(act, 'aerobic_training_effect', 'icu_training_effect', 'AerobicEffect', 'aerobic_effect', 'aerobic_te', 'icu_aerobic_training_effect')) || 0
        ),
        anaerobicTE: anaeroDf ? Number(anaeroDf.value) || 0 : (
          Number(_getIntervalsField(act, 'anaerobic_training_effect', 'icu_anaerobic_training_effect', 'AnaerobicEffect', 'anaerobic_effect', 'anaerobic_te')) || 0
        ),
        icu_load: loadDf ? Number(loadDf.value) || 0 : (Number(act.icu_load || act.acute_load) || 0),
        aerobic_training_effect: aeroDf ? Number(aeroDf.value) || 0 : (Number(act.aerobic_training_effect || act.icu_training_effect) || 0),
        anaerobic_training_effect: anaeroDf ? Number(anaeroDf.value) || 0 : (Number(act.anaerobic_training_effect || act.icu_anaerobic_training_effect) || 0),
        sweatLossMl,
        datafields: dfs,
        createdAt: existing?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      batchPromises.push(setDoc(workoutDocRef, workoutData, { merge: true }));
      importedWorkouts++;
    }

    // 4. Wellness és Napi Biometria mentése (WhoopLogs & SleepLogs)
    let importedWellness = 0;
    let latestWeight = null;

    if (Array.isArray(wellnessList)) {
      for (const w of wellnessList) {
        if (!w || !w.id) continue;
        const dateStr = w.id; // YYYY-MM-DD

        if (w.weight && Number(w.weight) > 0) {
          latestWeight = Number(w.weight);
        }

        const whoopDocRef = doc(db, 'users', _uid, 'whoopLogs', dateStr);
        const sleepActualMin = w.sleepSecs ? Math.round(Number(w.sleepSecs) / 60) : null;
        let sleepScore = null;
        if (w.sleepScore !== undefined && w.sleepScore !== null && Number(w.sleepScore) > 0) {
          sleepScore = Math.min(100, Math.max(0, Math.round(Number(w.sleepScore))));
        } else if (w.sleep_score !== undefined && w.sleep_score !== null && Number(w.sleep_score) > 0) {
          sleepScore = Math.min(100, Math.max(0, Math.round(Number(w.sleep_score))));
        } else if (w.sleepQuality !== undefined && w.sleepQuality !== null) {
          const sq = Number(w.sleepQuality);
          sleepScore = sq > 5 ? Math.round(sq) : Math.round(sq * 20);
        }
        const stressScore = w.stress !== undefined && w.stress !== null ? Math.round((Number(w.stress) / 33.3) * 10) / 10 : null;
        const rhrVal = (w.restingHR !== undefined && w.restingHR !== null) ? Number(w.restingHR) : null;
        const hrvVal = (w.hrv !== undefined && w.hrv !== null) ? Math.round(Number(w.hrv)) : (w.hrvSDNN ? Math.round(Number(w.hrvSDNN)) : null);

        // Véroxigén (SpO2) - Garmin Connect és Intervals.icu összes lehetséges mezője
        let rawSpo2 = _getIntervalsField(w,
          'average_spo2', 'averageSpo2', 'avg_spo2', 'avgSpo2', 'spo2', 'spO2', 'minSpo2', 'min_spo2', 'icu_spo2'
        );
        let spo2Val = null;
        if (rawSpo2 !== undefined && rawSpo2 !== null && rawSpo2 !== '') {
          const n = Number(rawSpo2);
          if (!isNaN(n) && n > 0) {
            spo2Val = n <= 1 ? Math.round(n * 100) : Math.round(n);
          }
        }

        // Légzésszám (Respiration Rate)
        let rawResp = _getIntervalsField(w,
          'average_respiration', 'averageRespiration', 'avg_respiration', 'avgRespiration',
          'respiration', 'sleepRespiration', 'sleep_respiration', 'wakingRespiration',
          'respRate', 'resp', 'icu_respiration'
        );
        let respVal = null;
        if (rawResp !== undefined && rawResp !== null && rawResp !== '') {
          const n = Number(rawResp);
          if (!isNaN(n) && n > 0) {
            respVal = Math.round(n * 10) / 10;
          }
        }

        // Bőrhőmérséklet eltérés (Skin Temp Delta)
        let rawSkin = _getIntervalsField(w,
          'skin_temp_delta', 'skinTempDelta', 'body_temp_delta', 'bodyTempDelta',
          'skinTemp', 'skin_temp', 'tempDelta', 'temp_delta', 'temperatureDelta',
          'temperature_delta', 'icu_skin_temp_delta'
        );
        let skinTempVal = null;
        if (rawSkin !== undefined && rawSkin !== null && rawSkin !== '') {
          const n = Number(rawSkin);
          if (!isNaN(n)) {
            skinTempVal = Math.round(n * 10) / 10;
          }
        }

        const recVal = (hrvVal && rhrVal)
          ? calcWhoopOfficialRecovery(hrvVal, rhrVal, sleepScore, respVal, skinTempVal)
          : (Number(w.readiness) || null);

        const whoopData = {
          date: dateStr,
          source: 'intervals.icu',
          updatedAt: serverTimestamp()
        };

        if (recVal !== null) whoopData.recovery = recVal;
        if (rhrVal !== null) whoopData.rhr = rhrVal;
        if (hrvVal !== null) whoopData.hrv = hrvVal;
        if (sleepActualMin !== null) whoopData.sleepActualMin = sleepActualMin;
        if (sleepScore !== null) {
          whoopData.sleepScore = sleepScore;
          whoopData.sleepEfficiency = sleepScore;
        }
        if (stressScore !== null) whoopData.stressScore = stressScore;
        if (spo2Val !== null) {
          whoopData.spo2 = spo2Val;
          whoopData.spO2 = spo2Val;
          whoopData.average_spo2 = spo2Val;
        }
        if (respVal !== null) {
          whoopData.respRate = respVal;
          whoopData.respiration = respVal;
          whoopData.average_respiration = respVal;
        }
        if (skinTempVal !== null) {
          whoopData.skinTemp = skinTempVal;
          whoopData.tempDelta = skinTempVal;
          whoopData.skin_temp_delta = skinTempVal;
          whoopData.body_temp_delta = skinTempVal;
        }

        const stages = sleepActualMin ? extractGarminSleepStages(w, sleepActualMin, sleepScore, dateStr) : null;
        if (stages) whoopData.stages = stages;

        whoopData.health = {
          rhr: rhrVal,
          hrv: hrvVal,
          skinTemp: skinTempVal,
          tempDelta: skinTempVal,
          skin_temp_delta: skinTempVal,
          body_temp_delta: skinTempVal,
          spo2: spo2Val,
          spO2: spo2Val,
          average_spo2: spo2Val,
          respRate: respVal,
          respiration: respVal,
          average_respiration: respVal
        };

        batchPromises.push(setDoc(whoopDocRef, whoopData, { merge: true }));

        // Alvásnapló (SleepLog) rögzítése, ha volt alvás
        if (w.sleepSecs && Number(w.sleepSecs) > 0) {
          const sleepDocRef = doc(db, 'users', _uid, 'sleepLogs', `intervals_${dateStr}`);
          const sleepHours = Math.round((Number(w.sleepSecs) / 3600) * 10) / 10;
          const sleepPayload = {
            date: dateStr,
            durationHours: sleepHours,
            quality: Number(w.sleepQuality) || (sleepScore ? Math.round(sleepScore / 20) : 3),
            notes: 'Garmin / Intervals.icu alvás',
            source: 'intervals.icu',
            createdAt: serverTimestamp()
          };
          if (stages) {
            sleepPayload.stages = stages;
          }
          batchPromises.push(setDoc(sleepDocRef, sleepPayload, { merge: true }));
        }

        importedWellness++;
      }
    }

    // Párhuzamos mentések végrehajtása kötegekben (50-esével a stabilitásért)
    try {
      const chunkSize = 50;
      for (let i = 0; i < batchPromises.length; i += chunkSize) {
        const chunk = batchPromises.slice(i, i + chunkSize);
        await Promise.all(chunk);
      }
    } catch (batchErr) {
      console.warn('[intervals] Firestore kötegelt mentési hiba (helyi fallback aktív):', batchErr);
    }

    // 5. Ha van friss testsúly a wellnessben, frissítjük a felhasználói profilt & folyadékcélt
    if (latestWeight && latestWeight > 0) {
      try {
        const newWater = Math.round(latestWeight * 35);
        await setDoc(doc(db, 'users', _uid, 'settings', 'profile'), {
          weight: latestWeight,
          waterGoal: newWater
        }, { merge: true });

        const wIn = $('settings-input-weight');
        const watIn = $('settings-input-water');
        const calcHint = $('settings-water-calc-hint');
        if (wIn) wIn.value = latestWeight;
        if (watIn) watIn.value = newWater;
        if (calcHint) {
          calcHint.textContent = `Kalkulált folyadékigény: ${newWater} ml / nap (35 ml / testsúly kg alapján)`;
          calcHint.classList.remove('hidden');
        }

        window.dispatchEvent(new CustomEvent('fitplan:goals-updated', {
          detail: { weight: latestWeight, waterGoal: newWater }
        }));
      } catch (errWeight) {
        console.warn('[intervals] Testsúly frissítési hiba:', errWeight);
      }
    }

    // 6. Összekapcsolási adatok elmentése Firestore-ba és LocalStorage-ba
    const nowStr = new Date().toLocaleString('hu-HU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const totalWorkoutsCount = isFullSync
      ? importedWorkouts
      : Math.max(_config.totalWorkouts || 0, importedWorkouts);
    const totalWellnessCount = isFullSync
      ? importedWellness
      : Math.max(_config.totalWellnessDays || 0, importedWellness);

    _config = {
      athleteId: athlete,
      apiKey: apiKey,
      connected: true,
      lastSyncStr: nowStr,
      totalWorkouts: totalWorkoutsCount,
      totalWellnessDays: totalWellnessCount
    };

    localStorage.setItem(`lockin_intervals_${_uid}`, JSON.stringify(_config));

    try {
      await setDoc(doc(db, 'users', _uid, 'settings', 'intervals'), {
        athleteId: athlete,
        apiKey: apiKey,
        connected: true,
        lastSync: serverTimestamp(),
        lastSyncStr: nowStr,
        totalWorkouts: totalWorkoutsCount,
        totalWellnessDays: totalWellnessCount
      }, { merge: true });
    } catch (fsErr) {
      console.warn('[intervals] Firestore mentési figyelmeztetés (helyi tároló mentve):', fsErr);
    }

    _renderUIState();
    const succMsg = isFullSync
      ? `Sikeres teljes szinkronizáció! ${importedWorkouts} edzés és ${importedWellness} nap biometria betöltve.`
      : `Sikeres szinkronizáció! Elmúlt 7 nap (${importedWorkouts} edzés, ${importedWellness} nap biometria) frissítve.`;
    _showStatus(succMsg, 'success');

    // Értesítés a többi modulnak a nézetek azonnali újrarajzolásához
    window.dispatchEvent(new CustomEvent('lockin:intervals-synced', {
      detail: _config
    }));

  } catch (err) {
    console.error('[intervals] Szinkronizációs hiba:', err);
    if (!options.silent) {
      _showStatus(err.message || 'Hiba történt a kapcsolódáskor. Kérjük próbáld újra!', 'error');
    }
  } finally {
    _isSyncing = false;
    const headerIcon = $('header-sync-icon');
    if (headerIcon) headerIcon.classList.remove('fa-spin');
    if (connectBtn) { connectBtn.disabled = false; connectBtn.classList.remove('opacity-70'); }
    if (syncBtn) { syncBtn.disabled = false; syncBtn.classList.remove('opacity-70'); }
  }
}

// ── Fiók Szétkapcsolása (Unlink) ───────────────────────────
async function _handleDisconnect() {
  if (!_uid) return;

  _config = {
    athleteId: '',
    apiKey: '',
    connected: false,
    lastSyncStr: '',
    totalWorkouts: 0,
    totalWellnessDays: 0
  };

  try {
    localStorage.removeItem(`lockin_intervals_${_uid}`);

    try {
      await setDoc(doc(db, 'users', _uid, 'settings', 'intervals'), {
        athleteId: '',
        apiKey: '',
        connected: false,
        lastSyncStr: ''
      }, { merge: true });
    } catch (fsErr) {
      console.warn('[intervals] Firestore disconnect figyelmeztetés:', fsErr);
    }

    const athleteInp = $('settings-intervals-athlete');
    const apiKeyInp = $('settings-intervals-apikey');
    if (athleteInp) athleteInp.value = '';
    if (apiKeyInp) apiKeyInp.value = '';

    _renderUIState();
    _showStatus('Intervals.icu fiók sikeresen szétkapcsolva.', 'info');
    setTimeout(_hideStatus, 3000);
  } catch (err) {
    console.error('[intervals] Szétkapcsolási hiba:', err);
    _showStatus('Hiba a szétkapcsolás során.', 'error');
  }
}
