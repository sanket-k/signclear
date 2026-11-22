# PRD — SignClear (RFS 30: Understand Before You Sign)

> Part of the SignClear knowledge hub. Read `AGENTS.md` first — it is the agent's
> constitution. This document is the **what and why**. For the *how*, read
> `TECH_STACK.md`. For the *look and feel*, read `DESIGN_SYSTEM.md`.

**Event:** Builder's Day — Product (Un)Conference '26 (The Product Folks) · Sun, Nov 22, 2026 · Bengaluru
**Format:** 4-hour solo speedrun · 1:00–5:00 PM IST · Live demos 6:00 PM
**Problem:** RFS 30 — *Understand Before You Sign* (Prashanth Rao, India Product Head, Docusign)
**Product:** **SignClear** — a zero-build, mobile-first PWA + desktop split X-Ray assistant that turns a photo or PDF of an Indian agreement into a 60-second spoken walkthrough in the signer's own language, flags one-sided clauses against audited Indian rules, and drafts a polite WhatsApp/Email negotiation ask.

---

## 1. The Problem

Millions of Indians sign rental agreements, loan papers, insurance policies, and offer letters written in dense English legal language they cannot fully follow. They often discover the lock-in, the penalty, or the auto-renewal clause only after it costs them.

The asymmetry is not about intelligence. The agreement was drafted by the counterparty's lawyer, and it is being read on a phone, at 11pm, off a WhatsApp PDF, with a broker saying "everyone signs this."

---

## 2. Why This Matters (personal)

I live in Bengaluru. Friends of mine — engineers who read code for a living — have signed 11-month leases with a 10-month deposit, a painting charge that shows up only at exit, and a lock-in that costs four months' rent to leave. They signed because the PDF arrived on WhatsApp at 11pm and the broker said everyone signs this. Eleven months later the deposit doesn't come back, and nobody kept a copy of what was agreed.

The document was never the problem. **The timing and the language were.** You need clarity at the moment of signing, not a lawyer three weeks later.

---

## 3. Vision & One-Liner

**Vision:** Turn dense English agreements into calm, 60-second spoken clarity and polite negotiation leverage in any Indian signer's own language.

**One-liner:** *"Know what you're signing — in your language, in 60 seconds, with the exact clause and the polite ask to fix it."*

---

## 4. The Wedge (why this and not ChatGPT / Docusign)

Docusign's own AI-Assisted Review (late 2026) works **exclusively inside desktop Microsoft Word for `.docx` files across 5 Western languages**. It has no mobile support, no photo/PDF-scan support, and no Indian languages.

Meanwhile, India signs on phones, in Kannada, Hindi, and Tamil, from WhatsApp PDFs and ₹100 stamp paper.

SignClear closes that gap with three things no general-purpose LLM chat can match:
1. **A grounded walkthrough** — every clause flag carries a verified verbatim quote and a pinned statutory `rule_id`.
2. **Regional voice that actually sounds Indian** — code-mixed Kanglish/Hinglish via Sarvam, not a generic TTS reading Romanized text.
3. **A polite, ready-to-send ask** — a WhatsApp/Email draft tailored to the specific clause, not a legal essay.

---

## 5. Personas

| Persona | Context | What they need | Why it matters |
|---|---|---|---|
| **Urban Bengaluru Renter** (demo hero) | 22–35, tech or startup, moving every 11–24 months, deposit ₹2L–₹5L | Immediate clarity before signing a WhatsApp PDF at 11pm | Highest-volume use case; demo uses this |
| **First-Time Retail Borrower** | Tier 1–3 India, home/education/NBFC personal loan, ₹5L–₹80L | Kannada/Hindi walkthrough of an English loan paper, KFS awareness | RBI KFS mandate makes this a legal moat |
| **Tech Job Seeker** | Offer letter with ESOPs, non-compete, bond, or clawback | Explain the lock-in and Section 27 non-compete voidness | Fastest to demo (short document) |

---

## 6. Functional Requirements (MVP)

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| **FR-1** | Dual-lane intake + 4 presets | P0 | Vector PDF, camera photo (`capture="environment"`), or 1-click preset (*BLR Rental*, *RBI Loan*, *Startup Offer*, *Missing Page 3*). |
| **FR-2** | Compression & honest capture gate | P0 | `max 1500px` color JPEG `0.80` (~200KB, EXIF stripped); 100ms client blur check; Haiku page/clause gap detection (`Clause 4 → 7`) + amber Completeness Banner. |
| **FR-3** | Two-lane privacy shield | P0 | Lane A local fail-closed PII guard (green badge + token-type popover); Lane B 1-tap Header Blackout + honest amber zero-retention badge. |
| **FR-4** | Modular statutory audit + dual citations | P0 | Auto-loads matching pack (`in-ka-rental`, `in-central-rbi-loan`, `in-central-employment`, or `in-general-fallback`); every flag `✓ Verified excerpt` + pinned to `rule_id`. |
| **FR-5** | Clause-synced regional audio | P0 | Native-script code-mixed `spoken_script` (KN/HI/TA/EN) via `bulbul:v4-flash`, auto-scroll + pulse active clause, dim others to 18%. |
| **FR-6** | Hold-to-Ask code-mixed voice Q&A | P0 | ≤30s Kanglish/Hinglish question (`saaras:v4`) → grounded answer → audio reply + pinned card + scroll to clause. |
| **FR-7** | Checkbox Negotiator (WhatsApp + Email) | P0 | Tick asks → `Polite`/`Firm` → `WhatsApp`/`Email` → 1-page jsPDF Pre-Sign Brief. |
| **FR-8** | Deterministic Way-Out Rupee Slider | P1 | Single exit-month slider computing current vs. negotiated rupee loss in pure JS. |
| **FR-9** | Local Vault + Quick Note | P1 | `localStorage` (~20KB/doc), history drawer, editable title, 1-line note, "Don't save" toggle, 1-tap clear. |
| **OUT** | Explicit cutline | CUT | See §9. |

