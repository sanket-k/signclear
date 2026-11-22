# DESIGN_SYSTEM.md — SignClear

> Implementation spec for Phase 5 (`public/styles/tokens.css` + `public/styles/app.css` + `index.html`).
> **`AGENTS.md` §4–§5 wins every conflict in this file.** Tokens are the only place colors, sizes and
> durations are defined. `app.css` must contain **zero** raw hex values, `px` font sizes, or `ms` durations.

**Non-negotiables repeated here so app.css cannot drift:**
zero-build vanilla CSS · no Tailwind/React · primary is Trust Indigo `#1D4ED8` · mobile = card feed + 62px sticky bar (no stacked sheets) · desktop = 3 view modes with Split 48/52 · max 3 primary tabs · clause-level playlist (no word karaoke).

---

## 1. Design tokens — `public/styles/tokens.css`

### 1.1 File shape

```css
/* tokens.css — the ONLY file with literals. */
:root { /* color, type, space, radius, shadow, motion, layout */ }
[data-theme="dark"] { /* dark overrides only */ }
@media (prefers-reduced-motion: reduce) { :root { /* motion overrides */ } }
@media (min-width: 900px) { :root { /* desktop type + layout overrides */ } }
```

Theme switch is a single attribute on `<html>`: `document.documentElement.dataset.theme = 'light' | 'dark'`.
Default = **light** (no attribute ⇒ light). Toggle persists to `localStorage['sc.theme']`; first run honours `matchMedia('(prefers-color-scheme: dark)')`.

### 1.2 Color — brand and surface

| Token | Light | Dark | Rule |
|---|---|---|---|
| `--primary` | `#1D4ED8` | `#1D4ED8` | Trust Indigo. **Never** orange/amber as primary. Fills, active tab, primary CTA. |
| `--primary-hover` | `#1E40AF` | `#1E40AF` | Pressed/hover fill. |
| `--primary-soft` | `#EFF3FF` | `#16223A` | Selected-row / tab-indicator background. |
| `--primary-ink` | `#1D4ED8` | `#8FB0FF` | Primary-colored **text** (links, counts). Lightened on dark for ≥4.5:1. |
| `--on-primary` | `#FFFFFF` | `#FFFFFF` | Text on `--primary` fills. |
| `--bg` | `#F7F8FA` | `#0B1220` | App canvas. |
| `--surface` | `#FFFFFF` | `#111A2B` | Cards, sheets, sticky bar. |
| `--surface-2` | `#F1F3F7` | `#16223A` | Insets, code, slider track. |
| `--border` | `#E2E6EE` | `#25344F` | 1px hairlines. |
| `--text` | `#0F172A` | `#E6EAF2` | Body text. |
| `--text-muted` | `#5B6478` | `#9AA6BC` | Labels, captions. |
| `--focus-ring` | `#1D4ED8` | `#8FB0FF` | `:focus-visible` outline only. |
| `--scrim` | `rgb(15 23 42 / .45)` | `rgb(0 0 0 / .6)` | `<dialog>::backdrop`. |

**Banned:** amber/orange anywhere in the primary path (tabs, CTA, active state, slider thumb). Amber is *reserved* for honest-gap signals (§7).

### 1.3 Color — severity triplets

Every severity has exactly three tokens: `-fg` (text + icon), `-bg` (tint), `-border`.

| Severity | Tokens | Light `fg / bg / border` | Dark `fg / bg / border` | Meaning |
|---|---|---|---|---|
| `critical` | `--sev-critical-*` | `#B42318` / `#FEF3F2` / `#FDA29B` | `#FDA29B` / `#3B1219` / `#7A271A` | **Red.** Statutory conflict, materially one-sided. |
| `caution` | `--sev-caution-*` | `#B54708` / `#FFFAEB` / `#FEC84B` | `#FEC84B` / `#3B2A08` / `#7A4F10` | **Amber.** Above local norm / missing protection / incomplete scan. |
| `standard` | `--sev-standard-*` | `#05603A` / `#F3FAF7` / `#A6F4C5` | `#A6F4C5` / `#10261C` / `#1E6B47` | **Emerald (muted).** Acceptable, within norm. |
| `safe` | `--sev-safe-*` | `#067647` / `#ECFDF3` / `#6CE9A6` | `#6CE9A6` / `#0F2E22` / `#1E6B47` | **Emerald (strong).** Protects the signer. |

