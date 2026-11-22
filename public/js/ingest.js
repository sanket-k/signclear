import { detectPII } from "./pii-guard.js";

export const MAX_DIMENSION = 1500;
export const JPEG_QUALITY = 0.8;
export const CONCURRENCY = 3;
export const BLUR_THRESHOLD = 60;
export const SCANNABLE_CHAR_FLOOR = 20;

let pdfjsReady = null;

async function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const lib = globalThis.pdfjsLib;
      if (!lib) throw new Error("pdfjs_unavailable");
      lib.GlobalWorkerOptions.workerSrc = new URL(
        "../lib/pdfjs/pdf.worker.min.js",
        import.meta.url
      ).href;
      return lib;
    })();
  }
  return pdfjsReady;
}

export async function openPdf(file) {
  const lib = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return lib.getDocument({ data: bytes }).promise;
}

export async function isScannable(pdf, budgetMs = 150) {
  const started = performance.now();
  let chars = 0;
  let pagesRead = 0;
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    if (performance.now() - started > budgetMs && pagesRead > 0) break;
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    chars += content.items.reduce((sum, item) => sum + (item.str?.trim().length || 0), 0);
    pagesRead += 1;
  }
  return chars < SCANNABLE_CHAR_FLOOR * Math.max(pagesRead, 1);
}

export async function pdfToPages(pdf) {
  const pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    let text = "";
    let lastY = null;
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 4) text += "\n";
      text += item.str;
      lastY = y;
    }
    pages.push({ page: pageNo, text: text.replace(/[ \t]+/g, " ").trim() });
  }
  return pages;
}

export async function pdfToImages(pdf, maxPages = 3) {
  const images = [];
  const limit = Math.min(pdf.numPages, maxPages);
  for (let pageNo = 1; pageNo <= limit; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_DIMENSION / viewport.width, MAX_DIMENSION / viewport.height, 3);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    // White matte keeps scanned pages colour-accurate; never binarize.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    images.push({ page: pageNo, dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
  }
  return images;
}

export async function imageFileToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  // Re-encoding through canvas drops EXIF (orientation + GPS) by construction.
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { dataUrl, width: canvas.width, height: canvas.height, bytes: approxBytes(dataUrl) };
}

export function approxBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

export function measureSharpness(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const sampleW = Math.min(width, 240);
  const sampleH = Math.min(height, 240);
  const data = ctx.getImageData(0, 0, width, height).data;
  const stepX = Math.max(1, Math.floor(width / sampleW));
  const stepY = Math.max(1, Math.floor(height / sampleH));
  const gray = [];
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  let sum = 0;
  let sumSq = 0;
  for (const v of gray) {
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / gray.length;
  return Math.sqrt(Math.max(0, sumSq / gray.length - mean * mean));
}

export async function blurVerdict(dataUrl, budgetMs = 100) {
  const started = performance.now();
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const sharpness = measureSharpness(canvas);
  return {
    sharpness: Math.round(sharpness),
    blurred: sharpness < BLUR_THRESHOLD,
    elapsedMs: Math.round(performance.now() - started),
    withinBudget: performance.now() - started <= budgetMs,
  };
}

export async function blackoutHeader(dataUrl, fraction = 0.18) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, Math.round(canvas.height * fraction));
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function shieldText(pages) {
  const joined = pages.map((p) => p.text).join("\n");
  const result = detectPII(joined);
  return {
    safeToSend: result.safeToSend,
    total: result.total,
    counts: result.counts,
    maskedPages: pages.map((p) => ({ page: p.page, text: detectPII(p.text).maskedText })),
  };
}

