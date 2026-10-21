// ============================================================
// diet.js — Diéta, Ételmenü, Hidratáció & Táplálékkiegészítők
// FitPlan Pro | Emerald / Green téma
// 6 étkezés, Napi/Heti nézet, Barcode scanner, Bevásárlólista
// ============================================================

import { db } from '../firebase-config.js';
import { getGoals } from '../settings.js';
import { calcWorkoutSweatLoss } from '../garmin-sports.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── DOM segéd ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── 6 Étkezési kategória metaadatai ─────────────────────────
export const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Reggeli',    icon: 'fa-solid fa-sun',        desc: 'Napindító étkezés' },
  { id: 'elevenses', label: 'Tízórai',    icon: 'fa-solid fa-apple-whole',desc: 'Délelőtti energia' },
  { id: 'lunch',     label: 'Ebéd',       icon: 'fa-solid fa-cloud-sun',  desc: 'Főétkezés' },
  { id: 'snack1',    label: 'Uzsonna 1',  icon: 'fa-solid fa-cookie-bite',desc: 'Délutáni snack' },
  { id: 'snack2',    label: 'Uzsonna 2',  icon: 'fa-solid fa-seedling',   desc: 'Edzés előtti / utáni' },
  { id: 'dinner',    label: 'Vacsora',    icon: 'fa-solid fa-moon',       desc: 'Könnyed esti zárás' },
];

export const MEAL_META = MEAL_SLOTS.reduce((acc, slot) => {
  acc[slot.id] = slot;
  return acc;
}, {});

// ── Italok hidratációs szorzóval ───────────────────────────
export const DRINK_TYPES = [
  { id: 'water',       name: 'Víz / Ásványvíz', factor: 1.0, icon: 'fa-solid fa-glass-water', color: '#0ea5e9' },
  { id: 'isotonic',    name: 'Izotóniás sportital', factor: 1.1, icon: 'fa-solid fa-bolt', color: '#10b981' },
  { id: 'tea',         name: 'Zöld tea / Gyógytea', factor: 1.0, icon: 'fa-solid fa-mug-hot', color: '#14b8a6' },
  { id: 'coffee',      name: 'Kávé / Fekete tea', factor: 0.8, icon: 'fa-solid fa-mug-saucer', color: '#854d0e' },
  { id: 'juice',       name: '100% Gyümölcslé', factor: 0.9, icon: 'fa-solid fa-lemon', color: '#f59e0b' },
  { id: 'alcohol',     name: 'Sör / Alkohol', factor: 0.5, icon: 'fa-solid fa-beer-mug-empty', color: '#ef4444' }
];

// ── Alapértelmezett étel adatbázis tételek ──────────────────
const DEFAULT_FOOD_DB = [
  { name: 'Csirkemell filé (nyers)', cal100: 120, p100: 22.5, c100: 0, f100: 2.6, unit: 'g' },
  { name: 'Zabpehely', cal100: 375, p100: 13.5, c100: 60.0, f100: 7.0, unit: 'g' },
  { name: 'Basmati rizs (száraz)', cal100: 350, p100: 7.0, c100: 78.0, f100: 0.8, unit: 'g' },
  { name: 'Tojás (M-es, 1 db ~53g)', cal100: 143, p100: 12.6, c100: 0.7, f100: 9.9, unit: 'g' },
  { name: 'Sovány tehéntúró', cal100: 78, p100: 14.0, c100: 3.5, f100: 0.5, unit: 'g' },
  { name: 'Banán', cal100: 89, p100: 1.1, c100: 22.8, f100: 0.3, unit: 'g' },
  { name: 'Tejsavó fehérje por (100% Whey)', cal100: 395, p100: 76.0, c100: 6.0, f100: 6.5, unit: 'g' },
  { name: 'Extra szűz olívaolaj', cal100: 884, p100: 0, c100: 0, f100: 100.0, unit: 'g' },
  { name: 'Brokkoli', cal100: 34, p100: 2.8, c100: 6.6, f100: 0.4, unit: 'g' },
  { name: 'Lazac filé', cal100: 208, p100: 20.0, c100: 0, f100: 13.0, unit: 'g' },
  { name: 'Görög joghurt (0% zsír)', cal100: 59, p100: 10.0, c100: 3.6, f100: 0.4, unit: 'g' }
];

// ── Beépített minta receptek (Recipe Library — max 1 minta étel, törölhető) ────
export const DEFAULT_RECIPES = [
  {
    id: 'default_recipe_1',
    isSample: true,
    name: 'Csirkés-zöldséges bulgurtál',
    unitType: 'adag',
    servings: 1,
    totalWeight: 390,
    calories: 520,
    protein: 48,
    carbs: 55,
    fat: 12,
    ingredientItems: [
      { name: 'Csirkemell filé', grams: 200, cal100: 110, p100: 23.0, c100: 0, f100: 1.2 },
      { name: 'Bulgur (szárazon)', grams: 80, cal100: 342, p100: 12.3, c100: 76.0, f100: 1.3 },
      { name: 'Brokkoli', grams: 100, cal100: 34, p100: 2.8, c100: 6.6, f100: 0.4 },
      { name: 'Extra szűz olívaolaj', grams: 10, cal100: 884, p100: 0, c100: 0, f100: 100.0 }
    ],
    ingredients: '200g csirkemell filé\n80g bulgur (szárazon)\n100g brokkoli\n80g kaliforniai paprika\n10ml extra szűz olívaolaj\nSó, bors, oregánó',
    instructions: '1. A bulgurt kétszeres forró sós vízben lefedve 15 perc alatt megpároljuk.\n2. A csirkemellet felcsíkozzuk, fűszerezzük, majd olívaolajon aranybarnára pirítjuk.\n3. Hozzáadjuk a párolt zöldségeket, és a bulgurral összeforgatva tálaljuk.'
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

function _markSampleDeleted(key, id) {
  try {
    const list = _getDeletedSampleIds(key);
    if (!list.includes(id)) {
      list.push(id);
      const userKey = _uid ? `lockin_deleted_sample_${key}_${_uid}` : `lockin_deleted_sample_${key}_default`;
      localStorage.setItem(userKey, JSON.stringify(list));
      localStorage.setItem(`lockin_deleted_sample_${key}_default`, JSON.stringify(list));
    }
  } catch (e) {
    console.error('Error saving deleted sample:', e);
  }
}

// ── Belső állapot ──────────────────────────────────────────
let _uid = null;
let _unsubMeals = null;
let _unsubFoodDb = null;
let _unsubRecipes = null;
let _unsubHydration = null;
let _unsubSupplements = null;
let _unsubWorkouts = null;

let _allMeals = [];
let _foodDatabase = [];
let _currentFoodList = [];
let _recipes = [];
let _hydrationLogs = [];
let _supplementLogs = [];
let _allWorkouts = [];

let _selectedDate = todayString();
let _viewMode = 'day'; // 'day' | 'week'
let _activeMealSlot = 'breakfast';
let _activeFilter = 'all';
let _activeFoodTab = 'ingredients'; // 'ingredients' | 'recipes'
let _activeIngredientTarget = 'meal'; // 'meal' | 'recipe'
let _activeRecipeUnitType = 'adag'; // 'adag' | 'gramm'

let _uiInitialized = false;

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// ── Dátum segédek ──────────────────────────────────────────
function _formatDateHU(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const today = todayString();
  const days = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  const months = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

  const isToday = dateStr === today;
  return `${d.getFullYear()}. ${months[d.getMonth()]} ${d.getDate()}., ${days[d.getDay()]}${isToday ? ' (Ma)' : ''}`;
}

function _shiftDate(offsetDays) {
  const d = new Date(_selectedDate + 'T12:00:00');
  d.setDate(d.getDate() + offsetDays);
  _selectedDate = d.toISOString().slice(0, 10);
  _onDateChanged();
}

function _onDateChanged(syncWhoop = true) {
  const dateInput = $('diet-current-date-input');
  const dateText = $('diet-current-date-text');
  if (dateInput) dateInput.value = _selectedDate;
  if (dateText) dateText.textContent = _formatDateHU(_selectedDate);

  _updateStats();
  _renderDietView();
  _renderHydration();
  _renderSupplements();

  if (syncWhoop && typeof window !== 'undefined' && typeof window.setWhoopDate === 'function') {
    window.setWhoopDate(_selectedDate, false);
  }
}

export function setDietDate(dateStr, syncWhoop = false) {
  if (!dateStr || _selectedDate === dateStr) return;
  _selectedDate = dateStr;
  _onDateChanged(syncWhoop);
}
if (typeof window !== 'undefined') {
  window.setDietDate = setDietDate;
}

export function getDietDate() {
  return _selectedDate;
}
if (typeof window !== 'undefined') {
  window.getDietDate = getDietDate;
}

// ── Statisztikák számítása ─────────────────────────────────
function _updateStats() {
  const targetDateMeals = _allMeals.filter(m => m.date === _selectedDate);

  const totalCalories = Math.round(targetDateMeals.reduce((s, m) => s + (m.calories || 0), 0));
  const totalProtein  = Math.round(targetDateMeals.reduce((s, m) => s + (m.protein  || 0), 0));
  const totalCarbs    = Math.round(targetDateMeals.reduce((s, m) => s + (m.carbs    || 0), 0));
  const totalFat      = Math.round(targetDateMeals.reduce((s, m) => s + (m.fat      || 0), 0));
  const count         = targetDateMeals.length;

  const elCal     = $('diet-stat-calories');
  const elProtein = $('diet-stat-protein');
  const elMeals   = $('diet-stat-meals');

  if (elCal)     elCal.textContent     = totalCalories;
  if (elProtein) elProtein.textContent = `${totalProtein}g`;
  if (elMeals)   elMeals.textContent   = count;

  // Cél előrehaladás (Goal progress)
  const goals = getGoals();
  const calGoal = goals.calorieGoal || 2200;
  const proGoal = goals.proteinGoal || 150;

  const calProgress = $('diet-progress-calories');
  const proProgress = $('diet-progress-protein');
  const calGoalText = $('diet-goal-calories-text');
  const proGoalText = $('diet-goal-protein-text');

  if (calGoalText) calGoalText.textContent = `${totalCalories} / ${calGoal} kcal`;
  if (proGoalText) proGoalText.textContent = `${totalProtein}g / ${proGoal}g`;

  if (calProgress) {
    const pct = Math.min(100, Math.round((totalCalories / calGoal) * 100));
    calProgress.style.width = `${pct}%`;
  }
  if (proProgress) {
    const pct = Math.min(100, Math.round((totalProtein / proGoal) * 100));
    proProgress.style.width = `${pct}%`;
  }
}

// ── Fő nézet renderelő (Napi vs Heti) ──────────────────────
function _renderDietView() {
  const container = $('diet-records-list');
  if (!container) return;

  if (_viewMode === 'day') {
    _renderDayView(container);
  } else {
    _renderWeekView(container);
  }
}

// ── Napi nézet (6 étkezési sávval) ─────────────────────────
function _renderDayView(container) {
  const dayMeals = _allMeals.filter(m => m.date === _selectedDate);

  let html = `
    <!-- Napi fejléc dátumválasztóval -->
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-4 shadow-sm mb-4">
      <div class="flex items-center justify-between gap-2">
        <button id="diet-prev-day-btn" class="w-9 h-9 rounded-2xl bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-300 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>

        <div class="relative cursor-pointer text-center flex-1">
          <p id="diet-current-date-text" class="text-sm font-bold text-gray-900 dark:text-white tracking-tight">${_formatDateHU(_selectedDate)}</p>
          <input id="diet-current-date-input" type="date" value="${_selectedDate}" class="absolute inset-0 opacity-0 cursor-pointer w-full" />
        </div>

        <button id="diet-next-day-btn" class="w-9 h-9 rounded-2xl bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-300 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
          <i class="fa-solid fa-chevron-right text-sm"></i>
        </button>
      </div>
    </div>
  `;

  // 6 étkezési sáv generálása
  MEAL_SLOTS.forEach(slot => {
    const slotMeals = dayMeals.filter(m => (m.mealType || 'breakfast') === slot.id);
    const slotKcal = Math.round(slotMeals.reduce((s, m) => s + (m.calories || 0), 0));
    const slotProtein = Math.round(slotMeals.reduce((s, m) => s + (m.protein || 0), 0));

    html += `
      <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-4 shadow-sm mb-4">
        <!-- Sáv fejléc -->
        <div class="flex items-center justify-between pb-3 border-b border-gray-50 dark:border-slate-800/80">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <i class="${slot.icon} text-base"></i>
            </div>
            <div>
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">${slot.label}</h3>
              <p class="text-[11px] text-gray-400 dark:text-gray-500">${slot.desc}</p>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <div class="text-right mr-1">
              <p class="text-xs font-bold text-emerald-600 dark:text-emerald-400">${slotKcal} kcal</p>
              <p class="text-[10px] text-gray-400">P: ${slotProtein}g</p>
            </div>
            <button class="diet-slot-barcode-btn w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors active:scale-95 shadow-xs" data-slot="${slot.id}" title="Vonalkód beolvasása (${slot.label})">
              <i class="fa-solid fa-barcode text-xs pointer-events-none"></i>
            </button>
            <button class="diet-add-to-slot-btn w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors active:scale-95 shadow-xs" data-slot="${slot.id}" title="Étel hozzáadása a ${slot.label}-hez">
              <i class="fa-solid fa-plus text-xs pointer-events-none"></i>
            </button>
          </div>
        </div>

        <!-- Ételek listája az adott sávban -->
        <div class="mt-3 space-y-2">
          ${slotMeals.length === 0 ? `
            <p class="text-xs text-gray-400 dark:text-gray-600 py-1 text-center italic">Még nem rögzítettél ételt.</p>
          ` : slotMeals.map(meal => `
            <div class="flex items-center justify-between py-2 px-3 rounded-2xl bg-gray-50/70 dark:bg-slate-800/60 text-xs gap-2">
              <div class="flex items-center gap-2.5 flex-1 min-w-0 pr-1">
                ${meal.imageUrl ? `
                  <img src="${_esc(meal.imageUrl)}" alt="" class="w-8 h-8 rounded-xl object-contain bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 p-0.5 flex-shrink-0" onerror="this.remove()" />
                ` : ''}
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-gray-800 dark:text-gray-200 truncate">${_esc(meal.name)}</p>
                  <p class="text-[10px] text-gray-400 mt-0.5">
                    ${meal.quantity ? `${meal.quantity}g · ` : ''}P: ${meal.protein || 0}g · C: ${meal.carbs || 0}g · F: ${meal.fat || 0}g
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="font-bold text-emerald-600 dark:text-emerald-400">${meal.calories || 0} kcal</span>
                <button class="diet-delete-meal-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${meal.id}">
                  <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Dátumváltó gombok bekötése
  const prevBtn = $('diet-prev-day-btn');
  const nextBtn = $('diet-next-day-btn');
  const dateInput = $('diet-current-date-input');

  if (prevBtn) prevBtn.addEventListener('click', () => _shiftDate(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => _shiftDate(1));
  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        _selectedDate = e.target.value;
        _onDateChanged();
      }
    });
    dateInput.parentElement?.addEventListener('click', () => {
      if (typeof dateInput.showPicker === 'function') {
        try { dateInput.showPicker(); } catch (e) {}
      }
    });
  }

  // Sáv hozzáadás gombok
  container.querySelectorAll('.diet-add-to-slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeMealSlot = btn.dataset.slot || 'breakfast';
      _openAddMealModal();
    });
  });

  // Sáv vonalkód beolvasó gombok
  container.querySelectorAll('.diet-slot-barcode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slotId = btn.dataset.slot || 'breakfast';
      _openQuickBarcodeModal(slotId, 'slot_direct');
    });
  });

  // Törlés gombok
  container.querySelectorAll('.diet-delete-meal-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) _deleteMeal(id);
    });
  });
}