- Severity is data-driven, never hand-set: `article.clause-card[data-severity="critical"]` maps to the triplet.
- `standard` and `safe` are both emerald-family; `standard` is desaturated so it never reads as a win.
- **Color is never the only signal**: every severity element also carries an icon glyph from the sprite (`#i-alert`, `#i-caution`, `#i-check`, `#i-shield`) plus text (`Statutory Conflict` / `Above Local Norm` / `Standard`).

### 1.4 Type

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans",
             "Noto Sans Kannada", "Noto Sans Devanagari", "Noto Sans Tamil", sans-serif;
--font-serif: "Source Serif 4", Georgia, "Noto Serif", serif;   /* contract body only */
--font-mono: ui-monospace, "SF Mono", Menlo, monospace;         /* OCR digits, ₹ debugging */
```

| Token | Light default | `≥900px` | Use |
|---|---|---|---|
| `--fs-xs` | `12px` / `1.35` | same | Badge text, disclaimers, stepper counts |
| `--fs-sm` | `13px` / `1.45` | same | Labels, tab captions, muted meta |
| `--fs-body` | `15px` / `1.55` | **`16px`** / `1.55` | Paragraphs, clause body, buttons |
| `--fs-lg` | `18px` / `1.4` | `19px` | Card titles |
| `--fs-xl` | `22px` / `1.3` | `24px` | Section headings, score label |
| `--fs-2xl` | `28px` / `1.2` | `32px` | Hero heading |
| `--fs-score` | `40px` / `1.05`, `tabular-nums`, `650` | `48px` | Risk score numeral |
| `--fs-contract` | **`16px` / `1.7`** | **`16px` / `1.7`** | Contract sheet (serif) — fixed in both modes |
| `--fw-regular` `400` · `--fw-medium` `500` · `--fw-semibold` `600` | | | No 700+ except `--fs-score`. |
| `--measure` | `68ch` | `72ch` | Max line length for prose/contract. |

Rules: body copy is **15–16px, never smaller**; contract text is **always** `var(--font-serif)` at `var(--fs-contract)`; ₹ amounts and OCR digits use `font-variant-numeric: tabular-nums`; Indic scripts inherit `--font-sans` (never a Latin-only stack).

### 1.5 Space, radius, shadow, motion, layout

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px; --sp-16: 64px;

--r-sm: 6px;   /* chips, badges */
--r-md: 10px;  /* cards, inputs */
--r-lg: 14px;  /* sheets, dialogs, contract panel */
--r-pill: 999px; /* tabs, language pill, sticky-bar buttons */

--sh-1: 0 1px 2px rgb(15 23 42 / .06);                     /* hairline lift */
--sh-2: 0 4px 14px rgb(15 23 42 / .10);                    /* cards, sticky bar */
--sh-3: 0 18px 48px rgb(15 23 42 / .22);                   /* dialogs, Ask drawer */

--dur-fast: 120ms;  --dur-med: 240ms;  --dur-pulse: 1100ms; /* §6 pulse — do not change */
--ease-out: cubic-bezier(.2, .7, .3, 1);

--bp: 900px;            /* documentation only — write literals in @media (min-width: 900px) */
--sticky-bar-h: 62px;   /* content box height, excluding safe-area inset */
--split-left: 48%;
--split-right: 52%;
--tabbar-h: 56px;
--safari-safe-bottom: max(0px, env(safe-area-inset-bottom));
--safari-safe-top: max(0px, env(safe-area-inset-top));
```

