const PDFDocument = require("pdfkit");

function compact(values) {
  return (Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
}

function createJsonReport(payload) {
  return Buffer.from(JSON.stringify(payload, null, 2), "utf8");
}

function addBulletList(doc, items, fallback = "No items available.") {
  const list = compact(items);

  if (!list.length) {
    doc.font("Helvetica").fontSize(10).text(fallback);
    return;
  }

  for (const item of list) {
    doc.circle(doc.x + 2, doc.y + 6, 1.5).fill("#0f4c81").fillColor("black");
    doc.text(` ${item}`, { indent: 8 });
    doc.moveDown(0.25);
  }
}

function addSection(doc, title) {
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f4c81").text(title);
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10).fillColor("black");
}

function createPdfReport(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 42,
      size: "A4",
      info: {
        Title: payload.summary?.headline || "InterviewPal mygpt Report",
        Author: "InterviewPal"
      }
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#0f4c81").text("InterviewPal mygpt Report");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(11).fillColor("black").text(payload.summary?.headline || "Local-first career copilot export");
    doc.text(`Generated: ${payload.metadata?.retrievedAt || new Date().toISOString()}`);
    doc.text(`Engine: ${payload.metadata?.engine || "mygpt"}`);
    doc.text(`Context mode: ${payload.metadata?.contextMode || "fallback"}`);
    doc.text(`Jobs freshness: ${payload.metadata?.sourceFreshness?.jobs || payload.metadata?.retrievedAt || "not available"}`);
    doc.text(`Company freshness: ${payload.metadata?.sourceFreshness?.company || payload.metadata?.retrievedAt || "not available"}`);

    addSection(doc, "Fit Snapshot");
    doc.text(payload.summary?.fitSnapshot || "No summary available.");
    doc.moveDown(0.25);
    doc.text(payload.summary?.pitch || payload.summary?.reportSummary || "");

    addSection(doc, "Local-First Notes");
    addBulletList(doc, compact([
      payload.metadata?.fallbackUsed ? "Deterministic fallback protected at least one mygpt generation step." : "Local mygpt generation passed validation for the visible result.",
      payload.metadata?.note,
      payload.summary?.reportSummary
    ]));

    addSection(doc, "Top Strengths");
    addBulletList(doc, payload.summary?.topStrengths || payload.resumeAnalysis?.strengths);

    addSection(doc, "Top Improvements");
    addBulletList(doc, payload.resumeAnalysis?.improvementActions);

    addSection(doc, "Interview Questions");
    addBulletList(
      doc,
      (payload.recommendedQuestions || payload.resumeQuestions || [])
        .slice(0, 8)
        .map((item) => `${item.category || "Question"}: ${item.question || ""}`)
    );

    addSection(doc, "Job Search Direction");
    addBulletList(doc, payload.jobSearchRecommendations?.optimizationTips || payload.internshipRecommendations?.readinessNotes);

    addSection(doc, "Company Context");
    doc.text(payload.companyContext?.summary || "No company context available.");
    doc.moveDown(0.25);
    addBulletList(doc, payload.companyContext?.interviewSignals, "Using fallback company context.");

    addSection(doc, "Sources");
    addBulletList(
      doc,
      (payload.metadata?.sources || payload.companyContext?.sources || []).map((source) => `${source.label || source.url} (${source.type || "source"})`)
    );

    addSection(doc, "Privacy");
    addBulletList(doc, [
      "Uploaded resumes are analyzed in memory and discarded after processing.",
      "Saved workspace snapshots store structured output only.",
      "InterviewPal is designed as a privacy-first local mygpt workflow."
    ]);

    doc.end();
  });
}

module.exports = {
  createJsonReport,
  createPdfReport
};