// ── Heti nézet ─────────────────────────────────────────────
function _renderWeekView(container) {
  // Hétfőtől vasárnapig tartó hét meghatározása
  const curr = new Date(_selectedDate + 'T12:00:00');
  const dayOfWeek = curr.getDay(); // 0: vasárnap, 1: hétfő
  const diffToMon = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;

  const mon = new Date(curr);
  mon.setDate(curr.getDate() + diffToMon);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    weekDays.push(d.toISOString().slice(0, 10));
  }

  const dayNames = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

  let totalWeekKcal = 0;
  let totalWeekProtein = 0;

  const weekCards = weekDays.map((dateStr, idx) => {
    const dayMeals = _allMeals.filter(m => m.date === dateStr);
    const dayKcal = Math.round(dayMeals.reduce((s, m) => s + (m.calories || 0), 0));
    const dayProtein = Math.round(dayMeals.reduce((s, m) => s + (m.protein || 0), 0));
    totalWeekKcal += dayKcal;
    totalWeekProtein += dayProtein;

    const isToday = dateStr === todayString();
    const isSelected = dateStr === _selectedDate;

    return `
      <div class="p-3.5 rounded-2xl border transition-all cursor-pointer ${
        isSelected
          ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30'
          : 'border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900'
      }" data-week-date="${dateStr}">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs font-bold ${isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-800 dark:text-gray-200'}">
              ${dayNames[idx]} ${isToday ? '★' : ''}
            </span>
            <p class="text-[11px] text-gray-400">${dateStr.slice(5)}</p>
          </div>
          <div class="text-right">
            <span class="text-xs font-bold text-gray-900 dark:text-white">${dayKcal} kcal</span>
            <p class="text-[10px] text-gray-400">P: ${dayProtein}g · ${dayMeals.length} tétel</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Heti összefoglaló kártya -->
    <div class="bg-emerald-500 text-white rounded-3xl p-5 shadow-lg shadow-emerald-500/20 mb-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-emerald-100 font-medium">Heti összesítés (${weekDays[0].slice(5)} – ${weekDays[6].slice(5)})</p>
          <h2 class="text-2xl font-bold mt-1">${totalWeekKcal.toLocaleString('hu-HU')} kcal</h2>
        </div>
        <div class="text-right">
          <p class="text-xs text-emerald-100">Napi átlag</p>
          <p class="text-lg font-bold">${Math.round(totalWeekKcal / 7)} kcal</p>
        </div>
      </div>
    </div>

    <!-- Hét napjainak kártyái -->
    <div class="space-y-2.5 mb-6">
      ${weekCards}
    </div>
  `;

  // Kattintásra váltson az adott napra és nyissa meg a napi nézetet
  container.querySelectorAll('[data-week-date]').forEach(card => {
    card.addEventListener('click', () => {
      _selectedDate = card.dataset.weekDate;
      _viewMode = 'day';
      _updateViewModeButtons();
      _onDateChanged();
    });
  });
}

// ── Bevásárlólista (Shopping List) generáló ─────────────────
let _shoppingListMode = null; // 'day' | 'week'
let _checkedShoppingItems = new Set();

function _getCheckedStorageKey() {
  return `lockin_checked_shopping_${_uid || 'user'}`;
}

function _loadCheckedShopping() {
  try {
    const raw = localStorage.getItem(_getCheckedStorageKey());
    _checkedShoppingItems = raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    _checkedShoppingItems = new Set();
  }
}

function _saveCheckedShopping() {
  try {
    localStorage.setItem(_getCheckedStorageKey(), JSON.stringify(Array.from(_checkedShoppingItems)));
  } catch (e) {}
}

function _openShoppingListModal() {
  _loadCheckedShopping();
  // Alapértelmezett: aktuális nézet alapján 'day' vagy 'week'
  _shoppingListMode = _viewMode === 'week' ? 'week' : 'day';
  _renderShoppingListModalContent();

  const modal = $('diet-shopping-modal');
  const sheet = $('diet-shopping-sheet');
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _renderShoppingListModalContent() {
  const content = $('diet-shopping-content');
  if (!content) return;

  const isWeek = _shoppingListMode === 'week';
  let targetMeals = [];
  let periodTitle = '';

  if (isWeek) {
    const curr = new Date(_selectedDate + 'T12:00:00');
    const dayOfWeek = curr.getDay();
    const diffToMon = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;
    const mon = new Date(curr);
    mon.setDate(curr.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const monStr = mon.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);

    targetMeals = _allMeals.filter(m => m.date >= monStr && m.date <= sunStr);
    periodTitle = `Heti menü (${monStr} – ${sunStr})`;
  } else {
    targetMeals = _allMeals.filter(m => m.date === _selectedDate);
    periodTitle = `Napi menü (${_selectedDate})`;
  }

  // Hozzávalók kinyerése: soronként bontva minden külön hozzávalót!
  const deletedSampleIds = _getDeletedSampleIds('recipes');
  const activeDefaultRecipes = (DEFAULT_RECIPES || []).filter(r => !deletedSampleIds.includes(r.id) && !deletedSampleIds.includes(r.name));
  const allKnownRecipes = [...activeDefaultRecipes, ..._recipes];
  const ingredientItems = [];

  targetMeals.forEach(m => {
    let ingStr = (m.ingredients || '').trim();

    // Ha nincs az ételhez rögzített hozzávaló lista, próbáljuk megtalálni a recepttárból
    if (!ingStr && m.name) {
      const rec = allKnownRecipes.find(r => r.name && r.name.toLowerCase() === m.name.toLowerCase());
      if (rec && rec.ingredients) {
        ingStr = rec.ingredients.trim();
      }
    }

    if (ingStr) {
      // Új soronként daraboljuk, és minden tétel külön pont lesz!
      const lines = ingStr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      lines.forEach(line => {
        // Eltávolítjuk a felesleges felsorolásjeleket
        const cleaned = line.replace(/^[-*•\d\.\)]\s*/, '').trim();
        if (cleaned) {
          ingredientItems.push({
            name: cleaned,
            fromMeal: m.name || 'Recept',
            date: m.date
          });
        }
      });
    } else {
      // Ha nincs semmilyen összetevő, maga az étel megnevezése szerepel
      const fallbackName = (m.name || 'Étel').trim();
      ingredientItems.push({
        name: fallbackName + (m.quantity ? ` (${Math.round(m.quantity)}g)` : ''),
        fromMeal: m.name || 'Étkezés',
        date: m.date
      });
    }
  });

  // Csoportosítás vagy egyedi felsorolás
  const map = new Map();
  ingredientItems.forEach(item => {
    const key = item.name.toLowerCase();
    const existing = map.get(key) || { name: item.name, count: 0, fromMeals: new Set() };
    existing.count += 1;
    if (item.fromMeal) existing.fromMeals.add(item.fromMeal);
    map.set(key, existing);
  });

  const uniqueItems = Array.from(map.values());

  content.innerHTML = `
    <!-- Nézet váltó sáv (Napi / Heti) -->
    <div class="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-slate-800">
      <div class="flex items-center bg-gray-100 dark:bg-slate-800 p-1 rounded-2xl">
        <button id="diet-shop-tab-day" type="button" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${!isWeek ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'}">
          <i class="fa-regular fa-calendar-day mr-1"></i>Napi lista
        </button>
        <button id="diet-shop-tab-week" type="button" class="px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${isWeek ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900'}">
          <i class="fa-solid fa-calendar-week mr-1"></i>Heti lista
        </button>
      </div>
      <span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 truncate max-w-[170px]">${periodTitle}</span>
    </div>

    ${uniqueItems.length === 0 ? `
      <div class="text-center py-10">
        <div class="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 mx-auto flex items-center justify-center mb-3">
          <i class="fa-solid fa-basket-shopping text-xl"></i>
        </div>
        <p class="text-sm font-bold text-gray-700 dark:text-gray-300">Nincs hozzávaló az adott időszakra.</p>
        <p class="text-xs text-gray-400 mt-1">Adj hozzá ételeket a naphoz vagy a heti menühöz!</p>
      </div>
    ` : `
      <div class="mb-3 flex items-center justify-between text-xs text-gray-500">
        <span>Összesen: <strong class="text-gray-800 dark:text-gray-200">${uniqueItems.length} tétel</strong></span>
        <div class="flex items-center gap-3">
          <button id="diet-clear-shopping-checks-btn" class="text-gray-400 hover:text-red-500 transition-colors text-[11px]">
            <i class="fa-solid fa-rotate-left mr-1"></i>Pipák törlése
          </button>
          <button id="diet-copy-shopping-btn" class="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline text-[11px]">
            <i class="fa-regular fa-copy mr-1"></i>Másolás vágólapra
          </button>
        </div>
      </div>

      <div class="space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar">
        ${uniqueItems.map(it => {
          const isChecked = _checkedShoppingItems.has(it.name.toLowerCase());
          const mealsStr = Array.from(it.fromMeals).join(', ');
          return `
            <label class="diet-shopping-row flex items-center gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/80 cursor-pointer hover:bg-emerald-50/50 transition-all border border-transparent ${isChecked ? 'opacity-60 bg-emerald-50/20 dark:bg-emerald-950/20' : ''}"
                   data-name="${_esc(it.name)}">
              <input type="checkbox" class="diet-shopping-check w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500" ${isChecked ? 'checked' : ''} />
              <div class="flex-1 min-w-0">
                <span class="diet-item-title text-xs font-semibold text-gray-800 dark:text-gray-200 block truncate ${isChecked ? 'line-through text-gray-400 dark:text-gray-500' : ''}">
                  ${_esc(it.name)}
                </span>
                <span class="text-[10px] text-gray-400 truncate block">
                  ${mealsStr ? `Recept: ${mealsStr}` : 'Étel hozzávaló'} ${it.count > 1 ? ` · (${it.count}× szerepel)` : ''}
                </span>
              </div>
              ${isChecked ? `
                <span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60">Megvan ✓</span>
              ` : ''}
            </label>
          `;
        }).join('')}
      </div>
    `}
  `;

  // Fülváltók eseményei
  const tabDay = $('diet-shop-tab-day');
  const tabWeek = $('diet-shop-tab-week');
  if (tabDay) tabDay.addEventListener('click', () => {
    _shoppingListMode = 'day';
    _renderShoppingListModalContent();
  });
  if (tabWeek) tabWeek.addEventListener('click', () => {
    _shoppingListMode = 'week';
    _renderShoppingListModalContent();
  });

  // Pipálás eseménykezelése
  content.querySelectorAll('.diet-shopping-row').forEach(row => {
    const cb = row.querySelector('.diet-shopping-check');
    const name = row.dataset.name;
    if (cb && name) {
      cb.addEventListener('change', () => {
        const key = name.toLowerCase();
        if (cb.checked) {
          _checkedShoppingItems.add(key);
        } else {
          _checkedShoppingItems.delete(key);
        }
        _saveCheckedShopping();
        _renderShoppingListModalContent();
      });
    }
  });

  // Pipák törlése
  const clearBtn = $('diet-clear-shopping-checks-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _checkedShoppingItems.clear();
      _saveCheckedShopping();
      _renderShoppingListModalContent();
    });
  }

  // Másolás vágólapra
  const copyBtn = $('diet-copy-shopping-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = uniqueItems.map(it => {
        const checked = _checkedShoppingItems.has(it.name.toLowerCase());
        return `${checked ? '[✓]' : '[ ]'} ${it.name}`;
      }).join('\n');
      const contentToCopy = `Lockin Bevásárlólista (${periodTitle}):\n${text}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentToCopy).then(() => {
          copyBtn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Kimásolva!';
          setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy mr-1"></i>Másolás vágólapra'; }, 2000);
        }).catch(() => {
          _fallbackCopyText(contentToCopy, copyBtn);
        });
      } else {
        _fallbackCopyText(contentToCopy, copyBtn);
      }
    });
  }
}

function _closeShoppingListModal() {
  const modal = $('diet-shopping-modal');
  const sheet = $('diet-shopping-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

// ── Ételmenü & Barcode Scanner Adatbázis ─────────────────────
function _openFoodDbModal(initialTab = 'ingredients') {
  const modal = $('diet-food-db-modal');
  const sheet = $('diet-food-db-sheet');
  if (!modal || !sheet) return;

  _setRecipeUnitType(_activeRecipeUnitType || 'adag');
  _switchFoodDbTab(initialTab || 'ingredients');
  _renderFoodDbList();
  _renderRecipesList();

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeFoodDbModal() {
  _stopBarcodeScanner();
  const modal = $('diet-food-db-modal');
  const sheet = $('diet-food-db-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

function _switchFoodDbTab(tab) {
  _activeFoodTab = tab;
  const btnIng = $('diet-food-tab-btn-ingredients');
  const btnRec = $('diet-food-tab-btn-recipes');
  const panelIng = $('diet-food-panel-ingredients');
  const panelRec = $('diet-food-panel-recipes');

  const activeClasses = ['bg-white', 'dark:bg-slate-900', 'text-emerald-600', 'dark:text-emerald-400', 'shadow-sm'];
  const inactiveClasses = ['text-gray-500', 'dark:text-gray-400', 'hover:text-gray-900', 'dark:hover:text-gray-200'];

  if (tab === 'ingredients') {
    if (panelIng) panelIng.classList.remove('hidden');
    if (panelRec) panelRec.classList.add('hidden');

    if (btnIng) {
      btnIng.classList.add(...activeClasses);
      btnIng.classList.remove(...inactiveClasses);
    }
    if (btnRec) {
      btnRec.classList.remove(...activeClasses);
      btnRec.classList.add(...inactiveClasses);
    }
    _renderFoodDbList($('diet-food-db-search')?.value || '');
  } else {
    if (panelIng) panelIng.classList.add('hidden');
    if (panelRec) panelRec.classList.remove('hidden');

    if (btnRec) {
      btnRec.classList.add(...activeClasses);
      btnRec.classList.remove(...inactiveClasses);
    }
    if (btnIng) {
      btnIng.classList.remove(...activeClasses);
      btnIng.classList.add(...inactiveClasses);
    }
    _renderRecipesList($('diet-recipes-search')?.value || '');
  }
}

function _renderFoodDbList(searchQuery = '') {
  const listEl = $('diet-food-db-items');
  if (!listEl) return;

  const q = searchQuery.toLowerCase().trim();
  const allFoods = [...DEFAULT_FOOD_DB, ..._foodDatabase];

  const filtered = q
    ? allFoods.filter(f => f.name.toLowerCase().includes(q))
    : allFoods;

  _currentFoodList = filtered;

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Nincs találat az alapanyagok között.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map((f, idx) => `
    <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/80 hover:bg-emerald-50/50 transition-colors">
      <div class="flex items-center gap-2.5 flex-1 min-w-0 pr-2">
        ${f.imageUrl ? `
          <img src="${_esc(f.imageUrl)}" alt="" class="w-8 h-8 rounded-xl object-contain bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 p-0.5 flex-shrink-0" onerror="this.remove()" />
        ` : ''}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">${_esc(f.name)}</p>
          <p class="text-[11px] text-gray-400">100g: ${f.cal100} kcal · P:${f.p100}g · C:${f.c100}g · F:${f.f100}g</p>
        </div>
      </div>
      <button class="diet-select-db-food-btn px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs active:scale-95 transition-all flex items-center gap-1"
        data-index="${idx}">
        <i class="fa-solid fa-plus text-[10px] pointer-events-none"></i>
        <span>Kiválasztás</span>
      </button>
    </div>
  `).join('');

  // Kiválasztás gomb: átviszi az ételt az étkezés hozzáadása ablakba
  listEl.querySelectorAll('.diet-select-db-food-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      const food = _currentFoodList[idx];
      if (!food) return;

      const dbModal = $('diet-food-db-modal');
      const dbSheet = $('diet-food-db-sheet');
      if (dbModal) dbModal.classList.add('hidden');
      if (dbSheet) dbSheet.style.transform = 'translateY(100%)';

      _openAddMealModal(food);
    });
  });
}

// ── Receptkönyvtár renderelés & kezelés ──────────────────────
function _renderRecipesList(searchQuery = '') {
  const listEl = $('diet-recipes-list');
  if (!listEl) return;

  const q = searchQuery.toLowerCase().trim();
  const deletedSampleIds = _getDeletedSampleIds('recipes');
  const activeDefaultRecipes = (DEFAULT_RECIPES || []).filter(r => !deletedSampleIds.includes(r.id) && !deletedSampleIds.includes(r.name));
  const allRecipes = [...activeDefaultRecipes, ...(_recipes || [])];

  const filtered = q
    ? allRecipes.filter(r => r && ((r.name && r.name.toLowerCase().includes(q)) || (r.ingredients && r.ingredients.toLowerCase().includes(q))))
    : allRecipes.filter(Boolean);

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Nincs találat a receptek között.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map((recipe, idx) => {
    const isCustom = Boolean(recipe.id && !recipe.isSample);
    return `
      <div class="p-4 rounded-3xl bg-gray-50 dark:bg-slate-800/80 border border-gray-100 dark:border-slate-700/60 shadow-sm transition-all">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 flex-1 min-w-0 pr-2">
            <div class="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <i class="fa-solid fa-utensils text-xs"></i>
            </div>
            <div class="min-w-0">
              <h4 class="text-xs font-bold text-gray-900 dark:text-white truncate">${_esc(recipe.name)}</h4>
              <p class="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                ${recipe.unitType === 'gramm' ? `${recipe.totalWeight || 100}g: ` : `${recipe.servings || 1} adag: `}${recipe.calories || 0} kcal · P:${recipe.protein || 0}g · C:${recipe.carbs || 0}g · F:${recipe.fat || 0}g
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${isCustom ? `
              <span class="text-[9px] bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">Saját</span>
              <button class="diet-delete-recipe-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${recipe.id}" title="Recept törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            ` : `
              <span class="text-[9px] bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full font-semibold">Minta</span>
              <button class="diet-delete-recipe-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${recipe.id || recipe.name}" data-is-sample="true" title="Minta étel törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            `}
          </div>
        </div>

        <!-- Hozzávalók és elkészítés lenyitható modul -->
        <details class="text-[11px] text-gray-600 dark:text-gray-300 my-2.5 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-gray-100 dark:border-slate-800">
          <summary class="font-bold text-gray-700 dark:text-gray-200 cursor-pointer select-none outline-none flex items-center justify-between">
            <span><i class="fa-solid fa-receipt mr-1 text-emerald-600"></i> Hozzávalók &amp; Elkészítés</span>
            <i class="fa-solid fa-chevron-down text-[10px] text-gray-400"></i>
          </summary>
          <div class="mt-2 pt-2 border-t border-gray-100 dark:border-slate-800 space-y-2">
            ${recipe.ingredients ? `
              <div>
                <span class="font-bold text-[10px] text-gray-400 uppercase tracking-wider block mb-0.5">Hozzávalók:</span>
                <p class="font-mono text-[10px] whitespace-pre-line leading-relaxed text-gray-600 dark:text-gray-300">${_esc(recipe.ingredients)}</p>
              </div>
            ` : ''}
            ${recipe.instructions ? `
              <div>
                <span class="font-bold text-[10px] text-gray-400 uppercase tracking-wider block mb-0.5">Elkészítés:</span>
                <p class="text-[11px] whitespace-pre-line leading-relaxed text-gray-600 dark:text-gray-300">${_esc(recipe.instructions)}</p>
              </div>
            ` : ''}
          </div>
        </details>

        <!-- 1-kattintásos beemelés a mai étkezésbe -->
        <button class="diet-apply-recipe-btn w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm"
          data-index="${idx}">
          <i class="fa-solid fa-plus text-[10px] pointer-events-none"></i>
          <span>Hozzáadás a mai étkezésekhez</span>
        </button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.diet-apply-recipe-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      const recipe = filtered[idx];
      if (!recipe) return;

      const dbModal = $('diet-food-db-modal');
      const dbSheet = $('diet-food-db-sheet');
      if (dbModal) dbModal.classList.add('hidden');
      if (dbSheet) dbSheet.style.transform = 'translateY(100%)';

      _openAddMealModalFromRecipe(recipe);
    });
  });

  listEl.querySelectorAll('.diet-delete-recipe-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const isSample = btn.dataset.isSample === 'true';
      if (isSample) {
        _markSampleDeleted('recipes', id);
        _renderRecipesList($('diet-recipes-search')?.value || '');
        return;
      }
      if (id && _uid) {
        try {
          await deleteDoc(doc(db, 'users', _uid, 'recipes', id));
        } catch (err) {
          console.error('[diet] Recipe delete error:', err);
        }
      }
    });
  });
}