**Reduced motion** (mandatory block, no exceptions):

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 1ms; --dur-med: 1ms; --dur-pulse: 1ms; }
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  .clause-active { box-shadow: inset 3px 0 0 var(--primary); } /* static marker replaces the pulse */
}
```
JS must read the same query: `const RM = matchMedia('(prefers-reduced-motion: reduce)').matches` →
`scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' })`. The 1100ms dim window and
`data-state` bookkeeping still run — only the animation is suppressed.

### 1.6 Inline SVG sprite convention

- One `<svg aria-hidden="true" class="sprite" width="0" height="0">` as the **first child of `<body>`** in `index.html`, containing `<symbol id="i-…" viewBox="0 0 24 24">`. No icon fonts, no icon CDN, no external `.svg` requests.
- Use: `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-play"/></svg>`.
  Icon-only buttons supply the name elsewhere: `aria-label="Play 60 second walkthrough"`.
- `.icon { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }` — icons inherit severity/text color; never hard-code `fill`.
- Required symbol ids: `i-play`, `i-pause`, `i-mic`, `i-alert`, `i-caution`, `i-check`, `i-shield`, `i-lock`, `i-camera`, `i-file`, `i-copy`, `i-whatsapp`, `i-mail`, `i-qr`, `i-close`, `i-slider`, `i-clock`, `i-rupee`, `i-chevron`.

---

## 2. Responsive — single 900px breakpoint

One breakpoint only: **`@media (min-width: 900px)`**. Everything below is mobile; no `768px`, no `1024px` variants, no `hover`-only affordances.

| | **Mobile `<900px`** | **Desktop `≥900px`** |
|---|---|---|
| Layout | Single-column **card feed**, vertical scroll | `[Report \| Split \| Contract]` view switch |
| Default view | Feed | **Split**, 48% left / 52% right |
| Split columns | — | Left `--split-left`: tab rail (`Understand`/`Negotiate`/`Document / Ask`); Right `--split-right`: serif contract sheet. `grid-template-columns: 48% 52%` inside `max-width: 1440px` centred shell. |
| Clause navigation | Tap card → in-feed inspector (expands in place) | Click clause in list → highlight + scroll in contract column; scroll-synced via `data-clause-id` |
| Sheets | **No stacked sheets, no bottom sheet, no modal stack.** One surface at a time. | Ask is a floating panel; QR is a `<dialog>` |
| Persistent action | `.sticky-bar` — 62px, `position: sticky; bottom: 0` | Floating **Ask** pill, bottom-right `--sp-6` inset |
| Ask | `Hold to Ask` inside sticky bar | Floating Ask button opens `.ask-drawer` |
| Zoom | `viewport: width=device-width, initial-scale=1, viewport-fit=cover`, **zero pinch-zoom required**: no fixed widths >100%, no `font-size < 15px`, tap targets ≥44×44px | Same |

**Mobile sticky bar** — `.sticky-bar`:

```css
.sticky-bar {
  position: sticky; bottom: 0; z-index: 40;
  height: calc(var(--sticky-bar-h) + var(--safari-safe-bottom));
  padding-bottom: var(--safari-safe-bottom);          /* iPhone home-bar inset */
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2);
  background: var(--surface); border-top: 1px solid var(--border); box-shadow: var(--sh-2);
}
```
- Exactly **two** controls, equal width: `.btn-play-60` (`Play 60s`, `#i-play`, `--primary` fill) and `.btn-hold-ask` (`Hold to Ask`, `#i-mic`, `--surface-2` fill, `pointerdown`/`pointerup` capture ≤30s).
- The feed scroll container gets `padding-bottom: calc(var(--sticky-bar-h) + var(--safari-safe-bottom) + var(--sp-4))` so the last card is never occluded.
- `@media (min-width: 900px) { .sticky-bar { display: none; } }`

---

## 3. Navigation — max 3 primary tabs

