"use strict";

/**
 * Rule-pack loader (§5 shared-contract). Reads rules/{packId}.json from the repo root.
 * Tiny module-level cache: Vercel may reuse a function instance within one invoke burst.
 */

const fs = require("node:fs");
const path = require("node:path");

const FALLBACK_PACK_ID = "in-general-fallback";
const RENTAL_PACK_ID = "in-ka-rental";

const PACK_IDS = [
  "in-ka-rental",
  "in-central-rbi-loan",
  "in-central-employment",
  "in-general-fallback",
];

const cache = new Map();

function rulesDir() {
  return path.join(process.cwd(), "rules");
}

/** Read + parse rules/{packId}.json. Throws a structured error when absent/invalid. */
function loadPack(packId) {
  const id = String(packId || "").trim();
  if (!id) return loadPack(FALLBACK_PACK_ID);
  if (cache.has(id)) return cache.get(id);

  const file = path.join(rulesDir(), `${id}.json`);
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    const err = new Error(`rule_pack_unreadable: ${id}`);
    err.status = 500;
    err.code = "rule_pack_unreadable";
    throw err;
  }
  cache.set(id, pack);
  return pack;
}

/** Cheap sanity check so a corrupt pack can never reach the model or the client. */
function isUsablePack(pack) {
  return Boolean(
    pack && pack.pack_id && Array.isArray(pack.rules) && pack.rules.length > 0
  );
}

function allPacks() {
  return PACK_IDS.map((id) => {
    try {
      return loadPack(id);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

const RENTAL_STATE_HINTS = [
  "bengaluru",
  "bangalore",
  "karnataka",
  "mysuru",
  "mysore",
  "hubballi",
  "mangaluru",
];

/**
 * @param {{docType?:string, text?:string}} args
 * @returns {{pack:object, fallback_used:boolean}}
 */
function pickPack({ docType, text } = {}) {
  const wanted = String(docType || "").trim();
  const haystack = String(text || "").toLowerCase();

  if (wanted) {
    const candidates = allPacks().filter(
      (p) => Array.isArray(p.contract_types) && p.contract_types.includes(wanted)
    );

    // Prefer the most specific pack; the fallback is always last resort.
    const specific = candidates.filter((p) => p.pack_id !== FALLBACK_PACK_ID);

    let chosen = null;
    if (specific.length === 1) {
      chosen = specific[0];
    } else if (specific.length > 1) {
      // Ties: residential_rental in Karnataka ⇒ in-ka-rental; otherwise first specific pack.
      if (wanted === "residential_rental" && RENTAL_STATE_HINTS.some((h) => haystack.includes(h))) {
        chosen = specific.find((p) => p.pack_id === RENTAL_PACK_ID) || specific[0];
      } else {
        chosen = specific[0];
      }
    }

    if (!chosen && wanted === "residential_rental") {
      // Only the fallback declares rentals — use the Karnataka pack when text smells like KA.
      if (RENTAL_STATE_HINTS.some((h) => haystack.includes(h))) {
        chosen = loadPack(RENTAL_PACK_ID);
      }
    }

    if (chosen && isUsablePack(chosen)) {
      return { pack: chosen, fallback_used: chosen.pack_id === FALLBACK_PACK_ID };
    }
  }

  // Unknown doc type ⇒ pan-India fallback with the amber badge.
  return { pack: loadPack(FALLBACK_PACK_ID), fallback_used: true };
}

/**
 * ONLY what the model may see: pack_id + per-rule detection hints.
 * Full negotiation asks, citations and legal_basis never reach the model.
 */
function packPromptContext(pack) {
  const rules = Array.isArray(pack && pack.rules) ? pack.rules : [];
  return {
    pack_id: pack && pack.pack_id ? pack.pack_id : FALLBACK_PACK_ID,
    rules: rules.map((r) => ({
      rule_id: r.rule_id,
      title: r.title,
      detection_hint: r.detection_hint,
      benchmark: r.benchmark,
    })),
  };
}

/** rule_id -> rule lookup for server-side citation/ask attachment. */
function ruleIndex(pack) {
  const index = new Map();
  for (const rule of (pack && pack.rules) || []) index.set(rule.rule_id, rule);
  return index;
}

module.exports = {
  FALLBACK_PACK_ID,
  RENTAL_PACK_ID,
  PACK_IDS,
  loadPack,
  pickPack,
  packPromptContext,
  ruleIndex,
};
