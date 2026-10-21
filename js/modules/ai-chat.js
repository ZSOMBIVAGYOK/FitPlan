// ============================================================
// ai-chat.js — Lockin AI Coach (Multi-turn Chat & 7-napos Kontextus)
// Hivatalos Firebase AI SDK (Vertex AI in Firebase / Gemini 1.5 Flash)
// Apple Intelligence / Whoop minimalista sötét esztétika
// ============================================================

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth, firebaseConfig } from "../firebase-config.js";
import { DEFAULT_EXERCISES } from "../garmin-sports.js";

const $ = id => document.getElementById(id);

// ── Modul Belső Állapot ──────────────────────────────────────
let _uid = null;
let _user = null;
let _aiApp = null;
let _vertexAI = null;
let _model = null;
let _chatSession = null;
let _currentModelName = "gemini-1.5-flash";
let _isSending = false;
let _hasSentContext = false;
let _cachedContext = null;
let _contextData = null;
let _chatHistory = [];
let _lastContextFetch = 0;
let _initializedUI = false;
let _appModule = null;
let _vertexModule = null;

// ── Rendszer Utasítás (System Instruction) ─────────────────
const SYSTEM_INSTRUCTION = `Te a Lockin app elit sport és fitnesz AI asszisztense vagy. Válaszolj professzionálisan, strukturáltan és a felhasználó konkrét utasítását precízen követve.
SZABÁLYOK:
1. PONTOS PARANCSKÖVETÉS: Mindig a felhasználó konkrét utasítására/kérésére válaszolj, a parancs valódi szándékára és céljára fókuszálva ahelyett, hogy felületes kulcsszavakra ugranál!
2. ADATOK SZIGORÚ FIGYELEMBEVÉTELE KIZÁRÓLAG KIFEJEZETT KÉRÉSRE: A felhasználó mentett adatait (7 napos adatok, mentett sablonok, meglévő gyakorlatok, receptek) CSAK ÉS KIZÁRÓLAG AKKOR vedd alapul szigorúan, ha a felhasználó kifejezetten ezt kéri (pl. "a meglévő gyakorlatokból állíts össze egy edzést", "a mentett receptjeimből ajánlj", "az adataim alapján elemezz", "heti elemzés")!
3. ÖNÁLLÓ TERVEZÉS (ÍRJ MAGADTÓL): Ha a felhasználó általánosságban kér egy edzést vagy tervet (pl. "írj egy edzést", "írj egy lábedzést", "készíts egy mell edzést", "mit egyek"): ÍRJ MAGADTÓL, professzionálisan és kreatívan egy teljes, szakszerű edzésprogramot vagy étkezést (bemelegítés, gyakorlatok pontos megnevezése, szériák, ismétlések, pihenőidők, intenzitás/RPE, levezetés, edzői tanácsok)! Ilyenkor NE korlátozd magad a mentett adatokra, és NE írj figyelmeztetést korábbi adathiányokról!
4. MEGLÉVŐ GYAKORLATOKBÓL VALÓ ÖSSZEÁLLÍTÁS: Ha a felhasználó kifejezetten azt kéri, hogy a meglévő vagy mentett gyakorlataiból / sablonjaiból állíts össze egy edzést: vedd figyelembe szigorúan az alább megadott meglévő gyakorlatokat és sablonokat, és KIZÁRÓLAG azokból építs fel egy strukturált, logikus edzésprogramot!
5. HETI ELEMZÉS & FIGYELMEZTETÉSEK: [⚠️ FIGYELMEZTETÉS] blokkot vagy heti adatelemzést KIZÁRÓLAG akkor írj, ha a felhasználó kifejezetten a heti állapotáról, adatairól, hidratációjáról vagy heti teljesítményéről kérdez (pl. "Heti elemzés", "Hogy áll a hidratációm?"). Általános edzéskérésnél soha ne szúrj be kéretlen figyelmeztetéseket!
6. FORMÁZÁS: Használj letisztult Markdown formázást: félkövér kiemeléseket a fontos számoknál és gyakorlatoknál, és jól átlátható pontokba szedd a válaszokat.`;

// ── Inicializálás és Tisztítás ─────────────────────────────
export function initAIChat(uid, user = null) {
  _uid = uid;
  _user = user || (auth && auth.currentUser);

  _bindUI();
  _ensureFirebaseAI().catch(e => console.warn("[Lockin AI] Init background check:", e));
}

export function destroyAIChat() {
  _uid = null;
  _user = null;
  _chatSession = null;
  _model = null;
  _hasSentContext = false;
  _cachedContext = null;
  _contextData = null;
  _chatHistory = [];
}

// ── Firebase AI SDK Inicializálása (Dinamikus, hibatűrő import) ─
async function _ensureFirebaseAI() {
  if (_vertexAI && _chatSession) return true;
  try {
    if (!_appModule) {
      _appModule = await import("https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js");
    }
    if (!_vertexModule) {
      _vertexModule = await import("https://www.gstatic.com/firebasejs/11.2.0/firebase-vertexai.js");
    }
    const { initializeApp, getApps } = _appModule;
    const { getVertexAI, getGenerativeModel } = _vertexModule;

    const existingApps = getApps();
    _aiApp = existingApps.find(a => a.name === "lockin-ai-app");
    if (!_aiApp) {
      _aiApp = initializeApp(firebaseConfig, "lockin-ai-app");
    }
    _vertexAI = getVertexAI(_aiApp);
    _model = getGenerativeModel(_vertexAI, {
      model: _currentModelName,
      systemInstruction: SYSTEM_INSTRUCTION
    });
    _chatSession = _model.startChat();
    return true;
  } catch (err) {
    console.warn("[Lockin AI] Firebase Vertex AI inicializálási figyelmeztetés:", err);
    return false;
  }
}

// ── 7-Napos Heti Kontextus Lekérése Firestore-ból ───────────
async function _fetchFullUserContext(uid) {
  const now = Date.now();
  if (_cachedContext && now - _lastContextFetch < 60000) {
    return _cachedContext;
  }

  // 1. Dátumok kiszámítása: utolsó 7 nap
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().slice(0, 10));
  }
  const todayStr = last7Days[last7Days.length - 1];

  // 2. Párhuzamos lekérések Firestore-ból (biztonságos allSettled)
  let profileData = {};
  let mealsDocs = [];
  let hydraDocs = [];
  let workoutDocs = [];
  let recipesDocs = [];
  let foodDbDocs = [];
  let routinesDocs = [];
  let customExercisesDocs = [];

  try {
    const results = await Promise.allSettled([
      getDoc(doc(db, "users", uid, "settings", "profile")),
      getDocs(collection(db, "users", uid, "meals")),
      getDocs(collection(db, "users", uid, "hydrationLogs")),
      getDocs(collection(db, "users", uid, "workouts")),
      getDocs(collection(db, "users", uid, "recipes")),
      getDocs(collection(db, "users", uid, "foodDatabase")),
      getDocs(collection(db, "users", uid, "routines")),
      getDocs(collection(db, "users", uid, "workoutRoutines")),
      getDocs(collection(db, "users", uid, "exercises"))
    ]);

    if (results[0].status === "fulfilled" && results[0].value.exists()) {
      profileData = results[0].value.data() || {};
    }
    if (results[1].status === "fulfilled") mealsDocs = results[1].value.docs.map(d => ({ id: d.id, ...d.data() }));
    if (results[2].status === "fulfilled") hydraDocs = results[2].value.docs.map(d => ({ id: d.id, ...d.data() }));
    if (results[3].status === "fulfilled") workoutDocs = results[3].value.docs.map(d => ({ id: d.id, ...d.data() }));
    if (results[4].status === "fulfilled") recipesDocs = results[4].value.docs.map(d => ({ id: d.id, ...d.data() }));
    if (results[5].status === "fulfilled") foodDbDocs = results[5].value.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Rutinok egyesítése mindkét lehetséges kollekcióból
    const r1 = results[6].status === "fulfilled" ? results[6].value.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    const r2 = results[7].status === "fulfilled" ? results[7].value.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    routinesDocs = [...r1, ...r2];

    if (results[8].status === "fulfilled") {
      customExercisesDocs = results[8].value.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    console.warn("[Lockin AI] Firestore kontextus lekérési figyelmeztetés:", err);
  }

  // 3. Felhasználói profil és célok összegzése
  const userName = _user?.displayName || profileData.name || "Sportoló";
  const userWeight = profileData.weight || 75;
  const userHeight = profileData.height || 180;
  const userAge = profileData.age || 28;
  const calorieGoal = profileData.calorieGoal || 2200;
  const proteinGoal = profileData.proteinGoal || 150;
  const waterGoal = profileData.waterGoal || Math.round(userWeight * 35);

  // 4. Heti adatok napokra bontva
  const dailySummary = [];
  let totalWater7d = 0;
  let totalProtein7d = 0;
  let totalCalories7d = 0;
  let totalWorkoutMinutes7d = 0;
  let totalWorkoutLoad7d = 0;
  let heavyDaysCount = 0;

  last7Days.forEach(day => {
    // Hidratáció erre a napra
    const dayHydra = hydraDocs.filter(h => h.date === day);
    const dayWater = Math.round(dayHydra.reduce((sum, h) => sum + (Number(h.effectiveMl) || Number(h.ml) || 0), 0));
    totalWater7d += dayWater;

    // Étkezések erre a napra
    const dayMeals = mealsDocs.filter(m => m.date === day);
    const dayCal = Math.round(dayMeals.reduce((sum, m) => sum + (Number(m.calories) || 0), 0));
    const dayProt = Math.round(dayMeals.reduce((sum, m) => sum + (Number(m.protein) || 0), 0));
    const dayCarb = Math.round(dayMeals.reduce((sum, m) => sum + (Number(m.carbs) || 0), 0));
    const dayFat = Math.round(dayMeals.reduce((sum, m) => sum + (Number(m.fat) || 0), 0));
    const mealNames = dayMeals.map(m => m.name).filter(Boolean).join(", ");
    totalCalories7d += dayCal;
    totalProtein7d += dayProt;

    // Edzések erre a napra
    const dayWorkouts = workoutDocs.filter(w => w.date === day);
    const woDetails = dayWorkouts.map(w => {
      const dur = Number(w.duration) || 0;
      const load = Number(w.icu_load || w.load || w.acute_load || 0);
      const aero = w.aerobic_training_effect || w.icu_training_effect || "";
      const anaero = w.anaerobic_training_effect || "";
      totalWorkoutMinutes7d += dur;
      totalWorkoutLoad7d += load;
      if (dur > 75 || load > 100) heavyDaysCount++;
      return `${w.name || 'Edzés'} (${w.sport || w.type || 'Sport'}, ${dur} perc, Terhelés: ${load || 'n/a'}${aero ? `, Aerob TE: ${aero}` : ''}${anaero ? `, Anaerob TE: ${anaero}` : ''})`;
    }).join("; ");

    dailySummary.push(`- [${day}${day === todayStr ? ' (MA)' : ''}]: Víz: ${dayWater} ml / cél ${waterGoal} ml | Étrend: ${dayCal} kcal (Fehérje: ${dayProt}g, Szénhidrát: ${dayCarb}g, Zsír: ${dayFat}g)${mealNames ? ` [Ételek: ${mealNames}]` : ''} | Edzések: ${woDetails || 'Pihenőnap / nincs rögzítve'}`);
  });

  const avgWater = Math.round(totalWater7d / 7);
  const avgProtein = Math.round(totalProtein7d / 7);
  const avgCalories = Math.round(totalCalories7d / 7);

  // 5. Mentett ételek & receptek
  const savedFoodsList = [];
  recipesDocs.forEach(r => {
    savedFoodsList.push(`- [RECEPT] ${r.name}: ${r.calories || 0} kcal, ${r.protein || 0}g fehérje, ${r.carbs || 0}g CH, ${r.fat || 0}g zsír (Hozzávalók: ${Array.isArray(r.ingredients) ? r.ingredients.map(i => i.name || i).join(', ') : (r.ingredients || 'alap')} | Adag: ${r.servingType === 'portion' ? (r.servingPortion || 1) + ' adag' : (r.servingGrams || 100) + 'g'})`);
  });
  foodDbDocs.slice(0, 30).forEach(f => {
    savedFoodsList.push(`- [ÉTEL] ${f.name}: ${f.calories || 0} kcal, ${f.protein || 0}g fehérje, ${f.carbs || 0}g CH, ${f.fat || 0}g zsír`);
  });

  // 6. Mentett edzésprogramok, sablonok & saját gyakorlatok
  const savedRoutinesList = [];
  routinesDocs.forEach(rt => {
    const exList = Array.isArray(rt.exercises) ? rt.exercises.map(e => e.name || e).join(', ') : (rt.exercises || '');
    savedRoutinesList.push(`- [SABLON] ${rt.name || 'Edzésterv'}${rt.description ? ` (${rt.description})` : ''}: Gyakorlatok: ${exList || 'Nincs részletezve'}`);
  });

  const savedExercisesList = [];
  customExercisesDocs.forEach(ex => {
    savedExercisesList.push(`- [EGYEDI GYAKORLAT] ${ex.name}${ex.category ? ` (${ex.category})` : ''}${ex.targetMuscle ? ` - Célizom: ${ex.targetMuscle}` : ''}`);
  });

  // 7. Szöveges kontextuscsomag összeállítása
  const contextString = `
=== FELHASZNÁLÓI PROFIL & EGYÉNI CÉLOK ===
- Név: ${userName}
- Testsúly: ${userWeight} kg | Magasság: ${userHeight} cm | Életkor: ${userAge} év
- Napi célértékek: ${calorieGoal} kcal kalória | ${proteinGoal} g fehérje | ${waterGoal} ml hidratáció

=== ELMÚLT 7 NAP ÖSSZESÍTŐ METRIKÁI ===
- Átlagos napi folyadékbevitel: ${avgWater} ml / nap (Cél: ${waterGoal} ml) -> ${avgWater < waterGoal * 0.75 ? '⚠️ KRITIKUS DEHIDRATÁCIÓ' : 'Megfelelő'}
- Átlagos napi fehérjebevitel: ${avgProtein} g / nap (Cél: ${proteinGoal} g) -> ${avgProtein < proteinGoal * 0.75 ? '⚠️ KRITIKUS FEHÉRJEHIÁNY' : 'Megfelelő'}
- Átlagos napi kalóriabevitel: ${avgCalories} kcal / nap (Cél: ${calorieGoal} kcal)
- Heti összes edzésidő: ${Math.round(totalWorkoutMinutes7d / 60)} óra ${totalWorkoutMinutes7d % 60} perc | Összes terhelés (Load): ${totalWorkoutLoad7d} | Nehéz/hosszú edzésnapok száma: ${heavyDaysCount}

=== NAPI NAPLÓBEJEGYZÉSEK AZ ELMÚLT 7 NAPBÓL ===
${dailySummary.join('\n')}

=== FELHASZNÁLÓ SAJÁT MENTETT ÉTELEI & RECEPTEK KÖNYVTÁRA ===
${savedFoodsList.length > 0 ? savedFoodsList.join('\n') : 'Még nincs egyedi mentett étel vagy recept.'}

=== FELHASZNÁLÓ SAJÁT MENTETT GYAKORLATAI ÉS SABLONJAI ===
(FONTOS: Csak akkor válogass ezekből, ha a felhasználó kifejezetten a meglévő / mentett gyakorlataiból kér edzést! Ha általánosságban kér edzést, írj magadtól egy komplett profi edzést!)
${savedExercisesList.length > 0 ? savedExercisesList.join('\n') : 'Még nincs egyedi mentett gyakorlat.'}
${savedRoutinesList.length > 0 ? savedRoutinesList.join('\n') : 'Még nincs mentett edzéssablon.'}
`.trim();

  _cachedContext = contextString;
  _lastContextFetch = now;
  _contextData = {
    userName,
    userWeight,
    userHeight,
    userAge,
    calorieGoal,
    proteinGoal,
    waterGoal,
    avgWater,
    avgProtein,
    avgCalories,
    totalWorkoutMinutes7d,
    totalWorkoutLoad7d,
    heavyDaysCount,
    dailySummary,
    recipesDocs,
    foodDbDocs,
    routinesDocs,
    workoutDocs,
    customExercisesDocs,
    geminiApiKey: profileData.geminiApiKey || localStorage.getItem("lockin_gemini_api_key") || ""
  };
  return contextString;
}