| Tab id | Label (verbatim) | Owns |
|---|---|---|
| `understand` | `Understand` | Score, ₹Exposure, 3 bullets, Way-Out slider, clause list |
| `negotiate` | `Negotiate` | Checkbox asks, `Polite`/`Firm`, `WhatsApp`/`Email`, Pre-Sign Brief |
| `document` | `Document / Ask` | Contract sheet, `Original Scan` toggle, Ask drawer (desktop) |

- Markup: `.tabbar[role="tablist"]` + `.tab[role="tab"][aria-selected][data-tab]` + `.tabpanel[role="tabpanel"][data-tab-panel]`. `--primary` indicator underline on the selected tab; `--text-muted` otherwise.
- **Hard cap: 3.** History/Vault is a drawer opened from a header icon (`.vault-drawer`), never a fourth tab. Language is a pill (`.lang-pill`) in the header, never a tab. Settings is one theme toggle button.
- Mobile: same 3 tabs as a segmented control at the top of the feed (`.tabbar` becomes `position: sticky; top: 0; height: var(--tabbar-h)`).

---

## 4. Hero layout — fixed order

The Understand view renders these blocks **in this exact order and count**. No insertions, no reordering, no 4th bullet.

| # | Block | Class / hook | Spec |
|---|---|---|---|
| 1 | Score + ₹Exposure | `.hero-score` `[data-score]`, `.hero-exposure` `[data-exposure-inr]` | Score `--fs-score` in a `.score-dial`; severity tint by band (`critical` 0–39, `caution` 40–69, `safe` 70–100). Exposure: `₹` + Indian grouping (`1,40,000`), `--fs-xl`, `--sev-caution-fg` if > 0. Two numbers side by side, stacked under 380px. |
| 2 | **Exactly 3** bullets | `.hero-bullets > li` (assert `length === 3`) | ≤14 words each, each tagged with a severity chip + `data-clause-id`. Renderer takes top 3 by severity rank then rupee impact. If fewer than 3 real findings: fill with `Standard`-severity facts (never fabricate, never pad to 4). |
| 3 | Way-Out slider | `.wayout` `.wayout-slider[type=range]` `[data-wayout-month]`, `.wayout-readout` | One slider = exit month (1…term). Readout shows *current* vs *negotiated* rupee loss + `₹ saved` delta, computed in `verifier.js`. `--primary` thumb/track; the saved delta uses `--sev-safe-fg`. `aria-valuetext` = the rupee sentence. |
| 4 | Top 3–5 clauses | `.clause-list > .clause-card[data-clause-id][data-severity]` | **Min 3, max 5** visible (`slice(0,5)`); a `.clause-list-more` link opens the full list. Each card: severity icon + title + `✓ Verified excerpt` + pinned `rule_id` badge. |
| 5 | Disclaimer | `.disclaimer` | Permanent, always the last block of the Understand view (§7.4). |

---

## 5. Clause focus-dimming (audio sync)

Clause-level playlist only. **Word-level karaoke is forbidden** (§7 cutline) — there is no
`data-word-index`, no per-word span, no `requestAnimationFrame` text highlighting anywhere.

State contract (driven by `public/js/audio-sync.js`, styled by `app.css`):

| Moment | DOM effect | Duration |
|---|---|---|
| `onplay` of clause *N* | `clause.classList.add('clause-active')`, `setAttribute('data-state','active')` on `[data-clause-id="N"]` (both card **and** contract block); `smooth-scroll` to it | immediate |
| Simultaneous | Every other `[data-clause-id]` gets `.clause-dim` → `opacity: .18` | `--dur-med` in, held |
| Pulse | `.clause-active` runs `sc-pulse` (ring + `--primary-soft` wash) | **1100ms** (`--dur-pulse`), once |
| `onpause` / `ended` | `.clause-active` removed after the 1100ms window; `.clause-dim` removed → opacity returns to `1` | `--dur-med` |