function _setRecipeUnitType(type) {
  _activeRecipeUnitType = type === 'gramm' ? 'gramm' : 'adag';
  const btnAdag = $('diet-recipe-unit-btn-adag');
  const btnGramm = $('diet-recipe-unit-btn-gramm');
  const wrapAdag = $('diet-recipe-adag-wrap');
  const wrapGramm = $('diet-recipe-gramm-wrap');

  const activeClasses = ['bg-emerald-600', 'text-white', 'shadow-xs'];
  const inactiveClasses = ['text-gray-500', 'dark:text-gray-400', 'hover:text-gray-800', 'dark:hover:text-gray-200'];

  if (_activeRecipeUnitType === 'adag') {
    if (btnAdag) {
      btnAdag.classList.add(...activeClasses);
      btnAdag.classList.remove(...inactiveClasses);
    }
    if (btnGramm) {
      btnGramm.classList.remove(...activeClasses);
      btnGramm.classList.add(...inactiveClasses);
    }
    if (wrapAdag) wrapAdag.classList.remove('hidden');
    if (wrapGramm) wrapGramm.classList.add('hidden');
  } else {
    if (btnGramm) {
      btnGramm.classList.add(...activeClasses);
      btnGramm.classList.remove(...inactiveClasses);
    }
    if (btnAdag) {
      btnAdag.classList.remove(...activeClasses);
      btnAdag.classList.add(...inactiveClasses);
    }
    if (wrapGramm) wrapGramm.classList.remove('hidden');
    if (wrapAdag) wrapAdag.classList.add('hidden');

    const weightIn = $('diet-recipe-weight-in');
    if (weightIn && (weightIn.dataset.manual !== 'true' || !weightIn.value || weightIn.value === '0')) {
      const recContainer = $('diet-recipe-ingredients-container');
      let sumGrams = 0;
      if (recContainer) {
        recContainer.querySelectorAll('.diet-ing-grams-input').forEach(inp => {
          sumGrams += parseFloat(inp.value) || 0;
        });
      }
      weightIn.value = sumGrams > 0 ? Math.round(sumGrams) : 100;
    }
  }
}

async function _saveRecipe() {
  if (!_uid) return;

  const nameIn = $('diet-recipe-name-in');
  const calIn  = $('diet-recipe-cal-in');
  const proIn  = $('diet-recipe-pro-in');
  const carbIn = $('diet-recipe-carb-in');
  const fatIn  = $('diet-recipe-fat-in');
  const ingIn  = $('diet-recipe-ingredients-in');
  const instIn = $('diet-recipe-instructions-in');
  const recContainer = $('diet-recipe-ingredients-container');
  const saveBtn = $('diet-save-recipe-btn');

  const name = nameIn?.value.trim();
  if (!name) {
    if (nameIn) {
      nameIn.style.borderColor = '#ef4444';
      nameIn.focus();
      setTimeout(() => { nameIn.style.borderColor = ''; }, 1500);
    }
    return;
  }

  const calories = parseFloat(calIn?.value) || 0;
  const protein  = parseFloat(proIn?.value) || 0;
  const carbs    = parseFloat(carbIn?.value) || 0;
  const fat      = parseFloat(fatIn?.value) || 0;
  const instructions = instIn?.value.trim() || '';

  // Összetevő szalagok begyűjtése
  const ingredientItems = [];
  const ingLines = [];
  let totalIngredientGrams = 0;

  if (recContainer) {
    recContainer.querySelectorAll('.diet-ingredient-strip').forEach(strip => {
      const ingName = strip.dataset.name || 'Hozzávaló';
      const cal100 = parseFloat(strip.dataset.cal100) || 0;
      const p100 = parseFloat(strip.dataset.p100) || 0;
      const c100 = parseFloat(strip.dataset.c100) || 0;
      const f100 = parseFloat(strip.dataset.f100) || 0;
      const grams = Math.max(0, parseFloat(strip.querySelector('.diet-ing-grams-input')?.value) || 0);
      const ratio = grams / 100;

      totalIngredientGrams += grams;
      ingredientItems.push({
        name: ingName,
        grams,
        cal100,
        p100,
        c100,
        f100,
        calories: Math.round(cal100 * ratio),
        protein: Math.round(p100 * ratio * 10) / 10,
        carbs: Math.round(c100 * ratio * 10) / 10,
        fat: Math.round(f100 * ratio * 10) / 10
      });
      ingLines.push(`${grams}g ${ingName}`);
    });
  }

  const ingredients = ingIn?.value.trim() || ingLines.join('\n');
  const unitType = _activeRecipeUnitType || 'adag';
  const servings = Math.max(0.1, parseFloat($('diet-recipe-servings-in')?.value) || 1);
  const totalWeight = Math.max(1, parseFloat($('diet-recipe-weight-in')?.value) || Math.round(totalIngredientGrams) || 100);

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés folyamatban...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'recipes'), {
      name,
      unitType,
      servings,
      totalWeight,
      calories,
      protein,
      carbs,
      fat,
      ingredients,
      ingredientItems,
      instructions,
      createdAt: serverTimestamp()
    });

    if (nameIn) nameIn.value = '';
    if (calIn) calIn.value = '';
    if (proIn) proIn.value = '';
    if (carbIn) carbIn.value = '';
    if (fatIn) fatIn.value = '';
    if (ingIn) ingIn.value = '';
    if (instIn) instIn.value = '';
    if (recContainer) recContainer.innerHTML = '';

    _setRecipeUnitType('adag');
    const servIn = $('diet-recipe-servings-in');
    const weightIn = $('diet-recipe-weight-in');
    if (servIn) servIn.value = '1';
    if (weightIn) {
      weightIn.value = '';
      weightIn.dataset.manual = 'false';
    }
  } catch (err) {
    console.error('[diet] save recipe error:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Recept mentése a Recepttárba';
    }
  }
}

// ── Élő kamerás vonalkód olvasó (Barcode Scanner Camera) ────
let _html5QrCode = null;
let _nativeBarcodeStream = null;
let _isCameraScanning = false;

function _playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

function _handleBarcodeDetected(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return;

  _playScanBeep();
  if (navigator.vibrate) {
    try { navigator.vibrate([80, 40, 80]); } catch (e) {}
  }

  const msgEl = $('diet-barcode-scanner-msg');
  if (msgEl) {
    msgEl.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-check mr-1"></i>Sikeresen beolvasva: ${code}</span>`;
  }

  const barcodeIn = $('diet-barcode-input');
  if (barcodeIn) {
    barcodeIn.value = code;
  }

  const statusEl = $('diet-barcode-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-barcode mr-1"></i>Beolvasott kód: ${code} — Lekérdezés folyamatban...</span>`;
  }

  // Kamera leállítása és termék lekérdezése
  setTimeout(() => {
    _stopBarcodeScanner();
    _lookupBarcode(code);
  }, 400);
}

async function _startBarcodeScanner() {
  const wrap = $('diet-barcode-scanner-wrap');
  const msgEl = $('diet-barcode-scanner-msg');
  const readerDiv = $('diet-barcode-reader');
  const videoEl = $('diet-barcode-video');
  const statusEl = $('diet-barcode-status');

  if (!wrap) return;

  // Ha már fut, állítsuk le (toggle)
  if (_isCameraScanning) {
    _stopBarcodeScanner();
    return;
  }

  wrap.classList.remove('hidden');
  _isCameraScanning = true;

  if (msgEl) {
    msgEl.textContent = 'Kamera megnyitása... Kérlek engedélyezd a hozzáférést!';
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-camera fa-fade mr-1"></i>Kamera aktiválása...</span>`;
  }

  // 1. Megpróbáljuk a Html5Qrcode könyvtárat (ha betöltődött)
  if (typeof window.Html5Qrcode !== 'undefined') {
    try {
      if (readerDiv) readerDiv.classList.remove('hidden');
      if (videoEl) videoEl.classList.add('hidden');

      const formats = window.Html5QrcodeSupportedFormats ? [
        window.Html5QrcodeSupportedFormats.EAN_13,
        window.Html5QrcodeSupportedFormats.EAN_8,
        window.Html5QrcodeSupportedFormats.UPC_A,
        window.Html5QrcodeSupportedFormats.UPC_E,
        window.Html5QrcodeSupportedFormats.CODE_128,
        window.Html5QrcodeSupportedFormats.CODE_39,
        window.Html5QrcodeSupportedFormats.QR_CODE
      ].filter(Boolean) : undefined;

      _html5QrCode = new window.Html5Qrcode("diet-barcode-reader", {
        formatsToSupport: formats && formats.length > 0 ? formats : undefined,
        verbose: false
      });

      const qrboxFn = (viewfinderWidth, viewfinderHeight) => {
        const w = Math.min(viewfinderWidth * 0.85, 320);
        const h = Math.min(viewfinderHeight * 0.6, 180);
        return { width: Math.floor(w), height: Math.floor(h) };
      };

      await _html5QrCode.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: qrboxFn, aspectRatio: 1.333333 },
        (decodedText) => {
          _handleBarcodeDetected(decodedText);
        },
        () => {} // csendes frame feldolgozás
      );

      if (msgEl) msgEl.textContent = 'Irányítsd a kamerát a termék vonalkódjára';
      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-medium"><i class="fa-solid fa-camera mr-1"></i>Kamera aktív — mutasd a vonalkódot!</span>`;
      return;
    } catch (err) {
      console.warn('[Barcode Scanner] Html5Qrcode sikertelen, próbálkozás natív BarcodeDetectorral:', err);
      if (_html5QrCode) {
        try { _html5QrCode.clear(); } catch (e) {}
        _html5QrCode = null;
      }
    }
  }

  // 2. Natív BarcodeDetector + getUserMedia fallback (modern Chrome / Android / Safari 17+)
  if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (readerDiv) readerDiv.classList.add('hidden');
      if (videoEl) videoEl.classList.remove('hidden');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      _nativeBarcodeStream = stream;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }

      let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
      } catch (e) {}

      const detector = new BarcodeDetector({ formats });
      let active = true;

      const loopDetect = async () => {
        if (!active || !_isCameraScanning || !_nativeBarcodeStream) return;
        try {
          if (videoEl && videoEl.readyState >= 2) {
            const barcodes = await detector.detect(videoEl);
            if (barcodes && barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              if (code && code.trim()) {
                active = false;
                _handleBarcodeDetected(code.trim());
                return;
              }
            }
          }
        } catch (e) {}
        if (active && _isCameraScanning && _nativeBarcodeStream) {
          requestAnimationFrame(loopDetect);
        }
      };
      requestAnimationFrame(loopDetect);

      if (msgEl) msgEl.textContent = 'Irányítsd a kamerát a termék vonalkódjára';
      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-medium"><i class="fa-solid fa-camera mr-1"></i>Kamera aktív — mutasd a vonalkódot!</span>`;
      return;
    } catch (err) {
      console.warn('[Barcode Scanner] Natív kamera indítása sikertelen:', err);
    }
  }

  // 3. Ha nem sikerült elindítani a kamerát (engedély megtagadva vagy nincs kamera)
  _isCameraScanning = false;
  if (msgEl) {
    msgEl.innerHTML = '<span class="text-amber-300 font-semibold">Nem sikerült elérni a kamerát. Engedélyezd a böngészőben, vagy használj fotó tallózást!</span>';
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>A kamera nem érhető el. Add meg a kódot kézzel, vagy tallózz fotót!</span>`;
  }
}

async function _stopBarcodeScanner() {
  _isCameraScanning = false;
  const wrap = $('diet-barcode-scanner-wrap');
  if (wrap) wrap.classList.add('hidden');

  if (_html5QrCode) {
    try {
      if (_html5QrCode.isScanning) {
        await _html5QrCode.stop();
      }
      _html5QrCode.clear();
    } catch (e) {
      console.warn('[Barcode Scanner] Stop hiba:', e);
    }
    _html5QrCode = null;
  }

  if (_nativeBarcodeStream) {
    try {
      _nativeBarcodeStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    _nativeBarcodeStream = null;
  }

  const videoEl = $('diet-barcode-video');
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.classList.add('hidden');
  }

  const readerDiv = $('diet-barcode-reader');
  if (readerDiv) {
    readerDiv.classList.remove('hidden');
    readerDiv.innerHTML = '';
  }
}

async function _handleBarcodeFile(file) {
  if (!file) return;
  const statusEl = $('diet-barcode-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Fotó beolvasása és elemzése...</span>`;
  }

  // Html5Qrcode kép beolvasás
  if (typeof window.Html5Qrcode !== 'undefined') {
    try {
      const scanner = _html5QrCode || new window.Html5Qrcode("diet-barcode-reader");
      const decoded = await scanner.scanFile(file, true);
      if (decoded) {
        _handleBarcodeDetected(decoded);
        return;
      }
    } catch (err) {
      console.warn('[Barcode] Html5Qrcode kép scan sikertelen:', err);
    }
  }

  // Natív BarcodeDetector kép beolvasás
  if ('BarcodeDetector' in window) {
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
      });
      const barcodes = await detector.detect(img);
      if (barcodes && barcodes.length > 0) {
        _handleBarcodeDetected(barcodes[0].rawValue);
        return;
      }
    } catch (err) {
      console.warn('[Barcode] Natív kép detector hiba:', err);
    }
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-circle-exclamation mr-1"></i>Nem található érvényes vonalkód a képen. Próbálj jobb szögből fotózni, vagy add meg kézzel!</span>`;
  }
}