// ── UI és Eseménykezelés ────────────────────────────────────
function _bindUI() {
  const openBtn = $("nav-ai-chat-btn");
  const headerAiBtn = $("btn-header-ai");
  const closeBtn = $("ai-chat-close-btn");
  const clearBtn = $("ai-chat-clear-btn");
  const backdrop = $("ai-chat-backdrop");
  const sendBtn = $("ai-chat-send-btn");
  const inputEl = $("ai-chat-input");
  const chipContainer = $("ai-prompt-chips");

  if (openBtn && !openBtn.dataset.bound) {
    openBtn.dataset.bound = "true";
    openBtn.addEventListener("click", openAIChat);
  }

  if (headerAiBtn && !headerAiBtn.dataset.bound) {
    headerAiBtn.dataset.bound = "true";
    headerAiBtn.addEventListener("click", openAIChat);
  }

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", closeAIChat);
  }

  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = "true";
    backdrop.addEventListener("click", closeAIChat);
  }

  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "true";
    clearBtn.addEventListener("click", clearAIChat);
  }

  if (sendBtn && !sendBtn.dataset.bound) {
    sendBtn.dataset.bound = "true";
    sendBtn.addEventListener("click", () => {
      const text = inputEl?.value?.trim();
      if (text && !_isSending) {
        _handleSendMessage(text);
      }
    });
  }

  if (inputEl && !inputEl.dataset.bound) {
    inputEl.dataset.bound = "true";
    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = inputEl.value.trim();
        if (text && !_isSending) {
          _handleSendMessage(text);
        }
      }
    });

    // Auto resize input
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + "px";
    });
  }

  // Gyorsindító gombok (Suggested Prompt Chips)
  if (chipContainer && !chipContainer.dataset.bound) {
    chipContainer.dataset.bound = "true";
    chipContainer.querySelectorAll(".ai-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const prompt = btn.getAttribute("data-prompt");
        if (prompt && !_isSending) {
          _handleSendMessage(prompt);
        }
      });
    });
  }
}

// ── Modális Ablak Kezelése (Apple / Whoop Bottom Sheet) ─────
export function openAIChat() {
  const modal = $("ai-chat-modal");
  const sheet = $("ai-chat-sheet");
  if (!modal || !sheet) return;

  _bindUI();

  // Azonosító lekérése ha még nem volt beállítva
  if (!_uid) {
    if (auth && auth.currentUser) {
      _uid = auth.currentUser.uid;
      _user = auth.currentUser;
    } else {
      try {
        const local = localStorage.getItem("lockin_local_user");
        if (local) {
          const parsed = JSON.parse(local);
          _uid = parsed.uid || "local_athlete";
          _user = parsed;
        }
      } catch (e) {}
    }
  }

  // Ha még nincsenek üzenetek, jelenítsük meg a kezdő kártyát
  const msgContainer = $("ai-chat-messages");
  if (msgContainer && msgContainer.children.length === 0) {
    _renderInitialGreeting();
  }

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  // Kétrépcsős rAF a vajpuha CSS transition animációhoz
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = "translateY(0)";
    });
  });

  // Fókusz az inputra kis késleltetéssel
  setTimeout(() => {
    const input = $("ai-chat-input");
    if (input) input.focus();
  }, 350);

  // Háttérben előkészítjük a heti adatokat és az AI SDK kapcsolatot
  if (_uid) {
    _fetchFullUserContext(_uid).catch(e => console.warn(e));
  }
  _ensureFirebaseAI().catch(e => console.warn(e));
}

export function closeAIChat() {
  const modal = $("ai-chat-modal");
  const sheet = $("ai-chat-sheet");
  if (!modal || !sheet) return;

  sheet.style.transform = "translateY(100%)";
  setTimeout(() => {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }, 340);
}

export function clearAIChat() {
  _chatSession = null;
  _hasSentContext = false;
  _cachedContext = null;
  _chatHistory = [];
  _ensureFirebaseAI();

  const msgContainer = $("ai-chat-messages");
  if (msgContainer) {
    msgContainer.innerHTML = "";
    _renderInitialGreeting();
  }
}

// ── Üzenetküldés és Multi-turn Memória ──────────────────────
async function _handleSendMessage(userText) {
  if (_isSending || !userText) return;

  const inputEl = $("ai-chat-input");
  const sendBtn = $("ai-chat-send-btn");
  const loadingEl = $("ai-chat-loading");

  _isSending = true;
  if (inputEl) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    inputEl.disabled = true;
  }
  if (sendBtn) sendBtn.disabled = true;

  // 1. Felhasználói buborék azonnali megjelenítése
  _appendUserBubble(userText);
  _scrollToBottom();

  // 2. Töltés indikátor bekapcsolása (Pulzáló Lockin AI ikon)
  if (loadingEl) loadingEl.classList.remove("hidden");
  _scrollToBottom();

  try {
    // 3. Háttérben a Firestore kontextus lekérése
    let userContext = _cachedContext;
    if (!userContext && _uid) {
      userContext = await _fetchFullUserContext(_uid);
    } else if (!_contextData && _uid) {
      await _fetchFullUserContext(_uid);
    }

    let fullPrompt = userText;
    if (!_hasSentContext && userContext) {
      fullPrompt = `[FELHASZNÁLÓ UTASÍTÁSA / KÉRDÉSE]:
${userText}

[SZABÁLYOK A VÁLASZADÁSHOZ]:
- Ha a felhasználó egy edzést kér általánosságban (pl. "írj egy edzést", "írj egy lábedzést", "készíts edzéstervet", "mit egyek"): ÍRJ MAGADTÓL egy teljes, szakszerű programot vagy receptet! Ne korlátozd magad a mentett adatokra!
- Ha a felhasználó kifejezetten azt kéri, hogy a meglévő / mentett gyakorlatokból állíts össze egy edzést: vedd figyelembe szigorúan az alább megadott mentett gyakorlatokat és sablonokat, és kizárólag azokból válogass!
- Heti adatelemzést vagy figyelmeztetést kizárólag akkor írj, ha a felhasználó kifejezetten heti elemzést vagy az adatairól kérdez!

[HÁTTÉR ADATOK ÉS MENTETT ELEMEK]:
${userContext}`;
      _hasSentContext = true;
    }

    let responseText = "";

    // 4. API hívási prioritási lánc:
    // A) Közvetlen Google AI Studio Gemini API kulcs használata (ha be van állítva)
    const directApiKey = localStorage.getItem("lockin_gemini_api_key") || _contextData?.geminiApiKey;
    if (directApiKey) {
      try {
        responseText = await _callGeminiDirect(directApiKey, userText, userContext || "", _chatHistory);
      } catch (gemErr) {
        console.warn("[Lockin AI] Direct Gemini API hiba, átváltás tartalék motorra:", gemErr?.message || gemErr);
      }
    }

    // B) Ha nem volt kulcs vagy nem sikerült, próbáljuk a Firebase Vertex AI-t
    if (!responseText) {
      try {
        await _ensureFirebaseAI();
        if (_chatSession) {
          const result = await _chatSession.sendMessage(fullPrompt);
          const resp = await result.response;
          responseText = resp.text();
        }
      } catch (sdkErr) {
        console.warn("[Lockin AI] Firebase Vertex AI nem elérhető, beépített elit motor aktiválása:", sdkErr?.message || sdkErr);
      }
    }

    // C) Ha egyik felhő-hívás sem működik (pl. App Check 401 hiba),
    // a beépített elit sportanalitikai intelligens motor generál konkrét választ:
    if (!responseText) {
      responseText = _generateEliteSportsResponse(userText, _contextData, _chatHistory);
    }

    // 5. Multi-turn memória frissítése
    _chatHistory.push({ role: "user", content: userText });
    _chatHistory.push({ role: "model", content: responseText });

    // 6. Válasz megjelenítése szépen formázott Markdownként
    if (loadingEl) loadingEl.classList.add("hidden");
    _appendAIBubble(responseText);

  } catch (err) {
    console.warn("[Lockin AI] Váratlan hiba:", err);
    if (loadingEl) loadingEl.classList.add("hidden");

    // Soha nem írunk ki nyers hibaüzenetet a felhasználónak!
    const answer = _generateEliteSportsResponse(userText, _contextData, _chatHistory);
    _chatHistory.push({ role: "user", content: userText });
    _chatHistory.push({ role: "model", content: answer });
    _appendAIBubble(answer);
  } finally {
    _isSending = false;
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
    _scrollToBottom();
  }
}

