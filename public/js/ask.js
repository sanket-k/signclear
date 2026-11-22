import { focusClause, speakText } from "./audio-sync.js";
import { escapeHTML } from "./prompt-security.js";

export const MAX_RECORD_MS = 30000;
export const MIN_RECORD_MS = 400;

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("audio_read_failed"));
    reader.readAsDataURL(blob);
  });
}

async function postJSON(url, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(payload?.error?.message || `request_failed_${res.status}`);
    err.code = payload?.error?.code || "request_failed";
    throw err;
  }
  return payload;
}

export function createAsk(root, audit, { language, onStage = () => {} } = {}) {
  const lang = language || audit.language || "en";
  const state = { recording: false, busy: false, startedAt: 0, recorder: null, chunks: [], controller: null };

  function renderCard({ question, answer, clauseId, source }) {
    const host = root.querySelector(".ask-card-host") || root.querySelector(".ask-drawer") || root;
    const card = document.createElement("article");
    card.className = "ask-card";
    if (clauseId) card.dataset.clauseId = clauseId;
    const clause = (audit.clauses || []).find((c) => c.clause_id === clauseId);
    card.innerHTML = `
      <p class="ask-question">${escapeHTML(question)}</p>
      <p class="ask-answer">${escapeHTML(answer)}</p>
      ${clause ? `<button class="ask-jump" type="button">Jump to Clause ${escapeHTML(String(clause.index))}</button>` : ""}
      <span class="ask-source" data-source="${escapeHTML(source)}">${escapeHTML(source === "speechSynthesis" ? "spoken" : source)}</span>
    `;
    const jump = card.querySelector(".ask-jump");
    if (jump && clauseId) {
      jump.addEventListener("click", () => focusClause(root, clauseId));
    }
    host.prepend(card);
    return card;
  }

  async function answerQuestion(question) {
    if (!question?.trim()) return;
    if (state.busy) return;
    state.busy = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    onStage("ground");
    try {
      const summary = {
        clauses: (audit.clauses || []).map((c) => ({ clause_id: c.clause_id, index: c.index, heading: c.heading, text: c.text })),
        findings: (audit.findings || []).map((f) => ({
          rule_id: f.rule_id,
          clause_id: f.clause_id,
          title: f.title,
          severity: f.severity,
          quote: f.quote,
          explanation: f.explanation,
        })),
      };
      const result = await postJSON("/api/qa", { question, audit_summary: summary, language: lang }, signal);
      if (result.clause_id) focusClause(root, result.clause_id);
      let source = "text";
      const spoken = result.spoken?.text;
      if (spoken) {
        onStage("speak");
        let played = false;
        try {
          const tts = await postJSON("/api/tts", { text: spoken, language: lang }, signal);
          if (tts?.audio_base64) {
            const audio = new Audio(`data:${tts.mime || "audio/mpeg"};base64,${tts.audio_base64}`);
            await audio.play();
            played = true;
            source = "sarvam";
            audio.onended = () => {};
          }
        } catch {
          played = false;
        }
        if (!played) {
          await speakText(spoken, lang);
          source = "speechSynthesis";
        }
      }
      renderCard({ question, answer: result.answer || spoken || "", clauseId: result.clause_id, source });
      return result;
    } catch (err) {
      if (err?.name === "AbortError") return null;
      renderCard({ question, answer: "We could not reach the assistant. Try again, or read the clause directly.", clauseId: null, source: "offline" });
      return null;
    } finally {
      state.busy = false;
      state.controller = null;
    }
  }

  async function stopRecording() {
    if (!state.recording) return null;
    state.recording = false;
    const duration = Date.now() - state.startedAt;
    const recorder = state.recorder;
    state.recorder = null;
    if (!recorder) return null;
    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    if (duration < MIN_RECORD_MS) return null;
    const blob = new Blob(state.chunks, { type: recorder.mimeType || "audio/webm" });
    state.chunks = [];
    const base64 = await blobToBase64(blob);
    onStage("shield");
    try {
      const stt = await postJSON("/api/stt", { audio_base64: base64, mime: blob.type, language: lang });
      const transcript = stt?.transcript?.trim();
      if (transcript) return answerQuestion(transcript);
    } catch {
      return null;
    }
    return null;
  }

  async function startRecording() {
    if (state.recording || state.busy) return;
    state.chunks = [];
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      renderCard({ question: "Microphone unavailable", answer: "Type your question instead — the answer path is identical.", clauseId: null, source: "offline" });
      return;
    }
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.recorder = recorder;
    state.recording = true;
    state.startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data?.size) state.chunks.push(event.data);
    };
    recorder.start();
    onStage("scan");
    window.setTimeout(() => {
      if (state.recording) stopRecording();
      stream.getTracks().forEach((t) => t.stop());
    }, MAX_RECORD_MS);
    recorder.addEventListener("stop", () => stream.getTracks().forEach((t) => t.stop()), { once: true });
  }

  return {
    get state() {
      return { ...state, recorder: undefined };
    },
    startRecording,
    stop: async () => {
      if (state.recording) return stopRecording();
      return null;
    },
    askText: answerQuestion,
    cancel: () => {
      state.controller?.abort();
      state.busy = false;
    },
  };
}

export function bindHoldToAsk(button, root, audit, options = {}) {
  if (!button) return null;
  const ask = createAsk(root, audit, options);
  const onDown = (event) => {
    event.preventDefault();
    button.dataset.state = "recording";
    ask.startRecording();
  };
  const onUp = async (event) => {
    event.preventDefault();
    if (button.dataset.state !== "recording") return;
    button.dataset.state = "sending";
    await ask.stop();
    button.dataset.state = "idle";
  };
  button.addEventListener("pointerdown", onDown);
  button.addEventListener("pointerup", onUp);
  button.addEventListener("pointercancel", onUp);
  button.addEventListener("pointerleave", onUp);
  return ask;
}
