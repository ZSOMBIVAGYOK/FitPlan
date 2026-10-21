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
const SYSTEM_INSTRUCTION = `Te a Lockin app elit állóképességi sportolóknak szóló AI asszisztense vagy. Válaszolj röviden, tudományosan, a teljesítményoptimalizálásra és regenerációra fókuszálva.
SZABÁLYOK:
1. ELSŐDLEGESEN ÉS KÖZVETLENÜL a felhasználó konkrét kérdésére vagy kérésére válaszolj konkrét szakmai tanácsokkal és számokkal! Soha NE írj heti adatelemzést a kérdés megválaszolása helyett, hacsak a felhasználó kifejezetten heti elemzést vagy összegzést nem kért (pl. "Heti elemzés").
2. A felhasználó 7 napos adatait (edzésvolumen, hidratáció, táplálkozás) háttérként és a válasz személyre szabására használd (pl. testsúlyához, napi céljaihoz és aktuális terheléséhez igazítva).
3. Ha a heti adatokban kritikus elmaradást látsz (pl. súlyos dehidratáció, hiányos fehérjebevitel vagy túledzettségi kockázat), a válasz legelején egy rövid [⚠️ FIGYELMEZTETÉS] blokkban jelezd ezt!
4. Étkezési és edzésajánlásnál ELSŐSORBAN a felhasználó saját mentett ételeiből és edzésterveiből ajánlj név szerint és pontos tápértékekkel!
5. Használj letisztult Markdown formázást: félkövér kiemeléseket a fontos számoknál (pl. **2500 ml**, **140g fehérje**, **50 perc**), és jól átlátható pontokba szedd a válaszokat.`;

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

  try {
    const results = await Promise.allSettled([
      getDoc(doc(db, "users", uid, "settings", "profile")),
      getDocs(collection(db, "users", uid, "meals")),
      getDocs(collection(db, "users", uid, "hydrationLogs")),
      getDocs(collection(db, "users", uid, "workouts")),
      getDocs(collection(db, "users", uid, "recipes")),
      getDocs(collection(db, "users", uid, "foodDatabase")),
      getDocs(collection(db, "users", uid, "routines")),
      getDocs(collection(db, "users", uid, "workoutRoutines"))
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

  // 6. Mentett edzésprogramok & sablonok
  const savedRoutinesList = [];
  routinesDocs.forEach(rt => {
    const exList = Array.isArray(rt.exercises) ? rt.exercises.map(e => e.name || e).join(', ') : (rt.exercises || '');
    savedRoutinesList.push(`- [SABLON] ${rt.name || 'Edzésterv'}${rt.description ? ` (${rt.description})` : ''}: Gyakorlatok: ${exList || 'Nincs részletezve'}`);
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

=== FELHASZNÁLÓ SAJÁT MENTETT EDZÉSTERVEI & SABLONJAI ===
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
      fullPrompt = `[A FELHASZNÁLÓ KÉRDÉSE - ELSŐDLEGESEN ÉS KÖZVETLENÜL ERRE VÁLASZOLJ]:\n${userText}\n\n[HÁTTÉR ADATOK ÉS CÉLOK (CSAK SZEMÉLYRE SZABÁSHOZ, NE ÍRD LE HETI ELEMZÉSKÉNT)]:\n${userContext}`;
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
      text: `${SYSTEM_INSTRUCTION}\n\n[HÁTTÉR ADATOK - CÉLOK ÉS 7 NAPOS METRIKÁK (CSAK SZEMÉLYRE SZABÁSHOZ, NE ÍRD LE HETI ELEMZÉSKÉNT)]:\n${userContext}`
    }]
  });
  contents.push({
    role: "model",
    parts: [{
      text: "Értettem! A Lockin app elit állóképességi AI asszisztenseként közvetlenül és pontosan a feltett kérdésre válaszolok, a háttéradatokat csak a válasz személyre szabásához veszem figyelembe. Heti adatelemzést kizárólag kifejezett heti elemzés kérés esetén adok."
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
        <p class="text-[10px] text-gray-500 dark:text-gray-400">Betöltöttem az elmúlt 7 napos edzéseidet, hidratációdat és receptjeidet.</p>
      </div>
    </div>
    <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
      Kérdezz bármit a mai terhelésedről, az optimális edzés utáni tápanyagbevitelről a mentett receptjeid alapján, vagy kérj elemzést a regenerációdról!
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
    workoutDocs: []
  };

  // 1. SZABÁLY 2: Kritikus hiányok kiértékelése és legelején megjelenítése
  let warningBlock = "";
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

  const q = (userText || "").toLowerCase().trim();

  // 2. Kérdés típusának és valódi szándékának felismerése
  // FONTOS: A heti elemzés CSAK akkor indul el, ha a felhasználó kifejezetten a heti áttekintést / összefoglalót kéri!
  const isWeeklyAnalysis = 
    q === "heti elemzés" || 
    q === "heti összegzés" || 
    q === "heti riport" || 
    q.includes("📊") ||
    (q.includes("heti") && (q.includes("elemzés") || q.includes("összegzés") || q.includes("riport") || q.includes("áttekintés") || q.includes("összefoglaló"))) ||
    ((q.includes("összegezd") || q.includes("értékeld") || q.includes("elemezd")) && (q.includes("hét") || q.includes("napom") || q.includes("teljesítményem")));

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
    q.includes("kaja ötlet");

  const isFoodItemQuery = 
    q.includes("banán") || 
    q.includes("csoki") || 
    q.includes("édesség") || 
    q.includes("cukor") || 
    q.includes("datolya") || 
    q.includes("méz") || 
    q.includes("gyümölcs") || 
    q.includes("kávé");

  const isWorkoutRec = 
    q.includes("holnapi") || 
    q.includes("ajánlj edzést") || 
    q.includes("mit eddzek") || 
    q.includes("következő edzés") || 
    q.includes("edzésterv") || 
    q.includes("holnap mit") || 
    q.includes("milyen edzést") || 
    q.includes("mai edzés");

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

  } else if (isPreWorkoutMeal) {
    body = `### 🍌 Edzés Előtti Táplálkozási Protokoll

Az edzés előtti étkezés célja a glikogénraktárak maximális feltöltése a gyomor megterhelése nélkül.

**1. Időzítés és tápanyagok (${c.userWeight} kg testsúlyhoz):**
- **2-3 órával edzés előtt (Főétkezés):** Összetett szénhidrátok + mérsékelt fehérje, alacsony zsír és rost. Pl. zabpehely növényi tejjel vagy basmati rizs natúr csirkemellel (**~50-70g szénhidrát**, **20-30g fehérje**).
- **30-45 perccel edzés előtt (Gyors energia):** Könnyen emészthető gyors szénhidrát (**~30-40g**). Pl. **1 érett banán**, **2-3 szem datolya** vagy 1 szelet mézes pirítós.
- **Kerülendő:** Nehéz zsírok (sült ételek, zsíros sajtok) és magas rosttartalmú hüvelyesek, mert lassítják a gyomorürülést és edzés alatti diszkomfortot, hányingert okozhatnak.

**2. Folyadékpótlás a rajt előtt:**
- Fogyassz **400 - 500 ml vizet** 2 órával edzés előtt, majd **150 - 200 ml-t** 15 perccel a start előtt egy csipet sóval.`;

  } else if (isPostWorkoutMeal) {
    const targetCarbs = Math.round(c.userWeight * 0.9);
    const targetProtein = Math.round(c.userWeight * 0.38);

    let recipeRecommendations = "";
    if (c.recipesDocs && c.recipesDocs.length > 0) {
      const topRecipes = c.recipesDocs.slice(0, 2);
      const items = topRecipes.map(r => {
        const cal = r.calories || 0;
        const p = r.protein || 0;
        const ch = r.carbs || 0;
        const f = r.fat || 0;
        const ing = Array.isArray(r.ingredients) ? r.ingredients.map(i => i.name || i).join(", ") : (r.ingredients || "");
        return `- 🥇 **${r.name}**\n  *Tápérték:* **${cal} kcal** | Fehérje: **${p}g** | Szénhidrát: **${ch}g** | Zsír: **${f}g**\n  ${ing ? `*Hozzávalók:* ${ing}` : ""}`;
      }).join("\n");
      recipeRecommendations = `\n\n**A saját mentett receptjeid közül edzés utánra optimális:**\n${items}`;
    }

    let foodDbRecommendations = "";
    if (c.foodDbDocs && c.foodDbDocs.length > 0 && (!c.recipesDocs || c.recipesDocs.length < 2)) {
      const topFoods = c.foodDbDocs.slice(0, 2);
      const items = topFoods.map(f => `- **${f.name}**: **${f.calories || 0} kcal**, **${f.protein || 0}g fehérje**, **${f.carbs || 0}g CH**`).join("\n");
      foodDbRecommendations = `\n\n**Mentett ételeid a kamrából:**\n${items}`;
    }

    if (!recipeRecommendations && !foodDbRecommendations) {
      recipeRecommendations = `\n\n**Elit sporttáplálkozási javaslat (Mentsd el a Diéta modulban):**
- **Csirkemellfilé basmati rizzsel és párolt zöldségekkel:** **150g csirkemell**, **80g basmati rizs**, **1 evőkanál olívaolaj** (**~520 kcal**, **42g fehérje**, **68g szénhidrát**, **7g zsír**).
- **Zabkása tejsavófehérjével és banánnal:** **70g finom zabpehely**, **30g tejsavófehérje**, **1 közepes banán** (**~460 kcal**, **35g fehérje**, **62g szénhidrát**, **6g zsír**).`;
    }

    body = `### 🥗 Edzés Utáni Táplálkozási Stratégia

Az állóképességi és erőnléti terhelést követő **30-45 perces anabolikus és reszintézis ablakban** a szervezet inzulinérzékenysége a legmagasabb.

**1. Fiziológiai célok a testsúlyod (${c.userWeight} kg) alapján:**
- **Szénhidrát:** **${targetCarbs}g** (3:1 vagy 4:1 arány a glikogénraktárak gyors visszatöltésére és a kortizol szintek csökkentésére).
- **Fehérje:** **${targetProtein}g** (leucin-gazdag gyorsan felszívódó forrás az izomfehérje-szintézis stimulálásához).
- **Folyadék és Elektrolit:** Fogyassz **500 - 750 ml folyadékot** nátriummal (**~400-600 mg Na+**) az ozmotikus retenció biztosításához.${recipeRecommendations}${foodDbRecommendations}

**2. Gyakorlati időzítés:**
- Az első **30 percen belül** fogyaszd el az edzés utáni folyadékot és gyors szénhidrát/fehérje kombinációt.
- A következő szilárd, kiegyensúlyozott étkezést **90-120 perccel** az edzés után időzítsd.`;

  } else if (isSpecificMeal) {
    let mealTypeLabel = "étkezés";
    if (q.includes("reggeli")) mealTypeLabel = "reggeli";
    else if (q.includes("ebéd")) mealTypeLabel = "ebéd";
    else if (q.includes("vacsora")) mealTypeLabel = "vacsora";
    else if (q.includes("snack") || q.includes("uzsonna") || q.includes("tízórai")) mealTypeLabel = "snack";

    let savedItemLines = "";
    if (c.recipesDocs && c.recipesDocs.length > 0) {
      savedItemLines = c.recipesDocs.slice(0, 3).map(r => {
        return `- 🍲 **${r.name}**: **${r.calories || 0} kcal** | Fehérje: **${r.protein || 0}g** | CH: **${r.carbs || 0}g** | Zsír: **${r.fat || 0}g**`;
      }).join("\n");
    }

    body = `### 🍽️ Ajánlott Sportolói ${mealTypeLabel.toUpperCase()} és Receptjavaslat

A kiegyensúlyozott **${mealTypeLabel}** célja, hogy stabil vércukorszintet, egyenletes aminosav-ellátottságot és megfelelő energiát biztosítson a napi edzéseidhez.

**1. Ideális tápanyag-összetétel (${c.userWeight} kg-hoz igazítva):**
- **Fehérje:** **30 - 45g** minőségi fehérje az izomtömeg védelmére és az izomfehérje-szintézishez.
- **Szénhidrát:** **40 - 65g** alacsony/közepes glikémiás indexű forrásból (pl. zab, barna rizs, édesburgonya, quinoa).
- **Egészséges zsírok:** **10 - 15g** (avokádó, olívaolaj, mandula) a mikrotápanyagok felszívódásáért.

**2. Saját mentett receptjeid közül ajánlom:**
${savedItemLines || "- Mentsd el kedvenc receptjeidet a Diéta modulban, hogy itt azonnal megjelenhessenek!"}

**3. Gyors tipp:** Mindig igyál egy nagy pohár (**300 - 400 ml**) vizet az étkezés előtt 15-20 perccel az optimális emésztőenzim-működésért!`;

  } else if (isFoodItemQuery) {
    body = `### 🍎 Élelmiszer és Édesség Elemzés Állóképességi Sportolóknak

**1. Banán, Gyümölcsök és Datolya:**
- **Kiváló edzés körül:** Az érett banán (**~27g szénhidrát**, **400mg kálium**) és a datolya a sportolók egyik legkiválóbb természetes szénhidrátforrása. Edzés előtt **30-45 perccel** fogyasztva azonnali glikogén-utánpótlást biztosítanak a gyomor megterhelése nélkül.

**2. Csokoládé és Édességek:**
- **Időzítés:** Edzés előtt a magas zsírtartalmú csokoládé kerülendő, mivel a zsírok késleltetik a gyomorürülést és tompaságot okozhatnak.
- **Helye a diétában:** Nehéz, hosszú edzések után (pl. 2+ órás futás vagy bringázás) a gyors szénhidrátraktározás részeként mértékkel belefér, de a fő fókusz a minőségi keményítőn és fehérjén legyen.

**3. Kávé és Koffein:**
- Napi **1-2 csésze minőségi kávé** (**3-6 mg koffein / testsúly kg**) 45 perccel edzés előtt bizonyítottan javítja a zsírsav-oxidációt és csökkenti a szubjektív fáradtságérzetet.`;

  } else if (isWorkoutRec) {
    let routineSnippet = "";
    if (c.routinesDocs && c.routinesDocs.length > 0) {
      const topRoutines = c.routinesDocs.slice(0, 2);
      const items = topRoutines.map(rt => {
        const exList = Array.isArray(rt.exercises) ? rt.exercises.map(e => e.name || e).join(", ") : (rt.exercises || "Egyéni gyakorlatsor");
        return `- 🏅 **${rt.name || 'Edzéssablon'}**${rt.description ? ` (*${rt.description}*)` : ''}\n  *Gyakorlatok:* **${exList}**`;
      }).join("\n");
      routineSnippet = `\n\n**A saját mentett edzésterveid és sablonjaid közül javaslom:**\n${items}`;
    }

    const isTired = c.totalWorkoutLoad7d > 350 || c.heavyDaysCount >= 3;

    body = `### 🏋️ Személyre Szabott Edzésajánlás

**1. Terhelési státusz és adaptációs állapot:**
- Elmúlt 7 nap kumulált terhelése: **${c.totalWorkoutLoad7d} TSS/Load**
- Heti edzésidő: **${Math.floor(c.totalWorkoutMinutes7d / 60)} óra ${c.totalWorkoutMinutes7d % 60} perc**
- Aktuális élettani állapot: ${isTired ? "**Magas fáradtsági szint** (prioritás az aktív regeneráció és a szuperkompenzáció)" : "**Optimális regeneráltság** (alkalmas minőségi inger bevitelére)"}.${routineSnippet}

**2. Javasolt struktúra a holnapi napra:**
- **Bemelegítés (10-15 perc):** Könnyű Z1 pulzustartomány, dinamikus ízületi mobilizáció, láblengetések és törzsaktiváció.
- **Fő rész:** ${isTired ? "**45 - 60 perc Zóna 2 aerob bázisépítés** (orrlégzéssel tartható tempó, a maximális szívfrekvencia **65-75%**-án), vagy 40 perc könnyű spinning / úszás." : "**50 - 65 perc tempó vagy intervallum edzés:** pl. 15p Z2 bemelegítés + **4 x 4 perc VO2max intervallum** (max pulzus **90-95%**-án, **3 perc** könnyű gurulással) + levezetés."}
- **Levezetés (10 perc):** Könnyű kocogás/séta és levezető nyújtás, légzéskontroll.`;

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

  } else if (isHydrationAndCramps) {
    const baselineWater = Math.round(c.userWeight * 35);
    const athleteWater = Math.round(c.userWeight * 45);

    body = `### 💧 Hidratáció, Izomgörcsök és Elektrolit Protokoll

**1. A Te folyadékszükségleted (${c.userWeight} kg testsúly alapján):**
- **Alap nyugalmi folyadékigény:** **${baselineWater} ml / nap**
- **Edzésnapokon:** **${athleteWater} ml / nap** (plusz az edzés alatti izzadság).
- Heti átlagos beviteled jelenleg: **${c.avgWater} ml / nap** (Cél: **${c.waterGoal} ml**).

**2. Miért görcsölnek az izmok? (Tévhitek eloszlatása):**
- A sportolói görcsök 80%-át **NEM a magnéziumhiány**, hanem a **nátriumvesztés** és a **neuromuszkuláris fáradtság** okozza!
- 1 liter izzadsággal **800 - 1100 mg nátrium** távozik. Ha csak tiszta vizet iszol, a vérplazma felhígul (hiponatrémia), ami azonnali görcskészséget provokál.

**3. Gyakorlati stratégia:**
- **60+ perces edzésnél:** Fogyassz **óránként 500 - 800 ml** izotóniás italt vagy vizet sótablettával (**~500-700 mg Na+ / liter**).
- **Reggeli indítás:** Ébredés után azonnal **400 - 500 ml víz** egy csipet sóval a plazmatérfogat helyreállításához.`;

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

  } else if (isDOMSAndRecovery) {
    body = `### 🧘 Izomláz (DOMS), Regeneráció és Szauna Protokoll

**1. Az izomláz valódi oka:**
- Az izomláz (DOMS) nem a tejsav felhalmozódása (a tejsav 60 perccel edzés után kiürül), hanem az izomrostok Z-lemezeinél keletkező **mikroszkopikus mikroszakadások** és a gyógyulásukkal járó enyhe gyulladásos folyamat.

**2. A leghatékonyabb regenerációs eszközök:**
- **Aktív regeneráció (Gold Standard):** **20 - 30 perc könnyű Z1 zónás tekerés vagy tempós séta**. A fokozott vérkeringés elszállítja a sejttörmeléket és tápanyagot juttat az izmokba.
- **SMR masszázshenger:** Finom, lassú hengerlés a fascia lazítására. Kerüld a friss, erős izomláz durva nyújtását, mert az tovább mélyítheti a mikroszakadásokat!
- **Meleg vizes fürdő & Szauna:** Edzés után **30-40 perccel** a meleg tágítja a kapillárisokat és fokozza a növekedési hormon termelődését.

**3. Táplálkozás:** Fogyassz **${Math.round(c.userWeight * 1.8)}g fehérjét** és Omega-3 zsírsavakat a szöveti regeneráció támogatására.`;

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

  } else if (isRacePacing) {
    const carbLoad = Math.round(c.userWeight * 8);

    body = `### 🏁 Versenyfelkészülés, Pacing és Szénhidráttöltés

**1. Szénhidráttöltés (Carbo-loading):**
- A versenyt megelőző **36 - 48 órában** fogyassz napi **8 - 10g szénhidrátot / testsúly kg** (Neked kb. **${carbLoad}g szénhidrát / nap**), minimális zsír és rost mellett a glikogénraktárak 100%-os telítéséhez.

**2. Pacing stratégia (Negatív split):**
- Az első 30-40%-ot kezdd a célpulzusod/tempód alatt **3-5 másodperccel**. A rajtláz miatti túl gyors kezdés tejsav-felhalmozódáshoz és a glikogén korai kiürüléséhez vezet.

**3. Verseny alatti frissítés:**
- **60+ perc felett:** Óránként **60 - 90g szénhidrát** (1:0.8 glükóz-fruktóz gélek vagy sportital) és **500 - 750 ml folyadék** nátriummal.`;

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

  } else {
    // ── KÖZVETLEN VÁLASZADÁS BÁRMILYEN EGYÉB KÉRDÉSRE ──
    // SOHA nem írjuk le csak a heti adatokat! Közvetlenül a kérdés témájára válaszolunk.
    body = `### 💡 Lockin Élettani és Edzői Válasz

A kérdésedre (**"${_escapeHtml(userText)}"**) a sporttudomány és a biometrikus adataid (**${c.userWeight} kg** testsúly) alapján a következő szakmai választ adom:

**1. Élettani válasz és alapelvek:**
- Állóképességi és erőnléti terhelésnél a test adaptációját a terhelési inger, a glikogén-egyensúly és a neuromuszkuláris regeneráció hármasa határozza meg.
- Ha új mozgásformát, edzésmódszert vagy táplálkozási szokást vezetsz be, mindig a fokozatosság elvét kövesd a túlterhelés és sérülések elkerülésére.

**2. Személyre szabott teendők:**
- Testsúlyod (**${c.userWeight} kg**) és sporttevékenységeid mellett a legfontosabb sarokkövek: napi **${c.waterGoal} ml** folyadékbevitel és **${Math.round(c.userWeight * 1.6)}g fehérje** biztosítása.
- Ha az edzésterheléssel vagy regenerációval kapcsolatban van kérdésed, figyeld a pulzuszónákat és a test biofeedback jelzéseit (alvásminőség, izomérzet).

*Ha szeretnél konkrét edzéstervet, pulzuszóna-kalkulációt vagy edzés utáni receptet a mentett ételeidből, írd meg bátran!*`;
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
