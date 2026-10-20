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
let _lastContextFetch = 0;
let _initializedUI = false;
let _appModule = null;
let _vertexModule = null;

// ── Rendszer Utasítás (System Instruction) ─────────────────
const SYSTEM_INSTRUCTION = `Te a Lockin app elit állóképességi sportolóknak szóló AI asszisztense vagy. Válaszolj röviden, tudományosan, a teljesítményoptimalizálásra és regenerációra fókuszálva. SZABÁLYOK: 1. Mindig vedd figyelembe a felhasználó 7 napos adatait (edzésvolumen, hidratáció, táplálkozás). 2. Ha a heti adatokban kritikus elmaradást látsz (pl. súlyos dehidratáció, hiányos fehérjebevitel vagy túledzettség gyanúja a magas edzésvolumen miatt), a válasz legelején egy rövid [⚠️ FIGYELMEZTETÉS] blokkban jelezd ezt! 3. Étkezési és edzésajánlásnál ELSŐSORBAN a felhasználó saját mentett ételeiből és edzésterveiből ajánlj. 4. Használj letisztult Markdown formázást: félkövér kiemeléseket a fontos számoknál (pl. 2500 ml, 140g fehérje), és jól átlátható pontokba szedd a válaszokat.`;

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
    let fullPrompt = userText;
    if (!_hasSentContext && _uid) {
      const userContext = await _fetchFullUserContext(_uid);
      fullPrompt = `[FELHASZNÁLÓ TELJES HETI ÉS MENTETT ADATAI]:\n${userContext}\n\n[AKTUÁLIS KÉRDÉS VAGY KÉRÉS]:\n${userText}`;
      _hasSentContext = true;
    }

    // Biztosítjuk a modellt és chat-munkamenetet
    await _ensureFirebaseAI();

    let responseText = "";

    // 4. Hivatalos SDK hívás multi-turn startChat() munkameneten keresztül
    if (_chatSession) {
      try {
        const result = await _chatSession.sendMessage(fullPrompt);
        const resp = await result.response;
        responseText = resp.text();
      } catch (sdkErr) {
        // Ha a modell nyugdíjazva van (pl. Gemini 1.5 -> 2.0 váltás), automatikusan átváltunk
        if (sdkErr?.message?.includes("RETIRED_MODEL") || sdkErr?.toString()?.includes("retired")) {
          console.warn("[Lockin AI] Gemini 1.5 modell nyugdíjazva, átváltás gemini-2.0-flash-re...");
          _currentModelName = "gemini-2.0-flash";
          _chatSession = null;
          await _ensureFirebaseAI();
          if (_chatSession) {
            const retryResult = await _chatSession.sendMessage(fullPrompt);
            const retryResp = await retryResult.response;
            responseText = retryResp.text();
          } else {
            throw sdkErr;
          }
        } else {
          throw sdkErr;
        }
      }
    } else {
      throw new Error("A Firebase AI chat session nem inicializálódott.");
    }

    // 5. Válasz megjelenítése szépen formázott Markdownként
    if (loadingEl) loadingEl.classList.add("hidden");
    _appendAIBubble(responseText);

  } catch (err) {
    console.error("[Lockin AI] Hiba a válasz generálása során:", err);
    if (loadingEl) loadingEl.classList.add("hidden");

    // Intelligens helyi elemző és hiba visszajelzés
    const fallbackAnswer = _generateSmartFallbackResponse(userText, err);
    _appendAIBubble(fallbackAnswer);
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

// ── UI Buborékok Megjelenítése ─────────────────────────────
function _renderInitialGreeting() {
  const container = $("ai-chat-messages");
  if (!container) return;

  const greetingDiv = document.createElement("div");
  greetingDiv.className = "p-4 rounded-3xl bg-[#14161F] border border-[#222532] shadow-sm space-y-3";
  greetingDiv.innerHTML = `
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-xl p-[1px] bg-gradient-to-tr from-[#00E5FF] to-fuchsia-500 flex items-center justify-center">
        <div class="w-full h-full rounded-[11px] bg-[#0C0E12] flex items-center justify-center overflow-hidden">
          <img src="./logodark.jpg" alt="Lockin AI" class="w-full h-full object-cover" onerror="this.style.display='none';" />
        </div>
      </div>
      <div>
        <h4 class="text-xs font-extrabold text-white">Szia! A Lockin AI edződ vagyok.</h4>
        <p class="text-[10px] text-gray-400">Betöltöttem az elmúlt 7 napos edzéseidet, hidratációdat és receptjeidet.</p>
      </div>
    </div>
    <p class="text-xs text-gray-300 leading-relaxed">
      Kérdezz bármit a mai terhelésedről, az optimális edzés utáni tápanyagbevitelről a mentett receptjeid alapján, vagy kérj elemzést a regenerációdról!
    </p>
    <div class="pt-1 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-400">
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
      <div class="w-full h-full rounded-[10px] bg-[#0C0E12] flex items-center justify-center overflow-hidden">
        <img src="./logodark.jpg" alt="AI" class="w-full h-full object-cover" onerror="this.style.display='none';" />
      </div>
    </div>
    <div class="max-w-[90%] sm:max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-[#151720] border border-[#232736] text-gray-200 text-xs shadow-sm leading-relaxed break-words space-y-2">
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
    return `<div class="p-3 my-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium shadow-inner">
      <div class="flex items-center gap-1.5 font-bold mb-1 text-amber-400">
        <i class="fa-solid fa-triangle-exclamation text-amber-400"></i> FIGYELMEZTETÉS
      </div>
      <div class="text-amber-200/90 leading-relaxed">${body.trim()}</div>
    </div>`;
  });

  // 2. Fejlécek
  out = out.replace(/^### (.*$)/gim, '<h4 class="text-xs font-extrabold text-cyan-300 uppercase tracking-wider mt-3 mb-1">$1</h4>');
  out = out.replace(/^## (.*$)/gim, '<h3 class="text-sm font-extrabold text-white mt-3.5 mb-1">$1</h3>');
  out = out.replace(/^# (.*$)/gim, '<h2 class="text-base font-black text-white mt-4 mb-1.5">$1</h2>');

  // 3. Félkövér kiemelések (**szöveg**)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-extrabold text-white tracking-wide">$1</strong>');

  // 4. Dőlt szövegek (*szöveg*)
  out = out.replace(/\*([^*]+)\*/g, '<em class="text-slate-300">$1</em>');

  // 5. Kódblokkok (```lang ... ```)
  out = out.replace(/```([\s\S]*?)```/g, '<pre class="p-2.5 rounded-xl bg-[#0B0C0E] border border-[#222530] text-[11px] font-mono text-cyan-300 overflow-x-auto my-2"><code>$1</code></pre>');

  // 6. Soron belüli kód (`kód`)
  out = out.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-[#0B0C0E] border border-[#20222A] text-cyan-300 font-mono text-[11px]">$1</code>');

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

// ── Fallback Válasz Elemző (Offline / API Hiba esetén) ────────
function _generateSmartFallbackResponse(userText, err) {
  let warningBlock = "";
  const errDesc = err?.message || err?.toString() || "Ismeretlen hiba";

  // Ha az appban tárolt kontextusból látunk kritikus elmaradást
  if (_cachedContext) {
    if (_cachedContext.includes("KRITIKUS DEHIDRATÁCIÓ")) {
      warningBlock += `[⚠️ FIGYELMEZTETÉS] Az elmúlt 7 nap átlagos folyadékbevitele jóval a célérték alatt van! A dehidratáció akár 10-15%-os aerob teljesítménycsökkenést okoz.\n\n`;
    }
    if (_cachedContext.includes("KRITIKUS FEHÉRJEHIÁNY")) {
      warningBlock += `[⚠️ FIGYELMEZTETÉS] A fehérjebeviteled elmarad a kívánatos szinttől! Az izomregeneráció és a fehérjeszintézis fenntartásához pótold a hiányt.\n\n`;
    }
  }

  return `${warningBlock}**Lockin AI Elemzés** (Helyi mód):

A felhő modell válaszadása jelenleg nem elérhető (*${errDesc}*).

**Gyakorlati tanácsok a heti adataid alapján:**
- **Hidratáció:** Mindig célozz meg legalább **35-40 ml / testsúlykilogramm** napi folyadékot, plusz az edzés során elveszített izzadságot.
- **Étkezés:** Edzés után a mentett receptjeid közül válaszd a magas fehérje- és gyors szénhidráttartalmú ételeket (pl. zabkása fehérjével vagy csirkés rizs).
- **Regeneráció:** Ügyelj a minőségi alvásra és a zóna szerinti pulzustartományok betartására.

*💡 Tipp: A Firebase Konzolban (Build > Vertex AI in Firebase) ellenőrizheted az AI API engedélyezését a teljes felhő-modell eléréséhez.*`;
}

// Automatikus eseménykötés amint a DOM készen áll
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bindUI);
  } else {
    _bindUI();
  }
}
