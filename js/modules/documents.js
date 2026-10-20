// ============================================================
//  FitPlan Pro — DOCUMENTS module
//  Firestore collection: users/{uid}/documents
//  Color scheme: Cyan  (#0891b2 / #ecfeff / #22d3ee)
// ============================================================

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

// ── Category metadata ────────────────────────────────────────
const _CATEGORIES = {
  lelet:     { icon: 'fa-solid fa-flask',        label: 'Lelet'      },
  recept:    { icon: 'fa-solid fa-prescription', label: 'Recept'     },
  vizsgalat: { icon: 'fa-solid fa-stethoscope',  label: 'Vizsgálat'  },
  egyeb:     { icon: 'fa-solid fa-file',         label: 'Egyéb'      },
};

// ── Module state ─────────────────────────────────────────────
let _uid            = null;
let _unsubscribe    = null;
let _docs           = [];
let _activeFilter   = 'all';
let _activeCat      = 'lelet';

// ── DOM helpers ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Stats ────────────────────────────────────────────────────
function _updateStats() {
  const total   = _docs.length;
  const leletek = _docs.filter((d) => d.category === 'lelet').length;
  const receptek= _docs.filter((d) => d.category === 'recept').length;

  const elTotal   = $('doc-stat-total');
  const elLeletek = $('doc-stat-leletek');
  const elReceptek= $('doc-stat-receptek');

  if (elTotal)    elTotal.textContent    = total;
  if (elLeletek)  elLeletek.textContent  = leletek;
  if (elReceptek) elReceptek.textContent = receptek;
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Card HTML builder (Modern Tailwind + Apple Dark Mode) ────
function _cardHTML(d) {
  const meta = _CATEGORIES[d.category] || _CATEGORIES['egyeb'];
  const dateStr = d.date
    ? new Date(d.date + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" })
    : "";

  return `
    <div class="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div class="w-11 h-11 rounded-2xl bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center flex-shrink-0">
        <i class="${meta.icon} text-cyan-600 dark:text-cyan-400 text-base"></i>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-sm font-bold text-gray-900 dark:text-white truncate">${_esc(d.name)}</p>
          <span class="text-[10px] bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 rounded-full px-2 py-0.5 font-semibold">${meta.label}</span>
        </div>
        <p class="text-xs text-gray-400 mt-0.5">${dateStr}</p>
        ${d.notes ? `<p class="text-xs text-gray-400 mt-1 line-clamp-2">${_esc(d.notes)}</p>` : ''}
        ${d.url ? `
          <a href="${_esc(d.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs text-cyan-600 dark:text-cyan-400 font-semibold mt-1.5 hover:underline">
            <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> Megnyitás
          </a>
        ` : ''}
      </div>

      <button class="doc-delete-btn ml-1 w-7 h-7 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-300 dark:text-gray-600 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
        data-id="${d.id}" title="Törlés">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
  `;
}

// ── Render list ───────────────────────────────────────────────
function _renderList() {
  const list = $('doc-records-list');
  if (!list) return;

  const filtered = _activeFilter === 'all'
    ? _docs
    : _docs.filter((d) => d.category === _activeFilter);

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="text-center py-16">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center mb-4">
          <i class="fa-solid fa-file-medical text-cyan-400 text-2xl"></i>
        </div>
        <p class="text-gray-400 dark:text-gray-500 text-sm font-medium">Még nincs dokumentum rögzítve!</p>
        <p class="text-gray-300 dark:text-gray-600 text-xs mt-1">Koppints a + gombra lelet vagy vizsgálat feltöltéséhez!</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(_cardHTML).join('');

  list.querySelectorAll('.doc-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _deleteDocument(btn.dataset.id);
    });
  });
}

// ── Filter buttons ────────────────────────────────────────────
function _initFilterButtons() {
  document.querySelectorAll('.doc-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.getAttribute('data-filter') || 'all';
      _applyFilterStyles();
      _renderList();
    });
  });
  _applyFilterStyles();
}

function _applyFilterStyles() {
  document.querySelectorAll('.doc-filter-btn').forEach((btn) => {
    const isActive = btn.getAttribute('data-filter') === _activeFilter;
    btn.className = `doc-filter-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
      isActive
        ? 'bg-cyan-600 text-white shadow-sm'
        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:text-gray-700'
    }`;
    btn.style.backgroundColor = '';
    btn.style.color = '';
  });
}

// ── Category buttons (modal) ──────────────────────────────────
function _initCatButtons() {
  document.querySelectorAll('.doc-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeCat = btn.getAttribute('data-cat') || 'lelet';
      _applyCatStyles();
    });
  });
  _applyCatStyles();
}