```css
.clause-card, .clause-block { transition: opacity var(--dur-med) var(--ease-out), box-shadow var(--dur-med) var(--ease-out); }
.clause-dim { opacity: .18; pointer-events: none; }
.clause-active { animation: sc-pulse var(--dur-pulse) var(--ease-out) 1; box-shadow: inset 3px 0 0 var(--primary); }
@keyframes sc-pulse {
  0%   { box-shadow: 0 0 0 0 rgb(29 78 216 / .45), inset 3px 0 0 var(--primary); }
  60%  { box-shadow: 0 0 0 8px rgb(29 78 216 / 0),  inset 3px 0 0 var(--primary); }
  100% { box-shadow: 0 0 0 0 rgb(29 78 216 / 0),    inset 3px 0 0 var(--primary); }
}
```
- Exactly **one** `.clause-active` at a time (audio-sync clears before setting).
- `.clause-dim` must be removed on `ended`, on tab switch, and on `Escape`; a permanently dimmed feed is a bug.
- Tap-the-dimmed-card on mobile clears the dim immediately (never trap the user).
- Playlist items: `.playlist-item[data-clause-id][data-state="idle|playing|done"]`.
- Every play is user-gesture initiated; `speechSynthesis` fallback uses the same state calls, so dimming/pulse behaves identically with no `/api/tts`.

---

## 6. Live Telemetry Stepper (`M3` / `D2`)

Mandatory on both breakpoints. Same state machine, two layouts. Shows **real counts only** — no fake progress, no indeterminate spinners with invented percentages.

| Stage `data-stage` | Label (verbatim) | Real count source |
|---|---|---|
| `scan` | `Scan` | pages / images processed, `KB` after compression, blur verdict |
| `shield` | `Shield` | PII tokens masked by type (Aadhaar, PAN, +91, email, UPI, headers) — `0 sent` |
| `ground` | `Ground` | clauses found, findings, `✓ Verified` count, pack id |
| `speak` | `Speak` | clauses scripted / total, language code (KN/HI/TA/EN) |

| Variant | Layout | When |
|---|---|---|
| **`data-variant="M3"`** | 3 visible rows: `Prep` (merges `scan`+`shield`), `Ground`, `Speak`. Stacked, `--fs-sm`, counts right-aligned, bar per row. | `<900px` |
| **`data-variant="D2"`** | 2 rows: row 1 = horizontal 4-node track (`scan → shield → ground → speak`); row 2 = live counters + `Cancel`. | `≥900px` |

```html
<section class="stepper" data-variant="M3" data-state="running" aria-live="polite" aria-busy="true">
  <ol class="stepper-steps">
    <li class="stepper-step" data-stage="scan"   data-state="done">…<span class="stepper-count" data-count="pages">2</span></li>
    <li class="stepper-step" data-stage="shield" data-state="running">…</li>
    <li class="stepper-step" data-stage="ground" data-state="pending">…</li>
  </ol>
  <button class="stepper-cancel" type="button">Cancel</button>
</section>
```

- `[data-stage][data-state]`: `pending` (muted, hollow dot) · `running` (`--primary` dot, animated bar — static under reduced motion) · `done` (`--sev-safe-fg`, `#i-check`) · `error` (`--sev-critical-*`) · `cancelled` (muted, `#i-close`).
- **Cancel is real**: `new AbortController()` per run; every `fetch` receives `{ signal }`; the button does `ctrl.abort()` and sets `data-state="cancelled"`. Aborted runs render `Stopped — nothing was uploaded` for `scan`/`shield` and `Stopped before audit` for later stages. No `setTimeout` theatre, no cancel that keeps the request alive.
- Cancel button is `--sp-1`-bordered, 44px min height, never disabled while `running`, hidden when `done`/`error`.
- The stepper is the only progress UI; it replaces every skeleton/spinner. It announces count changes via `aria-live="polite"` on the count node only (not the whole section).

---

## 7. Honesty surfaces, privacy badges, anti-liability copy

### 7.1 Completeness / gap banner (amber)