// ── Vonalkód olvasó (Barcode Scanner & Quick Add) ───────────
const MOCK_BARCODES = {
  '737628064502': {
    name: 'Thai Kókusztej 400ml',
    brand: 'Aroy-D',
    cal100: 180,
    p100: 2.0,
    c100: 3.0,
    f100: 18.0,
    imageUrl: 'https://images.openfoodfacts.org/images/products/737/628/064/502/front_en.6.400.jpg',
    servingQuantity: 100
  },
  '3017620422003': {
    name: 'Mogyorókrém (Nutella)',
    brand: 'Ferrero',
    cal100: 539,
    p100: 6.3,
    c100: 57.5,
    f100: 30.9,
    imageUrl: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.550.400.jpg',
    servingQuantity: 15
  },
  '5998711311029': {
    name: 'Magyar Trappista Sajt',
    brand: 'Tolnatej',
    cal100: 345,
    p100: 26.0,
    c100: 1.5,
    f100: 26.5,
    imageUrl: 'https://images.openfoodfacts.org/images/products/599/871/131/1029/front_hu.10.400.jpg',
    servingQuantity: 30
  },
  '5900512300101': {
    name: 'Skyr Natúr Izlandi Joghurt',
    brand: 'Milbona',
    cal100: 63,
    p100: 11.0,
    c100: 4.0,
    f100: 0.2,
    imageUrl: 'https://images.openfoodfacts.org/images/products/590/051/230/0101/front_pl.12.400.jpg',
    servingQuantity: 150
  },
  '4008400404127': {
    name: 'Kinder Bueno',
    brand: 'Kinder',
    cal100: 572,
    p100: 8.6,
    c100: 49.5,
    f100: 37.3,
    imageUrl: 'https://images.openfoodfacts.org/images/products/400/840/040/4127/front_en.145.400.jpg',
    servingQuantity: 43
  }
};

let _lastScannedFoodDbImage = null;

async function _fetchProductByBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;

  if (MOCK_BARCODES[code]) {
    return { ...MOCK_BARCODES[code], barcode: code };
  }

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const nut = p.nutriments || {};
      const img = p.image_front_small_url || p.image_front_url || p.image_url || p.image_small_url || p.image_thumb_url || (p.selected_images && p.selected_images.front && p.selected_images.front.small && p.selected_images.front.small.hu) || '';
      return {
        name: p.product_name_hu || p.product_name || `Termék (${code})`,
        brand: p.brands || '',
        cal100: Math.round(nut['energy-kcal_100g'] || nut['energy-kcal'] || ((nut['energy_100g'] || 0) / 4.184)),
        p100: Math.round((nut.proteins_100g || nut.proteins || 0) * 10) / 10,
        c100: Math.round((nut.carbohydrates_100g || nut.carbohydrates || 0) * 10) / 10,
        f100: Math.round((nut.fat_100g || nut.fat || 0) * 10) / 10,
        imageUrl: img || '',
        servingSize: p.serving_size || '',
        servingQuantity: parseFloat(p.serving_quantity) || 0,
        barcode: code
      };
    }
  } catch (err) {
    console.warn('[Barcode] Lekérdezési hiba:', err);
  }
  return null;
}

async function _lookupBarcode(barcode) {
  const statusEl = $('diet-barcode-status');
  const code = (barcode || '').trim();
  if (!code) return;

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Termék lekérdezése az adatbázisból (${code})...</span>`;
  }

  const food = await _fetchProductByBarcode(code);
  if (food) {
    _fillBarcodeProduct(food);
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-check mr-1"></i>Termék megtalálva: ${food.name}</span>`;
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-circle-exclamation mr-1"></i>Nem található az OpenFoodFacts-ben. Add meg a makrókat manuálisan!</span>`;
    }
  }
}

function _fillBarcodeProduct(food) {
  const nameEl = $('diet-food-name-in');
  const calEl  = $('diet-food-cal-in');
  const proEl  = $('diet-food-pro-in');
  const carbEl = $('diet-food-carb-in');
  const fatEl  = $('diet-food-fat-in');

  if (nameEl) nameEl.value = food.brand ? `${food.brand} - ${food.name}` : food.name;
  if (calEl)  calEl.value  = food.cal100 || 0;
  if (proEl)  proEl.value  = food.p100 || 0;
  if (carbEl) carbEl.value = food.c100 || 0;
  if (fatEl)  fatEl.value  = food.f100 || 0;

  _lastScannedFoodDbImage = food.imageUrl || null;

  // Termék képe kicsiben a szélén
  const imgWrap = $('diet-food-db-img-wrap');
  const imgEl   = $('diet-food-db-img');
  const imgName = $('diet-food-db-img-name');
  const imgSub  = $('diet-food-db-img-sub');

  if (imgWrap && imgEl) {
    if (food.imageUrl) {
      imgEl.src = food.imageUrl;
      if (imgName) imgName.textContent = food.name;
      if (imgSub) imgSub.textContent = `100g: ${food.cal100} kcal · P: ${food.p100}g · C: ${food.c100}g · F: ${food.f100}g`;
      imgWrap.classList.remove('hidden');
    } else {
      imgWrap.classList.add('hidden');
    }
  }
}

// ── Gyors Vonalkódos Étel Hozzáadás (Quick Barcode to Meal) ─
let _currentQuickProduct = null;
let _barcodeTargetSlot = 'breakfast';
let _barcodeTargetContext = 'slot_direct'; // 'slot_direct' | 'meal_modal'
let _qbcHtml5QrCode = null;
let _qbcNativeStream = null;
let _isQbcScanning = false;

function _openQuickBarcodeModal(slotId = 'breakfast', context = 'slot_direct') {
  _barcodeTargetSlot = slotId || 'breakfast';
  _barcodeTargetContext = context || 'slot_direct';
  _currentQuickProduct = null;

  const slotObj = MEAL_SLOTS.find(s => s.id === _barcodeTargetSlot);
  const slotLabel = slotObj ? slotObj.label : 'Étkezés';

  const titleEl = $('diet-quick-barcode-title');
  const subEl = $('diet-quick-barcode-subtitle');
  if (titleEl) titleEl.textContent = `Vonalkód beolvasása: ${slotLabel}`;
  if (subEl) {
    subEl.textContent = _barcodeTargetContext === 'meal_modal'
      ? 'Egyszeri hozzávaló beillesztése a nyitott étkezéshez'
      : `Egyszeri hozzáadás a(z) ${slotLabel}-hez (nem menti az adatbázisba)`;
  }

  const inputEl = $('diet-qbc-input');
  if (inputEl) inputEl.value = '';

  const statusEl = $('diet-qbc-status');
  if (statusEl) statusEl.innerHTML = '';

  const prodCard = $('diet-qbc-product-card');
  if (prodCard) prodCard.classList.add('hidden');

  _stopQuickBarcodeScanner();

  const modal = $('diet-quick-barcode-modal');
  const sheet = $('diet-quick-barcode-sheet');
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
      if (inputEl) inputEl.focus();
    });
  });
}

function _closeQuickBarcodeModal() {
  _stopQuickBarcodeScanner();
  const modal = $('diet-quick-barcode-modal');
  const sheet = $('diet-quick-barcode-sheet');
  if (!modal || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
    _currentQuickProduct = null;
  }, 340);
}

async function _lookupQuickBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return;

  const statusEl = $('diet-qbc-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-medium"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Termék lekérdezése (${code})...</span>`;
  }

  const food = await _fetchProductByBarcode(code);
  if (!food) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-amber-500 font-semibold"><i class="fa-solid fa-circle-exclamation mr-1"></i>Nem található termék ezzel a vonalkóddal (${code}). Próbálj másik kódot!</span>`;
    }
    const card = $('diet-qbc-product-card');
    if (card) card.classList.add('hidden');
    return;
  }

  _currentQuickProduct = food;

  // Adatok megjelenítése a kártyán képpel a szélén
  const nameEl = $('diet-qbc-product-name');
  const brandEl = $('diet-qbc-product-brand');
  const baseMacrosEl = $('diet-qbc-base-macros');
  const imgContainer = $('diet-qbc-img-container');
  const gramsInput = $('diet-qbc-grams-input');
  const servingChip = $('diet-qbc-serving-chip');

  if (nameEl) nameEl.textContent = food.name;
  if (brandEl) brandEl.textContent = food.brand ? `Márka: ${food.brand}` : '';
  if (baseMacrosEl) {
    baseMacrosEl.textContent = `100g: ${food.cal100} kcal · P: ${food.p100}g · C: ${food.c100}g · F: ${food.f100}g`;
  }

  // Termék képe kicsiben a szélén
  if (imgContainer) {
    if (food.imageUrl) {
      imgContainer.innerHTML = `<img src="${_esc(food.imageUrl)}" alt="${_esc(food.name)}" class="w-full h-full object-contain rounded-xl" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-emerald-600 text-lg\\'><i class=\\'fa-solid fa-utensils\\'></i></div>';" />`;
    } else {
      imgContainer.innerHTML = `<div class="w-full h-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-lg"><i class="fa-solid fa-utensils"></i></div>`;
    }
  }

  // Alapértelmezett adag
  const defaultGrams = food.servingQuantity > 0 ? Math.round(food.servingQuantity) : 100;
  if (gramsInput) gramsInput.value = String(defaultGrams);

  if (servingChip) {
    if (food.servingQuantity > 0) {
      servingChip.className = 'diet-qbc-quick-portion px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 cursor-pointer';
      servingChip.textContent = `1 adag (${Math.round(food.servingQuantity)}g)`;
      servingChip.dataset.grams = String(Math.round(food.servingQuantity));
      servingChip.classList.remove('hidden');
    } else {
      servingChip.classList.add('hidden');
    }
  }

  _recalcQuickBarcodeMacros(defaultGrams);

  const card = $('diet-qbc-product-card');
  if (card) card.classList.remove('hidden');

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-check mr-1"></i>Termék betöltve! Válaszd ki az adagot.</span>`;
  }
}

function _recalcQuickBarcodeMacros(grams) {
  if (!_currentQuickProduct) return;
  const g = Math.max(1, parseFloat(grams) || 100);
  const r = g / 100;

  const k = Math.round((_currentQuickProduct.cal100 || 0) * r);
  const p = Math.round((_currentQuickProduct.p100 || 0) * r * 10) / 10;
  const c = Math.round((_currentQuickProduct.c100 || 0) * r * 10) / 10;
  const f = Math.round((_currentQuickProduct.f100 || 0) * r * 10) / 10;

  const calEl = $('diet-qbc-calc-cal');
  const proEl = $('diet-qbc-calc-pro');
  const carbEl = $('diet-qbc-calc-carb');
  const fatEl = $('diet-qbc-calc-fat');

  if (calEl) calEl.textContent = `${k} kcal (${g}g)`;
  if (proEl) proEl.textContent = `${p}g`;
  if (carbEl) carbEl.textContent = `${c}g`;
  if (fatEl) fatEl.textContent = `${f}g`;
}

async function _addQuickBarcodeToMeal() {
  if (!_currentQuickProduct) return;

  const g = Math.max(1, parseFloat($('diet-qbc-grams-input')?.value) || 100);
  const r = g / 100;
  const k = Math.round((_currentQuickProduct.cal100 || 0) * r);
  const p = Math.round((_currentQuickProduct.p100 || 0) * r * 10) / 10;
  const c = Math.round((_currentQuickProduct.c100 || 0) * r * 10) / 10;
  const f = Math.round((_currentQuickProduct.f100 || 0) * r * 10) / 10;

  const foodItem = {
    name: _currentQuickProduct.name,
    cal100: _currentQuickProduct.cal100,
    p100: _currentQuickProduct.p100,
    c100: _currentQuickProduct.c100,
    f100: _currentQuickProduct.f100,
    imageUrl: _currentQuickProduct.imageUrl || null
  };

  if (_barcodeTargetContext === 'meal_modal') {
    _addIngredientStrip(foodItem, g, 'meal');
    _closeQuickBarcodeModal();
  } else {
    const saveBtn = $('diet-qbc-add-meal-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Hozzáadás folyamatban...';
    }

    try {
      if (_uid) {
        await addDoc(collection(db, 'users', _uid, 'meals'), {
          name: _currentQuickProduct.name,
          mealType: _barcodeTargetSlot || 'breakfast',
          date: _selectedDate,
          quantity: g,
          calories: k,
          protein: p,
          carbs: c,
          fat: f,
          imageUrl: _currentQuickProduct.imageUrl || null,
          ingredientItems: [
            {
              name: _currentQuickProduct.name,
              grams: g,
              cal100: _currentQuickProduct.cal100,
              p100: _currentQuickProduct.p100,
              c100: _currentQuickProduct.c100,
              f100: _currentQuickProduct.f100,
              imageUrl: _currentQuickProduct.imageUrl || null,
              calories: k,
              protein: p,
              carbs: c,
              fat: f
            }
          ],
          createdAt: serverTimestamp()
        });
      } else {
        _allMeals.unshift({
          id: 'local_' + Date.now(),
          name: _currentQuickProduct.name,
          mealType: _barcodeTargetSlot || 'breakfast',
          date: _selectedDate,
          quantity: g,
          calories: k,
          protein: p,
          carbs: c,
          fat: f,
          imageUrl: _currentQuickProduct.imageUrl || null
        });
        _updateStats();
        _renderDietView();
      }
      _closeQuickBarcodeModal();
    } catch (err) {
      console.error('[diet] Quick barcode addMeal error:', err);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Hozzáadás az étkezéshez (egyszeri tétel)';
      }
    }
  }
}

function _handleQuickBarcodeDetected(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return;

  _playScanBeep();
  if (navigator.vibrate) {
    try { navigator.vibrate([80, 40, 80]); } catch (e) {}
  }

  const inputEl = $('diet-qbc-input');
  if (inputEl) inputEl.value = code;

  _stopQuickBarcodeScanner();
  _lookupQuickBarcode(code);
}

