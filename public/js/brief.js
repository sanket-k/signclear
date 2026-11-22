const DISCLAIMER =
  "SignClear explains agreements in plain language and flags clauses that commonly deviate from Indian norms. It is not legal advice and it is not a law firm. Always read the original agreement before signing.";

const BAND_LABEL = {
  statutory_conflict: "Statutory Conflict",
  above_local_norm: "Above Local Norm",
  missing_protection: "Missing Protection",
  standard: "Standard",
};

const SEVERITY_COLOR = {
  critical: [180, 35, 24],
  caution: [181, 71, 8],
  standard: [5, 96, 58],
  safe: [6, 118, 71],
};

function rupees(value) {
  const n = Math.round(Number(value) || 0);
  const s = String(Math.abs(n));
  let out = "";
  if (s.length <= 3) out = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${n < 0 ? "-" : ""}₹${out}`;
}

function getJsPdf() {
  const ctor = globalThis.jspdf?.jsPDF || globalThis.jsPDF;
  if (!ctor) throw new Error("jspdf_unavailable");
  return ctor;
}

export function briefLines(audit, selectedAsks = []) {
  const chosen = new Set(selectedAsks);
  const top = (audit.findings || [])
    .filter((f) => (audit.clauses || []).some((c) => c.clause_id === f.clause_id))
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, caution: 1, standard: 2, safe: 3 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    })
    .slice(0, 5);
  return {
    title: audit.document?.title || "Agreement",
    pack: audit.pack?.display_name || audit.pack?.pack_id || "",
    verifiedDate: audit.pack?.verified_date || "",
    score: audit.score?.value ?? 0,
    band: audit.score?.label || audit.score?.band || "",
    exposureCurrent: audit.exposure?.current ?? 0,
    exposureNegotiated: audit.exposure?.negotiated ?? 0,
    exposureSaved: audit.exposure?.saved ?? 0,
    gap: audit.completeness?.status && audit.completeness.status !== "complete"
      ? audit.completeness.banner?.message || "Incomplete scan — some clauses may be missing."
      : null,
    top,
    asks: (audit.findings || []).filter((f) => chosen.has(f.rule_id)),
    disclaimer: DISCLAIMER,
  };
}

export function exportBrief(audit, selectedAsks = []) {
  const JsPDF = getJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const data = briefLines(audit, selectedAsks);
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  let y = M;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(29, 78, 216);
  doc.text("Pre-Sign Brief", M, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(data.title, M, y);
  y += 15;
  doc.setFontSize(9);
  doc.setTextColor(91, 100, 120);
  doc.text(`${data.pack}  ·  verified ${data.verifiedDate}  ·  ${new Date().toISOString().slice(0, 10)}`, M, y);
  y += 22;

  doc.setDrawColor(226, 230, 238);
  doc.line(M, y, W - M, y);
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Risk score ${data.score}/100 — ${data.band}`, M, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    `Exposure ${rupees(data.exposureCurrent)} today  →  ${rupees(data.exposureNegotiated)} if negotiated  (saves ${rupees(data.exposureSaved)})`,
    M,
    y,
    { maxWidth: W - M * 2 }
  );
  y += 26;

  if (data.gap) {
    doc.setFillColor(255, 250, 235);
    doc.setDrawColor(254, 200, 75);
    doc.roundedRect(M, y - 12, W - M * 2, 30, 4, 4, "FD");
    doc.setTextColor(181, 71, 8);
    doc.setFontSize(9);
    doc.text(`Incomplete scan: ${data.gap}`, M + 8, y + 6, { maxWidth: W - M * 2 - 16 });
    y += 40;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text("Top findings", M, y);
  y += 16;

  for (const finding of data.top) {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = M;
    }
    const [r, g, b] = SEVERITY_COLOR[finding.severity] || SEVERITY_COLOR.standard;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(r, g, b);
    const label = `${BAND_LABEL[finding.basis_type] || "Clause check"} · Clause ${clauseNumber(audit, finding.clause_id)}`;
    doc.text(label, M, y);
    y += 13;

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(finding.title || "", M, y, { maxWidth: W - M * 2 });
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 70, 90);
    const explanation = finding.explanation || "";
    const wrapped = doc.splitTextToSize(explanation, W - M * 2);
    doc.text(wrapped, M, y);
    y += wrapped.length * 12 + 10;
  }

  if (data.asks.length) {
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = M;
    }
    doc.setDrawColor(226, 230, 238);
    doc.line(M, y, W - M, y);
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Your asks", M, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 70, 90);
    data.asks.forEach((finding, i) => {
      const line = `${i + 1}. ${finding.negotiation_ask?.short_title || finding.title}`;
      doc.text(line, M, y, { maxWidth: W - M * 2 });
      y += 14;
    });
  }

  const footerY = doc.internal.pageSize.getHeight() - 56;
  doc.setDrawColor(226, 230, 238);
  doc.line(M, footerY - 12, W - M, footerY - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(91, 100, 120);
  doc.text(doc.splitTextToSize(data.disclaimer, W - M * 2), M, footerY);

  const slug = (audit.document?.title || "signclear")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  doc.save(`${slug}-pre-sign-brief.pdf`);
  return doc;
}

function clauseNumber(audit, clauseId) {
  const clause = (audit.clauses || []).find((c) => c.clause_id === clauseId);
  return clause?.index ?? "—";
}

export { rupees, DISCLAIMER };