```html
<div class="gap-banner" role="status" data-gap="clause_4->7">
  <svg class="icon"><use href="#i-caution"/></svg>
  <p><strong>Incomplete scan.</strong> We found Clause 4 → 7. Pages may be missing.</p>
  <button class="gap-action" type="button">Review original</button>
</div>
```
| Property | Value |
|---|---|
| Colors | `--sev-caution-fg` text, `--sev-caution-bg` fill, `--sev-caution-border` border, `1px` left border `4px` |
| Position | Directly above the clause list, below the hero bullets; also pinned at the top of the contract column on desktop |
| Triggers | OCR page gap, `[ILLEGIBLE]` span present, `completeness.complete === false`, unknown pack ⇒ adds a second line `Pan-India General Norms Only` |
| Never | Dismissible into silence — collapse is allowed but a `.gap-chip` with the same amber triplet must remain visible next to the score |
| Accessible | `role="status"` (not `alert`), icon + text, never color-only |

`[ILLEGIBLE]` refusal copy (verbatim): `This part of the page is unreadable. We won't guess. Tap Original Scan to check.` — paired with `.original-scan-toggle` (`aria-pressed`).

### 7.2 PII shield badges

| Lane | Badge (verbatim, incl. emoji) | Classes | Colors |
|---|---|---|---|
| A — vector PDF | `🟢 Local PII Shield` | `.pii-badge[data-lane="A"]`, `.pii-popover[data-pii-type]` | `--sev-safe-fg` / `--sev-safe-bg` / `--sev-safe-border` |
| B — photo/scan | `🟡 Image Mode · EXIF stripped · Zero-retention` | `.pii-badge[data-lane="B"]` | `--sev-caution-fg` / `--sev-caution-bg` / `--sev-caution-border` |

- Lane A popover lists **real counts per token type** (`Aadhaar 2 · PAN 1 · +91 3 · email 1 · UPI 1 · headers 2`) and the line `Cities and states are never masked.`
- Fail-closed state: `.pii-badge[data-state="blocked"]` turns `--sev-critical-*` and the upload CTA is disabled with copy `We found a document identifier we cannot safely mask. Nothing was uploaded.`
- Badges sit **above the upload CTA** and remain visible in the report header, so the claim is auditable at demo time.

### 7.3 Anti-liability copy rules (non-negotiable)

| Never render | Use instead |
|---|---|
| `Illegal` / `Unlawful` / `Void contract` | `Statutory Conflict` |
| `Sue` / `Court case` / `Claim damages` | `Ask for a change` / `Request a revision` |
| `AI Lawyer` / `Legal advice` / `Guaranteed` | `Clause check` / `Clarity, not counsel` / `Typical practice` |
| `You will win` | `Many agreements set this at 15–30 days` |

Verdict labels are a closed set mapped from `basis_type`: `statutory_conflict → Statutory Conflict` (critical/red) · `above_local_norm → Above Local Norm` (caution/amber) · `missing_protection → Missing Protection` (caution/amber) · `standard → Standard` (emerald). No free-text verdict strings in the renderer.

**Permanent disclaimer** — `.disclaimer`, last element of every view and every exported Pre-Sign Brief, `--fs-xs`, `--text-muted`, never collapsed, never truncated:

> SignClear explains agreements in plain language and flags clauses that commonly deviate from Indian norms. It is not legal advice and it is not a law firm. Always read the original agreement before signing.

### 7.4 Quotes and OCR digits

- `✓ Verified excerpt` chip (`.cite-chip[data-verified="true"]`) only when Jaccard ≥ 0.80; unmatched quotes are dropped by `verifier.js` and must have no CSS class at all (no `data-verified="false"` styling path).
- OCR-sourced digits: `<span class="ocr-digit" data-verify-ocr="cl3:deposit">₹1,40,000</span>` → `border-bottom: 1px dashed var(--sev-caution-border); font-family: var(--font-mono);` and `--verify-ocr-*` custom properties (`--verify-ocr-bg`, `--verify-ocr-border`) defined in `tokens.css` so both themes restyle in one place. Every `.ocr-digit` toggles `.original-scan-toggle` to its page.
- Statute pills render **only** when `rule_id` exists in the active pack; the CSS has no styling for an un-pinned citation because the element is never created.

