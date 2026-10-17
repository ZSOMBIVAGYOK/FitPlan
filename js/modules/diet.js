// ============================================================
// diet.js — Diéta, Ételmenü, Hidratáció & Táplálékkiegészítők
// FitPlan Pro | Emerald / Green téma
// 6 étkezés, Napi/Heti nézet, Barcode scanner, Bevásárlólista
// ============================================================

import { db } from '../firebase-config.js';
import { getGoals } from '../settings.js';
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

// ── Beépített minta receptek (Recipe Library) ───────────────
export const DEFAULT_RECIPES = [
  {
    name: 'Csirkés-zöldséges bulgurtál',
    calories: 520,
    protein: 48,
    carbs: 55,
    fat: 12,
    ingredients: '200g csirkemell filé\n80g bulgur (szárazon)\n100g brokkoli\n80g kaliforniai paprika\n10ml extra szűz olívaolaj\nSó, bors, oregánó',
    instructions: '1. A bulgurt kétszeres forró sós vízben lefedve 15 perc alatt megpároljuk.\n2. A csirkemellet felcsíkozzuk, fűszerezzük, majd olívaolajon aranybarnára pirítjuk.\n3. Hozzáadjuk a párolt zöldségeket, és a bulgurral összeforgatva tálaljuk.'
  },
  {
    name: 'Fehérjés Zabkása Gyümölcsökkel',
    calories: 440,
    protein: 34,
    carbs: 58,
    fat: 8,
    ingredients: '60g finomszemű zabpehely\n30g vaníliás tejsavófehérje (Whey)\n200ml mandulatej vagy víz\n1 db banán\n50g áfonya vagy erdei gyümölcs',
    instructions: '1. A zabpelyhet a mandulatejjel kis lángon krémesre főzzük 3-4 perc alatt.\n2. Levesszük a tűzről, megvárjuk amíg picit hűl, majd elkeverjük benne a fehérjét.\n3. Tálkába öntjük, és friss banánkarikákkal, áfonyával díszítjük.'
  },
  {
    name: 'Rostonsült Lazac Édesburgonyával',
    calories: 590,
    protein: 42,
    carbs: 48,
    fat: 24,
    ingredients: '180g vadlazac filé\n200g édesburgonya\n150g zöldspárga vagy zöldbab\n1/2 citrom leve\n1 ek olívaolaj',
    instructions: '1. Az édesburgonyát kockákra vágjuk és sütőben 200°C-on 25 perc alatt megsütjük.\n2. A lazacot bőrös felével lefelé serpenyőben 4 percig sütjük, majd megfordítva még 3 percig pirítjuk citromlével.\n3. A zöldspárgát serpenyőben megpirítjuk, és a lazaccal együtt tálaljuk.'
  }
];

// ── Belső állapot ──────────────────────────────────────────
let _uid = null;
let _unsubMeals = null;
let _unsubFoodDb = null;
let _unsubRecipes = null;
let _unsubHydration = null;
let _unsubSupplements = null;

let _allMeals = [];
let _foodDatabase = [];
let _currentFoodList = [];
let _recipes = [];
let _hydrationLogs = [];
let _supplementLogs = [];

let _selectedDate = todayString();
let _viewMode = 'day'; // 'day' | 'week'
let _activeMealSlot = 'breakfast';
let _activeFilter = 'all';
let _activeFoodTab = 'ingredients'; // 'ingredients' | 'recipes'

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