---

## 7. Primary User Journeys

**Detail lives in `DESIGN_SYSTEM.md` (§8–§10). This is the summary.**

### Mobile (judge tests on their own phone at 6 PM)
Landing → Language pill → Photo or preset → Blur gate (if photo) →
Live stepper → Understand feed (Score, ₹Exposure, 3 bullets, Way-Out) →
Tap a clause card → Clause inspector → Negotiate tab → WhatsApp draft → Done

### Desktop (projector hero)

Landing → Drag-drop PDF or preset → Live stepper → Split workspace →
Left: 3-tab rail (Understand | Negotiate | Notes) →
Right: serif contract with focus-dimming highlights →
Play 60s walkthrough → Ask drawer → WhatsApp draft


---

## 8. Demo Success Criteria (what "winning" looks like at 6 PM)

The 2-minute stage script (§11) must run **unscripted, live, with real interactions**:
1. **PII Shield visibly counts tokens** before anything leaves the device.
2. **BLR Rental preset → Kannada audio plays** and pulses Clause 3 (deposit) while dimming others.
3. **Way-Out slider moves** and shows ₹1.4L saved vs current exposure.
4. **Kanglish question via Hold-to-Ask** returns a grounded audio answer and scrolls to the backing clause.
5. **Missing Page 3 preset** honestly flags the gap with an amber banner.
6. **Polite WhatsApp draft copies cleanly** — a judge can send it to their own WhatsApp.
7. **Mobile QR modal** lets judges test the same flow on their phones before the winners are announced.

If any one of these fails live, the demo is still coherent (each has a fallback). If 5 of 7 pass, it wins.

---

## 9. Explicit Cutline (Do NOT Build)

| Category | Cut items | Why |
|---|---|---|
| **Auth/state** | Login, accounts, cloud DB, server cache, rate-limit middleware | Violates stateless serverless; out of 4h scope |
| **Legal overreach** | On-the-spot e-signing, "AI Lawyer", "Illegal" verdicts | Invalidates ₹100 e-stamp; Docusign India Head will punish |
| **Docs** | `.docx` tracked changes, multi-version PDF diff, Word support | Docusign's own turf; zero demo value |
| **Scope creep** | 28 state packs, calendar sync, folders, multi-offer matrix | Time sinks; amber fallback is honest and sufficient |
| **CV/build traps** | OpenCV/Tesseract WASM, naive binarization | Destroys ₹100 e-stamp patterns |
| **UI bloat** | Word-level karaoke, 8-tab dashboard, radar charts, stacked mobile sheets | Killed in UX audit |
| **Build tooling** | Vite, Webpack, Next.js, React, TypeScript | Violates zero-build; adds failure modes without benefit |

---

## 10. Business Wedge (for the VC judge)

Consumer mobile link is the viral WhatsApp wedge. The **venture-scale buyer** is:
- **NBFCs and digital lenders** legally required under **RBI Key Facts Statement (KFS)** mandates to prove borrower comprehension before signing.
- **Rental portals** (NoBroker, Nestaway) that want to reduce post-signing disputes.
- **E-sign platforms** (Docusign India, Leegality) that want a **"Verified Comprehension" SDK** embedded right before the Sign button.

The consumer product is the acquisition; the SDK is the revenue.

---

## 11. Judge Q&A (pre-written answers)

| Judge | Question | Answer |
|---|---|---|
| **Prashanth (Docusign)** | "Crumpled WhatsApp photos or missing pages?" | Live-demo the `Missing Page 3` preset → blur gate verdict, Haiku gap detect (`Clause 4 → 7`), `[ILLEGIBLE]` refusal, 1-tap `Original Scan` toggle. |
| **Anthropic** | "How do you stop hallucinated clauses or laws?" | Versioned rule packs (no memory citations), temp `0.0–0.1`, Jaccard ≥ 0.80 verbatim verification (unmatched dropped), pure-JS rupee math, OWASP LLM01 defenses. |
| **Mani (Sarvam)** | "Does real code-mixed Kanglish work?" | Live Hold-to-Ask → `saaras:v4` codemix transcript → `bulbul:v4-flash` native-script reply → scrolls to backing clause. |
| **VC (Lightspeed/Nexus)** | "Why not ChatGPT? Who pays?" | Consumer mobile = viral wedge; enterprise = **Verified Comprehension SDK** for RBI KFS NBFCs, rental portals, and e-sign workflows. |
| **Any judge** | "Why Vercel and not Cloudflare?" | 10ms Cloudflare free-tier CPU limit is a trap for base64 image/audio proxying. Vercel gives 300s wall-clock, 2GB RAM, no CPU cliff. Same-origin with `public/` = zero CORS. |

---

## 12. Open Questions

**None.** Every decision in this PRD is locked. If you find yourself debating one, the answer is "ship what is written."