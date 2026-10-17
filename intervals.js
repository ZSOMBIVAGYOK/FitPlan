// ============================================================
// intervals.js — Intervals.icu & Garmin Adatbetöltő & Szinkron Motor
// Lockin 5.0 | Garmin korábbi és új edzések + Wellness biometria
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

// ── Sportág megfeleltetés (Intervals.icu type -> Lockin Garmin sportId) ──
export function mapIntervalsTypeToSportId(type) {
  if (!type) return 'strength_training';
  const t = String(type).trim().toLowerCase();

  if (t === 'trailrun' || t.includes('trail')) return 'trail_running';
  if (t === 'treadmill' || t === 'virtualrun') return 'treadmill';
  if (t === 'trackrun' || t.includes('track')) return 'track_running';
  if (t === 'run') return 'running';

  if (t === 'gravelride') return 'gravel_biking';
  if (t === 'mountainbikeride' || t.includes('mountain') || t === 'mtb') return 'mountain_biking';
  if (t === 'virtualride' || t.includes('trainer') || t.includes('spinning') || t.includes('indoor_bike')) return 'indoor_cycling';
  if (t === 'roadride') return 'road_biking';
  if (t === 'ride' || t.includes('bike') || t.includes('cycl')) return 'cycling';

  if (t === 'swim' || t === 'poolswim') return 'pool_swimming';
  if (t === 'openwaterswim') return 'open_water_swimming';

  if (t === 'weighttraining' || t.includes('weight') || t.includes('gym') || t.includes('strength')) return 'strength_training';
  if (t.includes('powerlift')) return 'powerlifting';
  if (t.includes('bodybuild')) return 'bodybuilding';
  if (t.includes('calisthen')) return 'calisthenics';
  if (t.includes('crossfit')) return 'crossfit';
  if (t === 'hiit') return 'hiit';
  if (t === 'cardio') return 'cardio';

  if (t === 'walk') return 'walking';
  if (t === 'hike') return 'hiking';
  if (t === 'climbing' || t === 'rockclimbing') return 'climbing';

  if (t === 'yoga') return 'yoga';
  if (t === 'pilates') return 'pilates';
  if (t === 'breathwork' || t.includes('breath')) return 'breathwork';

  if (t === 'rowing') return 'rowing';
  if (t === 'virtualrowing' || t.includes('rower')) return 'indoor_rowing';
  if (t === 'sup' || t.includes('paddle')) return 'sup';
  if (t === 'kayaking' || t.includes('canoe')) return 'kayaking';

  if (t === 'nordicski' || t.includes('nordic')) return 'cross_country_skiing';
  if (t === 'snowboard') return 'snowboarding';
  if (t.includes('ski')) return 'skiing';

  if (t === 'triathlon') return 'triathlon';
  if (t === 'tennis') return 'tennis';
  if (t === 'padel') return 'padel';
  if (t === 'golf') return 'golf';

  return 'running';
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

  // 9. Edzésterhelés (TSS / Training Load)
  if (act.icu_training_load && Number(act.icu_training_load) > 0) {
    dfs.push({
      id: 'aerobic_te',
      name: 'Edzésterhelés (TSS)',
      label: 'Edzésterhelés (TSS)',
      value: String(Math.round(Number(act.icu_training_load))),
      unit: 'TSS'
    });
  }

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

  return dfs;
}

