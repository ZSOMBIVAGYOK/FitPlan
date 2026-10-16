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

// ── Card builder ─────────────────────────────────────────────
function _buildCard(docData) {
  const { id, name, category, date, notes, url } = docData;
  const meta = _CATEGORIES[category] || _CATEGORIES['egyeb'];

  const card = document.createElement('div');
  card.className = 'doc-card';
  card.setAttribute('data-id', id);
  card.style.cssText = [
    'display:flex',
    'align-items:flex-start',
    'gap:12px',
    'background:#ffffff',
    'border-radius:1rem',
    'box-shadow:0 1px 3px rgba(0,0,0,0.08)',
    'padding:14px 16px',
    'margin-bottom:10px',
    'position:relative',
  ].join(';');

  // ── Icon badge ──────────────────────────────────────────
  const badge = document.createElement('div');
  badge.style.cssText = [
    'flex-shrink:0',
    'width:42px',
    'height:42px',
    'border-radius:0.75rem',
    'background:#ecfeff',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const icon = document.createElement('i');
  icon.className = meta.icon;
  icon.style.cssText = 'color:#06b6d4;font-size:18px;';
  badge.appendChild(icon);

  // ── Center content ──────────────────────────────────────
  const center = document.createElement('div');
  center.style.cssText = 'flex:1;min-width:0;';

  // Name
  const nameEl = document.createElement('div');
  nameEl.textContent = name || '—';
  nameEl.style.cssText = 'font-weight:600;color:#1f2937;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

  // Date + category pill
  const meta2 = document.createElement('div');
  meta2.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:3px;';

  const dateEl = document.createElement('span');
  dateEl.textContent = date || '';
  dateEl.style.cssText = 'font-size:12px;color:#6b7280;';

  const pill = document.createElement('span');
  pill.textContent = meta.label;
  pill.style.cssText = [
    'font-size:11px',
    'font-weight:600',
    'color:#0891b2',
    'background:#ecfeff',
    'border-radius:999px',
    'padding:1px 8px',
  ].join(';');

  meta2.appendChild(dateEl);
  meta2.appendChild(pill);

  center.appendChild(nameEl);
  center.appendChild(meta2);

  // Notes preview
  if (notes && notes.trim()) {
    const notesEl = document.createElement('div');
    notesEl.textContent = notes.trim();
    notesEl.style.cssText = [
      'margin-top:5px',
      'font-size:12px',
      'color:#9ca3af',
      'overflow:hidden',
      'display:-webkit-box',
      '-webkit-line-clamp:2',
      '-webkit-box-orient:vertical',
      'line-clamp:2',
    ].join(';');
    center.appendChild(notesEl);
  }

  // URL link
  if (url && url.trim()) {
    const linkWrap = document.createElement('div');
    linkWrap.style.cssText = 'margin-top:6px;';

    const link = document.createElement('a');
    link.href = url.trim();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.cssText = [
      'font-size:12px',
      'color:#0891b2',
      'font-weight:500',
      'text-decoration:none',
      'display:inline-flex',
      'align-items:center',
      'gap:4px',
    ].join(';');

    const linkIcon = document.createElement('i');
    linkIcon.className = 'fa-solid fa-arrow-up-right-from-square';
    linkIcon.style.cssText = 'font-size:10px;';

    link.appendChild(linkIcon);
    link.appendChild(document.createTextNode('Megnyitás'));
    linkWrap.appendChild(link);
    center.appendChild(linkWrap);
  }

  // ── Delete button ───────────────────────────────────────
  const delBtn = document.createElement('button');
  delBtn.style.cssText = [
    'flex-shrink:0',
    'background:none',
    'border:none',
    'cursor:pointer',
    'color:#d1d5db',
    'font-size:16px',
    'padding:2px 4px',
    'line-height:1',
    'transition:color 0.15s',
  ].join(';');
  delBtn.setAttribute('aria-label', 'Törlés');

  const delIcon = document.createElement('i');
  delIcon.className = 'fa-solid fa-xmark';
  delBtn.appendChild(delIcon);

  delBtn.addEventListener('mouseenter', () => { delBtn.style.color = '#ef4444'; });
  delBtn.addEventListener('mouseleave', () => { delBtn.style.color = '#d1d5db'; });
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _deleteDocument(id);
  });

  card.appendChild(badge);
  card.appendChild(center);
  card.appendChild(delBtn);

  return card;
}

// ── Render list ───────────────────────────────────────────────
function _renderList() {
  const list = $('doc-records-list');
  if (!list) return;

  list.innerHTML = '';

  const filtered = _activeFilter === 'all'
    ? _docs
    : _docs.filter((d) => d.category === _activeFilter);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'padding:48px 16px',
      'color:#9ca3af',
      'gap:12px',
    ].join(';');

    const emptyIcon = document.createElement('i');
    emptyIcon.className = 'fa-solid fa-file-medical';
    emptyIcon.style.cssText = 'font-size:36px;color:#22d3ee;opacity:0.6;';

    const emptyText = document.createElement('div');
    emptyText.textContent = 'Még nincs dokumentum rögzítve!';
    emptyText.style.cssText = 'font-size:14px;color:#9ca3af;';

    empty.appendChild(emptyIcon);
    empty.appendChild(emptyText);
    list.appendChild(empty);
    return;
  }

  filtered.forEach((docData) => {
    list.appendChild(_buildCard(docData));
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
    btn.style.backgroundColor = isActive ? '#0891b2' : '#f3f4f6';
    btn.style.color            = isActive ? '#ffffff' : '#9ca3af';
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
    btn.style.borderColor      = isActive ? '#0891b2' : '#e5e7eb';
    btn.style.backgroundColor  = isActive ? '#ecfeff' : '#f9fafb';
    btn.style.color            = isActive ? '#0891b2' : '#9ca3af';
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