**Token naming rule for `--verify-ocr-*`:** one triplet per theme, no component-local overrides —
`--verify-ocr-bg`, `--verify-ocr-border`, `--verify-ocr-underline`.

---

## 8. Overlays, focus, accessibility

### 8.1 Mobile QR modal — native `<dialog>`

```html
<dialog class="qr-dialog" id="qr-dialog" aria-labelledby="qr-title"> … <img class="qr-img" alt="QR code to open SignClear on your phone"> <button class="qr-close">Close</button> </dialog>
```
- `showModal()` / `close()`. No custom overlay divs, no focus-trap JS (the platform provides it), no `z-index` stacking war.
- `::backdrop { background: var(--scrim); }`; panel `--surface`, `--r-lg`, `--sh-3`, max `min(92vw, 420px)`.
- Close on: `Close` button, `Escape` (native), and a click whose target is the `<dialog>` itself (backdrop).
- Content: QR encoding the same-origin URL (current preset deep-link if any), the deployed URL in `--font-mono` for typos, and one line: `Scan to run the same flow on your phone.`
- Desktop entry point: header `Mobile QR` button (`#i-qr`). Hidden on mobile (`QR is for the projector`).
- Dark-mode-safe QR: white `#FFFFFF` quiet-zone card behind the code in both themes — never invert a QR.

### 8.2 Floating Ask (desktop) & Hold to Ask (mobile)

- Desktop: `.ask-fab` (`--primary` fill, `#i-mic`, `aria-expanded`), bottom-right, `--r-pill`, `--sh-3`, ≥44px. Opens `.ask-drawer` — a right-side panel (`width: clamp(320px, 32vw, 420px)`, `--surface`, `--sh-3`) that **pushes nothing** and closes on `Escape`/`aria-expanded=false`.
- Ask results land as `.ask-card[data-clause-id]` pinned in the drawer, with a `Jump to clause` action that reuses the §5 pulse + dim.
- Mobile: no drawer. `Hold to Ask` in the sticky bar records while held (`.btn-hold-ask[data-state="recording"]`, ring at `--dur-fast`), releases at ≤30s, and the answer renders as a card in the feed. **No stacked sheets.**
- Text-only fallback (`.ask-card-fallback`) is styled identically — TTS failure must never look like an error state.

### 8.3 Focus, keyboard, semantics

```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--r-sm); }
:focus:not(:focus-visible) { outline: none; }
```
| Requirement | Spec |
|---|---|
| Targets | ≥44×44px interactive; ≥8px spacing between adjacent targets |
| Landmarks | `<header>`, `<main>`, `<nav aria-label="Primary">`, `<footer>`; one `<h1>` (app name) |
| Tabs | Full ARIA tabs pattern: `role`, `aria-selected`, `aria-controls`, ←/→ moves, `Home`/`End` |
| Live regions | `aria-live="polite"` for stepper counts, gap banner, Ask answer, copy confirmation |
| Images | `alt` on scan thumbs (`Original scan of page 2`); decorative icons `aria-hidden` |
| Contrast | All text ≥4.5:1; severity chips use `-fg` on `-bg` (verified pairs above) |
| Zoom | 200% reflow with no horizontal scroll; nothing positioned only by `transform` |
| Reduced motion | §1.5 block + JS `scrollIntoView` branch |
| Dark mode | Every surface token has a dark value; **no** component-level dark overrides |

---

## 9. Component inventory (Phase 5+ implement these names verbatim)