async function _startQuickBarcodeScanner() {
  const wrap = $('diet-qbc-scanner-wrap');
  const readerDiv = $('diet-qbc-reader');
  const videoEl = $('diet-qbc-video');
  const statusEl = $('diet-qbc-status');

  if (!wrap) return;

  if (_isQbcScanning) {
    _stopQuickBarcodeScanner();
    return;
  }

  wrap.classList.remove('hidden');
  _isQbcScanning = true;

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-camera fa-fade mr-1"></i>Kamera aktiválása...</span>`;
  }

  // 1. Html5Qrcode
  if (typeof window.Html5Qrcode !== 'undefined') {
    try {
      if (readerDiv) readerDiv.classList.remove('hidden');
      if (videoEl) videoEl.classList.add('hidden');

      const formats = window.Html5QrcodeSupportedFormats ? [
        window.Html5QrcodeSupportedFormats.EAN_13,
        window.Html5QrcodeSupportedFormats.EAN_8,
        window.Html5QrcodeSupportedFormats.UPC_A,
        window.Html5QrcodeSupportedFormats.UPC_E,
        window.Html5QrcodeSupportedFormats.CODE_128,
        window.Html5QrcodeSupportedFormats.CODE_39,
        window.Html5QrcodeSupportedFormats.QR_CODE
      ].filter(Boolean) : undefined;

      _qbcHtml5QrCode = new window.Html5Qrcode("diet-qbc-reader", {
        formatsToSupport: formats && formats.length > 0 ? formats : undefined,
        verbose: false
      });

      const qrboxFn = (viewfinderWidth, viewfinderHeight) => {
        const w = Math.min(viewfinderWidth * 0.85, 300);
        const h = Math.min(viewfinderHeight * 0.6, 160);
        return { width: Math.floor(w), height: Math.floor(h) };
      };

      await _qbcHtml5QrCode.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: qrboxFn, aspectRatio: 1.333333 },
        (decodedText) => {
          _handleQuickBarcodeDetected(decodedText);
        },
        () => {}
      );

      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-medium"><i class="fa-solid fa-camera mr-1"></i>Kamera aktív — mutasd a vonalkódot!</span>`;
      return;
    } catch (err) {
      console.warn('[Quick Barcode] Html5Qrcode hiba, fallback:', err);
      if (_qbcHtml5QrCode) {
        try { _qbcHtml5QrCode.clear(); } catch (e) {}
        _qbcHtml5QrCode = null;
      }
    }
  }

  // 2. Natív BarcodeDetector
  if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (readerDiv) readerDiv.classList.add('hidden');
      if (videoEl) videoEl.classList.remove('hidden');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      _qbcNativeStream = stream;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }

      let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
      } catch (e) {}

      const detector = new BarcodeDetector({ formats });

      const scanLoop = async () => {
        if (!_isQbcScanning || !videoEl || videoEl.readyState < 2) {
          if (_isQbcScanning) requestAnimationFrame(scanLoop);
          return;
        }
        try {
          const barcodes = await detector.detect(videoEl);
          if (barcodes && barcodes.length > 0) {
            _handleQuickBarcodeDetected(barcodes[0].rawValue);
            return;
          }
        } catch (e) {}
        if (_isQbcScanning) requestAnimationFrame(scanLoop);
      };
      requestAnimationFrame(scanLoop);

      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-medium"><i class="fa-solid fa-camera mr-1"></i>Natív kamera aktív — mutasd a vonalkódot!</span>`;
      return;
    } catch (err) {
      console.warn('[Quick Barcode] Natív kamera hiba:', err);
    }
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>A kamera nem érhető el. Írd be a vonalkódot kézzel!</span>`;
  }
}

async function _stopQuickBarcodeScanner() {
  _isQbcScanning = false;

  const wrap = $('diet-qbc-scanner-wrap');
  if (wrap) wrap.classList.add('hidden');

  if (_qbcHtml5QrCode) {
    try {
      if (_qbcHtml5QrCode.isScanning) {
        await _qbcHtml5QrCode.stop();
      }
      _qbcHtml5QrCode.clear();
    } catch (e) {}
    _qbcHtml5QrCode = null;
  }

  if (_qbcNativeStream) {
    try {
      _qbcNativeStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    _qbcNativeStream = null;
  }

  const videoEl = $('diet-qbc-video');
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.classList.add('hidden');
  }

  const readerDiv = $('diet-qbc-reader');
  if (readerDiv) {
    readerDiv.classList.remove('hidden');
    readerDiv.innerHTML = '';
  }
}

// ── Új étkezés rögzítése Modal ─────────────────────────────
let _selectedDbFood = null;
let _currentMealIngredients = '';

function _openAddMealModalFromRecipe(recipe) {
  if (!recipe) return;
  const modal = $('diet-modal');
  const sheet = $('diet-modal-sheet');
  if (!modal || !sheet) return;

  _selectedDbFood = null;
  _currentMealIngredients = recipe.ingredients || '';

  const slotSelect = $('diet-select-meal-slot');
  if (slotSelect) slotSelect.value = _activeMealSlot;

  const dateIn = $('diet-input-date');
  if (dateIn) dateIn.value = _selectedDate;

  const nameIn   = $('diet-input-name');
  const gramWrap = $('diet-quantity-wrapper');
  const ingContainer = $('diet-meal-ingredients-container');
  if (ingContainer) ingContainer.innerHTML = '';

  if (nameIn) {
    nameIn.value = '';
    nameIn.dataset.autoGenerated = 'false';
  }
  if (gramWrap) gramWrap.classList.add('hidden');

  _populateRecipeSelector();

  // Recept összetevőinek beillesztése szalagként az étkezésbe!
  _insertRecipeIngredientStrips(recipe);

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _buildScaledIngredientsText(recipe, ratio = 1) {
  if (Array.isArray(recipe.ingredientItems) && recipe.ingredientItems.length > 0) {
    const list = recipe.ingredientItems.map(item => {
      const g = Math.round((parseFloat(item.grams) || 0) * ratio * 10) / 10;
      return `${g}g ${_esc(item.name)}`;
    }).join(' · ');
    return `<span class="font-bold text-emerald-600 dark:text-emerald-400">Összetevők:</span> ${list}`;
  } else if (recipe.ingredients) {
    const lines = String(recipe.ingredients).split('\n').map(l => l.trim()).filter(Boolean);
    const scaledLines = lines.map(line => {
      return line.replace(/^(\d+(?:\.\d+)?)\s*(g|gramm|ml)?\s*(.+)$/i, (m, num, u, rest) => {
        const val = Math.round(parseFloat(num) * ratio * 10) / 10;
        return `${val}${u || 'g'} ${rest}`;
      });
    }).join(' · ');
    return `<span class="font-bold text-emerald-600 dark:text-emerald-400">Összetevők:</span> ${scaledLines}`;
  }
  return '';
}

function _createRecipeStripElement(recipe, initialQty = null, initialUnit = null) {
  const unit = initialUnit || recipe.unitType || 'adag'; // 'adag' | 'gramm'
  const baseServings = Math.max(0.1, parseFloat(recipe.servings) || 1);
  const baseWeight = Math.max(1, parseFloat(recipe.totalWeight) || parseFloat(recipe.grams) || 100);

  let currentQty;
  if (initialQty !== null && initialQty !== undefined) {
    currentQty = parseFloat(initialQty) || (unit === 'gramm' ? baseWeight : 1);
  } else {
    currentQty = unit === 'gramm' ? baseWeight : 1;
  }

  const baseKcal = parseFloat(recipe.calories) || 0;
  const baseP = parseFloat(recipe.protein) || 0;
  const baseC = parseFloat(recipe.carbs) || 0;
  const baseF = parseFloat(recipe.fat) || 0;

  let ratio = unit === 'gramm' ? (currentQty / baseWeight) : (currentQty / baseServings);
  if (!isFinite(ratio) || ratio <= 0) ratio = 1;

  const calcKcal = Math.round(baseKcal * ratio);
  const calcP = Math.round(baseP * ratio * 10) / 10;
  const calcC = Math.round(baseC * ratio * 10) / 10;
  const calcF = Math.round(baseF * ratio * 10) / 10;

  const strip = document.createElement('div');
  strip.className = 'diet-ingredient-strip diet-recipe-strip p-3 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700/80 shadow-xs space-y-2 transition-all';
  strip.dataset.isRecipe = 'true';
  strip.dataset.name = recipe.name || 'Recept';
  strip.dataset.unitType = unit;
  strip.dataset.baseWeight = String(baseWeight);
  strip.dataset.baseServings = String(baseServings);
  strip.dataset.baseCal = String(baseKcal);
  strip.dataset.baseP = String(baseP);
  strip.dataset.baseC = String(baseC);
  strip.dataset.baseF = String(baseF);

  strip.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <div class="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs flex-shrink-0">
          <i class="fa-solid fa-book-open"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <h5 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate" title="${_esc(recipe.name)}">${_esc(recipe.name)}</h5>
            <span class="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60">Recept</span>
          </div>
          <p class="diet-recipe-subtext text-[10px] text-gray-400 font-medium truncate mt-0.5">
            ${currentQty} ${unit === 'gramm' ? 'g' : 'adag'} = ${calcKcal} kcal (P: ${calcP}g · C: ${calcC}g · F: ${calcF}g)
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1.5 justify-end flex-shrink-0">
        <div class="flex items-center bg-gray-50 dark:bg-slate-800 px-2 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700">
          <input type="number" 
                 min="${unit === 'gramm' ? '1' : '0.1'}" 
                 step="${unit === 'gramm' ? '1' : '0.1'}" 
                 value="${currentQty}"
                 class="diet-recipe-qty-input ${unit === 'gramm' ? 'w-16' : 'w-12'} text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none"
                 title="Recept mennyisége (${unit === 'gramm' ? 'grammban' : 'adagban'})" />
          <button type="button" class="diet-recipe-unit-toggle px-1.5 py-0.5 rounded-lg text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors" title="Kattints a mértékegység váltásához (adag / gramm)">
            ${unit === 'gramm' ? 'g' : 'adag'}
          </button>
        </div>
        <button type="button" class="diet-ing-remove-btn w-7 h-7 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors" title="Recept eltávolítása">
          <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
        </button>
      </div>
    </div>

    <div class="diet-recipe-ingredients-preview text-[10px] text-gray-500 dark:text-gray-400 pl-10 border-t border-gray-100 dark:border-slate-800/80 pt-1 leading-relaxed">
      ${_buildScaledIngredientsText(recipe, ratio)}
    </div>
  `;

  const qtyInput = strip.querySelector('.diet-recipe-qty-input');
  const unitToggle = strip.querySelector('.diet-recipe-unit-toggle');
  const subtext = strip.querySelector('.diet-recipe-subtext');
  const preview = strip.querySelector('.diet-recipe-ingredients-preview');

  const updateCalculations = () => {
    const curUnit = strip.dataset.unitType;
    const curQty = Math.max(0, parseFloat(qtyInput?.value) || 0);
    const r = curUnit === 'gramm' ? (curQty / baseWeight) : (curQty / baseServings);

    const k = Math.round(baseKcal * r);
    const p = Math.round(baseP * r * 10) / 10;
    const c = Math.round(baseC * r * 10) / 10;
    const f = Math.round(baseF * r * 10) / 10;

    if (subtext) {
      subtext.textContent = `${curQty} ${curUnit === 'gramm' ? 'g' : 'adag'} = ${k} kcal (P: ${p}g · C: ${c}g · F: ${f}g)`;
    }
    if (preview) {
      preview.innerHTML = _buildScaledIngredientsText(recipe, r);
    }
    _recalcMealFromIngredients();
  };

  if (qtyInput) {
    qtyInput.addEventListener('input', updateCalculations);
    qtyInput.addEventListener('change', updateCalculations);
  }

  if (unitToggle && qtyInput) {
    unitToggle.addEventListener('click', () => {
      const curUnit = strip.dataset.unitType;
      const curVal = parseFloat(qtyInput.value) || 1;

      if (curUnit === 'gramm') {
        // Váltás adagra:
        strip.dataset.unitType = 'adag';
        unitToggle.textContent = 'adag';
        qtyInput.min = '0.1';
        qtyInput.step = '0.1';
        qtyInput.classList.remove('w-16');
        qtyInput.classList.add('w-12');
        const newQty = Math.round((curVal / baseWeight) * baseServings * 10) / 10;
        qtyInput.value = newQty > 0 ? newQty : 1;
      } else {
        // Váltás grammra:
        strip.dataset.unitType = 'gramm';
        unitToggle.textContent = 'g';
        qtyInput.min = '1';
        qtyInput.step = '1';
        qtyInput.classList.remove('w-12');
        qtyInput.classList.add('w-16');
        const newGrams = Math.round((baseWeight / baseServings) * curVal);
        qtyInput.value = newGrams > 0 ? newGrams : baseWeight;
      }
      updateCalculations();
    });
  }

  const removeBtn = strip.querySelector('.diet-ing-remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      strip.remove();
      _recalcMealFromIngredients();
    });
  }

  return strip;
}

function _insertRecipeIngredientStrips(recipe) {
  if (!recipe) return;
  const container = $('diet-meal-ingredients-container');
  if (!container) return;

  const nameIn = $('diet-input-name');
  const gramWrap = $('diet-quantity-wrapper');
  if (gramWrap) gramWrap.classList.add('hidden');

  // Név hozzáfűzése
  if (nameIn) {
    const currName = nameIn.value.trim();
    if (!currName || nameIn.dataset.autoGenerated === 'true') {
      nameIn.value = recipe.name || 'Recept';
    } else {
      nameIn.value = `${currName} + ${recipe.name || 'Recept'}`;
    }
    nameIn.dataset.autoGenerated = 'false';
  }

  // Ha az étkezésben még nem voltak szalagok, de manuális makrók voltak beírva, alakítsuk azt is szalaggá
  const existingStrips = container.querySelectorAll('.diet-ingredient-strip');
  const calIn = $('diet-input-calories');
  const existingCal = parseFloat(calIn?.value) || 0;
  const existingName = nameIn?.value.trim();
  if (existingStrips.length === 0 && existingCal > 0 && existingName && existingName !== recipe.name) {
    const existingFood = {
      name: existingName.replace(new RegExp(`\\s*\\+\\s*${recipe.name}$`), '') || 'Kész étel',
      cal100: existingCal,
      p100: parseFloat($('diet-input-protein')?.value) || 0,
      c100: parseFloat($('diet-input-carbs')?.value) || 0,
      f100: parseFloat($('diet-input-fat')?.value) || 0
    };
    container.appendChild(_createIngredientStripElement(existingFood, 100, 'meal'));
  }

  // Recept szalag beillesztése (arányosítható mennyiséggel adagban vagy grammban)
  const recipeStrip = _createRecipeStripElement(recipe);
  container.appendChild(recipeStrip);

  // Makrók összegzése és beírása
  _recalcMealFromIngredients();
}

function _populateRecipeSelector(selectedName = '') {
  const recSelect = $('diet-select-saved-recipe');
  if (!recSelect) return;
  const deletedSampleIds = _getDeletedSampleIds('recipes');
  const activeDefaultRecipes = (DEFAULT_RECIPES || []).filter(r => !deletedSampleIds.includes(r.id) && !deletedSampleIds.includes(r.name));
  const allRecipes = [...activeDefaultRecipes, ...(_recipes || [])].filter(Boolean);
  recSelect.innerHTML = `<option value="">-- Válassz egy kész receptet (hozzáadás az étkezéshez) --</option>` +
    allRecipes.map((r, i) => `<option value="${i}" ${selectedName && r.name === selectedName ? 'selected' : ''}>${_esc(r.name || 'Recept')} (${r.unitType === 'gramm' ? `${r.totalWeight || 100}g` : `${r.servings || 1} adag`} · ${r.calories || 0} kcal)</option>`).join('');

  recSelect.onchange = () => {
    const idx = recSelect.value;
    if (idx !== '') {
      const recipe = allRecipes[parseInt(idx, 10)];
      if (recipe) {
        _insertRecipeIngredientStrips(recipe);
        recSelect.value = ''; // Visszaállítjuk, hogy még egy receptet vagy hozzávalót be lehessen illeszteni
      }
    }
  };
}

// ── Korábban hozzáadott és mentett alapanyagok / hozzávalók ──
function _getAllKnownIngredients() {
  const map = new Map();

  // 1. Alapértelmezett beépített adatbázis
  (DEFAULT_FOOD_DB || []).forEach(f => {
    if (f && f.name) {
      map.set(f.name.toLowerCase().trim(), {
        name: f.name.trim(),
        cal100: parseFloat(f.cal100) || 0,
        p100: parseFloat(f.p100) || 0,
        c100: parseFloat(f.c100) || 0,
        f100: parseFloat(f.f100) || 0,
        source: 'default'
      });
    }
  });

  // 2. Felhasználó által mentett FoodDatabase (Firestore)
  (_foodDatabase || []).forEach(f => {
    if (f && f.name) {
      map.set(f.name.toLowerCase().trim(), {
        name: f.name.trim(),
        cal100: parseFloat(f.cal100) || 0,
        p100: parseFloat(f.p100) || 0,
        c100: parseFloat(f.c100) || 0,
        f100: parseFloat(f.f100) || 0,
        id: f.id,
        source: 'custom'
      });
    }
  });

  // 3. Korábbi étkezésekből származó összetevők
  (_allMeals || []).forEach(m => {
    if (m.ingredientItems && Array.isArray(m.ingredientItems)) {
      m.ingredientItems.forEach(it => {
        if (it && it.name) {
          const key = it.name.toLowerCase().trim();
          if (!map.has(key)) {
            map.set(key, {
              name: it.name.trim(),
              cal100: parseFloat(it.cal100) || 0,
              p100: parseFloat(it.p100) || 0,
              c100: parseFloat(it.c100) || 0,
              f100: parseFloat(it.f100) || 0,
              source: 'meal'
            });
          }
        }
      });
    }
    if (m.name && m.quantity && m.quantity > 0 && (m.calories || m.protein || m.carbs || m.fat)) {
      const key = m.name.toLowerCase().trim();
      if (!map.has(key)) {
        const factor = 100 / m.quantity;
        map.set(key, {
          name: m.name.trim(),
          cal100: Math.round((m.calories || 0) * factor),
          p100: Math.round((m.protein || 0) * factor * 10) / 10,
          c100: Math.round((m.carbs || 0) * factor * 10) / 10,
          f100: Math.round((m.fat || 0) * factor * 10) / 10,
          source: 'meal'
        });
      }
    }
  });

  return Array.from(map.values());
}

let _cachedIngredientPickerList = [];

