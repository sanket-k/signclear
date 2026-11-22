const LANG_MAP = { kn: "kn-IN", hi: "hi-IN", ta: "ta-IN", en: "en-IN" };
const PULSE_MS = 1100;
const REDUCED = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const BCP47 = { kn: "kn-IN", hi: "hi-IN", ta: "ta-IN", en: "en-IN" };

function scrollToClause(root, clauseId) {
  const targets = root.querySelectorAll(`[data-clause-id="${clauseId}"]`);
  if (!targets.length) return;
  const behavior = REDUCED() ? "auto" : "smooth";
  targets[0].scrollIntoView({ behavior, block: "center", inline: "nearest" });
}

export function clearFocus(root) {
  for (const node of root.querySelectorAll(".clause-active")) node.classList.remove("clause-active");
  for (const node of root.querySelectorAll(".clause-dim")) node.classList.remove("clause-dim");
  for (const node of root.querySelectorAll('[data-state="active"]')) {
    if (node.hasAttribute("data-clause-id")) node.dataset.state = "idle";
  }
}

export function focusClause(root, clauseId, { dim = true } = {}) {
  clearFocus(root);
  const targets = root.querySelectorAll(`[data-clause-id="${clauseId}"]`);
  if (!targets.length) return;
  if (dim) {
    for (const node of root.querySelectorAll("[data-clause-id]")) {
      if (node.getAttribute("data-clause-id") !== clauseId) node.classList.add("clause-dim");
    }
  }
  for (const node of targets) {
    node.classList.add("clause-active");
    node.dataset.state = "active";
  }
  scrollToClause(root, clauseId);
  window.clearTimeout(focusClause._timer);
  focusClause._timer = window.setTimeout(() => {
    for (const node of root.querySelectorAll(".clause-active")) node.classList.remove("clause-active");
  }, PULSE_MS);
}

export function buildPlaylist(audit) {
  const byId = new Map((audit.clauses || []).map((c) => [c.clause_id, c]));
  return (audit.spoken_script || [])
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((segment) => ({
      ...segment,
      heading: byId.get(segment.clause_id)?.heading || "",
    }));
}

function speakFallback(segment, lang) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve("unsupported");
    const utter = new SpeechSynthesisUtterance(segment.text);
    utter.lang = BCP47[lang] || "en-IN";
    utter.rate = 0.92;
    utter.pitch = 1;
    utter.onend = () => resolve("done");
    utter.onerror = () => resolve("error");
    speechSynthesis.speak(utter);
  });
}

async function fetchSegmentAudio(segment, language, signal) {
  if (segment.audio_url) return { url: segment.audio_url, source: "cache" };
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: segment.text, language }),
      signal,
    });
    if (!res.ok) return { url: null, source: "fallback" };
    const data = await res.json();
    if (!data?.audio_base64) return { url: null, source: "fallback" };
    return { url: `data:${data.mime || "audio/mpeg"};base64,${data.audio_base64}`, source: "sarvam" };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { url: null, source: "fallback" };
  }
}

function playUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve("done");
    audio.onerror = () => reject(new Error("audio_error"));
    audio.play().catch(reject);
    playUrl._current = audio;
  });
}

export function createPlayer(root, audit, { language } = {}) {
  const lang = language || audit.language || "en";
  const playlist = buildPlaylist(audit);
  const state = { index: -1, playing: false, source: "idle", controller: null, segments: [] };

  const markItem = (index, value) => {
    const item = root.querySelector(`.playlist-item[data-clause-id="${playlist[index]?.clause_id}"]`);
    if (item) item.dataset.state = value;
  };

  async function step() {
    while (state.playing && state.index < playlist.length) {
      const segment = playlist[state.index];
      if (!segment) break;
      markItem(state.index, "playing");
      focusClause(root, segment.clause_id);
      let result = { url: null, source: "fallback" };
      try {
        result = await fetchSegmentAudio(segment, lang, state.controller.signal);
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
      state.source = result.source;
      if (result.url) {
        try {
          await playUrl(result.url);
        } catch {
          await speakFallback(segment, lang);
          state.source = "speechSynthesis";
        }
      } else {
        await speakFallback(segment, lang);
        state.source = "speechSynthesis";
      }
      if (!state.playing) return;
      markItem(state.index, "done");
      state.index += 1;
    }
    stop(true);
  }

  function stop(completed = false) {
    state.playing = false;
    state.controller?.abort();
    state.controller = null;
    if (playUrl._current) {
      playUrl._current.pause();
      playUrl._current = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    clearFocus(root);
    if (!completed) state.index = -1;
    root.dispatchEvent(new CustomEvent("sc:playstate", { detail: { playing: false } }));
  }

  return {
    playlist,
    get state() {
      return { ...state, playlist };
    },
    async play() {
      if (state.playing) return;
      stop();
      state.playing = true;
      state.index = state.index < 0 ? 0 : state.index;
      state.controller = new AbortController();
      root.dispatchEvent(new CustomEvent("sc:playstate", { detail: { playing: true } }));
      await step();
    },
    async jumpTo(clauseId) {
      const index = playlist.findIndex((s) => s.clause_id === clauseId);
      if (index < 0) return;
      stop();
      state.playing = true;
      state.index = index;
      state.controller = new AbortController();
      root.dispatchEvent(new CustomEvent("sc:playstate", { detail: { playing: true } }));
      await step();
    },
    stop,
    pause: () => stop(),
  };
}

export function speakText(text, lang = "en") {
  return speakFallback({ text }, lang);
}

export { BCP47, PULSE_MS, LANG_MAP };