function _onDateChanged() {
  const dateInput = $('diet-current-date-input');
  const dateText = $('diet-current-date-text');
  if (dateInput) dateInput.value = _selectedDate;
  if (dateText) dateText.textContent = _formatDateHU(_selectedDate);

  _updateStats();
  _renderDietView();
  _renderHydration();
  _renderSupplements();
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

          <div class="flex items-center gap-2">
            <div class="text-right mr-1">
              <p class="text-xs font-bold text-emerald-600 dark:text-emerald-400">${slotKcal} kcal</p>
              <p class="text-[10px] text-gray-400">P: ${slotProtein}g</p>
            </div>
            <button class="diet-add-to-slot-btn w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors" data-slot="${slot.id}" title="Étel hozzáadása a ${slot.label}-hez">
              <i class="fa-solid fa-plus text-xs"></i>
            </button>
          </div>
        </div>

        <!-- Ételek listája az adott sávban -->
        <div class="mt-3 space-y-2">
          ${slotMeals.length === 0 ? `
            <p class="text-xs text-gray-400 dark:text-gray-600 py-1 text-center italic">Még nem rögzítettél ételt.</p>
          ` : slotMeals.map(meal => `
            <div class="flex items-center justify-between py-2 px-3 rounded-2xl bg-gray-50/70 dark:bg-slate-800/60 text-xs">
              <div class="flex-1 min-w-0 pr-2">
                <p class="font-semibold text-gray-800 dark:text-gray-200 truncate">${_esc(meal.name)}</p>
                <p class="text-[10px] text-gray-400 mt-0.5">
                  ${meal.quantity ? `${meal.quantity}g · ` : ''}P: ${meal.protein || 0}g · C: ${meal.carbs || 0}g · F: ${meal.fat || 0}g
                </p>
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
  const allKnownRecipes = [...DEFAULT_RECIPES, ..._recipes];
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
      <div class="flex-1 min-w-0 pr-2">
        <p class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">${_esc(f.name)}</p>
        <p class="text-[11px] text-gray-400">100g: ${f.cal100} kcal · P:${f.p100}g · C:${f.c100}g · F:${f.f100}g</p>
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
  const allRecipes = [...DEFAULT_RECIPES, ..._recipes];

  const filtered = q
    ? allRecipes.filter(r => (r.name && r.name.toLowerCase().includes(q)) || (r.ingredients && r.ingredients.toLowerCase().includes(q)))
    : allRecipes;

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">Nincs találat a receptek között.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map((recipe, idx) => {
    const isCustom = Boolean(recipe.id);
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
                ${recipe.calories || 0} kcal · P:${recipe.protein || 0}g · C:${recipe.carbs || 0}g · F:${recipe.fat || 0}g
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${isCustom ? `
              <span class="text-[9px] bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">Saját</span>
              <button class="diet-delete-recipe-btn text-gray-300 hover:text-red-500 p-1 transition-colors" data-id="${recipe.id}" title="Recept törlése">
                <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
              </button>
            ` : '<span class="text-[9px] bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full font-semibold">Minta</span>'}
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

function _openAddMealModalFromRecipe(recipe) {
  const modal = $('diet-modal');
  const sheet = $('diet-modal-sheet');
  if (!modal || !sheet) return;

  _selectedDbFood = null;

  const slotSelect = $('diet-select-meal-slot');
  if (slotSelect) slotSelect.value = _activeMealSlot;

  const dateIn = $('diet-input-date');
  if (dateIn) dateIn.value = _selectedDate;

  const nameIn   = $('diet-input-name');
  const calIn    = $('diet-input-calories');
  const proIn    = $('diet-input-protein');
  const carbIn   = $('diet-input-carbs');
  const fatIn    = $('diet-input-fat');
  const gramWrap = $('diet-quantity-wrapper');

  if (nameIn) nameIn.value = recipe.name || '';
  if (calIn) calIn.value = recipe.calories || 0;
  if (proIn) proIn.value = recipe.protein || 0;
  if (carbIn) carbIn.value = recipe.carbs || 0;
  if (fatIn) fatIn.value = recipe.fat || 0;
  if (gramWrap) gramWrap.classList.add('hidden');

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
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
  const ingredients = ingIn?.value.trim() || '';
  const instructions = instIn?.value.trim() || '';

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés folyamatban...';
  }

  try {
    await addDoc(collection(db, 'users', _uid, 'recipes'), {
      name,
      calories,
      protein,
      carbs,
      fat,
      ingredients,
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
  } catch (err) {
    console.error('[diet] save recipe error:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Recept mentése a Recepttárba';
    }
  }
}

// ── Vonalkód olvasó (Barcode Scanner) ───────────────────────
async function _lookupBarcode(barcode) {
  const statusEl = $('diet-barcode-status');
  const code = barcode.trim();
  if (!code) return;

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Termék lekérdezése az adatbázisból (${code})...</span>`;
  }

  // Minta teszt kódok gyors offline működéshez
  const mockDb = {
    '737628064502': { name: 'Thai Kókusztej 400ml', cal100: 180, p100: 2.0, c100: 3.0, f100: 18.0 },
    '3017620422003': { name: 'Mogyorókrém (Nutella)', cal100: 539, p100: 6.3, c100: 57.5, f100: 30.9 },
    '5998711311029': { name: 'Magyar Trappista Sajt', cal100: 345, p100: 26.0, c100: 1.5, f100: 26.5 },
    '5900512300101': { name: 'Skyr Natúr Izlandi Joghurt', cal100: 63, p100: 11.0, c100: 4.0, f100: 0.2 },
    '4008400404127': { name: 'Kinder Bueno', cal100: 572, p100: 8.6, c100: 49.5, f100: 37.3 }
  };

  if (mockDb[code]) {
    _fillBarcodeProduct(mockDb[code]);
    if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-check mr-1"></i>Termék megtalálva: ${mockDb[code].name}</span>`;
    return;
  }

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    const data = await res.json();

    if (data.status === 1 && data.product) {
      const p = data.product;
      const nut = p.nutriments || {};

      const food = {
        name: p.product_name_hu || p.product_name || `Termék (${code})`,
        brand: p.brands || '',
        cal100: Math.round(nut['energy-kcal_100g'] || nut['energy-kcal'] || ((nut['energy_100g'] || 0) / 4.184)),
        p100: Math.round((nut.proteins_100g || nut.proteins || 0) * 10) / 10,
        c100: Math.round((nut.carbohydrates_100g || nut.carbohydrates || 0) * 10) / 10,
        f100: Math.round((nut.fat_100g || nut.fat || 0) * 10) / 10,
      };

      _fillBarcodeProduct(food);
      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-check mr-1"></i>Sikeres találat: ${food.name}</span>`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-circle-exclamation mr-1"></i>Nem található az OpenFoodFacts-ben. Add meg a makrókat manuálisan!</span>`;
    }
  } catch (err) {
    console.warn('[Barcode] Hiba a lekérdezés során:', err);
    if (statusEl) statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Hálózati hiba. Add meg az adatokat kézzel!</span>`;
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
}

// ── Új étkezés rögzítése Modal ─────────────────────────────
let _selectedDbFood = null;
let _currentMealIngredients = '';

function _openAddMealModalFromRecipe(recipe) {
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
  const calIn    = $('diet-input-calories');
  const proIn    = $('diet-input-protein');
  const carbIn   = $('diet-input-carbs');
  const fatIn    = $('diet-input-fat');
  const gramWrap = $('diet-quantity-wrapper');

  if (nameIn) nameIn.value = recipe.name || '';
  if (calIn) calIn.value = recipe.calories || 0;
  if (proIn) proIn.value = recipe.protein || 0;
  if (carbIn) carbIn.value = recipe.carbs || 0;
  if (fatIn) fatIn.value = recipe.fat || 0;
  if (gramWrap) gramWrap.classList.add('hidden');

  _populateRecipeSelector(recipe.name);

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _populateRecipeSelector(selectedName = '') {
  const recSelect = $('diet-select-saved-recipe');
  if (!recSelect) return;

  const allRecipes = [...DEFAULT_RECIPES, ..._recipes];
  recSelect.innerHTML = `<option value="">-- Válassz egy kész receptet (automatikusan kitölti) --</option>` +
    allRecipes.map((r, i) => `<option value="${i}" ${selectedName && r.name === selectedName ? 'selected' : ''}>${_esc(r.name)} (${r.calories || 0} kcal)</option>`).join('');

  recSelect.onchange = () => {
    const idx = recSelect.value;
    if (idx !== '') {
      const recipe = allRecipes[parseInt(idx, 10)];
      if (recipe) {
        const nameIn   = $('diet-input-name');
        const calIn    = $('diet-input-calories');
        const proIn    = $('diet-input-protein');
        const carbIn   = $('diet-input-carbs');
        const fatIn    = $('diet-input-fat');
        const gramWrap = $('diet-quantity-wrapper');

        if (nameIn) nameIn.value = recipe.name || '';
        if (calIn) calIn.value = recipe.calories || 0;
        if (proIn) proIn.value = recipe.protein || 0;
        if (carbIn) carbIn.value = recipe.carbs || 0;
        if (fatIn) fatIn.value = recipe.fat || 0;
        if (gramWrap) gramWrap.classList.add('hidden');
        _currentMealIngredients = recipe.ingredients || '';
      }
    }
  };
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

  _populateRecipeSelector();

  if (prefilledFood) {
    if (nameIn) nameIn.value = prefilledFood.name;
    if (gramWrap) gramWrap.classList.remove('hidden');
    if (gramIn) gramIn.value = 100;

    _recalcFromGrams(100);
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
  const quantity = parseFloat(gramIn?.value) || null;
  const calories = parseFloat(calIn?.value) || 0;
  const protein  = parseFloat(proIn?.value) || 0;
  const carbs    = parseFloat(carbIn?.value) || 0;
  const fat      = parseFloat(fatIn?.value) || 0;

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
      ingredients: _currentMealIngredients || '',
      createdAt: serverTimestamp(),
    });
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

  const goals = getGoals();
  const waterGoal = goals.waterGoal || (goals.weight ? Math.round(goals.weight * 35) : 2625);
  const pct = Math.min(100, Math.round((totalWater / waterGoal) * 100));

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
          <p class="text-[10px] text-gray-400">${pct}% elérve (${rawWater} ml bruttó)</p>
        </div>
      </div>

      <!-- Haladási sáv -->
      <div class="w-full bg-gray-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-5">
        <div class="bg-gradient-to-r from-sky-400 to-sky-600 h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
      </div>

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

  // 1. Ételek
  const qMeals = query(collection(db, 'users', _uid, 'meals'), orderBy('createdAt', 'desc'));
  _unsubMeals = onSnapshot(qMeals, snap => {
    _allMeals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _updateStats();
    _renderDietView();
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
    _renderHydration();
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

  // Vonalkód keresés gomb
  const barcodeBtn = $('diet-barcode-lookup-btn');
  const barcodeIn  = $('diet-barcode-input');
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
          name, cal100: cal, p100: pro, c100: carb, f100: fat, unit: 'g', createdAt: serverTimestamp()
        });
        $('diet-food-name-in').value = '';
        $('diet-food-cal-in').value = '';
        $('diet-food-pro-in').value = '';
        $('diet-food-carb-in').value = '';
        $('diet-food-fat-in').value = '';
        $('diet-barcode-input').value = '';
        $('diet-barcode-status').textContent = 'Étel sikeresen elmentve!';
      } catch (err) {
        console.error(err);
      }
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

// ── Public API ─────────────────────────────────────────────
export function initDiet(uid) {
  _uid = uid;
  _selectedDate = todayString();
  _viewMode = 'day';
  _allMeals = [];
  _foodDatabase = [];
  _recipes = [];
  _hydrationLogs = [];
  _supplementLogs = [];
  _activeFoodTab = 'ingredients';

  if (!_uiInitialized) {
    _bindEvents();
    _uiInitialized = true;
  }

  _updateViewModeButtons();
  _onDateChanged();
  _startListeners();
}

export function destroyDiet() {
  if (_unsubMeals) { _unsubMeals(); _unsubMeals = null; }
  if (_unsubFoodDb) { _unsubFoodDb(); _unsubFoodDb = null; }
  if (_unsubRecipes) { _unsubRecipes(); _unsubRecipes = null; }
  if (_unsubHydration) { _unsubHydration(); _unsubHydration = null; }
  if (_unsubSupplements) { _unsubSupplements(); _unsubSupplements = null; }

  _uid = null;
  _allMeals = [];
  _foodDatabase = [];
  _recipes = [];
  _hydrationLogs = [];
  _supplementLogs = [];

  const list = $('diet-records-list');
  if (list) list.innerHTML = '';
  const hydra = $('diet-hydration-container');
  if (hydra) hydra.innerHTML = '';
  const sup = $('diet-supplements-container');
  if (sup) sup.innerHTML = '';

  _updateStats();
}
