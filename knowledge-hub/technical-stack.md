# TECH_STACK — SignClear

> Part of the SignClear knowledge hub. Read `AGENTS.md` first — it is the agent's
> constitution. This document is the **how** (infra, API, security).
> For the *what and why*, read `PRD.md`. For the *look and feel*, read
> `DESIGN_SYSTEM.md`.

---

## 1. Locked Decisions

| Decision | Locked choice | Rationale | Rejected alternative |
|---|---|---|---|
| **Backend** | **Vercel Functions** (`api/*.js`) | 300s wall-clock, 2GB RAM, 4.5MB body, no CPU cliff. Same-origin with `public/` = zero CORS. | Cloudflare Workers: free tier 10ms CPU is a trap for base64 image/audio. Paid tier adds billing complexity. |
| **Frontend** | **Zero-build Vanilla ES2020 ESM** (`public/`) | 0 KB runtime, no build step, no `node_modules` failure mode. Fastest TTI for projector + judge phones. | Next.js/Vite: ~185KB runtime + build pipeline = time spent on tooling, not product. |
| **LLM gateway** | **`LLM_PROVIDER=openrouter` (default) → `anthropic` (event credits)** | OpenRouter works pre-event; Anthropic activates at 1:00 PM. Same OpenAI schema both ways. **OpenRouter is the default.** | Hardcoding one provider = dead demo if credits don't activate. |
| **Speech** | Sarvam `saaras:v4` (STT, codemix) + `bulbul:v4-flash` (TTS) + **browser `speechSynthesis` fallback** | Native code-mixed Indian voice is the gasp moment. Fallback = stage never dies. | TTS-only with no fallback = single point of failure. |
| **Privacy** | Honest two-lane: Lane A local PII Shield, Lane B EXIF-strip + zero-retention | Never lie about masking JPEGs. Judges respect honesty. | "100% on-device" for photos = Redline's overclaim trap. |
| **Legal** | 3-tier taxonomy (`Statutory Conflict`/`Above Local Norm`/`Standard`), no e-signing | Docusign India Head will punish "AI Lawyer" and fake e-sign. | jsPDF signature = invalidates ₹100 e-stamp. |
| **Persistence** | `localStorage` vault (~20KB/doc) | Zero-ops, survives refresh, real value 11 months later. | Cloud DB = auth + migrations + cold-start = out of scope. |

---

## 2. Backend — Why Vercel, Not Cloudflare

The 10ms Cloudflare limit is **pure CPU time**, not wall-clock or network. What eats it in this app:

- **Base64 decode/encode of a ~200KB image** — the payload arrives as a data URL, must be parsed and forwarded.
- **Base64 audio proxying** from Sarvam — an 8–12 second clip is typically 150–400KB.
- **JSON serialization of a full `AuditResult`** — 10–20 findings, each with a verbatim quote and spoken script.
- **Auth header construction and env-var parsing** on every cold start.

| Constraint | CF Workers (Free) | CF Workers (Paid) | Vercel Functions (Hobby) |
|---|---|---|---|
| CPU limit | 10ms | 5 min, CPU-ms billed | 300s wall-clock, no CPU cliff |
| Memory | 128MB | 128MB | 1024–2048MB |
| Body limit | 100MB | 100MB | 4.5MB (sufficient) |
| Billing complexity | None | CPU-ms vs wall-clock | None |

**Verdict: Vercel.** Not a hedge. The correct choice for a proxy handling base64 payloads.

---

## 3. Frontend — Why Zero-Build Vanilla

**The cost of frameworks:**
- React + Next.js: ~185KB runtime + Webpack/Rollup pipeline. Every minute on `webpack.config.js` is a minute not on clause-sync.
- Vite: lighter, but still a build step and `node_modules` graph.
- **Vanilla ES2020 ESM:** 0 KB runtime. `python -m http.server` is the dev server. Vercel serves `public/` as static files — no build artifact.

**Native primitives (2026) replace most framework needs:**
- Popover API → floating Ask drawer (D7)
- CSS Anchor Positioning → clause highlight popovers
- Declarative Shadow DOM → contract sheet
- `<details>`/`<summary>` → accordions
- `AbortController` → Cancel on telemetry stepper
- `<dialog>` → Stage QR modal

**Verdict: Zero-build Vanilla ESM.** Strategic decision to eliminate "build tooling failure" from the critical path.

---

## 4. System Architecture

```mermaid
flowchart TB
    subgraph BROWSER["Browser PWA — Zero-build Vanilla ES2020 ESM (public/)"]
        UI["Adaptive shell: Mobile feed <900px / Desktop split >=900px"]
        ING["ingest.js: PDF.js isScannable · Canvas 1500px JPEG (EXIF strip) · 100ms blur"]
        PII["pii-guard.js: 4-layer fail-closed Indian PII (Lane A)"]
        VER["verifier.js: Jaccard >=0.80 · rupee math · Way-Out"]
        AUD["audio-sync.js: clause playlist · focus dimming · speechSynthesis fallback"]
        LS[("localStorage vault ~20KB/doc")]
    end
    subgraph API["Vercel Stateless Proxy — api/*.js (same origin, keys hidden)"]
        R1["/api/ocr — Haiku 5.5 Vision"]
        R2["/api/audit — Sonnet 5.5 + rule pack"]
        R3["/api/qa — Sonnet 5.5 grounded"]
        R4["/api/tts · /api/stt — Sarvam proxy"]
    end
    subgraph EXT["Providers — 1 env var switch"]
        LLM["OpenRouter (default) → Anthropic (event credits)"]
        SRV["Sarvam saaras:v4 + bulbul:v4-flash"]
    end
    UI --> ING
    ING -->|Lane A vector| PII --> R2
    ING -->|Lane B photo| R1 --> R2
    R1 --> LLM
    R2 --> LLM
    R3 --> LLM
    R4 --> SRV
    R2 --> VER --> UI
    UI <--> AUD <--> R4
    UI <--> LS