export function createStepper(root) {
  const el = root.querySelector(".stepper");
  if (!el) return { stage() {}, count() {}, finish() {}, cancel() {} };
  const set = (stage, state) => {
    const node = el.querySelector(`[data-stage="${stage}"]`);
    if (node) node.dataset.state = state;
  };
  return {
    stage(stage) {
      for (const node of el.querySelectorAll("[data-stage]")) {
        if (node.dataset.stage === stage) set(node.dataset.stage, "running");
        else if (node.dataset.state === "running") set(node.dataset.stage, "done");
      }
      el.dataset.state = "running";
      el.setAttribute("aria-busy", "true");
    },
    count(name, value) {
      const node = el.querySelector(`[data-count="${name}"]`);
      if (node) node.textContent = String(value);
    },
    finish() {
      for (const node of el.querySelectorAll("[data-stage]")) {
        if (node.dataset.state === "running" || node.dataset.state === "pending") {
          node.dataset.state = "done";
        }
      }
      el.dataset.state = "done";
      el.setAttribute("aria-busy", "false");
    },
    cancel() {
      for (const node of el.querySelectorAll("[data-stage]")) {
        if (node.dataset.state === "running" || node.dataset.state === "pending") {
          node.dataset.state = "cancelled";
        }
      }
      el.dataset.state = "cancelled";
      el.setAttribute("aria-busy", "false");
    },
  };
}

export function createRun() {
  const controller = new AbortController();
  return { controller, signal: controller.signal, cancel: () => controller.abort() };
}

export async function postJSON(url, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(payload?.error?.message || `request_failed_${res.status}`);
    err.status = res.status;
    err.code = payload?.error?.code || "request_failed";
    throw err;
  }
  return payload;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function ingestFile(file, options = {}) {
  const { signal, onStage = () => {}, onCount = () => {} } = options;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isPdf) {
    onStage("scan");
    const pdf = await openPdf(file);
    const scanned = await isScannable(pdf);
    onCount("pages", pdf.numPages);
    if (!scanned) {
      const pages = await pdfToPages(pdf);
      onStage("shield");
      const shield = shieldText(pages);
      return {
        lane: "A",
        pages: shield.maskedPages,
        privacy: { lane: "A", pii_tokens_found: shield.total, pii_token_types: shield.counts, safeToSend: shield.safeToSend, zero_retention: false },
        docType: "residential_rental",
      };
    }
    // Scanned PDF: fall to image lane so the honesty badge is accurate.
    const images = await pdfToImages(pdf);
    return ingestImages(images, { signal, onStage, onCount, source: "vector_pdf_scan" });
  }

  const page = await imageFileToJpeg(file);
  return ingestImages([{ page: 1, dataUrl: page.dataUrl }], {
    signal,
    onStage,
    onCount,
    source: "photo",
  });
}

export async function ingestImages(images, options = {}) {
  const { signal, onStage = () => {}, onCount = () => {}, source = "photo", blackout = false } = options;
  onStage("scan");
  const prepared = await pool(images.slice(0, 3), CONCURRENCY, async (image) => {
    let dataUrl = image.dataUrl;
    if (blackout) dataUrl = await blackoutHeader(dataUrl);
    const verdict = await blurVerdict(dataUrl);
    return { ...image, dataUrl, ...verdict };
  });
  onCount("pages", prepared.length);
  onStage("shield");
  const ocr = await postJSON(
    "/api/ocr",
    { images: prepared.map((p) => p.dataUrl), doc_type: "residential_rental" },
    signal
  );
  return {
    lane: "B",
    pages: ocr.pages || [],
    illegible: ocr.illegible || [],
    pagesMissing: ocr.pages_missing || [],
    blur: prepared.map((p) => ({ page: p.page, sharpness: p.sharpness, blurred: p.blurred })),
    privacy: { lane: "B", exif_stripped: true, zero_retention: true },
    source,
  };
}

export function ingestPreset(preset) {
  const pages = (preset.pages || []).map((p) => ({ page: p.page, text: p.text }));
  const shield = shieldText(pages);
  const completeness = preset.expected_completeness || {
    status: "complete",
    pages_found: pages.map((p) => p.page),
    pages_missing: [],
    clause_gaps: [],
  };
  return {
    lane: preset.document?.source_lane === "image_photo" ? "B" : "A",
    pages: shield.maskedPages,
    privacy: {
      lane: preset.document?.source_lane === "image_photo" ? "B" : "A",
      pii_tokens_found: shield.total,
      pii_token_types: shield.counts,
      safeToSend: shield.safeToSend,
    },
    completeness,
    docType: preset.document?.doc_type,
    expectedPackId: preset.expected_pack_id,
    source: "preset",
  };
}
