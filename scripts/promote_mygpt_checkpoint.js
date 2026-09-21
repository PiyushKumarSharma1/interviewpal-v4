const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CANDIDATE = path.join(ROOT_DIR, "model.pt");
const SUMMARY_PATH = path.join(ROOT_DIR, "evals", "latest-summary.json");
const MANIFEST_PATH = path.join(ROOT_DIR, "model_versions", "manifest.json");
const ARCHIVE_DIR = path.join(ROOT_DIR, "model_versions", "archive");
const PROMOTION_DIR = path.join(ROOT_DIR, "model_versions", "promotions");

function parseArgs(argv) {
  const args = { candidate: DEFAULT_CANDIDATE, summary: SUMMARY_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--candidate" && argv[index + 1]) {
      args.candidate = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--summary" && argv[index + 1]) {
      args.summary = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      current: null,
      promotions: []
    };
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function saveManifest(manifest) {
  ensureDir(path.dirname(MANIFEST_PATH));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function promotionThresholdsFailed(summary) {
  const overall = summary?.summary?.overall || {};
  const failures = [];

  if ((overall.formatPassRate || 0) < 0.9) failures.push("formatPassRate < 0.90");
  if ((overall.coherencePassRate || 0) < 0.85) failures.push("coherencePassRate < 0.85");
  if ((overall.promptEchoPassRate || 0) < 0.95) failures.push("promptEchoPassRate < 0.95");
  if ((overall.fallbackRate || 1) >= 0.7) failures.push("fallbackRate >= 0.70");
  if ((overall.avgRelevanceScore || 0) < 0.55) failures.push("avgRelevanceScore < 0.55");
  if ((overall.avgFaithfulnessScore || 0) < 0.5) failures.push("avgFaithfulnessScore < 0.50");

  return failures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.candidate)) {
    throw new Error(`Candidate checkpoint not found: ${args.candidate}`);
  }

  if (!fs.existsSync(args.summary)) {
    throw new Error(`Eval summary not found: ${args.summary}`);
  }

  const evalSummary = JSON.parse(fs.readFileSync(args.summary, "utf8"));
  const failures = promotionThresholdsFailed(evalSummary);

  if (failures.length) {
    throw new Error(`Promotion blocked. Thresholds failed: ${failures.join(", ")}`);
  }

  ensureDir(ARCHIVE_DIR);
  ensureDir(PROMOTION_DIR);

  const manifest = loadManifest();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const productionPath = path.join(ROOT_DIR, "model.pt");
  const archivedCurrent = fs.existsSync(productionPath) ? path.join(ARCHIVE_DIR, `model-${timestamp}.pt`) : "";

  if (archivedCurrent) {
    fs.copyFileSync(productionPath, archivedCurrent);
  }

  if (path.resolve(args.candidate) !== productionPath) {
    fs.copyFileSync(args.candidate, productionPath);
  }

  const promotedHash = sha256(productionPath);
  const promotionRecord = {
    promotedAt: new Date().toISOString(),
    promotedFrom: args.candidate,
    promotedHash,
    archivedPreviousCheckpoint: archivedCurrent || null,
    evalSummaryPath: args.summary,
    evalOverall: evalSummary.summary?.overall || {}
  };

  fs.writeFileSync(
    path.join(PROMOTION_DIR, `promotion-${timestamp}.json`),
    JSON.stringify(promotionRecord, null, 2)
  );

  manifest.current = {
    path: "model.pt",
    hash: promotedHash,
    promotedAt: promotionRecord.promotedAt
  };
  manifest.promotions = Array.isArray(manifest.promotions) ? manifest.promotions : [];
  manifest.promotions.unshift(promotionRecord);
  manifest.promotions = manifest.promotions.slice(0, 30);
  saveManifest(manifest);

  console.log("Checkpoint promoted to production model.pt");
  console.log(JSON.stringify(promotionRecord, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