function _openIngredientPickerModal(target = 'meal') {
  _activeIngredientTarget = target === 'recipe' ? 'recipe' : 'meal';
  const modal = $('diet-ingredient-picker-modal');
  const sheet = $('diet-ing-picker-sheet');
  if (!modal || !sheet) return;

  _renderIngredientPickerList();

  const searchIn = $('diet-ing-picker-search');
  if (searchIn) {
    searchIn.value = '';
    searchIn.oninput = () => {
      _renderIngredientPickerList(searchIn.value);
    };
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeIngredientPickerModal() {
  const modal = $('diet-ingredient-picker-modal');
  const sheet = $('diet-ing-picker-sheet');
  if (!modal || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 340);
}

function _renderIngredientPickerList(searchQuery = '') {
  const listEl = $('diet-ing-picker-list');
  if (!listEl) return;

  const all = _getAllKnownIngredients();
  const q = searchQuery.toLowerCase().trim();

  const filtered = q
    ? all.filter(item => item.name.toLowerCase().includes(q))
    : all;

  _cachedIngredientPickerList = filtered;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-6 px-4 rounded-2xl bg-gray-50 dark:bg-slate-800/60 border border-dashed border-gray-200 dark:border-slate-700">
        <i class="fa-solid fa-apple-whole text-2xl text-gray-300 dark:text-gray-600 mb-1.5"></i>
        <p class="text-xs font-bold text-gray-600 dark:text-gray-300">Nincs találat erre a hozzávalóra</p>
        <p class="text-[10px] text-gray-400 mt-1">Használd a fenti "+ Új egyéni hozzávaló mentése" űrlapot a felvitelhez!</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map((food, idx) => `
    <div class="diet-pick-ing-item flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/80 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/40 border border-gray-100 dark:border-slate-700/60 transition-colors cursor-pointer"
         data-index="${idx}">
      <div class="flex-1 min-w-0 pr-2">
        <p class="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${_esc(food.name)}</p>
        <p class="text-[10px] text-gray-400 mt-0.5">
          100g: <span class="font-bold text-emerald-600 dark:text-emerald-400">${food.cal100 || 0} kcal</span> · P: ${food.p100 || 0}g · C: ${food.c100 || 0}g · F: ${food.f100 || 0}g
        </p>
      </div>
      <button type="button" class="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] active:scale-95 transition-all flex items-center gap-1 flex-shrink-0 pointer-events-none">
        <i class="fa-solid fa-plus text-[9px]"></i>
        <span>Kiválasztás</span>
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('.diet-pick-ing-item').forEach(itemEl => {
    itemEl.addEventListener('click', () => {
      const idx = parseInt(itemEl.dataset.index, 10);
      const food = _cachedIngredientPickerList[idx];
      if (food) {
        _addIngredientStrip(food, 100, _activeIngredientTarget);
        _closeIngredientPickerModal();
      }
    });
  });
}

async function _quickSaveNewIngredient() {
  const nameIn = $('diet-quick-ing-name');
  const calIn = $('diet-quick-ing-cal');
  const proIn = $('diet-quick-ing-pro');
  const carbIn = $('diet-quick-ing-carb');
  const fatIn = $('diet-quick-ing-fat');

  const name = nameIn?.value.trim();
  if (!name) {
    if (nameIn) {
      nameIn.style.borderColor = '#ef4444';
      nameIn.focus();
      setTimeout(() => { nameIn.style.borderColor = ''; }, 1500);
    }
    return;
  }

  const cal100 = parseFloat(calIn?.value) || 0;
  const p100 = parseFloat(proIn?.value) || 0;
  const c100 = parseFloat(carbIn?.value) || 0;
  const f100 = parseFloat(fatIn?.value) || 0;

  const item = { name, cal100, p100, c100, f100, unit: 'g' };

  if (_uid) {
    try {
      await addDoc(collection(db, 'users', _uid, 'foodDatabase'), {
        ...item,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn('[diet] quickSaveNewIngredient error:', e);
    }
  }

  if (nameIn) nameIn.value = '';
  if (calIn) calIn.value = '';
  if (proIn) proIn.value = '';
  if (carbIn) carbIn.value = '';
  if (fatIn) fatIn.value = '';

  _addIngredientStrip(item, 100, _activeIngredientTarget);
  _closeIngredientPickerModal();
}

function _createIngredientStripElement(food, initialGrams = 100, target = 'meal') {
  const gramsVal = Math.max(0, parseFloat(initialGrams) || 100);
  const cal100 = parseFloat(food.cal100) || 0;
  const p100 = parseFloat(food.p100) || 0;
  const c100 = parseFloat(food.c100) || 0;
  const f100 = parseFloat(food.f100) || 0;
  const ratio = gramsVal / 100;

  const calcKcal = Math.round(cal100 * ratio);
  const calcP = Math.round(p100 * ratio * 10) / 10;
  const calcC = Math.round(c100 * ratio * 10) / 10;
  const calcF = Math.round(f100 * ratio * 10) / 10;

  const strip = document.createElement('div');
  strip.className = 'diet-ingredient-strip p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-2.5 transition-all';
  strip.dataset.name = food.name || 'Hozzávaló';
  strip.dataset.cal100 = String(cal100);
  strip.dataset.p100 = String(p100);
  strip.dataset.c100 = String(c100);
  strip.dataset.f100 = String(f100);
  if (food.imageUrl) {
    strip.dataset.imageUrl = food.imageUrl;
  }

  strip.innerHTML = `
    <!-- Bal oldal: Ikon/Kép, Név és élő makrók az adott grammhoz -->
    <div class="flex items-center gap-2.5 min-w-0 flex-1">
      <div class="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs flex-shrink-0 overflow-hidden">
        ${food.imageUrl ? `<img src="${_esc(food.imageUrl)}" alt="" class="w-full h-full object-contain p-0.5" onerror="this.remove()" />` : `<i class="fa-solid fa-apple-whole"></i>`}
      </div>
      <div class="min-w-0 flex-1">
        <h5 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate" title="${_esc(food.name)}">${_esc(food.name)}</h5>
        <p class="diet-ing-subtext text-[10px] text-gray-400 font-medium truncate">${gramsVal}g = ${calcKcal} kcal (P: ${calcP}g · C: ${calcC}g · F: ${calcF}g)</p>
      </div>
    </div>

    <!-- Jobb oldal: Gramm kiválasztás és törlés gomb -->
    <div class="flex items-center gap-2 justify-end flex-shrink-0">
      <div class="flex items-center gap-1 bg-gray-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700">
        <input type="number" min="1" max="9999" step="1" value="${gramsVal}"
               class="diet-ing-grams-input w-14 text-center text-xs font-bold text-gray-900 dark:text-white bg-transparent focus:outline-none"
               title="Mennyiség grammban" />
        <span class="text-[10px] text-gray-400 font-bold select-none">g</span>
      </div>
      <button type="button" class="diet-ing-remove-btn w-7 h-7 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors" title="Eltávolítás">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `;

  const gramInput = strip.querySelector('.diet-ing-grams-input');
  if (gramInput) {
    const handleGramChange = () => {
      const g = Math.max(0, parseFloat(gramInput.value) || 0);
      const r = g / 100;
      const sub = strip.querySelector('.diet-ing-subtext');
      if (sub) {
        const k = Math.round(cal100 * r);
        const p = Math.round(p100 * r * 10) / 10;
        const c = Math.round(c100 * r * 10) / 10;
        const f = Math.round(f100 * r * 10) / 10;
        sub.textContent = `${g}g = ${k} kcal (P: ${p}g · C: ${c}g · F: ${f}g)`;
      }
      if (target === 'recipe') {
        _recalcRecipeFromIngredients();
      } else {
        _recalcMealFromIngredients();
      }
    };
    gramInput.addEventListener('input', handleGramChange);
    gramInput.addEventListener('change', handleGramChange);
  }

  const removeBtn = strip.querySelector('.diet-ing-remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      strip.remove();
      if (target === 'recipe') {
        _recalcRecipeFromIngredients();
      } else {
        _recalcMealFromIngredients();
      }
    });
  }

  return strip;
}

function _addIngredientStrip(food, initialGrams = 100, target = 'meal') {
  const containerId = target === 'recipe' ? 'diet-recipe-ingredients-container' : 'diet-meal-ingredients-container';
  const container = $(containerId);
  if (!container) return;

  if (target === 'meal') {
    // Ha még nincsenek szalagok, de már van beírva étel név és kalória, alakítsuk át azt is alap szalaggá!
    const existingStrips = container.querySelectorAll('.diet-ingredient-strip');
    const nameIn = $('diet-input-name');
    const calIn = $('diet-input-calories');
    const existingName = nameIn?.value.trim();
    const existingCal = parseFloat(calIn?.value) || 0;

    if (existingStrips.length === 0 && (existingCal > 0 || (existingName && nameIn?.dataset.autoGenerated !== 'true'))) {
      const existingFood = {
        name: existingName || 'Kész étel',
        cal100: existingCal,
        p100: parseFloat($('diet-input-protein')?.value) || 0,
        c100: parseFloat($('diet-input-carbs')?.value) || 0,
        f100: parseFloat($('diet-input-fat')?.value) || 0
      };
      const baseStrip = _createIngredientStripElement(existingFood, 100, 'meal');
      container.appendChild(baseStrip);
      if (nameIn) {
        nameIn.dataset.autoGenerated = 'true';
      }
    }
  }

  const strip = _createIngredientStripElement(food, initialGrams, target);
  container.appendChild(strip);

  if (target === 'recipe') {
    _recalcRecipeFromIngredients();
  } else {
    _recalcMealFromIngredients();
  }
}

function _recalcRecipeFromIngredients() {
  const container = $('diet-recipe-ingredients-container');
  if (!container) return;

  const strips = container.querySelectorAll('.diet-ingredient-strip');
  const calIn  = $('diet-recipe-cal-in');
  const proIn  = $('diet-recipe-pro-in');
  const carbIn = $('diet-recipe-carb-in');
  const fatIn  = $('diet-recipe-fat-in');
  const ingIn  = $('diet-recipe-ingredients-in');

  if (strips.length === 0) {
    if (calIn)  calIn.value = '';
    if (proIn)  proIn.value = '';
    if (carbIn) carbIn.value = '';
    if (fatIn)  fatIn.value = '';
    if (ingIn)  ingIn.value = '';
    return;
  }

  let totalKcal = 0;
  let totalPro = 0;
  let totalCarb = 0;
  let totalFat = 0;
  let totalGrams = 0;
  const ingLines = [];

  strips.forEach(strip => {
    const cal100 = parseFloat(strip.dataset.cal100) || 0;
    const p100 = parseFloat(strip.dataset.p100) || 0;
    const c100 = parseFloat(strip.dataset.c100) || 0;
    const f100 = parseFloat(strip.dataset.f100) || 0;
    const gramIn = strip.querySelector('.diet-ing-grams-input');
    const grams = Math.max(0, parseFloat(gramIn?.value) || 0);
    const ratio = grams / 100;

    totalKcal += cal100 * ratio;
    totalPro += p100 * ratio;
    totalCarb += c100 * ratio;
    totalFat += f100 * ratio;
    totalGrams += grams;

    const sub = strip.querySelector('.diet-ing-subtext');
    if (sub) {
      const k = Math.round(cal100 * ratio);
      const p = Math.round(p100 * ratio * 10) / 10;
      const c = Math.round(c100 * ratio * 10) / 10;
      const f = Math.round(f100 * ratio * 10) / 10;
      sub.textContent = `${grams}g = ${k} kcal (P: ${p}g · C: ${c}g · F: ${f}g)`;
    }

    if (strip.dataset.name) {
      ingLines.push(`${grams}g ${strip.dataset.name}`);
    }
  });

  if (calIn)  calIn.value  = Math.round(totalKcal);
  if (proIn)  proIn.value  = Math.round(totalPro * 10) / 10;
  if (carbIn) carbIn.value = Math.round(totalCarb * 10) / 10;
  if (fatIn)  fatIn.value  = Math.round(totalFat * 10) / 10;
  if (ingIn)  ingIn.value  = ingLines.join('\n');

  const weightIn = $('diet-recipe-weight-in');
  if (weightIn && (weightIn.dataset.manual !== 'true' || !weightIn.value)) {
    weightIn.value = totalGrams > 0 ? Math.round(totalGrams) : '';
    weightIn.placeholder = String(totalGrams > 0 ? Math.round(totalGrams) : 390);
  }
}

function _recalcMealFromIngredients() {
  const container = $('diet-meal-ingredients-container');
  if (!container) return;

  const strips = container.querySelectorAll('.diet-ingredient-strip');
  const calIn  = $('diet-input-calories');
  const proIn  = $('diet-input-protein');
  const carbIn = $('diet-input-carbs');
  const fatIn  = $('diet-input-fat');
  const nameIn = $('diet-input-name');

  if (strips.length === 0) {
    if (calIn)  calIn.value  = '';
    if (proIn)  proIn.value  = '';
    if (carbIn) carbIn.value = '';
    if (fatIn)  fatIn.value  = '';
    if (nameIn && nameIn.dataset.autoGenerated === 'true') {
      nameIn.value = '';
      nameIn.dataset.autoGenerated = 'false';
    }
    return;
  }

  let totalKcal = 0;
  let totalPro = 0;
  let totalCarb = 0;
  let totalFat = 0;
  const names = [];

  strips.forEach(strip => {
    if (strip.dataset.isRecipe === 'true') {
      const curUnit = strip.dataset.unitType || 'adag';
      const baseWeight = Math.max(1, parseFloat(strip.dataset.baseWeight) || 100);
      const baseServings = Math.max(0.1, parseFloat(strip.dataset.baseServings) || 1);
      const qtyIn = strip.querySelector('.diet-recipe-qty-input');
      const curQty = Math.max(0, parseFloat(qtyIn?.value) || 0);
      const r = curUnit === 'gramm' ? (curQty / baseWeight) : (curQty / baseServings);

      const baseKcal = parseFloat(strip.dataset.baseCal) || 0;
      const baseP = parseFloat(strip.dataset.baseP) || 0;
      const baseC = parseFloat(strip.dataset.baseC) || 0;
      const baseF = parseFloat(strip.dataset.baseF) || 0;

      totalKcal += baseKcal * r;
      totalPro += baseP * r;
      totalCarb += baseC * r;
      totalFat += baseF * r;

      if (strip.dataset.name) {
        names.push(strip.dataset.name);
      }
    } else {
      const cal100 = parseFloat(strip.dataset.cal100) || 0;
      const p100 = parseFloat(strip.dataset.p100) || 0;
      const c100 = parseFloat(strip.dataset.c100) || 0;
      const f100 = parseFloat(strip.dataset.f100) || 0;
      const gramIn = strip.querySelector('.diet-ing-grams-input');
      const grams = Math.max(0, parseFloat(gramIn?.value) || 0);
      const ratio = grams / 100;

      totalKcal += cal100 * ratio;
      totalPro += p100 * ratio;
      totalCarb += c100 * ratio;
      totalFat += f100 * ratio;

      const sub = strip.querySelector('.diet-ing-subtext');
      if (sub) {
        const k = Math.round(cal100 * ratio);
        const p = Math.round(p100 * ratio * 10) / 10;
        const c = Math.round(c100 * ratio * 10) / 10;
        const f = Math.round(f100 * ratio * 10) / 10;
        sub.textContent = `${grams}g = ${k} kcal (P: ${p}g · C: ${c}g · F: ${f}g)`;
      }

      if (strip.dataset.name) {
        names.push(strip.dataset.name);
      }
    }
  });

  if (calIn)  calIn.value  = Math.round(totalKcal);
  if (proIn)  proIn.value  = Math.round(totalPro * 10) / 10;
  if (carbIn) carbIn.value = Math.round(totalCarb * 10) / 10;
  if (fatIn)  fatIn.value  = Math.round(totalFat * 10) / 10;

  if (nameIn && (!nameIn.value.trim() || nameIn.dataset.autoGenerated === 'true')) {
    nameIn.value = names.join(' + ');
    nameIn.dataset.autoGenerated = 'true';
  }
}

function _openAddMealModal(prefilledFood = null) {
  const modal = $('diet-modal');
  const sheet = $('diet-modal-sheet');
  if (!modal || !sheet) return;

  _selectedDbFood = prefilledFood;
  _currentMealIngredients = '';

  const slotSelect = $('diet-select-meal-slot');
  if (slotSelect) slotSelect.value = _activeMealSlot;

  const dateIn = $('diet-input-date');
  if (dateIn) dateIn.value = _selectedDate;

  const nameIn   = $('diet-input-name');
  const calIn    = $('diet-input-calories');
  const proIn    = $('diet-input-protein');
  const carbIn   = $('diet-input-carbs');
  const fatIn    = $('diet-input-fat');
  const gramIn   = $('diet-input-quantity');
  const gramWrap = $('diet-quantity-wrapper');
  const ingContainer = $('diet-meal-ingredients-container');

  if (ingContainer) ingContainer.innerHTML = '';
  if (nameIn) nameIn.dataset.autoGenerated = 'false';

  _populateRecipeSelector();

  if (prefilledFood) {
    if (nameIn) nameIn.value = prefilledFood.name;
    if (gramWrap) gramWrap.classList.add('hidden');
    _addIngredientStrip(prefilledFood, 100, 'meal');
  } else {
    if (nameIn) nameIn.value = '';
    if (calIn) calIn.value = '';
    if (proIn) proIn.value = '';
    if (carbIn) carbIn.value = '';
    if (fatIn) fatIn.value = '';
    if (gramIn) gramIn.value = '';
    if (gramWrap) gramWrap.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _recalcFromGrams(grams) {
  if (!_selectedDbFood) return;
  const ratio = (parseFloat(grams) || 0) / 100;

  const calIn  = $('diet-input-calories');
  const proIn  = $('diet-input-protein');
  const carbIn = $('diet-input-carbs');
  const fatIn  = $('diet-input-fat');

  if (calIn)  calIn.value  = Math.round((_selectedDbFood.cal100 || 0) * ratio);
  if (proIn)  proIn.value  = Math.round((_selectedDbFood.p100 || 0) * ratio * 10) / 10;
  if (carbIn) carbIn.value = Math.round((_selectedDbFood.c100 || 0) * ratio * 10) / 10;
  if (fatIn)  fatIn.value  = Math.round((_selectedDbFood.f100 || 0) * ratio * 10) / 10;
}

function _closeAddMealModal() {
  const modal = $('diet-modal');
  const sheet = $('diet-modal-sheet');
  if (!modal || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
    _currentMealIngredients = '';
    const ingContainer = $('diet-meal-ingredients-container');
    if (ingContainer) ingContainer.innerHTML = '';
  }, 340);
}

// ── Étkezés mentése Firestore-ba ───────────────────────────
async function _saveMeal() {
  if (!_uid) return;

  const nameIn     = $('diet-input-name');
  const slotSelect = $('diet-select-meal-slot');
  const dateIn     = $('diet-input-date');
  const gramIn     = $('diet-input-quantity');
  const calIn      = $('diet-input-calories');
  const proIn      = $('diet-input-protein');
  const carbIn     = $('diet-input-carbs');
  const fatIn      = $('diet-input-fat');
  const saveBtn    = $('diet-save-btn');
  const ingContainer = $('diet-meal-ingredients-container');

  const name = nameIn?.value.trim();
  if (!name) {
    if (nameIn) {
      nameIn.style.borderColor = '#ef4444';
      nameIn.focus();
      setTimeout(() => { nameIn.style.borderColor = ''; }, 1500);
    }
    return;
  }

  const mealType = slotSelect?.value || _activeMealSlot;
  const dateVal  = dateIn?.value || _selectedDate;

  // Összetevő szalagok beolvasása
  const strips = ingContainer ? ingContainer.querySelectorAll('.diet-ingredient-strip') : [];
  const ingredientItems = [];
  const ingredientSummaries = [];
  let totalStripGrams = 0;

  strips.forEach(strip => {
    if (strip.dataset.isRecipe === 'true') {
      const ingName = strip.dataset.name || 'Recept';
      const curUnit = strip.dataset.unitType || 'adag';
      const baseWeight = Math.max(1, parseFloat(strip.dataset.baseWeight) || 100);
      const baseServings = Math.max(0.1, parseFloat(strip.dataset.baseServings) || 1);
      const qtyIn = strip.querySelector('.diet-recipe-qty-input');
      const curQty = Math.max(0, parseFloat(qtyIn?.value) || 0);
      const r = curUnit === 'gramm' ? (curQty / baseWeight) : (curQty / baseServings);

      const baseKcal = parseFloat(strip.dataset.baseCal) || 0;
      const baseP = parseFloat(strip.dataset.baseP) || 0;
      const baseC = parseFloat(strip.dataset.baseC) || 0;
      const baseF = parseFloat(strip.dataset.baseF) || 0;
      const calcGrams = Math.round(curUnit === 'gramm' ? curQty : ((baseWeight / baseServings) * curQty));

      totalStripGrams += calcGrams;
      ingredientSummaries.push(`${ingName} (${curQty} ${curUnit === 'gramm' ? 'g' : 'adag'})`);
      ingredientItems.push({
        name: ingName,
        isRecipe: true,
        unit: curUnit,
        quantity: curQty,
        grams: calcGrams,
        calories: Math.round(baseKcal * r),
        protein: Math.round(baseP * r * 10) / 10,
        carbs: Math.round(baseC * r * 10) / 10,
        fat: Math.round(baseF * r * 10) / 10
      });
    } else {
      const ingName = strip.dataset.name || 'Hozzávaló';
      const cal100 = parseFloat(strip.dataset.cal100) || 0;
      const p100 = parseFloat(strip.dataset.p100) || 0;
      const c100 = parseFloat(strip.dataset.c100) || 0;
      const f100 = parseFloat(strip.dataset.f100) || 0;
      const grams = Math.max(0, parseFloat(strip.querySelector('.diet-ing-grams-input')?.value) || 0);
      const ratio = grams / 100;

      totalStripGrams += grams;
      ingredientSummaries.push(`${ingName} (${grams}g)`);
      ingredientItems.push({
        name: ingName,
        grams,
        cal100,
        p100,
        c100,
        f100,
        imageUrl: strip.dataset.imageUrl || null,
        calories: Math.round(cal100 * ratio),
        protein: Math.round(p100 * ratio * 10) / 10,
        carbs: Math.round(c100 * ratio * 10) / 10,
        fat: Math.round(f100 * ratio * 10) / 10
      });
    }
  });

  const ingredients = ingredientSummaries.length > 0 ? ingredientSummaries.join(', ') : (_currentMealIngredients || '');
  const quantity = totalStripGrams > 0 ? totalStripGrams : (parseFloat(gramIn?.value) || null);
  const calories = parseFloat(calIn?.value) || 0;
  const protein  = parseFloat(proIn?.value) || 0;
  const carbs    = parseFloat(carbIn?.value) || 0;
  const fat      = parseFloat(fatIn?.value) || 0;
  const mealImageUrl = Array.from(strips).map(s => s.dataset.imageUrl).find(Boolean) || null;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'meals'), {
      name,
      mealType,
      date: dateVal,
      quantity,
      calories,
      protein,
      carbs,
      fat,
      ingredients,
      imageUrl: mealImageUrl,
      ingredientItems: ingredientItems.length > 0 ? ingredientItems : null,
      createdAt: serverTimestamp(),
    });
    if (ingContainer) ingContainer.innerHTML = '';
    _closeAddMealModal();
  } catch (err) {
    console.error('[diet] saveMeal hiba:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Étkezés mentése';
    }
  }
}

async function _deleteMeal(id) {
  if (!_uid || !id) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'meals', id));
  } catch (err) {
    console.error('[diet] deleteMeal hiba:', err);
  }
}

// ── Hidratációs napló kezelése ─────────────────────────────
function _renderHydration() {
  const container = $('diet-hydration-container');
  if (!container) return;

  const dayLogs = _hydrationLogs.filter(h => h.date === _selectedDate);
  const totalWater = Math.round(dayLogs.reduce((s, h) => s + (h.effectiveMl || h.ml || 0), 0));
  const rawWater = Math.round(dayLogs.reduce((s, h) => s + (h.ml || 0), 0));

  const workoutsSource = (_allWorkouts && _allWorkouts.length > 0) ? _allWorkouts : (typeof window !== 'undefined' && window._allWorkouts ? window._allWorkouts : []);
  const dayWorkouts = workoutsSource.filter(w => w.date === _selectedDate);
  const daySweatLossMl = dayWorkouts.reduce((s, w) => s + calcWorkoutSweatLoss(w), 0);

  const goals = getGoals();
  const baseWaterGoal = goals.waterGoal || (goals.weight ? Math.round(goals.weight * 35) : 2625);
  const waterGoal = baseWaterGoal + daySweatLossMl;
  const pct = Math.min(100, Math.round((totalWater / (waterGoal || 1)) * 100));

  container.innerHTML = `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center">
            <i class="fa-solid fa-droplet text-lg"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-gray-900 dark:text-white">Hidratációs Napló</h3>
            <p class="text-[11px] text-gray-400">Napi folyadékbevitel szorzókkal</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-base font-bold text-sky-600 dark:text-sky-400">${totalWater} / ${waterGoal} ml</span>
          <p class="text-[10px] text-gray-400 font-semibold">${pct}% elérve${daySweatLossMl > 0 ? ` (+${daySweatLossMl}ml izzadás)` : ` (${rawWater} ml bruttó)`}</p>
        </div>
      </div>

      <!-- Haladási sáv -->
      <div class="w-full bg-gray-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-4">
        <div class="bg-gradient-to-r from-sky-400 to-sky-600 h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
      </div>

      ${daySweatLossMl > 0 ? `
        <div class="mb-4 p-3 rounded-2xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 flex items-center justify-between text-xs text-sky-700 dark:text-sky-300">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <i class="fa-solid fa-person-running text-xs"></i>
            </div>
            <div>
              <p class="font-bold text-sky-900 dark:text-sky-200">Garmin edzés izzadási többlet (${dayWorkouts.length} edzés)</p>
              <p class="text-[10px] text-sky-600/80 dark:text-sky-400">Bázis cél: ${baseWaterGoal} ml + Becsült izzadás: ${daySweatLossMl} ml</p>
            </div>
          </div>
          <span class="font-black text-sm text-sky-600 dark:text-sky-400 tabular-nums">+${daySweatLossMl} ml</span>
        </div>
      ` : ''}

      <!-- Gyors hozzáadó gombok szorzókkal -->
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        ${DRINK_TYPES.map(drink => `
          <button class="diet-quick-drink-btn flex flex-col items-center gap-1.5 p-2 rounded-2xl border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-all active:scale-95 text-center"
            data-drink="${drink.id}" data-ml="250">
            <i class="${drink.icon} text-base" style="color: ${drink.color}"></i>
            <span class="text-[10px] font-semibold text-gray-700 dark:text-gray-300 truncate w-full">${drink.name.split(' ')[0]}</span>
            <span class="text-[9px] text-gray-400">×${drink.factor} (2.5dl)</span>
          </button>
        `).join('')}
      </div>

      <!-- Egyéni folyadék hozzáadás sor -->
      <div class="flex gap-2">
        <select id="diet-custom-drink-type" class="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-gray-800 dark:text-gray-200 focus:outline-none flex-1">
          ${DRINK_TYPES.map(d => `<option value="${d.id}">${d.name} (szorzó: ${d.factor}x)</option>`).join('')}
        </select>
        <input id="diet-custom-drink-ml" type="number" step="50" min="50" placeholder="ml (pl. 300)" class="w-28 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-gray-800 dark:text-gray-200 focus:outline-none" />
        <button id="diet-custom-drink-add-btn" class="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all">
          + Hozzáadás
        </button>
      </div>

      <!-- Mai folyadékok apró listája -->
      ${dayLogs.length > 0 ? `
        <div class="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800 flex flex-wrap gap-1.5">
          ${dayLogs.map(l => {
            const drink = DRINK_TYPES.find(d => d.id === l.drinkType) || DRINK_TYPES[0];
            return `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-[10px] font-medium">
                <i class="${drink.icon}"></i> ${drink.name.split(' ')[0]}: ${l.ml}ml
                <button class="diet-delete-drink-btn ml-1 hover:text-red-500" data-id="${l.id}">×</button>
              </span>
            `;
          }).join('')}
        </div>
      ` : ''}
    </div>
  `;

  // Gombok eseményei
  container.querySelectorAll('.diet-quick-drink-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.drink;
      const ml = parseInt(btn.dataset.ml) || 250;
      _addHydrationLog(type, ml);
    });
  });

  const customAddBtn = $('diet-custom-drink-add-btn');
  if (customAddBtn) {
    customAddBtn.addEventListener('click', () => {
      const type = $('diet-custom-drink-type')?.value || 'water';
      const ml = parseInt($('diet-custom-drink-ml')?.value) || 250;
      _addHydrationLog(type, ml);
      const inEl = $('diet-custom-drink-ml');
      if (inEl) inEl.value = '';
    });
  }

  container.querySelectorAll('.diet-delete-drink-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _deleteHydrationLog(btn.dataset.id);
    });
  });
}

async function _addHydrationLog(drinkType, ml) {
  if (!_uid) return;
  const drink = DRINK_TYPES.find(d => d.id === drinkType) || DRINK_TYPES[0];
  const effectiveMl = Math.round(ml * drink.factor);

  try {
    await addDoc(collection(db, 'users', _uid, 'hydrationLogs'), {
      date: _selectedDate,
      drinkType,
      ml,
      effectiveMl,
      factor: drink.factor,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error('[Hydration] Mentési hiba:', err);
  }
}

async function _deleteHydrationLog(id) {
  if (!_uid || !id) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'hydrationLogs', id));
  } catch (err) {
    console.error('[Hydration] Törlési hiba:', err);
  }
}

// ── Táplálékkiegészítők kezelése ───────────────────────────
const SUPPLEMENT_TIMINGS = [
  'Éhgyomorra (reggel)',
  'Reggeli után',
  'Edzés előtt (30 perccel)',
  'Edzés közben / után',
  'Ebéd után',
  'Vacsora után',
  'Lefekvés előtt'
];

function _renderSupplements() {
  const container = $('diet-supplements-container');
  if (!container) return;

  const dayLogs = _supplementLogs.filter(s => s.date === _selectedDate);

  container.innerHTML = `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-5 shadow-sm mt-4">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <i class="fa-solid fa-pills text-lg"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-gray-900 dark:text-white">Táplálékkiegészítők</h3>
            <p class="text-[11px] text-gray-400">Napi vitaminok és kiegészítők ütemezése</p>
          </div>
        </div>
        <button id="diet-add-supplement-btn" class="px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 hover:bg-purple-500 hover:text-white text-xs font-semibold transition-all">
          <i class="fa-solid fa-plus mr-1"></i>Új kiegészítő
        </button>
      </div>

      ${dayLogs.length === 0 ? `
        <p class="text-xs text-gray-400 dark:text-gray-600 py-3 text-center italic">Még nem állítottál be kiegészítőt mára.</p>
      ` : `
        <div class="space-y-2">
          ${dayLogs.map(sup => `
            <div class="flex items-center justify-between p-3 rounded-2xl ${sup.taken ? 'bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50' : 'bg-gray-50/70 dark:bg-slate-800/60 border border-transparent'} transition-colors">
              <label class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                <input type="checkbox" class="diet-toggle-supplement-cb w-4 h-4 rounded text-purple-600 focus:ring-purple-500" data-id="${sup.id}" ${sup.taken ? 'checked' : ''} />
                <div class="truncate">
                  <span class="text-xs font-bold text-gray-800 dark:text-gray-200 ${sup.taken ? 'line-through text-gray-400 dark:text-gray-500' : ''}">${_esc(sup.name)}</span>
                  <p class="text-[10px] text-purple-600 dark:text-purple-400">${sup.dosage ? `${sup.dosage} · ` : ''}${sup.timing || 'Napközben'}</p>
                </div>
              </label>
              <button class="diet-delete-supplement-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${sup.id}">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  const addBtn = $('diet-add-supplement-btn');
  if (addBtn) addBtn.addEventListener('click', _openAddSupplementModal);

  container.querySelectorAll('.diet-toggle-supplement-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      _toggleSupplementTaken(cb.dataset.id, cb.checked);
    });
  });

  container.querySelectorAll('.diet-delete-supplement-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _deleteSupplement(btn.dataset.id);
    });
  });
}