function _applyCatStyles() {
  document.querySelectorAll('.doc-cat-btn').forEach((btn) => {
    const isActive = btn.getAttribute('data-cat') === _activeCat;
    btn.className = `doc-cat-btn flex flex-col items-center gap-1 py-2.5 rounded-2xl border-2 transition-all ${
      isActive
        ? 'border-cyan-600 bg-cyan-50/80 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400 font-bold'
        : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-400'
    }`;
    btn.style.borderColor = '';
    btn.style.backgroundColor = '';
    btn.style.color = '';
  });
}

let _uiInitialized = false;

// ── Modal ─────────────────────────────────────────────────────
function _openModal() {
  _resetForm();
  const modal = $('doc-modal');
  const sheet = $('doc-modal-sheet');
  if (!modal || !sheet) return;

  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function _closeModal() {
  const modal = $('doc-modal');
  const sheet = $('doc-modal-sheet');
  if (!modal || !sheet) return;

  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 340);
}

function _resetForm() {
  const nameInput  = $('doc-input-name');
  const dateInput  = $('doc-input-date');
  const notesInput = $('doc-input-notes');
  const urlInput   = $('doc-input-url');

  if (nameInput)  nameInput.value  = '';
  if (notesInput) notesInput.value = '';
  if (urlInput)   urlInput.value   = '';

  // Default date = today
  if (dateInput) {
    const today = new Date();
    const yyyy  = today.getFullYear();
    const mm    = String(today.getMonth() + 1).padStart(2, '0');
    const dd    = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  // Default category
  _activeCat = 'lelet';
  _applyCatStyles();
}

function _initModal() {
  const backdrop = $('doc-modal-backdrop');
  const closeBtn = $('doc-modal-close');
  const fab      = $('doc-fab');

  if (fab)      fab.addEventListener('click', _openModal);
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);
  if (backdrop) backdrop.addEventListener('click', _closeModal);
}

// ── Save ──────────────────────────────────────────────────────
async function _saveDocument() {
  if (!_uid) return;

  const nameInput  = $('doc-input-name');
  const dateInput  = $('doc-input-date');
  const notesInput = $('doc-input-notes');
  const urlInput   = $('doc-input-url');
  const saveBtn    = $('doc-save-btn');

  const name  = nameInput  ? nameInput.value.trim()  : '';
  const date  = dateInput  ? dateInput.value.trim()  : '';
  const notes = notesInput ? notesInput.value.trim() : '';
  const url   = urlInput   ? urlInput.value.trim()   : '';

  if (!name) {
    if (nameInput) {
      nameInput.focus();
      nameInput.style.borderColor = '#ef4444';
      setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    }
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Mentés…';
  }

  try {
    const colRef = collection(db, 'users', _uid, 'documents');
    const payload = {
      name,
      category: _activeCat,
      date,
      notes,
      createdAt: serverTimestamp(),
    };
    if (url) payload.url = url;

    await addDoc(colRef, payload);
    _closeModal();
  } catch (err) {
    console.error('[Documents] Save error:', err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Dokumentum mentése';
    }
  }
}

function _initSaveButton() {
  const saveBtn = $('doc-save-btn');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', _saveDocument);
}

// ── Delete ────────────────────────────────────────────────────
async function _deleteDocument(docId) {
  if (!_uid || !docId) return;
  try {
    const docRef = doc(db, 'users', _uid, 'documents', docId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error('[Documents] Delete error:', err);
  }
}

// ── Firestore listener ────────────────────────────────────────
function _subscribe() {
  if (!_uid) return;
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  const q = query(
    collection(db, 'users', _uid, 'documents'),
    orderBy('createdAt', 'desc')
  );

  _unsubscribe = onSnapshot(q, (snapshot) => {
    _docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    _updateStats();
    _renderList();
  }, (err) => {
    console.error('[Documents] onSnapshot error:', err);
  });
}

// ── Public API ────────────────────────────────────────────────
export function initDocuments(uid) {
  if (!uid) return;
  _uid = uid;

  if (!_uiInitialized) {
    _initFilterButtons();
    _initCatButtons();
    _initModal();
    _initSaveButton();
    _uiInitialized = true;
  }

  _activeFilter = 'all';
  _applyFilterStyles();
  _subscribe();
}

export function destroyDocuments() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _uid          = null;
  _docs         = [];
  _activeFilter = 'all';
  _activeCat    = 'lelet';

  const list = $('doc-records-list');
  if (list) list.innerHTML = '';
  _updateStats();
}
