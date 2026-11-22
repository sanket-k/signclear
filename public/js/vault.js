/* vault.js — saved checks on this device: title, note, score, exposure, lang only. */

export const KEY = 'sc.vault';

const MAX_DOCS = 50;
const MAX_CHARS = 20480;
const LANGS = ['kn', 'hi', 'ta', 'en'];

function storage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch (_err) {
    return null;
  }
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (value && typeof value === 'object') {
    if (typeof value.value === 'number') return asNumber(value.value);
    if (typeof value.current === 'number') return asNumber(value.current);
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.round(Number(value));
  }
  return null;
}

function asText(value, fallback) {
  if (typeof value === 'string') return value.trim() ? value : fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function asTime(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function shape(record) {
  const source = record && typeof record === 'object' ? record : {};
  const lang = typeof source.lang === 'string' ? source.lang.toLowerCase() : '';
  return {
    id: asText(source.id, newId()).toString(),
    title: asText(source.title, 'Untitled'),
    note: asText(source.note, ''),
    score: asNumber(source.score),
    exposure_inr: asNumber(source.exposure_inr),
    lang: LANGS.includes(lang) ? lang : 'en',
    saved_at: asText(source.saved_at, new Date().toISOString()),
  };
}

function bySavedAt(a, b) {
  return asTime(a.saved_at) - asTime(b.saved_at);
}

function fit(docs) {
  let list = docs.slice().sort(bySavedAt);
  while (list.length > MAX_DOCS) list.shift();
  while (list.length > 1 && JSON.stringify(list).length > MAX_CHARS) list.shift();
  return list;
}

function writeAll(docs) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(fit(docs)));
    return true;
  } catch (_err) {
    return false;
  }
}

export function listDocs() {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return fit(parsed.filter((doc) => doc && typeof doc === 'object').map(shape));
  } catch (_err) {
    return [];
  }
}

export function saveDoc(record) {
  const doc = shape(record);
  const docs = listDocs().filter((entry) => entry.id !== doc.id);
  docs.push(doc);
  writeAll(docs);
  return doc;
}

export function removeDoc(id) {
  const target = asText(id, '');
  if (!target) return listDocs();
  const docs = listDocs().filter((doc) => doc.id !== target);
  writeAll(docs);
  return docs;
}

export function clearDocs() {
  writeAll([]);
  return [];
}

export function createVault(ctx) {
  const api = ctx && typeof ctx === 'object' ? ctx : {};
  let mounted = false;
  let noSave = false;

  const doc = () => (typeof document === 'undefined' ? null : document);

  function drawer() {
    const d = doc();
    if (!d || typeof d.getElementById !== 'function') return null;
    return d.getElementById('vault-drawer');
  }

  function openers() {
    const d = doc();
    if (!d || typeof d.querySelectorAll !== 'function') return [];
    return Array.from(d.querySelectorAll('[data-vault-open]'));
  }

  function isOpen() {
    const el = drawer();
    return !!el && el.dataset && el.dataset.open === 'true';
  }

  function setOpen(open) {
    const el = drawer();
    if (el) {
      if (el.dataset) el.dataset.open = open ? 'true' : 'false';
      el.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    for (const button of openers()) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function row(docRecord) {
    const d = doc();
    if (!d) return null;
    const item = d.createElement('li');
    item.className = 'vault-item';
    item.setAttribute('data-doc-id', docRecord.id);

    const head = d.createElement('div');
    head.className = 'vault-item-head';

    const title = d.createElement('span');
    title.className = 'vault-item-title';
    title.textContent = docRecord.title;

    const score = d.createElement('span');
    score.className = 'vault-item-score';
    score.textContent = typeof docRecord.score === 'number' ? `${docRecord.score}/100` : '—';

    head.appendChild(title);
    head.appendChild(score);

    const foot = d.createElement('div');
    foot.className = 'vault-item-foot';

    const meta = d.createElement('span');
    const parts = [];
    if (typeof docRecord.exposure_inr === 'number') {
      parts.push(`₹${docRecord.exposure_inr.toLocaleString('en-IN')} at risk`);
    }
    parts.push(String(docRecord.lang || 'en').toUpperCase());
    meta.textContent = parts.join(' · ');

    const remove = d.createElement('button');
    remove.className = 'vault-item-remove';
    remove.type = 'button';
    remove.setAttribute('data-vault-remove', docRecord.id);
    remove.setAttribute('aria-label', `Delete ${docRecord.title}`);
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      removeDoc(docRecord.id);
      renderList();
      if (typeof api.toast === 'function') api.toast('Removed from this device');
    });

    foot.appendChild(meta);
    foot.appendChild(remove);

    item.appendChild(head);
    item.appendChild(foot);
    return item;
  }

  function renderList() {
    const d = doc();
    if (!d || typeof d.querySelector !== 'function') return;
    const list = d.querySelector('[data-vault-list]');
    if (!list) return;
    const docs = listDocs().slice().reverse();
    list.textContent = '';
    if (!docs.length) {
      const empty = d.createElement('li');
      empty.className = 'vault-empty';
      empty.textContent = 'Nothing saved yet.';
      list.appendChild(empty);
      return;
    }
    for (const docRecord of docs) {
      const item = row(docRecord);
      if (item) list.appendChild(item);
    }
  }

  function currentRecord() {
    let audit = null;
    try {
      audit = typeof api.getAudit === 'function' ? api.getAudit() : null;
    } catch (_err) {
      audit = null;
    }
    const source = audit && typeof audit === 'object' ? audit : {};
    const pack = source.pack && typeof source.pack === 'object' ? source.pack : {};
    let lang = source.language;
    try {
      const chosen = typeof api.getLang === 'function' ? api.getLang() : null;
      if (typeof chosen === 'string' && chosen) lang = chosen;
    } catch (_err) {
      lang = source.language;
    }
    return shape({
      title: asText(pack.label, 'Untitled'),
      note: '',
      score: source.score,
      exposure_inr: source.exposure,
      lang,
    });
  }

  function saveCurrent() {
    if (noSave) {
      if (typeof api.toast === 'function') api.toast('Saving is off', 'warn');
      return null;
    }
    const saved = saveDoc(currentRecord());
    renderList();
    if (typeof api.toast === 'function') api.toast('Saved on this device');
    return saved;
  }

  function onKeydown(event) {
    if (!isOpen()) return;
    if (event && (event.key === 'Escape' || event.key === 'Esc')) setOpen(false);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    const d = doc();
    if (!d || typeof d.querySelectorAll !== 'function') return;

    for (const button of d.querySelectorAll('[data-vault-open]')) {
      button.addEventListener('click', () => {
        setOpen(!isOpen());
        if (isOpen()) renderList();
      });
    }
    for (const button of d.querySelectorAll('[data-vault-close]')) {
      button.addEventListener('click', () => setOpen(false));
    }

    const saveButton = d.querySelector('[data-vault-save]');
    if (saveButton) saveButton.addEventListener('click', saveCurrent);

    const clearButton = d.querySelector('[data-vault-clear]');
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        clearDocs();
        renderList();
        if (typeof api.toast === 'function') api.toast('Saved checks cleared');
      });
    }

    const noSaveBox = d.querySelector('[data-vault-nosave]');
    if (noSaveBox) {
      const sync = () => {
        noSave = !!noSaveBox.checked;
        if (saveButton) saveButton.disabled = noSave;
      };
      noSaveBox.addEventListener('change', sync);
      sync();
    }

    setOpen(false);
    renderList();
    if (typeof d.addEventListener === 'function') d.addEventListener('keydown', onKeydown);
  }

  return { mount };
}
