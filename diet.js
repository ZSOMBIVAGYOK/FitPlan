import { db } from '../firebase-config.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

const MEAL_META = {
  breakfast: { icon: 'fa-solid fa-sun',         label: 'Reggeli' },
  lunch:     { icon: 'fa-solid fa-cloud-sun',    label: 'Ebéd'    },
  dinner:    { icon: 'fa-solid fa-moon',         label: 'Vacsora' },
  snack:     { icon: 'fa-solid fa-cookie-bite',  label: 'Snack'   },
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------
let _uid          = null;
let _unsubscribe  = null;
let _allMeals     = [];
let _activeFilter = 'all';
let _activeMeal   = 'breakfast';

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function _updateStats() {
  const today = todayString();
  const todayMeals = _allMeals.filter(m => m.date === today);

  const totalCalories = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein  = todayMeals.reduce((s, m) => s + (m.protein  || 0), 0);
  const count         = todayMeals.length;

  const elCal     = $('diet-stat-calories');
  const elProtein = $('diet-stat-protein');
  const elMeals   = $('diet-stat-meals');

  if (elCal)     elCal.textContent     = totalCalories;
  if (elProtein) elProtein.textContent = `${totalProtein}g`;
  if (elMeals)   elMeals.textContent   = count;
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------
function _buildCard(meal) {
  const meta = MEAL_META[meal.mealType] || MEAL_META.breakfast;

  const card = document.createElement('div');
  card.className = 'bg-white border border-gray-100 rounded-2xl shadow-sm flex items-center gap-4 p-4';

  card.innerHTML = `
    <!-- Icon badge -->
    <div class="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
      <i class="${meta.icon} text-emerald-600"></i>
    </div>

    <!-- Center info -->
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-gray-800 truncate">${_esc(meal.name)}</p>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="text-xs text-gray-400">${meal.date || ''}</span>
        <span class="text-xs bg-gray-50 text-gray-500 rounded-full px-2 py-0.5">${meta.label}</span>
      </div>
    </div>

    <!-- Calories + macros -->
    <div class="flex-shrink-0 text-right">
      <p class="text-lg font-bold text-emerald-600">${meal.calories || 0} <span class="text-xs font-normal text-gray-400">kcal</span></p>
      <p class="text-xs text-gray-400">P:${meal.protein || 0}g / C:${meal.carbs || 0}g / F:${meal.fat || 0}g</p>
    </div>

    <!-- Delete button -->
    <button
      class="flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
      data-id="${meal.id}"
      aria-label="Törlés"
    >
      <i class="fa-solid fa-xmark text-sm pointer-events-none"></i>
    </button>
  `;

  return card;
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------
function _renderList() {
  const list = $('diet-records-list');
  if (!list) return;

  const filtered = _activeFilter === 'all'
    ? _allMeals
    : _allMeals.filter(m => m.mealType === _activeFilter);

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
          <i class="fa-solid fa-utensils text-2xl text-emerald-400"></i>
        </div>
        <p class="text-gray-400 text-sm">Még nincs étkezés. Koppints a + gombra!</p>
      </div>
    `;
    return;
  }

  filtered.forEach(meal => {
    list.appendChild(_buildCard(meal));
  });
}

// ---------------------------------------------------------------------------
// Filter UI
// ---------------------------------------------------------------------------
function _applyFilterUI() {
  document.querySelectorAll('.diet-filter-btn').forEach(btn => {
    const active = btn.dataset.filter === _activeFilter;
    btn.style.backgroundColor = active ? '#16a34a' : '#f3f4f6';
    btn.style.color            = active ? '#ffffff' : '#9ca3af';
  });
}

// ---------------------------------------------------------------------------
// Meal type selector UI
// ---------------------------------------------------------------------------
function _applyMealTypeUI() {
  document.querySelectorAll('.diet-meal-btn').forEach(btn => {
    const active = btn.dataset.meal === _activeMeal;
    btn.style.borderColor       = active ? '#16a34a' : '#e5e7eb';
    btn.style.backgroundColor   = active ? '#dcfce7' : '#f9fafb';
    btn.style.color             = active ? '#16a34a' : '#9ca3af';
  });
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function _openModal() {
  const overlay = $('diet-modal');
  const sheet   = $('diet-modal-sheet');
  if (!overlay || !sheet) return;

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeModal() {
  const overlay = $('diet-modal');
  const sheet   = $('diet-modal-sheet');
  if (!overlay || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    overlay.classList.add('hidden');
  }, 340);
}

function _resetForm() {
  const fields = [
    'diet-input-name',
    'diet-input-calories',
    'diet-input-protein',
    'diet-input-carbs',
    'diet-input-fat',
  ];
  fields.forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });

  const dateEl = $('diet-input-date');
  if (dateEl) dateEl.value = todayString();

  _activeMeal = 'breakfast';
  _applyMealTypeUI();
}

// ---------------------------------------------------------------------------
// Save meal
// ---------------------------------------------------------------------------
async function _saveMeal() {
  if (!_uid) return;

  const name     = $('diet-input-name');
  const calories = $('diet-input-calories');
  const protein  = $('diet-input-protein');
  const carbs    = $('diet-input-carbs');
  const fat      = $('diet-input-fat');
  const dateEl   = $('diet-input-date');

  if (!name || !name.value.trim()) return;

  const data = {
    name:      name.value.trim(),
    mealType:  _activeMeal,
    calories:  parseFloat(calories?.value) || 0,
    protein:   parseFloat(protein?.value)  || 0,
    carbs:     parseFloat(carbs?.value)    || 0,
    fat:       parseFloat(fat?.value)      || 0,
    date:      dateEl?.value || todayString(),
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, `users/${_uid}/meals`), data);
    _closeModal();
    _resetForm();
  } catch (err) {
    console.error('[diet] saveMeal error:', err);
  }
}

// ---------------------------------------------------------------------------
// Delete meal
// ---------------------------------------------------------------------------
async function _deleteMeal(id) {
  if (!_uid || !id) return;
  try {
    await deleteDoc(doc(db, `users/${_uid}/meals`, id));
  } catch (err) {
    console.error('[diet] deleteMeal error:', err);
  }
}

// ---------------------------------------------------------------------------
// Real-time listener
// ---------------------------------------------------------------------------
function _startListener() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }

  const q = query(
    collection(db, `users/${_uid}/meals`),
    orderBy('createdAt', 'desc')
  );

  _unsubscribe = onSnapshot(q, snapshot => {
    _allMeals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    _updateStats();
    _renderList();
  }, err => {
    console.error('[diet] onSnapshot error:', err);
  });
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
function _bindEvents() {
  // FAB → open modal
  const fab = $('diet-fab');
  if (fab) {
    fab.addEventListener('click', () => {
      _resetForm();
      _openModal();
    });
  }

  // Close button
  const closeBtn = $('diet-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);

  // Backdrop click
  const backdrop = $('diet-modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', _closeModal);

  // Save button
  const saveBtn = $('diet-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _saveMeal);

  // Filter buttons (event delegation on document)
  document.addEventListener('click', _onFilterClick);

  // Meal type buttons (event delegation on document)
  document.addEventListener('click', _onMealTypeClick);

  // Delete (event delegation on list)
  const list = $('diet-records-list');
  if (list) list.addEventListener('click', _onDeleteClick);
}

function _onFilterClick(e) {
  const btn = e.target.closest('.diet-filter-btn');
  if (!btn) return;
  _activeFilter = btn.dataset.filter || 'all';
  _applyFilterUI();
  _renderList();
}

function _onMealTypeClick(e) {
  const btn = e.target.closest('.diet-meal-btn');
  if (!btn) return;
  _activeMeal = btn.dataset.meal || 'breakfast';
  _applyMealTypeUI();
}

function _onDeleteClick(e) {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (id) _deleteMeal(id);
}

let _uiInitialized = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function initDiet(uid) {
  _uid          = uid;
  _activeFilter = 'all';
  _activeMeal   = 'breakfast';
  _allMeals     = [];

  _applyFilterUI();
  _applyMealTypeUI();
  if (!_uiInitialized) {
    _bindEvents();
    _uiInitialized = true;
  }
  _startListener();
}

export function destroyDiet() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }

  _uid      = null;
  _allMeals = [];

  const list = $('diet-records-list');
  if (list) list.innerHTML = '';
  _updateStats();
}
