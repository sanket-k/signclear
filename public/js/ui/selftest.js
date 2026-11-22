/* Self-check — runs the 8 demo invariants from docs/smoke-tests.md against the live DOM, no devtools. */

const CHECKS = [
  'PII token count visible pre-upload',
  'Score + exposure render',
  'Exactly 3 hero bullets',
  'Way-Out slider recomputes',
  'Top clauses have verified excerpts + rule pills',
  'Disclaimer present',
  'No forbidden copy',
  'No horizontal overflow at current width',
];

const FORBIDDEN = /illegal|unlawful|void contract|\bsue\b|ai lawyer|guaranteed/i;
const RUPEE = /\u20B9/;

function pass(name, detail) {
  return { name, pass: true, detail };
}

function fail(name, detail) {
  return { name, pass: false, detail };
}

export function createSelfTest(ctx) {
  const c = ctx || {};
  let mounted = false;
  let ui = null;

  function doc() {
    if (c.doc && typeof c.doc.querySelector === 'function') return c.doc;
    return typeof document !== 'undefined' ? document : null;
  }

  function win() {
    if (c.win) return c.win;
    const d = doc();
    if (d && d.defaultView) return d.defaultView;
    return typeof window !== 'undefined' ? window : null;
  }

  function one(selector) {
    const d = doc();
    return d && typeof d.querySelector === 'function' ? d.querySelector(selector) : null;
  }

  function all(selector) {
    const d = doc();
    return d && typeof d.querySelectorAll === 'function' ? Array.from(d.querySelectorAll(selector)) : [];
  }

  function textOf(el) {
    if (!el) return '';
    return String(el.textContent === null || el.textContent === undefined ? '' : el.textContent).trim();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') return false;
    const w = win();
    const styleOf = (node) => {
      if (!w || typeof w.getComputedStyle !== 'function') return null;
      try {
        return w.getComputedStyle(node);
      } catch (err) {
        return null;
      }
    };
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = styleOf(node);
      if (cs) {
        if (cs.display === 'none') return false;
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
        if (cs.opacity !== '' && cs.opacity !== undefined && Number(cs.opacity) === 0) return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  function dispatchInput(el) {
    const w = win();
    const d = doc();
    let ev = null;
    try {
      if (w && typeof w.Event === 'function') ev = new w.Event('input', { bubbles: true });
      else if (d && typeof d.createEvent === 'function') {
        ev = d.createEvent('Event');
        ev.initEvent('input', true, false);
      }
    } catch (err) {
      ev = null;
    }
    if (ev && el && typeof el.dispatchEvent === 'function') el.dispatchEvent(ev);
  }

  function checkPiiCount() {
    const name = CHECKS[0];
    const countEl = one('[data-pii-count]');
    if (!countEl) return fail(name, '[data-pii-count] is missing — no token count on screen');
    const count = textOf(countEl);
    if (!count) return fail(name, '[data-pii-count] is empty — the token count is blank');
    const badge = one('.pii-badge');
    if (!badge) return fail(name, '.pii-badge is missing — the Local PII Shield badge did not render');
    if (!isVisible(badge)) return fail(name, '.pii-badge exists but is not visible');
    return pass(name, 'shield badge shows "' + count + '" before any upload');
  }

  function checkScore() {
    const name = CHECKS[1];
    const scoreEl = one('[data-score]');
    if (!scoreEl) return fail(name, '[data-score] is missing — the hero score dial did not render');

    const valueEl = typeof scoreEl.querySelector === 'function' ? scoreEl.querySelector('.score-value') : null;
    const shownScore = valueEl ? textOf(valueEl) : textOf(scoreEl);
    let value = NaN;
    if (/^-?\d+(\.\d+)?$/.test(shownScore)) value = Number(shownScore);
    if (!Number.isFinite(value)) value = Number(scoreEl.getAttribute('data-score'));
    if (!Number.isFinite(value)) return fail(name, '[data-score] carries no numeric value');
    if (value < 0 || value > 100) return fail(name, 'score ' + value + ' sits outside 0-100');

    const exposureEl = one('[data-exposure-inr]');
    if (!exposureEl) return fail(name, '[data-exposure-inr] is missing — no rupee exposure on the hero');
    const valueNode =
      typeof exposureEl.querySelector === 'function' ? exposureEl.querySelector('.hero-exposure-value') : null;
    const shownExposure = valueNode ? textOf(valueNode) : textOf(exposureEl);
    if (!RUPEE.test(shownExposure) && !RUPEE.test(String(exposureEl.getAttribute('data-exposure-inr') || ''))) {
      return fail(name, 'exposure renders without the rupee symbol');
    }

    return pass(name, 'score ' + value + '/100 with exposure ' + shownExposure);
  }

  function checkBullets() {
    const name = CHECKS[2];
    const hero = one('.hero-bullets');
    if (!hero) return fail(name, '.hero-bullets is missing — the three-line summary did not render');
    const count = all('.hero-bullets > li').length;
    if (count !== 3) return fail(name, 'found ' + count + ' .hero-bullets > li, expected exactly 3');
    return pass(name, 'exactly 3 summary bullets');
  }

  function checkWayOut() {
    const name = CHECKS[3];
    const slider = one('.wayout-slider');
    if (!slider) return pass(name, 'no Way-Out slider on this report — skipped');

    const readout = one('[data-current-loss]');
    if (!readout) return fail(name, '[data-current-loss] is missing next to the slider');

    const startValue = String(slider.value);
    const min = Number.isFinite(Number(slider.min)) ? String(slider.min) : '0';
    const max = Number.isFinite(Number(slider.max)) ? String(slider.max) : startValue;
    if (Number(min) === Number(max)) return pass(name, 'slider has a single stop — nothing to recompute');

    const nextValue = startValue === max ? min : max;
    const beforeAttr = readout.getAttribute('data-current-loss');
    const beforeText = textOf(readout);

    let changed = false;
    let afterText = beforeText;
    try {
      slider.value = nextValue;
      dispatchInput(slider);
      afterText = textOf(readout);
      changed = readout.getAttribute('data-current-loss') !== beforeAttr || afterText !== beforeText;
    } finally {
      slider.value = startValue;
      dispatchInput(slider);
      if (readout.getAttribute('data-current-loss') !== beforeAttr || textOf(readout) !== beforeText) {
        if (beforeAttr !== null) readout.setAttribute('data-current-loss', beforeAttr);
        readout.textContent = beforeText;
      }
    }

    if (!changed) {
      return fail(name, 'moving the slider from ' + startValue + ' to ' + nextValue + ' left [data-current-loss] at ' + beforeText);
    }
    return pass(name, 'month ' + startValue + ' → ' + nextValue + ' changed the readout to ' + afterText);
  }

  function checkClauses() {
    const name = CHECKS[4];
    const verified = all('.cite-chip[data-verified="true"]');
    const pills = all('.statute-pill[data-rule-id]').filter((pill) => {
      return String(pill.getAttribute('data-rule-id') || '').trim().length > 0;
    });
    if (!verified.length && !pills.length) {
      return fail(name, 'no .cite-chip[data-verified="true"] and no .statute-pill[data-rule-id] rendered');
    }
    if (!verified.length) return fail(name, 'no .cite-chip[data-verified="true"] — no verified excerpt is on screen');
    if (!pills.length) return fail(name, 'no .statute-pill[data-rule-id] — no rule citation is on screen');
    return pass(name, verified.length + ' verified excerpt(s), ' + pills.length + ' rule pill(s)');
  }

  function checkDisclaimer() {
    const name = CHECKS[5];
    const el = one('.disclaimer');
    if (!el) return fail(name, '.disclaimer is missing — the permanent disclaimer did not render');
    if (!isVisible(el)) return fail(name, '.disclaimer exists but is not visible');
    return pass(name, 'permanent disclaimer is visible');
  }

  function checkCopy() {
    const name = CHECKS[6];
    const d = doc();
    if (!d || !d.body) return fail(name, 'document.body is unavailable');
    const text = String(d.body.textContent || '');
    if (FORBIDDEN.test(text)) {
      return fail(name, 'banned anti-liability wording appears in the page copy — use calm, neutral phrasing');
    }
    return pass(name, 'page copy is free of banned anti-liability wording');
  }

  function checkOverflow() {
    const name = CHECKS[7];
    const d = doc();
    const w = win();
    const root = d && d.documentElement;
    if (!root) return fail(name, 'document.documentElement is unavailable');
    const viewport = w && Number.isFinite(w.innerWidth) ? w.innerWidth : 0;
    if (!viewport) return fail(name, 'window.innerWidth is unavailable — cannot measure the viewport');
    const scrollWidth = Number(root.scrollWidth) || 0;
    if (scrollWidth > viewport + 1) {
      return fail(name, 'content is ' + scrollWidth + 'px wide at a ' + viewport + 'px viewport — horizontal scroll');
    }
    return pass(name, 'content ' + scrollWidth + 'px fits the ' + viewport + 'px viewport');
  }

  const RUNNERS = [
    checkPiiCount,
    checkScore,
    checkBullets,
    checkWayOut,
    checkClauses,
    checkDisclaimer,
    checkCopy,
    checkOverflow,
  ];

  function run() {
    const d = doc();
    if (!d || typeof d.querySelector !== 'function' || !d.body) {
      return CHECKS.map((name) => fail(name, 'no document'));
    }
    return CHECKS.map((name, i) => {
      try {
        const result = RUNNERS[i]();
        if (result && typeof result === 'object') return { name, pass: result.pass === true, detail: String(result.detail || '') };
        return fail(name, 'check returned no result');
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return fail(name, 'check threw: ' + message);
      }
    });
  }

  function buildPanel() {
    const d = doc();
    const el = d.createElement('div');
    el.className = 'selftest-panel';
    el.id = 'selftest-panel';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;

    const head = d.createElement('div');
    head.className = 'selftest-head';

    const title = d.createElement('p');
    title.className = 'selftest-title';
    title.textContent = 'Smoke test self-check';

    const close = d.createElement('button');
    close.type = 'button';
    close.className = 'selftest-close';
    close.setAttribute('aria-label', 'Close self-check');
    close.setAttribute('data-selftest-close', '');
    close.textContent = '\u00D7';
    close.addEventListener('click', () => {
      el.hidden = true;
    });

    head.appendChild(title);
    head.appendChild(close);

    const summary = d.createElement('p');
    summary.className = 'selftest-summary';

    const list = d.createElement('ul');
    list.className = 'selftest-list';

    el.appendChild(head);
    el.appendChild(summary);
    el.appendChild(list);

    return { el, summary, list };
  }

  function paint(results) {
    const d = doc();
    if (!d || typeof d.createElement !== 'function') return;
    if (!ui) {
      const host = d.body;
      if (!host) return;
      ui = buildPanel();
      host.appendChild(ui.el);
    }

    const passed = results.filter((r) => r.pass).length;
    const failures = results.filter((r) => !r.pass);

    ui.summary.textContent = (failures.length ? 'FAIL ' : 'PASS ') + passed + '/' + results.length;
    ui.summary.setAttribute('data-tone', failures.length ? 'warn' : 'ok');

    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);

    if (!failures.length) {
      const li = d.createElement('li');
      li.className = 'selftest-row';
      li.setAttribute('data-pass', 'true');
      li.textContent = 'All checks passed — safe to demo.';
      ui.list.appendChild(li);
    } else {
      failures.forEach((item) => {
        const li = d.createElement('li');
        li.className = 'selftest-row';
        li.setAttribute('data-pass', 'false');
        li.textContent = item.name + ' — ' + item.detail;
        ui.list.appendChild(li);
      });
    }

    ui.el.hidden = false;
  }

  function mount() {
    if (mounted) return { mount, run };
    const d = doc();
    if (!d || typeof d.createElement !== 'function' || !d.body) return { mount, run };
    mounted = true;

    const button = d.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip selftest-toggle';
    button.setAttribute('data-selftest-run', '');
    button.setAttribute('aria-controls', 'selftest-panel');
    button.textContent = 'Run self-check';
    button.addEventListener('click', () => {
      const results = run();
      paint(results);
      if (c.emit) {
        const passed = results.filter((r) => r.pass).length;
        try {
          c.emit('selftest', { passed, total: results.length, results });
        } catch (err) {
          void err;
        }
      }
    });

    const footer = one('.app-footer');
    (footer || d.body).appendChild(button);

    return { mount, run };
  }

  return { mount, run };
}
