# SignClear — The 7 Smoke Tests

Canonical demo-critical checks. Replaces the missing PRD §13.2. Derived from PRD §8.

**Run every test twice:**
- **Desktop** — 1440×900, `Split` view default, projector.
- **Phone** — real device, opened by scanning the `Mobile QR` modal on the deployed URL.

**Rule:** 5 of 7 passing still wins. Each test lists its fallback so a live failure never stops the demo.

---

## 1. PII token count visible pre-upload

**Goal:** Prove the Local PII Shield counts and masks tokens *before* any byte leaves the device.

**Preconditions:** `LLM_PROVIDER` set (default `openrouter`). Lane A vector PDF fixture with a known Aadhaar, PAN, `+91` number, email, UPI ID, and two party-name headers. DevTools Network panel open.

**Steps:**
1. Drag the PDF onto the drop zone (desktop) or tap the file input (phone).
2. Watch the telemetry stepper reach the PII stage — do **not** press `Cancel`.
3. Confirm `🟢 Local PII Shield` badge renders with a token count.
4. Tap/click the badge to open the token-type popover.
5. In Network, confirm the `/api/audit` request has not fired yet.
6. Optionally swap in a fixture with an unmaskable hit and re-run.

**Pass criteria:**
- Popover lists each type with a real count (e.g. `Aadhaar ×1`, `PAN ×1`, `+91 ×1`, `Email ×2`, `UPI ×1`, `Party header ×2`) — none hardcoded.
- Count is on screen before the first outbound request.
- Cities/states (`Bengaluru`, `Karnataka`) are **not** flagged.
- Fail-closed case: `safeToSend: false` blocks upload with an explicit on-screen message.

**Fallback:** If the popover misbehaves, show the `🟢 Local PII Shield` badge plus the token count line and narrate "counted locally, nothing sent." Lane B path still demos the `🟡 Image Mode · EXIF stripped · Zero-retention` badge as the privacy story.

---

## 2. BLR preset → Kannada audio plays, Clause 3 pulses, others dim

**Goal:** The hero 60-second walkthrough in Kannada, clause-synced.

**Preconditions:** `BLR Rental` preset selected. Language pill set to `KN`. `audio-sync.js` loaded; clause anchors present as `data-clause-id`.

**Steps:**
1. Tap the `BLR Rental` preset.
2. Confirm the language pill reads `KN`.
3. Press `Play 60s`.
4. Watch the contract pane as playback advances past Clause 3 (deposit).
5. Wait for playback to reach the next clause.

**Pass criteria:**
- Audio is native-script Kannada (Bulbul `v4-flash`), English legal terms intact, no Romanized Indic.
- At Clause 3 the pane smooth-scrolls so the clause is in view, `.clause-active` pulses for ~1100ms.
- All other clauses render at 18% opacity while Clause 3 is active; the next clause restores.
- Total runtime is ≈60s (±10s); each clause is driven by a user gesture, no autoplay block.

**Fallback:** If Sarvam TTS is down, `window.speechSynthesis` speaks the same `spoken_script` — pulse/dim/scroll still fire. If audio dies entirely, run the walkthrough silent: the pulse + scroll + dim animation alone reads as clause-synced.

---

## 3. Way-Out slider shows ₹ saved vs current exposure

**Goal:** Deterministic rupee math, no LLM, moves with the slider.

**Preconditions:** Audit report rendered from a preset with rupee exposure inputs. Hero shows Score + ₹Exposure.

**Steps:**
1. Note the current exposure figure on the hero.
2. Locate the `Way-Out` slider under the 3 bullets.
3. Drag from the earliest exit month to the latest.
4. Read the current-loss vs negotiated-loss pair at each end.
5. Refresh the page, re-render, drag to the same month.

**Pass criteria:**
- Slider recomputes on every `input` event with no network call (DevTools shows zero requests).
- Two figures shown side by side: current exposure vs negotiated exposure, plus ₹ saved.
- At the demo month the saved figure reads **₹1.4L** against the preset's current exposure.
- Same month on a refresh yields the identical rupee value (pure JS, no drift, no rounding wobble).
- No currency formatting bugs (₹ with Indian grouping, e.g. `₹1,40,000`).

**Fallback:** If the slider jams, read the two endpoint values aloud as fixed numbers ("₹2.4L today vs ₹1.0L negotiated — ₹1.4L saved"). The Pre-Sign Brief PDF still carries the computed exposure.

---

## 4. Kanglish Hold-to-Ask → grounded answer + scroll to clause

**Goal:** Code-mixed voice question returns a grounded answer and pins the backing clause.

**Preconditions:** `BLR Rental` audit loaded. Language pill `KN`. Mic permission granted.

**Steps:**
1. Press and hold `Hold to Ask`.
2. Ask in Kanglish, e.g. *"Deposit refund eshtu dina agutte? Clause heli."*
3. Release before 30s.
4. Watch the stepper (`STT → QA → TTS`).
5. Read the pinned answer card; observe the contract pane.

**Pass criteria:**
- `saaras:v4` codemix transcript on screen is recognizably the spoken Kanglish, not Romanized garbage.
- Answer is grounded: cites the specific clause and quotes the verbatim excerpt (`✓ Verified excerpt`).
- No statute is shown unless its `rule_id` exists in the active pack.
- Audio reply plays; the contract pane smooth-scrolls to and pulses the backing clause.
- Latency ≤8s end to end on stage wifi.