function _openAddSupplementModal() {
  const modal = $('diet-supplement-modal');
  const sheet = $('diet-supplement-sheet');
  if (!modal || !sheet) return;

  const timingSelect = $('diet-sup-timing-in');
  if (timingSelect) {
    timingSelect.innerHTML = SUPPLEMENT_TIMINGS.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeAddSupplementModal() {
  const modal = $('diet-supplement-modal');
  const sheet = $('diet-supplement-sheet');
  if (!modal || !sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => modal.classList.add('hidden'), 340);
}

async function _saveSupplement() {
  if (!_uid) return;
  const nameIn = $('diet-sup-name-in');
  const doseIn = $('diet-sup-dose-in');
  const timeIn = $('diet-sup-timing-in');
  const saveBtn = $('diet-sup-save-btn');

  const name = nameIn?.value.trim();
  if (!name) return;

  const dosage = doseIn?.value.trim() || '';
  const timing = timeIn?.value || SUPPLEMENT_TIMINGS[0];

  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, 'users', _uid, 'supplementLogs'), {
      date: _selectedDate,
      name,
      dosage,
      timing,
      taken: false,
      createdAt: serverTimestamp()
    });
    if (nameIn) nameIn.value = '';
    if (doseIn) doseIn.value = '';
    _closeAddSupplementModal();
  } catch (err) {
    console.error('[Supplement] Mentési hiba:', err);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function _toggleSupplementTaken(id, taken) {
  if (!_uid || !id) return;
  try {
    await updateDoc(doc(db, 'users', _uid, 'supplementLogs', id), { taken });
  } catch (err) {
    console.error('[Supplement] Frissítési hiba:', err);
  }
}

async function _deleteSupplement(id) {
  if (!_uid || !id) return;
  try {
    await deleteDoc(doc(db, 'users', _uid, 'supplementLogs', id));
  } catch (err) {
    console.error('[Supplement] Törlési hiba:', err);
  }
}

// ── Real-time Listeners ────────────────────────────────────
function _startListeners() {
  if (!_uid) return;

  // Korábbi figyelők biztonságos leiratkozása újrafeliratkozás előtt
  if (_unsubMeals) { _unsubMeals(); _unsubMeals = null; }
  if (_unsubFoodDb) { _unsubFoodDb(); _unsubFoodDb = null; }
  if (_unsubHydration) { _unsubHydration(); _unsubHydration = null; }
  if (_unsubSupplements) { _unsubSupplements(); _unsubSupplements = null; }
  if (_unsubRecipes) { _unsubRecipes(); _unsubRecipes = null; }

  // 1. Ételek
  const qMeals = query(collection(db, 'users', _uid, 'meals'), orderBy('createdAt', 'desc'));
  _unsubMeals = onSnapshot(qMeals, snap => {
    _allMeals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allDietMeals = _allMeals;
    _updateStats();
    _renderDietView();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lockin:nutrition-updated', { detail: { meals: _allMeals } }));
    }
  }, err => console.error('[diet] onSnapshot meals error:', err));

  // 2. Étel adatbázis (Food Database)
  const qFoodDb = query(collection(db, 'users', _uid, 'foodDatabase'), orderBy('createdAt', 'desc'));
  _unsubFoodDb = onSnapshot(qFoodDb, snap => {
    _foodDatabase = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const dbModal = $('diet-food-db-modal');
    if (dbModal && !dbModal.classList.contains('hidden')) {
      const q = $('diet-food-db-search')?.value || '';
      _renderFoodDbList(q);
    }
  }, err => console.error('[diet] onSnapshot foodDb error:', err));

  // 3. Hidratáció
  const qHydra = query(collection(db, 'users', _uid, 'hydrationLogs'), orderBy('createdAt', 'desc'));
  _unsubHydration = onSnapshot(qHydra, snap => {
    _hydrationLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window !== 'undefined') window._allDietHydration = _hydrationLogs;
    _renderHydration();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lockin:nutrition-updated', { detail: { hydration: _hydrationLogs } }));
    }
  }, err => console.error('[diet] onSnapshot hydration error:', err));

  // 4. Táplálékkiegészítők
  const qSup = query(collection(db, 'users', _uid, 'supplementLogs'), orderBy('createdAt', 'desc'));
  _unsubSupplements = onSnapshot(qSup, snap => {
    _supplementLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderSupplements();
  }, err => console.error('[diet] onSnapshot supplements error:', err));

  // 5. Recepttár (Recipes)
  const qRecipes = query(collection(db, 'users', _uid, 'recipes'), orderBy('createdAt', 'desc'));
  _unsubRecipes = onSnapshot(qRecipes, snap => {
    _recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const dbModal = $('diet-food-db-modal');
    if (dbModal && !dbModal.classList.contains('hidden')) {
      const q = $('diet-recipes-search')?.value || '';
      _renderRecipesList(q);
    }
  }, err => console.error('[diet] onSnapshot recipes error:', err));

  // 6. Edzések a Garmin becsült izzadás és optimalizált folyadékcél kiszámításához
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }
  const qWorkouts = query(collection(db, 'users', _uid, 'workouts'), orderBy('createdAt', 'desc'));
  _unsubWorkouts = onSnapshot(qWorkouts, snap => {
    _allWorkouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderHydration();
  }, err => console.warn('[diet] onSnapshot workouts note:', err.message));
}