// ── Hivatalos WHOOP Recovery kalkuláció (0 – 100%) ──────────
// 50% HRV (bázisvonalhoz képest), 30% RHR (alacsonyabb jobb), 20% Garmin Sleep Score
// Büntetés emelkedett légzésszám és bőrhőmérséklet esetén
export function calcWhoopOfficialRecovery(hrv, rhr, sleepScore = null, respRate = null, skinTemp = null) {
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
      // Ha a beállítások modál nincs nyitva, nyissuk meg, hogy látható legyen a mező
      const modal = $('settings-modal');
      if (modal && modal.classList.contains('hidden')) {
        const gearBtn = $('btn-settings-gear');
        if (gearBtn) gearBtn.click();
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
    const wellnessUrl = `https://intervals.icu/api/v1/athlete/${athlete}/wellness?oldest=${oldestDate}`;
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
      const sportId = mapIntervalsTypeToSportId(act.type);

      // Felszerelés hozzárendelés megkísérlése
      let matchedGearId = '';
      if (act.gear && act.gear.name) {
        const mg = userGears.find(g => (g.name || '').toLowerCase() === act.gear.name.toLowerCase());
        if (mg) matchedGearId = mg.id;
      }

      const workoutDocRef = doc(db, 'users', _uid, 'workouts', `intervals_${actId}`);
      const workoutData = {
        name: act.name || 'Garmin Edzés',
        sportId,
        date: dateStr,
        duration: durationMin,
        calories: Number(act.calories) || 0,
        distanceKm: distKm,
        gearId: matchedGearId,
        exercises: '',
        notes: act.description || `Garmin / Intervals.icu import (${act.type || 'Sport'})`,
        source: 'intervals.icu',
        intervalsId: actId,
        externalId: act.external_id || '',
        trainingLoad: Number(act.icu_training_load) || 0,
        datafields: buildGarminDatafieldsFromActivity(act),
        createdAt: serverTimestamp(),
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
        const sleepScore = (w.sleepScore !== undefined && w.sleepScore !== null && Number(w.sleepScore) > 0)
          ? Number(w.sleepScore)
          : (w.sleepQuality ? Math.round(Number(w.sleepQuality) * 20) : null);
        const stressScore = w.stress !== undefined && w.stress !== null ? Math.round((Number(w.stress) / 33.3) * 10) / 10 : null;
        const rhrVal = (w.restingHR !== undefined && w.restingHR !== null) ? Number(w.restingHR) : null;
        const hrvVal = (w.hrv !== undefined && w.hrv !== null) ? Math.round(Number(w.hrv)) : (w.hrvSDNN ? Math.round(Number(w.hrvSDNN)) : null);

        // Véroxigén (SpO2) - Garmin Connect és Intervals.icu összes lehetséges mezője
        let spo2Val = null;
        if (w.spO2 !== undefined && w.spO2 !== null) spo2Val = Number(w.spO2);
        else if (w.spo2 !== undefined && w.spo2 !== null) spo2Val = Number(w.spo2);
        else if (w.avgSpo2 !== undefined && w.avgSpo2 !== null) spo2Val = Number(w.avgSpo2);
        else if (w.avg_spo2 !== undefined && w.avg_spo2 !== null) spo2Val = Number(w.avg_spo2);
        else if (w.minSpo2 !== undefined && w.minSpo2 !== null) spo2Val = Number(w.minSpo2);
        else if (w.min_spo2 !== undefined && w.min_spo2 !== null) spo2Val = Number(w.min_spo2);
        if (spo2Val !== null && spo2Val > 0 && spo2Val <= 1) {
          spo2Val = Math.round(spo2Val * 100);
        } else if (spo2Val !== null) {
          spo2Val = Math.round(spo2Val);
        }

        // Légzésszám (Respiration Rate)
        let respVal = null;
        if (w.respiration !== undefined && w.respiration !== null) respVal = Number(w.respiration);
        else if (w.avgRespiration !== undefined && w.avgRespiration !== null) respVal = Number(w.avgRespiration);
        else if (w.avg_respiration !== undefined && w.avg_respiration !== null) respVal = Number(w.avg_respiration);
        else if (w.sleepRespiration !== undefined && w.sleepRespiration !== null) respVal = Number(w.sleepRespiration);
        else if (w.sleep_respiration !== undefined && w.sleep_respiration !== null) respVal = Number(w.sleep_respiration);
        else if (w.wakingRespiration !== undefined && w.wakingRespiration !== null) respVal = Number(w.wakingRespiration);
        else if (w.respRate !== undefined && w.respRate !== null) respVal = Number(w.respRate);
        else if (w.resp !== undefined && w.resp !== null) respVal = Number(w.resp);
        if (respVal !== null) {
          respVal = Math.round(respVal * 10) / 10;
        }

        // Bőrhőmérséklet eltérés (Skin Temp Delta)
        let skinTempVal = null;
        if (w.skinTemp !== undefined && w.skinTemp !== null) skinTempVal = Number(w.skinTemp);
        else if (w.skin_temp !== undefined && w.skin_temp !== null) skinTempVal = Number(w.skin_temp);
        else if (w.tempDelta !== undefined && w.tempDelta !== null) skinTempVal = Number(w.tempDelta);
        else if (w.temp_delta !== undefined && w.temp_delta !== null) skinTempVal = Number(w.temp_delta);
        else if (w.temperatureDelta !== undefined && w.temperatureDelta !== null) skinTempVal = Number(w.temperatureDelta);
        if (skinTempVal !== null) {
          skinTempVal = Math.round(skinTempVal * 10) / 10;
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
        }
        if (respVal !== null) {
          whoopData.respRate = respVal;
          whoopData.respiration = respVal;
        }
        if (skinTempVal !== null) {
          whoopData.skinTemp = skinTempVal;
          whoopData.tempDelta = skinTempVal;
        }

        whoopData.health = {
          rhr: rhrVal,
          hrv: hrvVal,
          skinTemp: skinTempVal,
          spo2: spo2Val,
          respRate: respVal
        };

        batchPromises.push(setDoc(whoopDocRef, whoopData, { merge: true }));

        // Alvásnapló (SleepLog) rögzítése, ha volt alvás
        if (w.sleepSecs && Number(w.sleepSecs) > 0) {
          const sleepDocRef = doc(db, 'users', _uid, 'sleepLogs', `intervals_${dateStr}`);
          const sleepHours = Math.round((Number(w.sleepSecs) / 3600) * 10) / 10;
          batchPromises.push(setDoc(sleepDocRef, {
            date: dateStr,
            durationHours: sleepHours,
            quality: Number(w.sleepQuality) || 3,
            notes: 'Garmin / Intervals.icu alvás',
            source: 'intervals.icu',
            createdAt: serverTimestamp()
          }, { merge: true }));
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