**Fallback:** If STT fails, type the same Kanglish question into the text input — answer + scroll path is identical. If TTS fails, answer renders as text card (`speechSynthesis` optional); the scroll-to-clause is the demo beat. If both fail, open the pinned card from the previous run.

---

## 5. Missing Page 3 → amber banner + `Clause 4 → 7` gap

**Goal:** Zero silent failures — the app admits what it could not read.

**Preconditions:** `Missing Page 3` preset (contract fixture missing page 3; expected gap encoded as `Clause 4 → 7`).

**Steps:**
1. Select the `Missing Page 3` preset.
2. Let the stepper finish.
3. Read the top of the report.
4. Toggle `Original Scan`.
5. Open the Negotiate tab.

**Pass criteria:**
- Amber Incomplete Scan Banner renders above the hero, with text stating the page/clause gap explicitly.
- Gap string reads exactly `Clause 4 → 7`.
- Banner is amber severity — never the Trust Indigo primary, never red/`Illegal` language.
- `Original Scan` toggle shows the source page on one tap and hides it on the next.
- Findings dependent on the missing range are absent or marked `[ILLEGIBLE]`, not invented.
- Negotiate tab still produces asks for the clauses that *were* read.

**Fallback:** If the banner animation misbehaves, the static amber banner plus the `Clause 4 → 7` text is the whole beat — no animation required. If `Original Scan` fails, skip the toggle and point at the gap string.

---

## 6. Polite WhatsApp draft copies cleanly

**Goal:** A judge can paste the ask into their own WhatsApp and send it.

**Preconditions:** Audit loaded with at least one flagged clause carrying `negotiation_ask`. Negotiate tab open.

**Steps:**
1. Switch to the `Negotiate` tab.
2. Tick two asks from the list.
3. Select tone `Polite & Collaborative`.
4. Select `WhatsApp`.
5. Press `Copy`.
6. Paste into a real WhatsApp chat (or the OS clipboard viewer).
7. Repeat once with `Email` selected.

**Pass criteria:**
- Clipboard contains the full draft — no truncation, no `[object Object]`, no markdown artifacts.
- Draft is polite English, names the specific clause, contains the ask, ends with a neutral closing. No `Illegal`, `Sue`, or `AI Lawyer` wording.
- The permanent disclaimer is present in the app UI adjacent to the draft.
- Unticked asks do not appear; toggling `Firm` changes the wording materially.
- Copy works on the phone (clipboard permission path) with the `<textarea>` fallback if `navigator.clipboard` is unavailable.

**Fallback:** If clipboard is blocked, the draft renders in a selectable `<textarea>` and the presenter says "select all, copy." If a judge's phone can't paste, the `Email` draft opens a prefilled `mailto:` instead.

---

## 7. Mobile QR modal serves the same flow on a phone

**Goal:** Judges test the identical flow on their own phones before winners are announced.

**Preconditions:** Deployed URL live and reachable from the venue network. Desktop in `Split` view.

**Steps:**
1. On desktop, click `Mobile QR`.
2. Confirm the `<dialog>` shows a scannable QR pointing at the deployed URL.
3. Scan with a phone; open the link.
4. On the phone, set language pill `KN`, tap `BLR Rental`, press `Play 60s`.
5. Tap a clause card, then `Hold to Ask`.
6. Confirm the 62px sticky bar shows `Play 60s` + `Hold to Ask`.
7. Close the modal on desktop with `Esc`.

**Pass criteria:**
- QR resolves to the same deployed URL; no login, no install, no CORS error.
- Phone loads the mobile card feed at 390×844 with zero pinch-zoom and no horizontal scroll.
- Sticky bar is 62px with `Play 60s` and `Hold to Ask` both reachable by thumb.
- Audio starts on a user gesture and pulses the correct clause on the phone.
- Hold-to-Ask returns an answer on the phone, not just desktop.
- `<dialog>` traps focus while open and closes on `Esc` and backdrop click.

**Fallback:** If the QR is unreadable on the projector, read the URL aloud and have a judge type it. If the venue network blocks the phone, demo the desktop flow and the already-loaded cached preset path — the same code path is on screen.

---

## Final checklist

| # | Smoke test | Desktop 1440×900 | Phone via QR | Pass |
|---|---|---|---|---|
| 1 | PII token count pre-upload | ☐ | ☐ | ☐ |
| 2 | BLR preset → KN audio, Clause 3 pulses, others 18% | ☐ | ☐ | ☐ |
| 3 | Way-Out slider ₹ saved vs current exposure | ☐ | ☐ | ☐ |
| 4 | Kanglish Hold-to-Ask → grounded answer + scroll | ☐ | ☐ | ☐ |
| 5 | Missing Page 3 → amber banner + `Clause 4 → 7` | ☐ | ☐ | ☐ |
| 6 | Polite WhatsApp draft copies cleanly | ☐ | ☐ | ☐ |
| 7 | Mobile QR serves same flow on a phone | ☐ | — | ☐ |

**Gate:** 7/7 required for Checkpoint 8. 5/7 is the live-demo win threshold (PRD §8). Re-run all seven after any change to `renderer.js`, `audio-sync.js`, `verifier.js`, `pii-guard.js`, or `negotiate.js`, and before the 4:15 PM freeze.