// ── Eseménykezelők bekötése ────────────────────────────────
function _bindEvents() {
  // Fülváltás az Étel adatbázis / Recepttár ablakban
  const tabBtnIng = $('diet-food-tab-btn-ingredients');
  const tabBtnRec = $('diet-food-tab-btn-recipes');
  if (tabBtnIng) tabBtnIng.addEventListener('click', () => _switchFoodDbTab('ingredients'));
  if (tabBtnRec) tabBtnRec.addEventListener('click', () => _switchFoodDbTab('recipes'));

  // Recept kereső & Mentés
  const recipeSearch = $('diet-recipes-search');
  if (recipeSearch) {
    recipeSearch.addEventListener('input', (e) => {
      _renderRecipesList(e.target.value);
    });
  }

  const saveRecipeBtn = $('diet-save-recipe-btn');
  if (saveRecipeBtn) saveRecipeBtn.addEventListener('click', _saveRecipe);

  const addRecipeIngBtn = $('diet-recipe-add-ing-btn');
  if (addRecipeIngBtn) addRecipeIngBtn.addEventListener('click', () => _openIngredientPickerModal('recipe'));

  // Recept mértékegység gombok (Adagban / Grammban)
  const btnUnitAdag = $('diet-recipe-unit-btn-adag');
  const btnUnitGramm = $('diet-recipe-unit-btn-gramm');
  if (btnUnitAdag) btnUnitAdag.addEventListener('click', () => _setRecipeUnitType('adag'));
  if (btnUnitGramm) btnUnitGramm.addEventListener('click', () => _setRecipeUnitType('gramm'));
  const weightIn = $('diet-recipe-weight-in');
  if (weightIn) weightIn.addEventListener('input', () => { weightIn.dataset.manual = 'true'; });

  // Nézet váltók (Napi / Heti)
  const dayViewBtn  = $('diet-view-day-btn');
  const weekViewBtn = $('diet-view-week-btn');

  if (dayViewBtn) {
    dayViewBtn.addEventListener('click', () => {
      _viewMode = 'day';
      _updateViewModeButtons();
      _renderDietView();
    });
  }

  if (weekViewBtn) {
    weekViewBtn.addEventListener('click', () => {
      _viewMode = 'week';
      _updateViewModeButtons();
      _renderDietView();
    });
  }

  // Bevásárlólista gomb
  const shoppingBtn = $('diet-shopping-btn');
  if (shoppingBtn) shoppingBtn.addEventListener('click', _openShoppingListModal);

  const shoppingClose = $('diet-shopping-close');
  const shoppingBackdrop = $('diet-shopping-backdrop');
  if (shoppingClose) shoppingClose.addEventListener('click', _closeShoppingListModal);
  if (shoppingBackdrop) shoppingBackdrop.addEventListener('click', _closeShoppingListModal);

  // Étel adatbázis & Recepttár gombok
  const foodDbBtn = $('diet-open-food-db-btn');
  if (foodDbBtn) foodDbBtn.addEventListener('click', () => _openFoodDbModal('ingredients'));

  const recipesBtn = $('diet-open-recipes-btn');
  if (recipesBtn) recipesBtn.addEventListener('click', () => _openFoodDbModal('recipes'));

  const foodDbClose = $('diet-food-db-close');
  const foodDbBackdrop = $('diet-food-db-backdrop');
  if (foodDbClose) foodDbClose.addEventListener('click', _closeFoodDbModal);
  if (foodDbBackdrop) foodDbBackdrop.addEventListener('click', _closeFoodDbModal);

  // Kereső az étel adatbázisban
  const foodDbSearch = $('diet-food-db-search');
  if (foodDbSearch) {
    foodDbSearch.addEventListener('input', (e) => {
      _renderFoodDbList(e.target.value);
    });
  }

  // Vonalkód keresés és kamera beolvasás
  const barcodeBtn = $('diet-barcode-lookup-btn');
  const barcodeIn  = $('diet-barcode-input');
  const barcodeScanBtn = $('diet-barcode-scan-btn');
  const barcodeScanClose = $('diet-barcode-scanner-close');
  const barcodeStopBtn = $('diet-barcode-stop-btn');
  const barcodeFileIn = $('diet-barcode-file-in');

  if (barcodeScanBtn) {
    barcodeScanBtn.addEventListener('click', () => {
      _startBarcodeScanner();
    });
  }

  if (barcodeScanClose) {
    barcodeScanClose.addEventListener('click', () => {
      _stopBarcodeScanner();
    });
  }

  if (barcodeStopBtn) {
    barcodeStopBtn.addEventListener('click', () => {
      _stopBarcodeScanner();
    });
  }

  if (barcodeFileIn) {
    barcodeFileIn.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) _handleBarcodeFile(file);
    });
  }

  if (barcodeBtn) {
    barcodeBtn.addEventListener('click', () => {
      if (barcodeIn?.value) _lookupBarcode(barcodeIn.value);
    });
  }
  if (barcodeIn) {
    barcodeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _lookupBarcode(barcodeIn.value);
      }
    });
  }

  // Teszt vonalkód gombok
  document.querySelectorAll('.diet-test-barcode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (barcodeIn) barcodeIn.value = code;
      _lookupBarcode(code);
    });
  });

  // Új étel mentése az adatbázisba
  const saveFoodDbBtn = $('diet-save-food-db-btn');
  if (saveFoodDbBtn) {
    saveFoodDbBtn.addEventListener('click', async () => {
      const name = $('diet-food-name-in')?.value.trim();
      const cal = parseFloat($('diet-food-cal-in')?.value) || 0;
      const pro = parseFloat($('diet-food-pro-in')?.value) || 0;
      const carb = parseFloat($('diet-food-carb-in')?.value) || 0;
      const fat = parseFloat($('diet-food-fat-in')?.value) || 0;

      if (!name) return;

      try {
        await addDoc(collection(db, 'users', _uid, 'foodDatabase'), {
          name,
          cal100: cal,
          p100: pro,
          c100: carb,
          f100: fat,
          imageUrl: _lastScannedFoodDbImage || null,
          unit: 'g',
          createdAt: serverTimestamp()
        });
        $('diet-food-name-in').value = '';
        $('diet-food-cal-in').value = '';
        $('diet-food-pro-in').value = '';
        $('diet-food-carb-in').value = '';
        $('diet-food-fat-in').value = '';
        $('diet-barcode-input').value = '';
        _lastScannedFoodDbImage = null;
        const imgWrap = $('diet-food-db-img-wrap');
        if (imgWrap) imgWrap.classList.add('hidden');
        $('diet-barcode-status').textContent = 'Étel sikeresen elmentve!';
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Gyors Vonalkód Hozzáadás Modal események
  const qbcClose = $('diet-quick-barcode-close');
  const qbcBackdrop = $('diet-quick-barcode-backdrop');
  if (qbcClose) qbcClose.addEventListener('click', _closeQuickBarcodeModal);
  if (qbcBackdrop) qbcBackdrop.addEventListener('click', _closeQuickBarcodeModal);

  const qbcCameraBtn = $('diet-qbc-camera-btn');
  const qbcScannerStop = $('diet-qbc-scanner-stop');
  if (qbcCameraBtn) qbcCameraBtn.addEventListener('click', _startQuickBarcodeScanner);
  if (qbcScannerStop) qbcScannerStop.addEventListener('click', _stopQuickBarcodeScanner);

  const qbcLookupBtn = $('diet-qbc-lookup-btn');
  const qbcInput = $('diet-qbc-input');
  if (qbcLookupBtn) {
    qbcLookupBtn.addEventListener('click', () => {
      if (qbcInput?.value) _lookupQuickBarcode(qbcInput.value);
    });
  }
  if (qbcInput) {
    qbcInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (qbcInput.value) _lookupQuickBarcode(qbcInput.value);
      }
    });
  }

  // Gyors teszt kód gombok
  document.querySelectorAll('.diet-qbc-test-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (qbcInput) qbcInput.value = code;
      _lookupQuickBarcode(code);
    });
  });

  // Gyors adag gombok
  document.querySelectorAll('.diet-qbc-quick-portion').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.grams;
      const gInput = $('diet-qbc-grams-input');
      if (g && gInput) {
        gInput.value = g;
        _recalcQuickBarcodeMacros(g);
      }
    });
  });

  const qbcGramsInput = $('diet-qbc-grams-input');
  if (qbcGramsInput) {
    qbcGramsInput.addEventListener('input', (e) => {
      _recalcQuickBarcodeMacros(e.target.value);
    });
  }

  const qbcAddBtn = $('diet-qbc-add-meal-btn');
  if (qbcAddBtn) qbcAddBtn.addEventListener('click', _addQuickBarcodeToMeal);

  // Étkezés rögzítése modal: Vonalkód gomb
  const mealBarcodeBtn = $('diet-meal-barcode-btn');
  if (mealBarcodeBtn) {
    mealBarcodeBtn.addEventListener('click', () => {
      _openQuickBarcodeModal(_activeMealSlot || 'breakfast', 'meal_modal');
    });
  }

  // Étkezés hozzáadása ablak események
  const fab = $('diet-fab');
  if (fab) fab.addEventListener('click', () => { _openAddMealModal(); });

  const modalClose = $('diet-modal-close');
  const modalBackdrop = $('diet-modal-backdrop');
  if (modalClose) modalClose.addEventListener('click', _closeAddMealModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', _closeAddMealModal);

  const saveBtn = $('diet-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _saveMeal);

  // Hozzávaló hozzáadása és kiválasztása események
  const addIngBtn = $('diet-add-ingredient-btn');
  if (addIngBtn) addIngBtn.addEventListener('click', () => _openIngredientPickerModal('meal'));

  const ingPickerClose = $('diet-ing-picker-close');
  const ingPickerBackdrop = $('diet-ing-picker-backdrop');
  if (ingPickerClose) ingPickerClose.addEventListener('click', _closeIngredientPickerModal);
  if (ingPickerBackdrop) ingPickerBackdrop.addEventListener('click', _closeIngredientPickerModal);

  const quickSaveIngBtn = $('diet-quick-save-ing-btn');
  if (quickSaveIngBtn) quickSaveIngBtn.addEventListener('click', _quickSaveNewIngredient);

  const mealNameIn = $('diet-input-name');
  if (mealNameIn) {
    mealNameIn.addEventListener('input', () => {
      mealNameIn.dataset.autoGenerated = 'false';
    });
  }

  // Gramm beviteli mező élő újraszámolása
  const gramIn = $('diet-input-quantity');
  if (gramIn) {
    gramIn.addEventListener('input', () => {
      _recalcFromGrams(gramIn.value);
    });
  }

  // Táplálékkiegészítő modal
  const supClose = $('diet-supplement-close');
  const supBackdrop = $('diet-supplement-backdrop');
  const supSave = $('diet-sup-save-btn');
  if (supClose) supClose.addEventListener('click', _closeAddSupplementModal);
  if (supBackdrop) supBackdrop.addEventListener('click', _closeAddSupplementModal);
  if (supSave) supSave.addEventListener('click', _saveSupplement);

  // Globális cél frissítési esemény figyelése
  window.addEventListener('fitplan:goals-updated', () => {
    _updateStats();
    _renderHydration();
  });

  // Szinkronizáció a WHOOP / Home gyors műveleteivel (pl. +250ml víz)
  window.addEventListener('lockin:whoop-nutrition-updated', () => {
    _updateStats();
    _renderDietView();
    _renderHydration();
  });
}

function _updateViewModeButtons() {
  const dayBtn = $('diet-view-day-btn');
  const weekBtn = $('diet-view-week-btn');

  if (dayBtn) {
    const active = _viewMode === 'day';
    dayBtn.className = `px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${
      active
        ? 'bg-emerald-600 text-white shadow-sm'
        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
    }`;
  }

  if (weekBtn) {
    const active = _viewMode === 'week';
    weekBtn.className = `px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${
      active
        ? 'bg-emerald-600 text-white shadow-sm'
        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
    }`;
  }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function _fallbackCopyText(text, btn) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Kimásolva!';
      setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy mr-1"></i>Másolás vágólapra'; }, 2000);
    }
  } catch (e) {
    console.warn('[diet] Fallback copy failed:', e);
  }
}

// ── Public API ─────────────────────────────────────────────
export function initDiet(uid) {
  _uid = uid;
  if (typeof window !== 'undefined' && typeof window.getWhoopDate === 'function') {
    _selectedDate = window.getWhoopDate() || todayString();
  } else {
    _selectedDate = todayString();
  }
  _viewMode = 'day';
  _allMeals = (typeof window !== 'undefined' && window._allDietMeals) ? window._allDietMeals : [];
  _foodDatabase = [];
  _recipes = [];
  _hydrationLogs = (typeof window !== 'undefined' && window._allDietHydration) ? window._allDietHydration : [];
  _supplementLogs = [];
  _activeFoodTab = 'ingredients';

  if (!_uiInitialized) {
    _bindEvents();
    _uiInitialized = true;
  }

  _updateViewModeButtons();
  _onDateChanged(false);
  _startListeners();
}

export function destroyDiet() {
  _stopBarcodeScanner();
  _stopQuickBarcodeScanner();
  if (_unsubMeals) { _unsubMeals(); _unsubMeals = null; }
  if (_unsubFoodDb) { _unsubFoodDb(); _unsubFoodDb = null; }
  if (_unsubRecipes) { _unsubRecipes(); _unsubRecipes = null; }
  if (_unsubHydration) { _unsubHydration(); _unsubHydration = null; }
  if (_unsubSupplements) { _unsubSupplements(); _unsubSupplements = null; }
  if (_unsubWorkouts) { _unsubWorkouts(); _unsubWorkouts = null; }

  _uid = null;
  _allMeals = [];
  _foodDatabase = [];
  _recipes = [];
  _hydrationLogs = [];
  _supplementLogs = [];
  _allWorkouts = [];
  if (typeof window !== 'undefined') {
    window._allDietMeals = [];
    window._allDietHydration = [];
  }

  const list = $('diet-records-list');
  if (list) list.innerHTML = '';
  const hydra = $('diet-hydration-container');
  if (hydra) hydra.innerHTML = '';
  const sup = $('diet-supplements-container');
  if (sup) sup.innerHTML = '';
  const ingStrips = $('diet-meal-ingredients-container');
  if (ingStrips) ingStrips.innerHTML = '';
  const ingList = $('diet-ing-picker-list');
  if (ingList) ingList.innerHTML = '';

  _updateStats();
}