| Component | Root selector | Data attributes / states | Owner |
|---|---|---|---|
| App shell | `.app-shell` | `data-view="feed\|report\|split\|contract"` | Phase 5 |
| Header | `.app-header` | `.brand`, `.lang-pill[data-lang="kn\|hi\|ta\|en"]`, `.theme-toggle`, `.qr-open`, `.vault-open` | Phase 5 |
| Tabs (max 3) | `.tabbar` / `.tab` / `.tabpanel` | `data-tab="understand\|negotiate\|document"`, `aria-selected` | Phase 5 |
| Upload / intake | `.intake` | `data-lane="A\|B"`, `.drop-zone`, `.camera-input[capture="environment"]`, `.preset-chip[data-preset="blr-rental\|rbi-loan\|startup-offer\|missing-page-3"]` | Phase 4 |
| PII badge | `.pii-badge` | `data-lane`, `data-state="ok\|blocked"`, `.pii-popover[data-pii-type]` | Phase 4 |
| Telemetry stepper | `.stepper` | `data-variant="M3\|D2"`, `data-state`, `.stepper-step[data-stage][data-state]`, `.stepper-count[data-count]`, `.stepper-cancel` | Phase 4 |
| Gap banner | `.gap-banner` | `data-gap="clause_4->7"`, `.gap-chip`, `role="status"` | Phase 4 |
| Hero score | `.hero` `.hero-score` `.score-dial` | `data-score`, `data-band="critical\|caution\|safe"` | Phase 5 |
| Rupee exposure | `.hero-exposure` | `data-exposure-inr`, `data-currency="INR"` | Phase 5 |
| Bullets (exactly 3) | `.hero-bullets > li` | `data-clause-id`, `data-severity` | Phase 5 |
| Way-Out slider | `.wayout` `.wayout-slider` `.wayout-readout` | `data-wayout-month`, `data-current-loss`, `data-negotiated-loss`, `aria-valuetext` | Phase 5 |
| Clause card | `.clause-card` | `data-clause-id`, `data-severity`, `data-state="idle\|active\|done"` | Phase 5 |
| **Clause focus-dimming** | `.clause-active` / `.clause-dim` / `[data-clause-id]` | `.clause-active` (1100ms pulse), `.clause-dim` (opacity .18) | Phase 6 |
| Clause inspector | `.clause-inspector` | `data-clause-id`, `.cite-chip[data-verified]`, `.statute-pill[data-rule-id]` | Phase 5 |
| Contract sheet | `.contract-sheet` | `data-pack-id`, `.clause-block[data-clause-id]`, `.ocr-digit[data-verify-ocr]`, `--verify-ocr-*` | Phase 5 |
| Original scan toggle | `.original-scan-toggle` | `aria-pressed`, `data-page` | Phase 4 |
| Playlist | `.playlist` `.playlist-item` | `data-clause-id`, `data-state="idle\|playing\|done"` | Phase 6 |
| Sticky bar (mobile) | `.sticky-bar` | `.btn-play-60`, `.btn-hold-ask[data-state="idle\|recording\|sending"]` | Phase 5 |
| Floating Ask | `.ask-fab` `.ask-drawer` `.ask-card` | `aria-expanded`, `data-open`, `data-clause-id`, `.ask-card-fallback` | Phase 6 |
| Negotiate | `.negotiate` `.ask-checkbox[data-rule-id]` `.tone-switch[data-tone="polite\|firm"]` `.channel-pill[data-channel="whatsapp\|email"]` `.draft-preview` | `aria-checked` | Phase 7 |
| Vault drawer | `.vault-drawer` `.vault-item` | `data-doc-id`, `data-saved="true\|false"` | Phase 7 |
| QR modal | `.qr-dialog` (`<dialog>`) `.qr-img` `.qr-close` | `::backdrop`, native `Esc` | Phase 5 |
| Toast / copy confirm | `.toast` | `role="status"`, `data-tone="ok\|warn"` | Phase 5 |
| Disclaimer | `.disclaimer` | always visible | Phase 5 |
| Icons | `.icon` + `#i-*` symbols | `.sprite` | Phase 5 |

**Definition of done for Phase 5:** `grep -nE '#[0-9a-fA-F]{3,8}|[0-9]+px' public/styles/app.css` returns zero color/size literals outside `tokens.css`; `mock-audit.json` renders at 390×844 with no pinch-zoom and no stacked sheets, and at 1440×900 with Split at 48/52.