// ── Közvetlen Google AI Studio Gemini REST API Hívás ────────
async function _callGeminiDirect(apiKey, userText, userContext, chatHistory = []) {
  const contents = [];

  // Rendszer utasítás és 7 napos kontextus
  contents.push({
    role: "user",
    parts: [{
      text: `${SYSTEM_INSTRUCTION}\n\n[HÁTTÉR ADATOK ÉS MENTETT ELEMEK]:\n${userContext}`
    }]
  });
  contents.push({
    role: "model",
    parts: [{
      text: "Értettem! Figyelek a parancs pontos szándékára. Ha általánosságban kérsz edzést vagy étkezést, magamtól készítek profi, komplett edzéstervet vagy receptet. Csak akkor veszem szigorúan alapul a mentett adatokat, ha kifejezetten a meglévő/mentett gyakorlatokból vagy adatokból kérted az összeállítást. Nem szúrok be kéretlen heti elemzést vagy figyelmeztetéseket."
    }]
  });

  // Előző beszélgetési körök hozzáadása (utolsó 6 kör a kontextushoz)
  if (Array.isArray(chatHistory)) {
    chatHistory.slice(-6).forEach(item => {
      contents.push({
        role: item.role === "user" ? "user" : "model",
        parts: [{ text: item.content || "" }]
      });
    });
  }

  // Aktuális kérdés
  contents.push({
    role: "user",
    parts: [{ text: userText }]
  });

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  // 1. Megpróbáljuk a gemini-1.5-flash modellt
  let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  // 2. Ha 1.5 nem elérhető vagy hibát dob, megpróbáljuk gemini-2.0-flash modellt
  if (!response.ok) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  if (!response.ok) {
    throw new Error(`Gemini API HTTP hiba: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Üres válasz érkezett a Gemini modelltől");
  }
  return text;
}

// ── UI Buborékok Megjelenítése ─────────────────────────────
function _renderInitialGreeting() {
  const container = $("ai-chat-messages");
  if (!container) return;

  const greetingDiv = document.createElement("div");
  greetingDiv.className = "p-4 rounded-3xl bg-white dark:bg-[#14161F] border border-gray-200 dark:border-[#222532] shadow-sm space-y-3 transition-colors";
  greetingDiv.innerHTML = `
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-xl p-[1px] bg-gradient-to-tr from-[#00E5FF] to-fuchsia-500 flex items-center justify-center">
        <div class="w-full h-full rounded-[11px] bg-white dark:bg-[#0C0E12] flex items-center justify-center overflow-hidden">
          <img src="./logolight.jpg" alt="Lockin AI" class="w-full h-full object-cover block dark:hidden" onerror="this.style.display='none';" />
          <img src="./logodark.jpg" alt="Lockin AI" class="w-full h-full object-cover hidden dark:block" onerror="this.style.display='none';" />
        </div>
      </div>
      <div>
        <h4 class="text-xs font-extrabold text-gray-900 dark:text-white">Szia! A Lockin AI edződ vagyok.</h4>
        <p class="text-[10px] text-gray-500 dark:text-gray-400">Kérdezz bátran edzésről, regenerációról vagy táplálkozásról.</p>
      </div>
    </div>
    <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
      Kérhetsz tőlem önállóan felépített edzésprogramot vagy receptet, illetve ha kifejezetten kéred, a mentett gyakorlataidból és sablonjaidból is összeállítom az edzésedet!
    </p>
    <div class="pt-1 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-600 dark:text-cyan-400">
      <i class="fa-solid fa-sparkles text-[10px]"></i>
      <span>Válassz a fenti gyorsgombokból vagy írj be egy kérdést!</span>
    </div>
  `;
  container.appendChild(greetingDiv);
}

function _appendUserBubble(text) {
  const container = $("ai-chat-messages");
  if (!container) return;

  const bubble = document.createElement("div");
  bubble.className = "flex justify-end";
  bubble.innerHTML = `
    <div class="max-w-[85%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-gradient-to-r from-cyan-600 via-indigo-600 to-indigo-700 text-white text-xs font-medium shadow-md leading-relaxed whitespace-pre-wrap break-words">
      ${_escapeHtml(text)}
    </div>
  `;
  container.appendChild(bubble);
}

function _appendAIBubble(markdownText) {
  const container = $("ai-chat-messages");
  if (!container) return;

  const bubble = document.createElement("div");
  bubble.className = "flex items-start gap-2.5";

  const formattedHtml = _formatMarkdown(markdownText);

  bubble.innerHTML = `
    <div class="w-7 h-7 rounded-xl p-[1px] bg-gradient-to-tr from-[#00E5FF] via-indigo-500 to-fuchsia-500 flex-shrink-0 mt-0.5">
      <div class="w-full h-full rounded-[10px] bg-white dark:bg-[#0C0E12] flex items-center justify-center overflow-hidden">
        <img src="./logolight.jpg" alt="AI" class="w-full h-full object-cover block dark:hidden" onerror="this.style.display='none';" />
        <img src="./logodark.jpg" alt="AI" class="w-full h-full object-cover hidden dark:block" onerror="this.style.display='none';" />
      </div>
    </div>
    <div class="max-w-[90%] sm:max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-white dark:bg-[#151720] border border-gray-200 dark:border-[#232736] text-gray-800 dark:text-gray-200 text-xs shadow-xs leading-relaxed break-words space-y-2 transition-colors">
      ${formattedHtml}
    </div>
  `;
  container.appendChild(bubble);
}

function _scrollToBottom() {
  const container = $("ai-chat-messages");
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// ── Markdown Formázó (Apple / Whoop Stílus) ────────────────
function _formatMarkdown(src) {
  if (!src) return "";

  let out = src;

  // 1. [⚠️ FIGYELMEZTETÉS] kiemelés az Apple/Whoop stílusban
  out = out.replace(/\[⚠️\s*FIGYELMEZTETÉS\]([^\n]+(?:\n[^\n]+)*)/gi, (match, body) => {
    return `<div class="p-3 my-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-medium shadow-inner">
      <div class="flex items-center gap-1.5 font-bold mb-1 text-amber-600 dark:text-amber-400">
        <i class="fa-solid fa-triangle-exclamation text-amber-600 dark:text-amber-400"></i> FIGYELMEZTETÉS
      </div>
      <div class="text-amber-700 dark:text-amber-200/90 leading-relaxed">${body.trim()}</div>
    </div>`;
  });

  // 2. Fejlécek
  out = out.replace(/^### (.*$)/gim, '<h4 class="text-xs font-extrabold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider mt-3 mb-1">$1</h4>');
  out = out.replace(/^## (.*$)/gim, '<h3 class="text-sm font-extrabold text-gray-900 dark:text-white mt-3.5 mb-1">$1</h3>');
  out = out.replace(/^# (.*$)/gim, '<h2 class="text-base font-black text-gray-900 dark:text-white mt-4 mb-1.5">$1</h2>');

  // 3. Félkövér kiemelések (**szöveg**)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-extrabold text-gray-900 dark:text-white tracking-wide">$1</strong>');

  // 4. Dőlt szövegek (*szöveg*)
  out = out.replace(/\*([^*]+)\*/g, '<em class="text-gray-600 dark:text-slate-300">$1</em>');

  // 5. Kódblokkok (```lang ... ```)
  out = out.replace(/```([\s\S]*?)```/g, '<pre class="p-2.5 rounded-xl bg-gray-100 dark:bg-[#0B0C0E] border border-gray-200 dark:border-[#222530] text-[11px] font-mono text-cyan-700 dark:text-cyan-300 overflow-x-auto my-2"><code>$1</code></pre>');

  // 6. Soron belüli kód (`kód`)
  out = out.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-[#0B0C0E] border border-gray-200 dark:border-[#20222A] text-cyan-700 dark:text-cyan-300 font-mono text-[11px]">$1</code>');

  // 7. Felsorolások listázása (- vagy *)
  const lines = out.split("\n");
  let inUl = false;
  let inOl = false;
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const numMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);

    if (bulletMatch) {
      if (!inUl) {
        if (inOl) { processedLines.push("</ol>"); inOl = false; }
        processedLines.push('<ul class="list-disc pl-4 space-y-1 my-1 text-xs text-gray-200">');
        inUl = true;
      }
      processedLines.push(`<li>${bulletMatch[1]}</li>`);
    } else if (numMatch) {
      if (!inOl) {
        if (inUl) { processedLines.push("</ul>"); inUl = false; }
        processedLines.push('<ol class="list-decimal pl-4 space-y-1 my-1 text-xs text-gray-200">');
        inOl = true;
      }
      processedLines.push(`<li>${numMatch[2]}</li>`);
    } else {
      if (inUl) { processedLines.push("</ul>"); inUl = false; }
      if (inOl) { processedLines.push("</ol>"); inOl = false; }
      if (line.trim().length > 0) {
        if (!line.startsWith("<div") && !line.startsWith("<h") && !line.startsWith("</div") && !line.startsWith("<pre")) {
          processedLines.push(`<p class="leading-relaxed mb-1.5">${line}</p>`);
        } else {
          processedLines.push(line);
        }
      }
    }
  }

  if (inUl) processedLines.push("</ul>");
  if (inOl) processedLines.push("</ol>");

  return processedLines.join("\n");
}

function _escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ── Mentett és Meglévő Gyakorlatok Kigyűjtése ────────────────
function _extractAllSavedExercises(c) {
  const list = [];
  const seen = new Set();

  function addEx(name, category, details) {
    if (!name) return;
    const cleanName = String(name).trim();
    if (!cleanName || cleanName.length < 2) return;
    const key = cleanName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      name: cleanName,
      category: category || "Erőnlét / Általános",
      details: details || ""
    });
  }

  // 1. Saját mentett egyedi gyakorlatok Firestore-ból
  if (Array.isArray(c?.customExercisesDocs)) {
    c.customExercisesDocs.forEach(d => {
      addEx(d.name, d.category || d.targetMuscle, d.notes || (d.sets && d.reps ? `${d.sets} × ${d.reps}` : ""));
    });
  }

  // 2. Mentett edzéssablonokból kinyert gyakorlatok
  if (Array.isArray(c?.routinesDocs)) {
    c.routinesDocs.forEach(rt => {
      if (Array.isArray(rt.exercises)) {
        rt.exercises.forEach(e => {
          if (typeof e === "string") addEx(e, rt.name);
          else if (e && e.name) addEx(e.name, e.category || rt.name, e.sets && e.reps ? `${e.sets} × ${e.reps}` : "");
        });
      } else if (typeof rt.exercises === "string") {
        rt.exercises.split("\n").forEach(line => {
          const trimmed = line.trim();
          if (trimmed) addEx(trimmed, rt.name);
        });
      }
    });
  }

  // 3. Korábbi naplózott edzésekből kinyert gyakorlatok
  if (Array.isArray(c?.workoutDocs)) {
    c.workoutDocs.forEach(w => {
      if (typeof w.exercises === "string") {
        w.exercises.split("\n").forEach(line => {
          const trimmed = line.trim();
          if (trimmed) addEx(trimmed, w.name || w.sport);
        });
      } else if (Array.isArray(w.exercises)) {
        w.exercises.forEach(e => {
          if (typeof e === "string") addEx(e, w.name);
          else if (e && e.name) addEx(e.name, e.category || w.name);
        });
      }
    });
  }

  // 4. Ha a felhasználónak még nincs saját mentett eleme, a beépített tár alapjait kínáljuk
  if (list.length === 0 && Array.isArray(DEFAULT_EXERCISES)) {
    DEFAULT_EXERCISES.forEach(de => {
      addEx(de.name, de.category, de.targetMuscle);
    });
  }

  return list;
}

// ── Önállóan Megírt Edzéstervezés (Ha általánosságban kérnek edzést) ──
function _generateSelfDirectedWorkout(userText, c) {
  const q = (userText || "").toLowerCase();
  
  const isLegs = q.includes("láb") || q.includes("comb") || q.includes("guggolás") || q.includes("vádli") || q.includes("lower");
  const isChest = q.includes("mell") || q.includes("fekvenyomás") || q.includes("push") || q.includes("mellnap");
  const isBack = q.includes("hát") || q.includes("húzódzkodás") || q.includes("evezés") || q.includes("pull") || q.includes("hátnap");
  const isShouldersArms = q.includes("váll") || q.includes("kar") || q.includes("bicepsz") || q.includes("tricepsz");
  const isUpper = q.includes("felsőtest") || q.includes("upper");
  const isRunning = q.includes("futás") || q.includes("futó") || q.includes("run");
  const isCycling = q.includes("bringa") || q.includes("bicikli") || q.includes("kerékpár") || q.includes("cycling");
  const isHIIT = q.includes("hiit") || q.includes("intervallum") || q.includes("tabata");
  const isHome = q.includes("otthon") || q.includes("saját testsúly") || q.includes("calisthenics");

  if (isLegs) {
    return `### 🏋️ Elit Láb és Alsótest Edzésprogram (Önálló Tervezés)

A kérésedre készítettem egy prémium, hipertrófiát és erőt maximalizáló alsótest edzéstervet:

**1. Bemelegítés & Ízületi Mobilizáció (8-10 perc):**
- **5 perc** könnyű kerékpározás vagy dinamikus séta.
- Boka- és csípőmobilizáció: mély guggolás kitartás (Deep Squat Hold) **2 × 45 mp**, láblengetések előre-hátra és oldalra **15 / láb**, csípőhorpasz nyújtás dinamikusan.
- Bemelegítő guggolások: üres rúddal **2 × 10**, majd 50%-os és 70%-os munkasúllyal **1-1 felvezető széria**.

**2. Fő rész (Gyakorlatok, szériák és ismétlésszámok):**
- **1. Guggolás rúddal háton (Barbell Back Squat):** **4 sorozat × 6-8 ismétlés** (Pihenő: **2.5 - 3 perc**, RPE 8, feszes törzs, mély csípősüllyesztés).
- **2. Román felhúzás kézisúlyzóval (Dumbbell RDL):** **3 sorozat × 8-10 ismétlés** (Pihenő: **2 perc**, hangsúly a combhajlító és a gluteus excentrikus nyúlásán).
- **3. Bolgár guggolás padon (Bulgarian Split Squat):** **3 sorozat × 10-12 ismétlés / láb** (Pihenő: **90 mp**, kiváló stabilizáció és combfeszítő inger).
- **4. Lábtolás gépen (Leg Press):** **3 sorozat × 12-15 ismétlés** (Pihenő: **90 mp**, lábfejek vállszélességben, 2 másodperces kontrollált leengedéssel).
- **5. Álló vádliemelés:** **4 sorozat × 12-15 ismétlés** (Pihenő: **60 mp**, a tetőponton 2 másodperces csúcsösszehúzódással, alsó ponton mély nyújtással).

**3. Levezetés & Regeneráció (6-8 perc):**
- **5 perc** laza levezető séta.
- Statikus combfeszítő-, combhajlító- és vádlinyújtás (**30-40 mp** / izomcsoport).

**💡 Edzői tanács:** Ügyelj a progresszív túlterhelésre; ha minden szériában eléred a felső ismétléshatárt hibátlan formával, a következő héten növeld a súlyt 2.5-5 kg-mal!`;
  }

  if (isChest) {
    return `### 🏋️ Elit Mell & Tricepsz Push Edzésprogram (Önálló Tervezés)

A kérésedre készítettem egy komplett, a mellizmokat minden szögből megdolgoztató push edzésprogramot:

**1. Bemelegítés & Lapockamobilizáció (8 perc):**
- Rotátorköpeny aktiváció gumiszalaggal (külső-belső rotáció, Face Pull szalaggal) **2 × 15**.
- Karkörzések, lapockazárások és **2 × 12** szabályos fekvőtámasz fokozatos tempóban.
- Fekvenyomás bemelegítés: üres rúddal **15 ismétlés**, majd két felvezető sorozat.

**2. Fő rész (Gyakorlatok, szériák és ismétlésszámok):**
- **1. Fekvenyomás vízszintes padon rúddal:** **4 sorozat × 6-8 ismétlés** (Pihenő: **2-3 perc**, RPE 8, lapockák stabilan zárva, kontrollált érintés a mellkason).
- **2. Ferdepados kézisúlyzós nyomás (30 fokos szög):** **4 sorozat × 8-10 ismétlés** (Pihenő: **90-120 mp**, a felső mellkasi rostok célzott terhelése).
- **3. Csigás tárogatás (Cable Fly) vagy Tolódzkodás:** **3 sorozat × 10-12 ismétlés** (Pihenő: **90 mp**, alsó ponton maximális mellizom nyúlás, csúcsponton 1 mp feszítés).
- **4. Kézisúlyzós vállból nyomás ülve:** **3 sorozat × 8-10 ismétlés** (Pihenő: **90 mp**, könyökök enyhén a test előtt, tiszta függőleges pálya).
- **5. Köteles tricepsz letolás csigán:** **3 sorozat × 12-15 ismétlés** (Pihenő: **60 mp**, az alsó ponton a kötél végeit szétnyitva a laterális fej maximális stimulációjához).

**3. Levezetés & Nyújtás (5-8 perc):**
- Mellizom nyújtás bordásfalnál vagy ajtókeretnél karonként **40-45 mp**.
- Tricepsz- és elülső vállnyújtás, levezető mélylégzés.

**💡 Edzői tanács:** A mellgyakorlatoknál a koncentrikus (felfelé toló) szakasz legyen robbanékony (1 mp), az excentrikus (leengedő) szakasz pedig kontrollált (2-3 mp)!`;
  }

  if (isBack) {
    return `### 🏋️ Elit Hát & Bicepsz Pull Edzésprogram (Önálló Tervezés)

A kérésedre készítettem egy komplett hát és bicepsz edzéstervet a V-alakú hát és vastag hátizmok építéséhez:

**1. Bemelegítés & Gerincmobilizáció (8 perc):**
- Háti gerinc extenzió és Macska-Kutya póz **10-12 átmozgatás**.
- Lapockazárások (Scapular pull-ups) függeszkedve **2 × 8**.
- Gumiszalagos hátrahúzások a lapockaközi izmok aktiválásához.

**2. Fő rész (Gyakorlatok, szériák és ismétlésszámok):**
- **1. Húzódzkodás saját testsúllyal (vagy Csigás lehúzás mellhez széles fogással):** **4 sorozat × 6-8 ismétlés** (Pihenő: **2 perc**, alsó ponton teljes nyúlás, felül a mellkas érinti a rudat).
- **2. Döntött törzsű evezés rúddal (Barbell Row):** **4 sorozat × 8-10 ismétlés** (Pihenő: **2 perc**, törzs 45 fokban stabil, rúd a köldök felé húzva).
- **3. Egykezes kézisúlyzós evezés padon támaszkodva:** **3 sorozat × 10-12 ismétlés / oldal** (Pihenő: **90 mp**, teljes mozgástartomány, a felső ponton a lapocka zárásával).
- **4. Arcra húzás csigán kötéllel (Face Pull):** **3 sorozat × 15 ismétlés** (Pihenő: **60 mp**, a hátsó delta és a külső rotátorok védelmére, könyökök magasan).
- **5. Bicepszhajlítás francia rúddal állva:** **3 sorozat × 10-12 ismétlés** (Pihenő: **60-90 mp**, könyökök rögzítve a törzs mellett).

**3. Levezetés (5-7 perc):**
- Nyújtott karú függeszkedés a húzódzkodó rúdon a gerinc tehermentesítésére (**2 × 30-40 mp**).
- Széles hátizom és bicepsz statikus nyújtása.

**💡 Edzői tanács:** Húzó mozdulatoknál koncentrálj arra, hogy a mozdulatot a lapockád hátrahúzásával kezdd, ne pusztán a karoddal tépd a súlyt!`;
  }

  if (isShouldersArms) {
    return `### 🏋️ Váll és Kar Hipertrófia Edzés (Önálló Tervezés)

A kérésedre készítettem egy dedikált váll- és karedzést a háromdimenziós vállakért és telt karokért:

**1. Bemelegítés (8 perc):**
- Vállízületi körzések, Y-T-W emelések talajon vagy padon **2 × 10**.
- Két könnyű felvezető sorozat kézisúlyzóval.

**2. Fő rész:**
- **1. Vállból nyomás állva rúddal (Military Press):** **4 sorozat × 6-8 ismétlés** (Pihenő: **2 perc**, feszített has és fenék, fej kibújik a rúd alatt).
- **2. Oldalemelés kézisúlyzóval:** **4 sorozat × 12-15 ismétlés** (Pihenő: **60-90 mp**, kisujj enyhén feljebb emelkedik, feszítés a laterális deltában).
- **3. Döntött törzsű hátsó delta emelés kézisúllyal:** **3 sorozat × 12-15 ismétlés** (Pihenő: **60 mp**).
- **4. Francia nyomás fekve francia rúddal (Skull Crusher):** **3 sorozat × 10-12 ismétlés** (Pihenő: **90 mp**, könyökök stabilak, mély nyúlás a fej mögött).
- **5. Bicepszhajlítás ferdepadon kézisúlyzóval:** **3 sorozat × 10-12 ismétlés** (Pihenő: **90 mp**, a hosszú fej maximális megnyúlása).
- **6. Köteles kalapács bicepszhajlítás + tricepsz letolás szuperszett:** **3 sorozat × 12-15 ismétlés** (Pihenő: **60 mp** a szuperszettek után).

**3. Levezetés & Nyújtás (5 perc):**
- Váll-, bicepsz- és tricepsznyújtás, karok ellazítása.`;
  }

  if (isUpper) {
    return `### 🏋️ Komplett Felsőtest (Upper Body) Edzésprogram (Önálló Tervezés)

A kérésedre készítettem egy anatómiailag kiegyensúlyozott felsőtest edzéstervet:

**1. Bemelegítés (8 perc):**
- Karkörzések, rotátorköpeny aktiváció, 2 sorozat fekvőtámasz és lapockazárás.

**2. Fő rész:**
- **1. Fekvenyomás rúddal vízszintes padon:** **4 sorozat × 6-8 ismétlés** (Pihenő: **2-2.5 perc**).
- **2. Döntött törzsű evezés rúddal:** **4 sorozat × 8-10 ismétlés** (Pihenő: **2 perc**).
- **3. Kézisúlyzós vállból nyomás ülve:** **3 sorozat × 8-10 ismétlés** (Pihenő: **90 mp**).
- **4. Csigás lehúzás mellhez széles fogással:** **3 sorozat × 10-12 ismétlés** (Pihenő: **90 mp**).
- **5. Oldalemelés kézisúlyzóval:** **3 sorozat × 12-15 ismétlés** (Pihenő: **60 mp**).
- **6. Kar szuperszett (Bicepsz hajlítás francia rúddal + Csigás tricepsz letolás):** **3 sorozat × 10-12 ismétlés** (Pihenő: **60 mp**).

**3. Levezetés (5 perc):**
- Felsőtest nyújtás bordásfalnál, függeszkedés rúdon.`;
  }

  if (isRunning) {
    return `### 🏃 Minőségi Futóedzés és Intervallum Terv (Önálló Tervezés)

A kérésedre készítettem egy tudományosan felépített futóedzést az állóképesség és a laktátküszöb fejlesztésére:

**1. Bemelegítés & Futóiskola (12 perc):**
- **8 perc** könnyű, laza kocogás (Zóna 1-2 pulzustartomány).
- Dinamikus futóiskolai gyakorlatok: szökdelések, sarokemelés, térdemelés, oldalazó futás (**2 × 20 méter** mindegyikből), majd **2 db 60 méteres fokozó futás**.

**2. Fő rész (Küszöb Tempó Intervallumok):**
- **5 x 800 méter küszöbtempóban** (A becsült 10 km-es versenytempódban, vagy a maximális pulzusod **85-90%**-án).
- **Pihenő az ismétlések között:** **90 másodperc** könnyű, sétáló vagy nagyon lassú kocogó regeneráció.
- **Kadencia cél:** Tartsd a lépésszámot **170-180 spm** között a becsapódási ízületi terhelés csökkentésére.

**3. Levezetés & Nyújtás (10 perc):**
- **6-8 perc** nagyon laza regeneráló kocogás/séta.
- Vádli, combfeszítő, combhajlító és piriformis alapos nyújtása.

**💡 Edzői tanács:** Az első 800 méteres blokkot ne kezd túl gyorsan; a cél az, hogy az 5. blokkban is ugyanolyan gyors és fegyelmezett tudj maradni, mint az elsőben!`;
  }

  if (isCycling) {
    return `### 🚴 Kerékpáros Sweet Spot & Erő-állóképességi Edzés (Önálló Tervezés)

A kérésedre készítettem egy strukturált kerékpáros edzést a funkcionális küszöbteljesítmény (FTP) növelésére:

**1. Bemelegítés (15 perc):**
- **10 perc** fokozatos Z1-Z2 pörgetés (**90-95 RPM** pedálfordulattal).
- **3 x 30 másodperc pörgetés** (**105+ RPM** könnyű ellenálláson, 1 perc laza gurulással közte).

**2. Fő rész (Sweet Spot Blokkok):**
- **3 x 10 perc Sweet Spot intenzitás** (az FTP **88 - 93%**-án, vagy pulzus alapon a Z4 alsó tartományában, **85-90 RPM** kadenciával).
- **Pihenő:** A blokkok között **4 perc** nagyon laza gurulás (Z1 zóna).

**3. Levezetés (10 perc):**
- **10 perc** laza, pörgető levezetés Z1-ben, légzés normalizálása.

**💡 Edzői tanács:** Fogyassz legalább **500-750 ml folyadékot elektrolittal** az edzés alatt a magas izzadási ráta kompenzálására!`;
  }

  if (isHome) {
    return `### 🏠 Saját Testsúlyos / Otthoni Calisthenics Edzés (Önálló Tervezés)

A kérésedre készítettem egy eszközök nélkül, bárhol elvégezhető, nagy intenzitású teljes testes edzésprogramot:

**1. Bemelegítés (6 perc):**
- Csukló- és vállmobilizáció, terpesz-zár szökdelés (Jumping Jacks) **2 × 40 mp**, guggolás testsúllyal **15 ismétlés**.

**2. Fő rész (4 kör, a körök között 90 másodperc pihenővel):**
- **1. Szabályos fekvőtámasz:** **12-15 ismétlés** (mellkas a talajt közelíti, feszített törzs).
- **2. Ugróguggolás (Jump Squat):** **12-15 ismétlés** (robbanékony elrugaszkodás, puha talajfogás).
- **3. Hátsó tolódzkodás széken vagy kanapén:** **12-15 ismétlés** (tricepsz fókusz).
- **4. Sétáló vagy hátrafelé kitörés:** **10-10 ismétlés / láb** (egyensúly és combizom terhelés).
- **5. Pike Push-up (Csípő emelt fekvőtámasz):** **8-10 ismétlés** (a vállizmok megdolgoztatására).
- **6. Hegymászó (Mountain Climbers) + Plank:** **40 mp pörgős hegymászó**, majd azonnal **30 mp statikus plank**.

**3. Levezetés (5 perc):**
- Kobra póz hasnyújtáshoz, Gyermekpóz a hát lazítására, alsóvégtag nyújtások.`;
  }

  // Alapértelmezett: Prémium Full Body Erőnléti & Hipertrófia Edzés
  return `### 🏋️ Elit Teljes Test (Full Body) Edzésprogram (Önálló Tervezés)

A kérésedre (**"${_escapeHtml(userText)}"**) készítettem egy komplett, az egész testet komplexen stimuláló prémium edzésprogramot:

**1. Bemelegítés & Ízületi Mobilizáció (8-10 perc):**
- **5 perc** pulzusemelés (kocogás, szobabicikli vagy ugrálókötél).
- Ízületi mobilizáció: kar-, váll- és csípőkörzések, mély guggolás póz kitartása **45 mp**.
- Dinamikus lapockazárások és **2 sorozat** felvezető fekvőtámasz / saját testsúlyos guggolás.

**2. Fő rész (Összetett alapgyakorlatok a maximális stimulációért):**
- **1. Guggolás rúddal (Barbell Squat):** **4 sorozat × 6-8 ismétlés** (Pihenő: **2.5 perc**, RPE 8, feszes törzs, mély csípősüllyesztés).
- **2. Fekvenyomás vízszintes padon rúddal (Bench Press):** **4 sorozat × 6-8 ismétlés** (Pihenő: **2 perc**, lapockák rögzítve, mellkasból indított robbanékony tolás).
- **3. Döntött törzsű evezés rúddal (Barbell Row):** **3 sorozat × 8-10 ismétlés** (Pihenő: **90-120 mp**, stabil derék, lapockazárás a tetőponton).
- **4. Vállból nyomás állva kézisúllyal (Overhead Press):** **3 sorozat × 8-10 ismétlés** (Pihenő: **90 mp**, törzs feszes, tiszta fej feletti kinyújtás).
- **5. Román felhúzás kézisúlyzóval (RDL):** **3 sorozat × 10-12 ismétlés** (Pihenő: **90 mp**, combhajlító és gluteus nyújtás egyenes háttal).
- **6. Plank & Törzsstabilizáció:** **3 sorozat × 45-60 másodperc** (Pihenő: **60 mp**, has és farizom kőkeményen megfeszítve).

**3. Levezetés & Nyújtás (6-8 perc):**
- **5 perc** levezető séta.
- Alapos statikus nyújtás az egész testre: combfeszítő, combhajlító, mellkas és széles hátizom.

**💡 Edzői tanács:** Minden gyakorlatnál válaszd meg úgy a súlyt, hogy az utolsó ismétlés után még maximum 1-2 tiszta ismétlés maradjon benned (RPE 8-8.5). Tartsd be a pihenőidőket a maximális erőkifejtéshez!`;
}

// ── Edzéstervezés Szigorúan a Meglévő / Mentett Gyakorlatokból ──
function _generateWorkoutFromSavedExercises(userText, c) {
  const q = (userText || "").toLowerCase();
  const allSaved = _extractAllSavedExercises(c);
  const hasUserCustom = (c?.customExercisesDocs && c.customExercisesDocs.length > 0) || (c?.routinesDocs && c.routinesDocs.length > 0);

  // Fókusz azonosítása ha a felhasználó megadta (pl. láb, mell, hát, felsőtest)
  let filtered = allSaved;
  let focusLabel = "Teljes testes";
  if (q.includes("láb") || q.includes("comb") || q.includes("guggolás") || q.includes("vádli") || q.includes("lower")) {
    focusLabel = "Láb / Alsótest fókuszú";
    const legMatches = allSaved.filter(e => {
      const text = `${e.name} ${e.category} ${e.details}`.toLowerCase();
      return text.includes("láb") || text.includes("guggol") || text.includes("comb") || text.includes("vádli") || text.includes("squat") || text.includes("press") || text.includes("deadlift") || text.includes("felhúz");
    });
    if (legMatches.length >= 3) filtered = legMatches;
  } else if (q.includes("mell") || q.includes("fekvenyomás") || q.includes("push")) {
    focusLabel = "Mell / Push fókuszú";
    const pushMatches = allSaved.filter(e => {
      const text = `${e.name} ${e.category} ${e.details}`.toLowerCase();
      return text.includes("mell") || text.includes("nyomás") || text.includes("fekve") || text.includes("toló") || text.includes("tricepsz") || text.includes("bench") || text.includes("press");
    });
    if (pushMatches.length >= 3) filtered = pushMatches;
  } else if (q.includes("hát") || q.includes("húzódzkodás") || q.includes("evezés") || q.includes("pull")) {
    focusLabel = "Hát / Pull fókuszú";
    const pullMatches = allSaved.filter(e => {
      const text = `${e.name} ${e.category} ${e.details}`.toLowerCase();
      return text.includes("hát") || text.includes("húz") || text.includes("evez") || text.includes("bicepsz") || text.includes("row") || text.includes("pull");
    });
    if (pullMatches.length >= 3) filtered = pullMatches;
  }

  // Kiválasztunk 5-6 reprezentatív gyakorlatot a mentett listából
  const selected = filtered.slice(0, 6);

  const usedListText = selected.map(e => `- **${e.name}** *(${e.category || 'Mentett gyakorlat'})*`).join("\n");
  const exerciseRows = selected.map((e, idx) => {
    const repScheme = e.details || "3-4 sorozat × 8-12 ismétlés";
    return `- **${idx + 1}. ${e.name}:** **${repScheme}** (pihenő: **60-90 mp**, RPE 7-8)`;
  }).join("\n");

  return `### 🏋️ Edzésterv Szigorúan a Meglévő Gyakorlataid Alapján (${focusLabel})

A kérésednek megfelelően **kizárólag az alkalmazásban meglévő / mentett gyakorlataidból és sablonjaidból** állítottam össze az edzést${hasUserCustom ? "" : " *(Mivel egyéni saját gyakorlatot még nem rögzítettél, a mentett adatbázis alapértelmezett elemeiből válogattam)*"}:

**Felhasznált meglévő gyakorlatok a Lockin adatbázisodból:**
${usedListText}

**1. Bemelegítés & Ízületi Mobilizáció (8 perc):**
- Általános pulzusemelés és a fenti gyakorlatok által érintett ízületek alapos dinamikus átmozgatása.

**2. Fő rész (sorozatok és ismétlésszámok):**
${exerciseRows}

**3. Levezetés & Nyújtás (5-8 perc):**
- Statikus levezető nyújtás a megdolgoztatott izomcsoportokra és levezető mélylégzés.

**💡 Edzői megjegyzés:** Ez az edzés szigorúan a Te meglévő gyakorlati elemeidre épült. Ha a Mentett Gyakorlatok vagy az Edzéssablonok fülön új gyakorlatokat rögzítesz, a legközelebbi összeállításba azokat is beépítem!`;
}

// ── Elit Sportanalitikai Intelligens Motor (Válaszgenerálás) ──
function _generateEliteSportsResponse(userText, ctx, chatHistory = []) {
  const c = ctx || {
    userName: _user?.displayName || "Sportoló",
    userWeight: 75,
    userHeight: 180,
    userAge: 28,
    calorieGoal: 2200,
    proteinGoal: 150,
    waterGoal: 2625,
    avgWater: 2400,
    avgProtein: 140,
    avgCalories: 2100,
    totalWorkoutMinutes7d: 280,
    totalWorkoutLoad7d: 320,
    heavyDaysCount: 2,
    recipesDocs: [],
    foodDbDocs: [],
    routinesDocs: [],
    workoutDocs: [],
    customExercisesDocs: []
  };

  const q = (userText || "").toLowerCase().trim();

  // 1. Kifejezett szándékok azonosítása
  // A) Meglévő / mentett gyakorlatok és sablonok kifejezett kérése
  const isAskingSavedExercises = 
    (q.includes("meglévő") && (q.includes("gyakorlat") || q.includes("edzés") || q.includes("sablon"))) ||
    (q.includes("mentett") && (q.includes("gyakorlat") || q.includes("edzés") || q.includes("sablon") || q.includes("terv"))) ||
    (q.includes("saját") && (q.includes("gyakorlat") || q.includes("sablon"))) ||
    q.includes("meglévőkből") ||
    q.includes("mentettekből") ||
    q.includes("sablonjaimból") ||
    q.includes("edzéssablonjaimból") ||
    (q.includes("gyakorlataimból") && (q.includes("állíts") || q.includes("készíts") || q.includes("írj") || q.includes("tervezz") || q.includes("csinálj")));

  // B) Meglévő / mentett ételek és receptek kifejezett kérése
  const isAskingSavedMeals = 
    (q.includes("mentett") && (q.includes("étel") || q.includes("kaja") || q.includes("recept"))) ||
    (q.includes("meglévő") && (q.includes("étel") || q.includes("kaja") || q.includes("recept"))) ||
    (q.includes("saját") && (q.includes("étel") || q.includes("kaja") || q.includes("recept"))) ||
    q.includes("kamrából");

  // C) Heti riport és adatelemzés kifejezett kérése
  const isWeeklyAnalysis = 
    q === "heti elemzés" || 
    q === "heti összegzés" || 
    q === "heti riport" || 
    q.includes("📊") ||
    (q.includes("heti") && (q.includes("elemzés") || q.includes("összegzés") || q.includes("riport") || q.includes("áttekintés") || q.includes("összefoglaló"))) ||
    ((q.includes("összegezd") || q.includes("értékeld") || q.includes("elemezd")) && (q.includes("hét") || q.includes("napom") || q.includes("teljesítményem")));

  // D) Személyes biometriai és státusz kérdés
  const isPersonalHealthCheck = 
    q.includes("hogy állok") ||
    q.includes("hogy áll a hidratációm") ||
    q.includes("mennyit ittam") ||
    q.includes("mennyit edzettem a héten") ||
    (q.includes("adataim") && (q.includes("alapján") || q.includes("szerint") || q.includes("elemz") || q.includes("riport"))) ||
    q.includes("státuszom");

  // 2. [⚠️ FIGYELMEZTETÉS] blokk:
  // KIZÁRÓLAG AKKOR generálódik, ha a felhasználó kifejezetten a heti állapotáról, adatairól vagy hidratációjáról kérdez!
  let warningBlock = "";
  if (isWeeklyAnalysis || isPersonalHealthCheck) {
    const warnings = [];
    const waterRatio = c.waterGoal > 0 ? (c.avgWater / c.waterGoal) : 1;
    const proteinRatio = c.proteinGoal > 0 ? (c.avgProtein / c.proteinGoal) : 1;

    if (waterRatio < 0.75 || (c.avgWater > 0 && c.avgWater < 1600)) {
      warnings.push(`Kritikus dehidratáció az elmúlt 7 napban! Átlagos beviteled mindössze **${c.avgWater} ml / nap** a kitűzött **${c.waterGoal} ml** helyett. A tartós folyadékhiány 10-15%-os aerob kapacitásvesztést és fokozott szívterhelést idéz elő.`);
    }

    if (proteinRatio < 0.75 || (c.avgProtein > 0 && c.avgProtein < Math.round(c.userWeight * 1.1))) {
      warnings.push(`Hiányos heti fehérjebevitel! Napi átlagod **${c.avgProtein}g** (cél: **${c.proteinGoal}g**, élsportolói minimum: **${Math.round(c.userWeight * 1.6)}g**). Ez közvetlenül hátráltatja a miofibrilláris regenerációt és a fehérjeszintézist.`);
    }

    if (c.totalWorkoutLoad7d > 450 || c.heavyDaysCount >= 4) {
      warnings.push(`Túledzettségi kockázat! Az elmúlt 7 napban rendkívül magas edzésterhelést rögzítettél (**${c.totalWorkoutLoad7d} TSS/Load**, **${c.heavyDaysCount} intenzív nap**). A szuperkompenzáció érdekében ma priorizáld az aktív pihenést vagy a korai lefekvést.`);
    }

    if (warnings.length > 0) {
      warningBlock = `[⚠️ FIGYELMEZTETÉS] ${warnings.join(" ")}\n\n`;
    }
  }

  // 3. Étrendkérés detektálása (Elsődlegesen ellenőrizzük, mert az "edzés után mit egyek" étkezési kérdés, nem edzésprogram!)
  const isPreWorkoutMeal = 
    q.includes("edzés előtt") || 
    q.includes("futás előtt") || 
    q.includes("bringa előtt") || 
    q.includes("verseny előtt") || 
    q.includes("pre-workout") || 
    (q.includes("előtt") && (q.includes("egyek") || q.includes("kaja") || q.includes("étel") || q.includes("étkezés") || q.includes("enni")));

  const isPostWorkoutMeal = 
    q.includes("edzés után") || 
    q.includes("futás után") || 
    q.includes("bringa után") || 
    q.includes("post-workout") || 
    q.includes("visszatöltés") || 
    (q.includes("után") && (q.includes("egyek") || q.includes("kaja") || q.includes("étel") || q.includes("étkezés") || q.includes("enni")));

  const isSpecificMeal = 
    isAskingSavedMeals ||
    q.includes("reggeli") || 
    q.includes("ebéd") || 
    q.includes("vacsora") || 
    q.includes("snack") || 
    q.includes("tízórai") || 
    q.includes("uzsonna") || 
    q.includes("recept") || 
    q.includes("mit főzzek") || 
    q.includes("ajánlj ételt") || 
    q.includes("mit egyek ma") || 
    q.includes("kaja ötlet") ||
    q.includes("mit egyek");

  const isFoodItemQuery = 
    q.includes("banán") || 
    q.includes("csoki") || 
    q.includes("édesség") || 
    q.includes("cukor") || 
    q.includes("datolya") || 
    q.includes("méz") || 
    q.includes("gyümölcs") || 
    q.includes("kávé");

  const isMealQuery = isAskingSavedMeals || isPreWorkoutMeal || isPostWorkoutMeal || isSpecificMeal || isFoodItemQuery;

  // 4. Edzéskérés detektálása (Csak akkor, ha nem étkezési kérdésről van szó!)
  const isWorkoutQuery = 
    isAskingSavedExercises ||
    (!isMealQuery && (
      q.includes("edzésterv") ||
      q.includes("edzéstervet") ||
      q.includes("gyakorlatsor") ||
      q.includes("lábnap") ||
      q.includes("mellnap") ||
      q.includes("hátnap") ||
      q.includes("vállnap") ||
      q.includes("push pull") ||
      q.includes("full body") ||
      q.includes("konditerem") ||
      q.includes("súlyzós") ||
      q.includes("futóedzés") ||
      q.includes("bringaedzés") ||
      q.includes("eddzek") ||
      q.includes("edzenék") ||
      ((q.includes("írj") || q.includes("állíts") || q.includes("készíts") || q.includes("tervezz") || q.includes("adj") || q.includes("ajánlj") || q.includes("milyen") || q.includes("mit")) &&
       (q.includes("edzés") || q.includes("edzést") || q.includes("tréning") || q.includes("workout") || q.includes("program")))
    ));

  // 5. Egyéb élettani és sporttudományi témák
  const isZone2AndHR = 
    q.includes("zóna 2") || 
    q.includes("zone 2") || 
    q.includes("pulzuszóna") || 
    q.includes("milyen pulzuson") || 
    q.includes("pulzus") || 
    q.includes("aerob küszöb") || 
    q.includes("orrlégzés") || 
    q.includes("zsírégető");

  const isVO2max = 
    q.includes("vo2") || 
    q.includes("intervallum") || 
    q.includes("4x4") || 
    q.includes("hiit") || 
    q.includes("küszöb") || 
    q.includes("laktát") || 
    q.includes("tejsav") || 
    q.includes("sprint");

  const isHydrationAndCramps = 
    q.includes("hidratáció") || 
    q.includes("víz") || 
    q.includes("folyadék") || 
    q.includes("mennyi vizet") || 
    q.includes("szomjúság") || 
    q.includes("dehidr") || 
    q.includes("görcs") || 
    q.includes("elektrolit") || 
    q.includes("sótabletta") || 
    q.includes("mit igyak");

  const isInjuryPain = 
    q.includes("fáj") || 
    q.includes("fájdalom") || 
    q.includes("sérülés") || 
    q.includes("térd") || 
    q.includes("vádli") || 
    q.includes("sípcsont") || 
    q.includes("achilles") || 
    q.includes("derék") || 
    q.includes("szúr") || 
    q.includes("gyullad");

  const isDOMSAndRecovery = 
    q.includes("izomláz") || 
    q.includes("doms") || 
    q.includes("merev") || 
    q.includes("feszül") || 
    q.includes("regeneráció") || 
    q.includes("szauna") || 
    q.includes("hideg vizes") || 
    q.includes("jeges") || 
    q.includes("henger") || 
    q.includes("smr") || 
    q.includes("nyújtás") || 
    q.includes("masszázs");

  const isSleepHRV = 
    q.includes("alvás") || 
    q.includes("sleep") || 
    q.includes("mélyalvás") || 
    q.includes("nem tudok aludni") || 
    q.includes("mikor feküdjek") || 
    q.includes("hrv") || 
    q.includes("fáradt") || 
    q.includes("kimerült") || 
    q.includes("whoop");

  const isSupplements = 
    q.includes("kreatin") || 
    q.includes("koffein") || 
    q.includes("magnézium") || 
    q.includes("béta-alanin") || 
    q.includes("bcaa") || 
    q.includes("omega") || 
    q.includes("vitamin") || 
    q.includes("kiegészítő");

  const isShoesGear = 
    q.includes("cipő") || 
    q.includes("futócipő") || 
    q.includes("felszerelés") || 
    q.includes("garmin") || 
    q.includes("mellkaspánt") || 
    q.includes("óra") || 
    q.includes("pedál") || 
    q.includes("kadencia");

  const isRacePacing = 
    q.includes("verseny") || 
    q.includes("maraton") || 
    q.includes("félmaraton") || 
    q.includes("10k") || 
    q.includes("5k") || 
    q.includes("tapering") || 
    q.includes("pacing") || 
    q.includes("tempó") || 
    q.includes("frissítés");

  const isMacros = 
    q.includes("fehérje") || 
    q.includes("protein") || 
    q.includes("makró") || 
    q.includes("szénhidrát") || 
    q.includes("kalória") || 
    q.includes("zsír") || 
    q.includes("fogyás") || 
    q.includes("deficit") || 
    q.includes("tömegelés");

  let body = "";

  // ══════════════════════════════════════════════════════════════
  // ÁGAK KIÉRTÉKELÉSE SZIGORÚAN A PARANCS SZÁNDÉKA SZERINT:
  // ══════════════════════════════════════════════════════════════

  // 1. KIFEJEZETT HETI ADATELEMZÉS KÉRÉSE
  if (isWeeklyAnalysis) {
    const hours = Math.floor(c.totalWorkoutMinutes7d / 60);
    const mins = c.totalWorkoutMinutes7d % 60;
    
    let recentWoSnippet = "";
    if (c.workoutDocs && c.workoutDocs.length > 0) {
      const recent = c.workoutDocs.slice(0, 3).map(w => {
        const name = w.name || "Edzés";
        const dur = w.duration ? `${w.duration} perc` : "";
        const te = w.aerobic_training_effect ? `Aerob TE: ${w.aerobic_training_effect}` : "";
        const load = w.icu_load || w.load ? `Load: ${w.icu_load || w.load}` : "";
        const extra = [dur, te, load].filter(Boolean).join(", ");
        return `- **${name}**${extra ? ` (${extra})` : ""}`;
      }).join("\n");
      recentWoSnippet = `\n\n**Legutóbb rögzített edzéseid:**\n${recent}`;
    }

    body = `### 📊 Heti Teljesítmény és Élettani Elemzés

**1. Edzésvolumen és Terhelés:**
- Összesített heti mozgásidő: **${hours} óra ${mins} perc**
- Kumulált edzésterhelés (Training Load): **${c.totalWorkoutLoad7d}**
- Nehéz / kulcs edzésnapok száma: **${c.heavyDaysCount} nap**${recentWoSnippet}

**2. Hidratációs és Anyagcsere Státusz:**
- Átlagos napi folyadékbevitel: **${c.avgWater} ml / nap** (Cél: **${c.waterGoal} ml**)
- Átlagos napi fehérjebevitel: **${c.avgProtein}g** (Cél: **${c.proteinGoal}g**)
- Átlagos napi kalóriabevitel: **${c.avgCalories} kcal** (Cél: **${c.calorieGoal} kcal**)

**3. Személyre szabott akcióterv az elkövetkező napokra:**
- **Hidratáció:** Mindennap fogyassz legalább **${c.waterGoal} ml** folyadékot, megosztva 2-3 órás intervallumokban.
- **Edzésterhelés periodizáció:** ${c.totalWorkoutLoad7d > 350 ? "Mivel a heti kumulált terhelésed magas, holnapra egy könnyű **45-50 perces Zóna 2** aerob regenerációt vagy teljes pihenőt javaslok." : "A terhelési kapacitásod kiváló, a hét hátralévő részében beiktatható egy minőségi intervallumos vagy tempó edzés."}
- **Táplálkozási fókusz:** Biztosíts legalább **${Math.round(c.userWeight * 1.6)}g fehérjét** naponta az optimális izomadaptációhoz.`;

  // 2. EDZÉSKÉRÉS: MEGLÉVŐ GYAKORLATOKBÓL (SZIGORÚAN AZ ADATOKBÓL)
  } else if (isAskingSavedExercises) {
    body = _generateWorkoutFromSavedExercises(userText, c);

  // 3. EDZÉSKÉRÉS: ÁLTALÁNOSAN (AZ AI ÍRJON MAGÁTÓL)
  } else if (isWorkoutQuery) {
    body = _generateSelfDirectedWorkout(userText, c);

  // 4. ÉTKEZÉSKÉRÉS: MEGLÉVŐ RECEPTEKBŐL ÉS ÉTELEKBŐL
  } else if (isAskingSavedMeals) {
    let savedItemLines = "";
    if (c.recipesDocs && c.recipesDocs.length > 0) {
      savedItemLines = c.recipesDocs.slice(0, 3).map(r => {
        return `- 🍲 **${r.name}**: **${r.calories || 0} kcal** | Fehérje: **${r.protein || 0}g** | CH: **${r.carbs || 0}g** | Zsír: **${r.fat || 0}g**`;
      }).join("\n");
    }
    let savedFoodLines = "";
    if (c.foodDbDocs && c.foodDbDocs.length > 0) {
      savedFoodLines = c.foodDbDocs.slice(0, 3).map(f => {
        return `- 📦 **${f.name}**: **${f.calories || 0} kcal** | Fehérje: **${f.protein || 0}g** | CH: **${f.carbs || 0}g** | Zsír: **${f.fat || 0}g**`;
      }).join("\n");
    }

    body = `### 🍽️ Ajánlás a Meglévő Ételeidből és Receptjeidből

A kérésednek megfelelően **kizárólag a saját mentett receptjeid és kamra-adataid** alapján válogattam:

**Mentett receptjeid közül:**
${savedItemLines || "- Még nincs rögzített recepted a Diéta modulban."}

${savedFoodLines ? `**Mentett kamra-ételeid közül:**\n${savedFoodLines}` : ""}

**💡 Edzői javaslat:** A fenti ételek pontos tápértékkel szerepelnek a fiókodban, így közvetlenül beilleszthetők a napi kalóriakeretedbe!`;

  // 5. EDZÉS ELŐTTI ÉTKEZÉS (ÖNÁLLÓ SZAKMAI PROTOKOLL)
  } else if (isPreWorkoutMeal) {
    body = `### 🍌 Edzés Előtti Táplálkozási Protokoll (Önálló Ajánlás)

Az edzés előtti étkezés célja a glikogénraktárak maximális feltöltése a gyomor megterhelése nélkül.

**1. Időzítés és tápanyagok (${c.userWeight} kg testsúlyhoz):**
- **2-3 órával edzés előtt (Főétkezés):** Összetett szénhidrátok + mérsékelt fehérje, alacsony zsír és rost. Pl. **150g natúr csirkemellfilé** **80g jázmin rizzsel** és párolt csemegekukoricával (**~520 kcal**, **42g fehérje**, **70g CH**, **5g zsír**).
- **30-45 perccel edzés előtt (Gyors energia):** Könnyen emészthető gyors szénhidrát (**~30-40g**). Pl. **1 nagy érett banán**, **2-3 szem medjool datolya** vagy 1 szelet mézes pirítós.
- **Kerülendő:** Nehéz zsírok (sült ételek, zsíros sajtok) és magas rosttartalmú hüvelyesek, mert lassítják a gyomorürülést és edzés alatti diszkomfortot okozhatnak.

**2. Folyadékpótlás a rajt előtt:**
- Fogyassz **400 - 500 ml vizet** 2 órával edzés előtt, majd **150 - 200 ml-t** 15 perccel a start előtt egy csipet sóval.`;

  // 6. EDZÉS UTÁNI ÉTKEZÉS (ÖNÁLLÓ SZAKMAI AJÁNLÁS)
  } else if (isPostWorkoutMeal) {
    const targetCarbs = Math.round(c.userWeight * 0.9);
    const targetProtein = Math.round(c.userWeight * 0.38);

    body = `### 🥗 Edzés Utáni Táplálkozási Stratégia (Önálló Ajánlás)

Az edzést követő **30-45 perces anabolikus és reszintézis ablakban** a szervezet inzulinérzékenysége a legmagasabb.

**1. Fiziológiai célok a testsúlyod (${c.userWeight} kg) alapján:**
- **Szénhidrát:** **${targetCarbs}g** a glikogénraktárak gyors visszatöltésére és a kortizolszint mérséklésére.
- **Fehérje:** **${targetProtein}g** leucin-gazdag fehérjeforrás az izomfehérje-szintézis stimulálásához.
- **Folyadék és Elektrolit:** Fogyassz **500 - 750 ml folyadékot** nátriummal (**~400-600 mg Na+**).

**2. Javasolt komplett edzés utáni menü (Minta étkezés):**
- **Sült lazacfilé vagy csirkemell édesburgonyával:** **160g csirkemell/lazac**, **250g sült édesburgonya**, friss zöldsaláta citromos öntettel (**~540 kcal**, **44g fehérje**, **68g CH**, **8g zsír**).
- **Gyors turmix opció (ha sietsz):** **35g tejsavófehérje**, **1 nagy banán**, **40g finom zabpehely**, **300 ml mandulatej** turmixolva.

**3. Gyakorlati időzítés:**
- Az első **30 percen belül** fogyaszd el az edzés utáni folyadékot és gyors szénhidrát/fehérje kombinációt.
- A következő szilárd, kiegyensúlyozott étkezést **90-120 perccel** az edzés után időzítsd.`;

  // 7. KONKRÉT ÉTKEZÉSTÍPUS (REGGELI / EBÉD / VACSORA / SNACK)
  } else if (isSpecificMeal) {
    let mealTypeLabel = "étkezés";
    if (q.includes("reggeli")) mealTypeLabel = "reggeli";
    else if (q.includes("ebéd")) mealTypeLabel = "ebéd";
    else if (q.includes("vacsora")) mealTypeLabel = "vacsora";
    else if (q.includes("snack") || q.includes("uzsonna") || q.includes("tízórai")) mealTypeLabel = "snack";

    body = `### 🍽️ Ajánlott Sportolói ${mealTypeLabel.toUpperCase()} Recept (Önálló Tervezés)

A kiegyensúlyozott **${mealTypeLabel}** célja, hogy stabil vércukorszintet, egyenletes aminosav-ellátottságot és energiát biztosítson a napi terhelésedhez.

**1. Ideális tápanyag-összetétel (${c.userWeight} kg-hoz igazítva):**
- **Fehérje:** **35 - 45g** minőségi fehérje.
- **Szénhidrát:** **45 - 65g** alacsony/közepes glikémiás indexű forrásból.
- **Egészséges zsírok:** **10 - 15g** (avokádó, olívaolaj, mandula).

**2. Komplett receptötlet:**
- **${mealTypeLabel === "reggeli" ? "Fehérjés Zabkása Erdei Gyümölcsökkel" : mealTypeLabel === "vacsora" ? "Könnyű Lazacfilé Párolt Brokkolival és Quinoával" : "Grillezett Pulykamell Édesburgonyapürével és Spárgával"}:**
  - **Hozzávalók:** ${mealTypeLabel === "reggeli" ? "70g zabpehely, 30g fehérjepor, 80g fagyasztott áfonya/málna, 15g mandulavaj, fahéj." : mealTypeLabel === "vacsora" ? "150g lazacfilé, 60g száraz quinoa, 150g párolt brokkoli, 1 tk olívaolaj." : "160g pulykamell, 250g édesburgonya, 100g spárga, 1 ek olívaolaj."}
  - **Becsült tápérték:** **~480 - 550 kcal** | Fehérje: **~40g** | CH: **~55g** | Zsír: **~12g**.

**3. Gyors tipp:** Mindig igyál egy nagy pohár (**300 - 400 ml**) vizet az étkezés előtt 15-20 perccel az optimális emésztőenzim-működésért!`;

  // 8. ÉLELMISZER SPECIFIKUS KÉRDÉS
  } else if (isFoodItemQuery) {
    body = `### 🍎 Élelmiszer és Édesség Elemzés Állóképességi Sportolóknak

**1. Banán, Gyümölcsök és Datolya:**
- **Kiváló edzés körül:** Az érett banán (**~27g szénhidrát**, **400mg kálium**) és a datolya a sportolók egyik legkiválóbb természetes szénhidrátforrása. Edzés előtt **30-45 perccel** fogyasztva azonnali glikogén-utánpótlást biztosítanak a gyomor megterhelése nélkül.

**2. Csokoládé és Édességek:**
- **Időzítés:** Edzés előtt a magas zsírtartalmú csokoládé kerülendő, mivel a zsírok késleltetik a gyomorürülést és tompaságot okozhatnak.
- **Helye a diétában:** Nehéz, hosszú edzések után (pl. 2+ órás futás vagy bringázás) a gyors szénhidrátraktározás részeként mértékkel belefér, de a fő fókusz a minőségi keményítőn és fehérjén legyen.

**3. Kávé és Koffein:**
- Napi **1-2 csésze minőségi kávé** (**3-6 mg koffein / testsúly kg**) 45 perccel edzés előtt bizonyítottan javítja a zsírsav-oxidációt és csökkenti a szubjektív fáradtságérzetet.`;

  // 9. ZÓNA 2 & PULZUS
  } else if (isZone2AndHR) {
    const maxHR = Math.max(170, 220 - c.userAge);
    const z2Min = Math.round(maxHR * 0.65);
    const z2Max = Math.round(maxHR * 0.75);

    body = `### 🫀 Zóna 2 Aerob Alapozás és Pulzuskontroll

A Zóna 2 edzés az állóképességi sportolók "motorjának" a felépítése.

**1. A Te konkrét Zóna 2 pulzustartományod (${c.userAge} éves kor alapján):**
- Becsült maximális szívfrekvencia: **${maxHR} bpm**
- **Cél Zóna 2 tartomány:** **${z2Min} - ${z2Max} bpm** (a maximális pulzus **65 - 75%**-a).
- **Gyakorlati teszt:** Teljes orrlégzés vagy folyamatos beszédteszt (képes vagy teljes mondatokban beszélni zihálás nélkül).

**2. Miért a Zóna 2 a legfontosabb?**
- Növeli az 1-es típusú (lassú) izomrostok mitokondriális denzitását.
- Maximalizálja a zsíroxidációs rátát, megkímélve a glikogénraktárakat a versenyekre.
- Fejleszti az MCT-1 transzportereket, így a szervezet gyorsabban semlegesíti a magasabb intenzitáson termelődő tejsavat.

**3. Heti volumen:** Az összes edzésidőd **75 - 80%**-át ebben a zónában töltsd az optimális polarizált adaptációhoz!`;

  // 10. VO2 MAX & INTERVALLUM
  } else if (isVO2max) {
    body = `### ⚡ VO2 Max Növelése és Intervallum Protokoll

A VO2 max a szervezet által maximálisan felvehető és hasznosítható oxigén mennyisége.

**1. A leghatékonyabb protokoll: Norvég 4x4 Intervallum:**
- **Bemelegítés:** **15 perc** fokozatos Z1-Z2 pörgetés.
- **Fő rész:** **4 x 4 perc** maximális fenntartható intenzitáson (a maximális pulzus **90 - 95%**-án).
- **Pihenő:** Az intervallumok között **3 perc aktív könnyű mozgás** (Z1 tekerés vagy kocogás a laktát lebontásához).
- **Levezetés:** **10 perc** könnyű levezetés.

**2. Micro-intervallumok (30/30 vagy 40/20):**
- **2-3 blokk x 8-10 ismétlés** (30 másodperc maximális tempó / 30 másodperc laza gurulás).
- Kisebb neuromuszkuláris kimerülést okoz, de magas oxigénfelvételt tart fenn.

**3. Gyakoriság:** Hetente maximum **1 - 2 minőségi intervallumos napot** iktass be, közte legalább 48 óra könnyű/pihenő nappal.`;

  // 11. HIDRATÁCIÓ & IZMOGÖRCSÖK
  } else if (isHydrationAndCramps) {
    const baselineWater = Math.round(c.userWeight * 35);
    const athleteWater = Math.round(c.userWeight * 45);

    body = `### 💧 Hidratáció, Izomgörcsök és Elektrolit Protokoll

**1. A Te folyadékszükségleted (${c.userWeight} kg testsúly alapján):**
- **Alap nyugalmi folyadékigény:** **${baselineWater} ml / nap**
- **Edzésnapokon:** **${athleteWater} ml / nap** (plusz az edzés alatti izzadság).
- Napi célértéked: **${c.waterGoal} ml**.

**2. Miért görcsölnek az izmok? (Tévhitek eloszlatása):**
- A sportolói görcsök döntő többségét **NEM a magnéziumhiány**, hanem a **nátriumvesztés** és a **neuromuszkuláris fáradtság** okozza!
- 1 liter izzadsággal **800 - 1100 mg nátrium** távozik. Ha csak tiszta vizet iszol, a vérplazma felhígul (hiponatrémia), ami azonnali görcskészséget provokál.

**3. Gyakorlati stratégia:**
- **60+ perces edzésnél:** Fogyassz **óránként 500 - 800 ml** izotóniás italt vagy vizet sótablettával (**~500-700 mg Na+ / liter**).
- **Reggeli indítás:** Ébredés után azonnal **400 - 500 ml víz** egy csipet sóval a plazmatérfogat helyreállításához.`;

  // 12. SÉRÜLÉS & ÍZÜLETVÉDELEM
  } else if (isInjuryPain) {
    body = `### 🩺 Sérüléskezelés, Fájdalom és Ízületvédelem

A fájdalom a test biofeedback jelzése arról, hogy a terhelés meghaladta az adott szövet adaptációs kapacitását.

**1. Azonnali teendők: A modern PEACE & LOVE protokoll:**
- **P (Protect - Védelem):** Az első 2-3 napban tehermentesítsd a sérült területet, de kerüld a teljes mozdulatlanságot.
- **E (Elevate - Felpolcolás):** Polcold fel a végtagot a szív szintje fölé.
- **A (Avoid anti-inflammatory - Kerüld a gyulladáscsökkentőket):** Az ibuprofen és rokonai gátolják a természetes szöveti gyógyulást és a kollagénképződést!
- **C (Compress - Kompresszió):** Kompressziós zokni vagy fásli a duzzanat mérséklésére.
- **L & O (Load & Optimism):** Amint a szúró fájdalom engedi, kezdj fokozatos, fájdalomhatár alatti aktív terhelést.

**2. Állóképességi specifikus okok (${c.userWeight} kg-nál):**
- **Futócipő kopása:** Ha a futócipődben több mint **600 - 800 km** van, a csillapító hab elveszítette rugalmasságát, és az ütések az ízületeket (térd, sípcsont) terhelik.
- **Lépésszám (Kadencia):** Növeld a futólépésszámodat **170 - 180 spm**-re, ez drasztikusan csökkenti a talajfogási becsapódási erőket.
- **Áthidaló keresztedzés:** Amíg fáj a futás, végezz fájdalommentes Z1 kerékpározást vagy úszást a kardiókapacitás megőrzéséért.`;

  // 13. IZOMLÁZ (DOMS) & SZAUNA
  } else if (isDOMSAndRecovery) {
    body = `### 🧘 Izomláz (DOMS), Regeneráció és Szauna Protokoll

**1. Az izomláz valódi oka:**
- Az izomláz (DOMS) nem a tejsav felhalmozódása (a tejsav 60 perccel edzés után kiürül), hanem az izomrostok Z-lemezeinél keletkező **mikroszkopikus mikroszakadások** és a gyógyulásukkal járó enyhe gyulladásos folyamat.

**2. A leghatékonyabb regenerációs eszközök:**
- **Aktív regeneráció (Gold Standard):** **20 - 30 perc könnyű Z1 zónás tekerés vagy tempós séta**. A fokozott vérkeringés elszállítja a sejttörmeléket és tápanyagot juttat az izmokba.
- **SMR masszázshenger:** Finom, lassú hengerlés a fascia lazítására. Kerüld a friss, erős izomláz durva nyújtását, mert az tovább mélyítheti a mikroszakadásokat!
- **Meleg vizes fürdő & Szauna:** Edzés után **30-40 perccel** a meleg tágítja a kapillárisokat és fokozza a növekedési hormon termelődését.

**3. Táplálkozás:** Fogyassz **${Math.round(c.userWeight * 1.8)}g fehérjét** és Omega-3 zsírsavakat a szöveti regeneráció támogatására.`;

  // 14. ALVÁSMINŐSÉG & HRV
  } else if (isSleepHRV) {
    body = `### 🛌 Alvásminőség, Cirkadián Ritmus és HRV Elemzés

Az alvás a legális teljesítményfokozás és a szöveti adaptáció legfontosabb alappillére.

**1. Alvásarchitektúra:**
- **Mélyalvás (N3 fázis):** A növekedési hormon (GH) **95%**-a az éjszaka első felében termelődik. Ez felel az izomszövetek reparációjáért és az idegrendszeri regenerációért.
- **REM fázis:** A mozgáskoordináció és a mentális stressz-tűrés regenerátora.

**2. Szívfrekvencia Variabilitás (HRV):**
- A magas HRV és az alacsony nyugalmi pulzus a paraszimpatikus idegrendszer (váguszideg) dominanciáját jelzi.
- Ha a nyugalmi pulzusod **5-8 bpm-mel magasabb** a megszokottnál, a szervezet még a tegnapi terhelést dolgozza fel.

**3. Alvásoptimalizálási protokoll:**
- **Hőmérséklet:** **18 - 19 °C**, teljes sötétség (redőny, szemmaszk).
- **Kékfény blokkolása:** **60-90 perccel** lefekvés előtt kapcsold ki az éles képernyőket.
- **Kiegészítés:** **300 - 400 mg magnézium-biszglicinát** lefekvés előtt 30 perccel.`;

  // 15. TÁPLÁLÉKKIEGÉSZÍTŐK
  } else if (isSupplements) {
    const caffeineDose = Math.round(c.userWeight * 4);

    body = `### 💊 Tudományos Étrend-kiegészítő Protokoll

Állóképességi és erőnléti sportolóknak a bizonyítottan leghatékonyabb szerek:

**1. Kreatin-monohidrát:**
- **Adag:** Napi **3 - 5g** folyamatosan (nincs szükség feltöltésre). Növeli a sejtek foszfokreatin raktárait és fokozza a glikogéntárolást. A legjobb edzés utáni szénhidráttal kombinálni.

**2. Koffein:**
- **Adag:** **3 - 6 mg / testsúly kg** (a Te súlyodhoz kb. **${caffeineDose} mg**) **45-60 perccel** a kulcsedzés vagy verseny előtt. Növeli a zsírsav-mobilizációt és csökkenti a fáradtságérzetet.

**3. Magnézium-biszglicinát:**
- **Adag:** **300 - 400 mg** este lefekvés előtt. Kiemelkedő felszívódás, segít az izomrelaxációban és a mélyalvás elérésében. (Kerüld a magnézium-oxidot a minimális biohasznosulás miatt!)

**4. Béta-alanin:**
- **Adag:** Napi **3.2 - 6.4g** az izomkarnozin növelésére, késlelteti az izomsavasodást az 1-4 perces maximális erőfeszítéseknél.`;

  // 16. FUTÓCIPŐ & FELSZERELÉS
  } else if (isShoesGear) {
    body = `### 👟 Futócipő és Felszerelés Útmutató

**1. Futócipő választás (${c.userWeight} kg testsúlyhoz):**
- **Csillapítás:** **${c.userWeight} kg**-os testsúlynál a mindennapos edzésekhez közepes vagy maximális párnázottságú cipő javasolt (pl. EVA/PEBA hab) a becsapódási terhelés elnyelésére.
- **Drop (Sarok-lábujj szintkülönbség):** **8 - 10 mm drop** ideális a vádli és achilles tehermentesítésére; **4 - 6 mm drop** a természetesebb közép- és előtalpas futást segíti elő.
- **Élettartam:** Egy futócipő átlagosan **600 - 800 km** után elveszíti rugalmasságát, ezt követően a hab már nem tompít hatékonyan, ami túlterheléses ízületi panaszokhoz vezethet.

**2. Pulzusmérés:**
- A csuklós optikai szenzorok késéssel követik a hirtelen pulzusváltozásokat. Intervallumos edzésekhez mindig EKG-pontosságú **mellkaspánt** javasolt.

**3. Kerékpáros kadencia:**
- Törekedj a **85 - 95 RPM** pedálfordulatra, ez kíméli a térdízületeket és a lassú izomrostokat.`;

  // 17. VERSENYFELKÉSZÜLÉS & PACING
  } else if (isRacePacing) {
    const carbLoad = Math.round(c.userWeight * 8);

    body = `### 🏁 Versenyfelkészülés, Pacing és Szénhidráttöltés

**1. Szénhidráttöltés (Carbo-loading):**
- A versenyt megelőző **36 - 48 órában** fogyassz napi **8 - 10g szénhidrátot / testsúly kg** (Neked kb. **${carbLoad}g szénhidrát / nap**), minimális zsír és rost mellett a glikogénraktárak 100%-os telítéséhez.

**2. Pacing stratégia (Negatív split):**
- Az első 30-40%-ot kezdd a célpulzusod/tempód alatt **3-5 másodperccel**. A rajtláz miatti túl gyors kezdés tejsav-felhalmozódáshoz és a glikogén korai kiürüléséhez vezet.

**3. Verseny alatti frissítés:**
- **60+ perc felett:** Óránként **60 - 90g szénhidrát** (1:0.8 glükóz-fruktóz gélek vagy sportital) és **500 - 750 ml folyadék** nátriummal.`;

  // 18. MAKRÓK ÉS KALÓRIÁK
  } else if (isMacros) {
    const minProt = Math.round(c.userWeight * 1.6);
    const maxProt = Math.round(c.userWeight * 2.2);
    const carbGrams = Math.round(c.userWeight * 6);
    const fatGrams = Math.round(c.userWeight * 1.0);

    body = `### 🥩 Makrotápanyag és Kalória Célok

**1. A Te egyéni értékeid (${c.userWeight} kg testsúlyhoz):**
- **Fehérje:** **${minProt} - ${maxProt}g / nap** (1.6 - 2.2 g/kg). Napi étkezéseidben oszd el **30-45g-os adagokra**.
- **Szénhidrát:** **${carbGrams}g / nap** (~6 g/kg) az edzésintenzitás fenntartásához és a glikogénraktározáshoz.
- **Egészséges zsírok:** **${fatGrams}g / nap** (~1.0 g/kg) a hormonális funkciókhoz.
- **Kalóriacél:** **${c.calorieGoal} kcal / nap**.

**2. Gyakorlati tanács:**
- Ha fogyás a cél, tarts mérsékelt **300 - 500 kcal deficitet**, de a fehérjebevitelt tartsd magasan (**${maxProt}g**), hogy az izomtömeg megmaradjon!`;

  // 19. KÖZVETLEN SZAKMAI VÁLASZ BÁRMELY EGYÉB KÉRDÉSRE
  } else {
    body = `### 💡 Lockin Élettani és Edzői Válasz

A kérdésedre (**"${_escapeHtml(userText)}"**) a sporttudomány és a felhasználói adataid (**${c.userWeight} kg** testsúly) alapján a következő szakmai választ adom:

**1. Élettani válasz és alapelvek:**
- Állóképességi és erőnléti terhelésnél a test adaptációját a terhelési inger, a glikogén-egyensúly és a neuromuszkuláris regeneráció hármasa határozza meg.
- Ha új mozgásformát, edzésmódszert vagy táplálkozási szokást vezetsz be, mindig a fokozatosság elvét kövesd a túlterhelés és sérülések elkerülésére.

**2. Személyre szabott teendők:**
- Testsúlyod (**${c.userWeight} kg**) és sporttevékenységeid mellett a legfontosabb sarokkövek: napi **${c.waterGoal} ml** folyadékbevitel és **${Math.round(c.userWeight * 1.6)}g fehérje** biztosítása.
- Ha az edzésterheléssel vagy regenerációval kapcsolatban van kérdésed, figyeld a pulzuszónákat és a test biofeedback jelzéseit (alvásminőség, izomérzet).

*Ha szeretnél konkrét edzéstervet (önállóan felépítve vagy a mentett gyakorlataidból), pulzuszóna-kalkulációt vagy receptet, írd meg bátran!*`;
  }

  return `${warningBlock}${body}`.trim();
}

// Automatikus eseménykötés amint a DOM készen áll
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bindUI);
  } else {
    _bindUI();
  }
}
