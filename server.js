const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
require("dotenv").config({ quiet: true });

const { profile } = require("./src/data/profile");
const { routeAssistantTurn } = require("./src/lib/assistant");
const { buildBaseAnalysis } = require("./src/lib/analysis-engine");
const { resolveCompanyContext } = require("./src/lib/company-context");
const { normalizeCandidateProfile, profileToCandidateProfile } = require("./src/lib/candidate-profile");
const { initializeDatabase, createSessionStore } = require("./src/lib/database");
const { listDiagnostics } = require("./src/lib/diagnostics");
const { searchLiveJobs } = require("./src/lib/jobs");
const { generateMyGPTTask, getMyGPTHealth } = require("./src/lib/mygpt");
const { refineAnalysisWithOpenAI } = require("./src/lib/openai");
const { parseResumeFile } = require("./src/lib/resume-parser");
const { createJsonReport, createPdfReport } = require("./src/lib/reporting");
const {
  constantTimeEquals,
  decryptJson,
  encryptJson,
  ensureCsrfToken,
  generateId,
  hashPassword,
  sanitizeDisplayName,
  sanitizeEmail,
  verifyPassword
} = require("./src/lib/security");

const app = express();
const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);
const host = "127.0.0.1";
const defaultCandidateProfile = profileToCandidateProfile(profile);
const dbReady = initializeDatabase(rootDir);
const REPORT_TOKENS = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowed = [".pdf", ".docx"];

    if (!allowed.includes(extension)) {
      callback(new Error("Unsupported resume file type. Please upload a PDF or DOCX file."));
      return;
    }

    callback(null, true);
  }
});

function cleanInput(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBool(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function wipeBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

function dedupeSources(sources = []) {
  const seen = new Set();
  const deduped = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const key = `${cleanInput(source.label, 160)}::${cleanInput(source.url, 500)}::${cleanInput(source.type, 40)}`;
    if (!source.url || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      label: cleanInput(source.label, 160) || cleanInput(source.url, 160),
      url: cleanInput(source.url, 500),
      type: cleanInput(source.type, 40) || "source"
    });
  }

  return deduped;
}

function parseLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function getOwnerEmail() {
  return sanitizeEmail(process.env.INTERVIEWPAL_OWNER_EMAIL || profile.email);
}

async function getOpenAIStatus() {
  return {
    available: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    detail: process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
      ? "Hosted refinement is available for owner-only advanced diagnostics."
      : "Set OPENAI_API_KEY and OPENAI_MODEL to enable owner-only hosted refinement.",
    capabilities: ["advanced refinement", "owner-only comparison"]
  };
}

async function getInternalProviders() {
  const mygpt = await getMyGPTHealth(rootDir);
  const openai = await getOpenAIStatus();

  return {
    activeDefault: "mygpt",
    mygpt,
    openai,
    deterministic: {
      available: true,
      detail: "Deterministic analysis pipelines backstop mygpt when local generation is unavailable.",
      capabilities: ["parsing", "scoring", "job ranking", "fallback composition"]
    }
  };
}

async function getDb() {
  return dbReady;
}

async function getUserById(userId) {
  const db = await getDb();
  return db.get("SELECT id, email, display_name, mygpt_opt_in, created_at, updated_at FROM users WHERE id = ?", [userId]);
}

async function getUserByEmail(email) {
  const db = await getDb();
  return db.get("SELECT * FROM users WHERE email = ?", [sanitizeEmail(email)]);
}

function isOwnerUser(user) {
  return Boolean(user && sanitizeEmail(user.email) === getOwnerEmail());
}

function serializeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    mygptOptIn: Boolean(user.mygpt_opt_in),
    owner: isOwnerUser(user),
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

async function saveWorkspaceItem(userId, kind, title, payload, format = "") {
  const db = await getDb();
  const id = generateId();
  const timestamp = new Date().toISOString();

  await db.run(
    `INSERT INTO saved_items (id, user_id, kind, format, title, encrypted_payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, kind, format || null, cleanInput(title, 180) || `${kind} snapshot`, encryptJson(payload), timestamp, timestamp]
  );

  return id;
}

async function listWorkspaceItems(userId, kind) {
  const db = await getDb();
  const rows = await db.all(
    "SELECT id, kind, format, title, encrypted_payload, created_at, updated_at FROM saved_items WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC",
    [userId, kind]
  );

  return rows.map((row) => {
    let payload = {};

    try {
      payload = decryptJson(row.encrypted_payload);
    } catch (error) {
      payload = {};
    }

    return {
      id: row.id,
      kind: row.kind,
      format: row.format || "",
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      summary: payload.summary?.headline || payload.summary?.fitSnapshot || payload.note || row.title,
      target: payload.target || null,
      taskType: payload.metadata?.taskType || ""
    };
  });
}

async function getWorkspaceItem(userId, kind, itemId) {
  const db = await getDb();
  const row = await db.get(
    "SELECT id, kind, format, title, encrypted_payload, created_at, updated_at FROM saved_items WHERE user_id = ? AND kind = ? AND id = ?",
    [userId, kind, itemId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind,
    format: row.format || "",
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload: decryptJson(row.encrypted_payload)
  };
}

function getAnalysisTitle(prefix, analysis) {
  return cleanInput(
    `${prefix}: ${analysis.targetJob?.title || analysis.summary?.headline || analysis.target?.role || "InterviewPal"}`,
    180
  );
}

async function maybeSaveAnalysis(req, kind, analysis, saveRequested) {
  if (!saveRequested) {
    return "";
  }

  if (!req.session.userId) {
    const error = new Error("Please sign in to save workspace items.");
    error.statusCode = 401;
    throw error;
  }

  return saveWorkspaceItem(req.session.userId, kind, getAnalysisTitle(kind, analysis), analysis);
}

function findTargetJob(jobs, jobUrl, company) {
  if (!Array.isArray(jobs) || !jobs.length) {
    return null;
  }

  if (jobUrl) {
    const exact = jobs.find((job) => job.applyUrl === jobUrl);
    if (exact) {
      return exact;
    }
  }

  if (company) {
    const sameCompany = jobs.find((job) => cleanInput(job.company).toLowerCase().includes(cleanInput(company).toLowerCase()));
    if (sameCompany) {
      return sameCompany;
    }
  }

  return jobs[0];
}

async function enrichWithMyGPT(analysis) {
  const [actionsTask, companyTask, reportTask] = await Promise.all([
    generateMyGPTTask(rootDir, {
      taskType: "next_actions",
      input: {
        targetRole: analysis.target?.role,
        topStrengths: analysis.summary?.topStrengths,
        topRisk: analysis.summary?.topRisk,
        actions: analysis.summary?.nextActions
      }
    }),
    generateMyGPTTask(rootDir, {
      taskType: "summarize_company_context",
      input: {
        company: analysis.target?.company,
        targetRole: analysis.target?.role,
        companySummary: analysis.companyContext?.summary,
        products: analysis.companyContext?.products,
        interviewSignals: analysis.companyContext?.interviewSignals
      }
    }),
    generateMyGPTTask(rootDir, {
      taskType: "report_polish",
      input: {
        targetRole: analysis.target?.role,
        company: analysis.target?.company,
        summary: analysis.summary?.fitSnapshot,
        topStrengths: analysis.summary?.topStrengths,
        topRisk: analysis.summary?.topRisk
      }
    })
  ]);

  analysis.summary.nextActions = parseLines(actionsTask.content).length
    ? parseLines(actionsTask.content)
    : analysis.summary.nextActions;
  analysis.companyContext.summary = companyTask.content || analysis.companyContext.summary;
  analysis.summary.reportSummary = reportTask.content || analysis.summary.fitSnapshot;
  analysis.metadata.validationState = [actionsTask.validationState, companyTask.validationState, reportTask.validationState].includes("fallback")
    ? "fallback"
    : actionsTask.validationState;
  analysis.metadata.fallbackUsed = Boolean(actionsTask.fallbackUsed || companyTask.fallbackUsed || reportTask.fallbackUsed);
  analysis.metadata.modelVersion = actionsTask.modelVersion || companyTask.modelVersion || reportTask.modelVersion;
  analysis.metadata.actualProvider = actionsTask.actualProvider || "deterministic";
  analysis.metadata.note = analysis.metadata.fallbackUsed
    ? "mygpt used deterministic fallback for at least one local generation task."
    : "mygpt generated polished local outputs from deterministic signals.";

  return analysis;
}

async function buildAnalysisResponse({
  role,
  company,
  location,
  focusArea,
  jobUrl,
  advancedProvider = "",
  candidateProfile,
  analysisMode,
  note = "",
  forceRefresh = false,
  taskType = "prep_brief"
}) {
  const providers = await getInternalProviders();
  const normalizedCandidate = normalizeCandidateProfile(candidateProfile || defaultCandidateProfile);
  const safeRole = cleanInput(role || "Software Engineer Intern");
  const safeCompany = cleanInput(company);
  const safeLocation = cleanInput(location);
  const safeFocusArea = cleanInput(focusArea || "Behavioral and project storytelling");
  const safeJobUrl = cleanInput(jobUrl, 500);
  const actualAdvancedProvider = cleanInput(advancedProvider, 40);

  const [companyContext, jobSearch] = await Promise.all([
    resolveCompanyContext({
      company: safeCompany,
      role: safeRole,
      jobUrl: safeJobUrl,
      forceRefresh
    }),
    searchLiveJobs({
      role: safeRole,
      company: safeCompany,
      location: safeLocation,
      internshipOnly: true,
      jobUrl: safeJobUrl,
      candidateProfile: normalizedCandidate,
      forceRefresh
    })
  ]);

  let analysis = buildBaseAnalysis({
    candidateProfile: normalizedCandidate,
    role: safeRole,
    company: safeCompany,
    location: safeLocation,
    focusArea: safeFocusArea,
    jobUrl: safeJobUrl,
    companyContext,
    provider: "mygpt-local-stack",
    analysisMode,
    note: note || jobSearch.note,
    jobs: jobSearch.jobs,
    targetJob: findTargetJob(jobSearch.jobs, safeJobUrl, safeCompany),
    taskType,
    sourceFreshness: {
      jobs: jobSearch.metadata?.retrievedAt || "",
      company: companyContext?.retrievedAt || ""
    }
  });

  analysis.metadata.sources = dedupeSources([
    ...(analysis.companyContext?.sources || []),
    ...(jobSearch.metadata?.sources || []),
    ...(analysis.liveJobs || []).map((job) => job.source)
  ]);

  if (actualAdvancedProvider === "openai" && providers.openai.available) {
    try {
      analysis = await refineAnalysisWithOpenAI({
        role: safeRole,
        company: safeCompany,
        focusArea: safeFocusArea,
        candidateProfile: normalizedCandidate,
        baseAnalysis: analysis
      });
      analysis.metadata.openaiRefined = true;
    } catch (error) {
      analysis.metadata.openaiRefined = false;
      analysis.metadata.openaiNote = `OpenAI owner-only refine failed: ${error.message}`;
    }
  }

  analysis = await enrichWithMyGPT(analysis);
  analysis.metadata.engine = "mygpt";
  analysis.metadata.retrievedAt = new Date().toISOString();
  analysis.metadata.sources = dedupeSources(analysis.metadata.sources);
  analysis.metadata.sourceFreshness = {
    jobs: jobSearch.metadata?.retrievedAt || analysis.metadata.retrievedAt,
    company: companyContext?.retrievedAt || analysis.metadata.retrievedAt
  };
  analysis.metadata.jobsRetrievedAt = jobSearch.metadata?.retrievedAt || analysis.metadata.retrievedAt;
  analysis.metadata.actualProvider = analysis.metadata.actualProvider || (providers.mygpt.available ? "mygpt" : "deterministic");

  return analysis;
}

function makeReportToken(payload) {
  const token = generateId();
  REPORT_TOKENS.set(token, {
    payload,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  return token;
}

function getReportToken(token) {
  const entry = REPORT_TOKENS.get(token);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    REPORT_TOKENS.delete(token);
    return null;
  }
  return entry.payload;
}

function createAuthLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many authentication requests. Please wait a few minutes and try again."
    }
  });
}

function createApiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 80,
    standardHeaders: true,
    legacyHeaders: false
  });
}

async function attachCurrentUser(req, res, next) {
  req.currentUser = req.session.userId ? await getUserById(req.session.userId) : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Please sign in to access saved workspaces." });
    return;
  }
  next();
}

function requireOwner(req, res, next) {
  if (!isOwnerUser(req.currentUser)) {
    res.status(403).json({ error: "Advanced diagnostics are limited to the project owner." });
    return;
  }
  next();
}

function requireCsrf(req, res, next) {
  if (!req.path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  const expected = ensureCsrfToken(req.session);
  const provided = req.get("x-csrf-token") || req.body?._csrf;

  if (!constantTimeEquals(expected, provided)) {
    res.status(403).json({ error: "Invalid CSRF token. Refresh the page and try again." });
    return;
  }

  next();
}

function kindFromMessage(message = "") {
  const lowered = cleanInput(message, 200).toLowerCase();
  if (lowered.includes("report")) return "report";
  if (lowered.includes("profile")) return "profile";
  if (lowered.includes("search")) return "job-search";
  return "prep";
}

async function loadSavedItemFromRequest(userId, { savedItemId, message }) {
  const kind = kindFromMessage(message);

  if (savedItemId) {
    return getWorkspaceItem(userId, kind, savedItemId);
  }

  const items = await listWorkspaceItems(userId, kind);
  if (!items.length) {
    return null;
  }

  return getWorkspaceItem(userId, kind, items[0].id);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : 0);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );

  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "interviewpal-development-session-secret",
  resave: false,
  saveUninitialized: false,
  store: createSessionStore(rootDir),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use((req, res, next) => {
  ensureCsrfToken(req.session);
  next();
});
app.use(createApiLimiter());
app.use("/api/auth", createAuthLimiter());
app.use(attachCurrentUser);
app.use(requireCsrf);

app.get("/api/profile", (req, res) => {
  res.json(defaultCandidateProfile);
});

app.get("/api/auth/me", async (req, res) => {
  res.json({
    authenticated: Boolean(req.currentUser),
    user: serializeUser(req.currentUser),
    csrfToken: ensureCsrfToken(req.session),
    engineBrand: "mygpt"
  });
});

app.get("/api/providers", requireOwner, async (req, res) => {
  res.json(await getInternalProviders());
});

app.get("/api/advanced/diagnostics", requireOwner, async (req, res) => {
  res.json({
    providers: await getInternalProviders(),
    logs: listDiagnostics(100)
  });
});

app.post("/api/auth/signup", async (req, res) => {
  const email = sanitizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const displayName = sanitizeDisplayName(req.body?.displayName) || email.split("@")[0] || "InterviewPal user";
  const mygptOptIn = cleanBool(req.body?.mygptOptIn);

  if (!email || !/.+@.+\..+/.test(email)) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Please use a password with at least 8 characters." });
    return;
  }

  if (await getUserByEmail(email)) {
    res.status(409).json({ error: "An account already exists for that email." });
    return;
  }

  const db = await getDb();
  const timestamp = new Date().toISOString();
  const userId = generateId();
  const passwordHash = await hashPassword(password);

  await db.run(
    `INSERT INTO users (id, email, password_hash, display_name, mygpt_opt_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, email, passwordHash, displayName, mygptOptIn ? 1 : 0, timestamp, timestamp]
  );

  req.session.userId = userId;
  const user = await getUserById(userId);
  res.status(201).json({
    authenticated: true,
    user: serializeUser(user),
    csrfToken: ensureCsrfToken(req.session)
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = sanitizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const user = await getUserByEmail(email);

  if (!user || !(await verifyPassword(user.password_hash, password))) {
    res.status(401).json({ error: "Email or password was incorrect." });
    return;
  }

  req.session.userId = user.id;
  res.json({
    authenticated: true,
    user: serializeUser(user),
    csrfToken: ensureCsrfToken(req.session)
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      authenticated: false
    });
  });
});

app.post("/api/auth/preferences", requireAuth, async (req, res) => {
  const db = await getDb();
  const mygptOptIn = cleanBool(req.body?.mygptOptIn);
  const timestamp = new Date().toISOString();
  await db.run(
    "UPDATE users SET mygpt_opt_in = ?, updated_at = ? WHERE id = ?",
    [mygptOptIn ? 1 : 0, timestamp, req.session.userId]
  );
  const user = await getUserById(req.session.userId);
  res.json({
    user: serializeUser(user)
  });
});

app.get("/api/account/export", requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(
    "SELECT id, kind, format, title, encrypted_payload, created_at, updated_at FROM saved_items WHERE user_id = ? ORDER BY updated_at DESC",
    [req.session.userId]
  );
  const payload = {
    user: serializeUser(req.currentUser),
    exportedAt: new Date().toISOString(),
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      format: row.format || "",
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: decryptJson(row.encrypted_payload)
    }))
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="interviewpal-account-export.json"');
  res.send(JSON.stringify(payload, null, 2));
});

app.delete("/api/account", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM users WHERE id = ?", [req.session.userId]);
  req.session.destroy(() => {
    res.json({
      deleted: true
    });
  });
});

app.get("/api/saved/profiles", requireAuth, async (req, res) => {
  res.json(await listWorkspaceItems(req.session.userId, "profile"));
});

app.get("/api/saved/searches", requireAuth, async (req, res) => {
  res.json(await listWorkspaceItems(req.session.userId, "job-search"));
});

app.get("/api/saved/prep", requireAuth, async (req, res) => {
  res.json(await listWorkspaceItems(req.session.userId, "prep"));
});

app.get("/api/saved/reports", requireAuth, async (req, res) => {
  res.json(await listWorkspaceItems(req.session.userId, "report"));
});

app.get("/api/saved/:kind/:id", requireAuth, async (req, res) => {
  const kind = cleanInput(req.params.kind, 40);
  const item = await getWorkspaceItem(req.session.userId, kind, req.params.id);

  if (!item) {
    res.status(404).json({ error: "Saved item not found." });
    return;
  }

  res.json(item);
});

app.get("/api/saved/reports/:id/download", requireAuth, async (req, res) => {
  const item = await getWorkspaceItem(req.session.userId, "report", req.params.id);

  if (!item) {
    res.status(404).json({ error: "Saved report not found." });
    return;
  }

  const format = cleanInput(req.query.format || item.format || "pdf", 8).toLowerCase();
  const buffer = format === "json" ? createJsonReport(item.payload) : await createPdfReport(item.payload);
  const fileName = `${item.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "interviewpal-report"}.${format}`;

  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.type(format === "json" ? "application/json" : "application/pdf");
  res.send(buffer);
});

app.post("/api/assistant/turn", async (req, res) => {
  try {
    let candidateProfile = null;

    if (req.body?.candidateProfile) {
      candidateProfile = normalizeCandidateProfile(req.body.candidateProfile);
    } else if (req.body?.candidateProfileId && req.session.userId) {
      const item = await getWorkspaceItem(req.session.userId, "profile", req.body.candidateProfileId);
      if (item?.payload?.candidate) {
        candidateProfile = normalizeCandidateProfile(item.payload.candidate);
      }
    }

    const advancedProvider = isOwnerUser(req.currentUser) ? cleanInput(req.body?.advancedProvider, 40) : "";
    const response = await routeAssistantTurn({
      rootDir,
      message: req.body?.message,
      preset: req.body?.preset,
      candidateProfile,
      candidateProfileId: req.body?.candidateProfileId,
      savedItemId: req.body?.savedItemId,
      role: req.body?.role,
      company: req.body?.company,
      location: req.body?.location,
      jobUrl: req.body?.jobUrl,
      forceRefresh: cleanBool(req.body?.forceRefresh),
      save: cleanBool(req.body?.save),
      advancedProvider,
      buildAnalysisResponse,
      workspace: {
        loadSavedItem: req.session.userId
          ? ({ savedItemId, message }) => loadSavedItemFromRequest(req.session.userId, { savedItemId, message })
          : null,
        saveAnalysis: req.session.userId
          ? (kind, analysis) => saveWorkspaceItem(req.session.userId, kind, getAnalysisTitle(kind, analysis), analysis)
          : null
      }
    });

    res.json(response);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Assistant request failed." });
  }
});

app.post("/api/jobs/search", async (req, res) => {
  try {
    const candidateProfile = req.body?.candidateProfile ? normalizeCandidateProfile(req.body.candidateProfile) : defaultCandidateProfile;
    const advancedProvider = isOwnerUser(req.currentUser) ? cleanInput(req.body?.advancedProvider, 40) : "";
    const analysis = await buildAnalysisResponse({
      role: req.body?.role,
      company: req.body?.company,
      location: req.body?.location,
      focusArea: "Live job search and internship targeting",
      jobUrl: req.body?.jobUrl,
      advancedProvider,
      candidateProfile,
      analysisMode: req.body?.candidateProfile ? "session-profile" : "default-profile",
      note: "Live jobs prefer official ATS and company sources first, with public fallback when needed.",
      forceRefresh: cleanBool(req.body?.forceRefresh),
      taskType: "job_search"
    });
    const savedSearchId = await maybeSaveAnalysis(req, "job-search", analysis, cleanBool(req.body?.save));
    res.json({
      ...analysis,
      savedSearchId
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Failed to search live jobs." });
  }
});

app.post("/api/prep", async (req, res) => {
  try {
    let candidateProfile = defaultCandidateProfile;
    let analysisMode = "default-profile";

    if (req.body?.candidateProfile) {
      candidateProfile = normalizeCandidateProfile(req.body.candidateProfile);
      analysisMode = "session-profile";
    }

    if (req.body?.candidateProfileId && req.session.userId) {
      const item = await getWorkspaceItem(req.session.userId, "profile", req.body.candidateProfileId);
      if (item?.payload?.candidate) {
        candidateProfile = normalizeCandidateProfile(item.payload.candidate);
        analysisMode = "saved-profile";
      }
    }

    const advancedProvider = isOwnerUser(req.currentUser) ? cleanInput(req.body?.advancedProvider, 40) : "";
    const analysis = await buildAnalysisResponse({
      role: req.body?.role,
      company: req.body?.company,
      location: req.body?.location,
      focusArea: req.body?.focusArea,
      jobUrl: req.body?.jobUrl,
      advancedProvider,
      candidateProfile,
      analysisMode,
      note: analysisMode === "default-profile"
        ? "Using Piyush Kumar Sharma's default student profile."
        : analysisMode === "saved-profile"
          ? "Using an encrypted saved profile from your workspace."
          : "Using the last parsed profile from this session.",
      forceRefresh: cleanBool(req.body?.forceRefresh),
      taskType: "prep_brief"
    });
    const savedPrepId = await maybeSaveAnalysis(req, "prep", analysis, cleanBool(req.body?.save));
    res.json({
      ...analysis,
      savedPrepId
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Failed to generate interview prep." });
  }
});

app.post("/api/analyze-resume", upload.single("resume"), async (req, res) => {
  let fileBuffer = null;

  try {
    if (!req.file) {
      throw new Error("Please upload a PDF or DOCX resume.");
    }

    fileBuffer = req.file.buffer;
    const parsed = await parseResumeFile(req.file);
    const lowSignal = parsed.extractedText.length < 180;
    const advancedProvider = isOwnerUser(req.currentUser) ? cleanInput(req.body?.advancedProvider, 40) : "";
    const analysis = await buildAnalysisResponse({
      role: req.body?.role,
      company: req.body?.company,
      location: req.body?.location,
      focusArea: "Resume review, internship readiness, and targeted optimization",
      jobUrl: req.body?.jobUrl,
      advancedProvider,
      candidateProfile: parsed.candidateProfile,
      analysisMode: lowSignal ? "fallback" : "uploaded-resume",
      note: lowSignal
        ? "Resume extraction was limited, so some sections may need manual review."
        : "Resume analyzed securely in memory and discarded after processing.",
      forceRefresh: cleanBool(req.body?.forceRefresh),
      taskType: "resume_review"
    });
    const savedProfileId = await maybeSaveAnalysis(req, "profile", analysis, cleanBool(req.body?.save));
    if (lowSignal) {
      analysis.metadata.note = `${analysis.metadata.note} Extraction confidence was limited.`;
    }
    res.json({
      ...analysis,
      savedProfileId,
      extractionMode: parsed.extractionMode
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Failed to analyze resume." });
  } finally {
    wipeBuffer(fileBuffer);
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    let payload = req.body?.payload;

    if (req.body?.savedItemId && req.session.userId) {
      const item = await getWorkspaceItem(req.session.userId, cleanInput(req.body?.kind || "prep", 40), req.body.savedItemId);
      payload = item?.payload || payload;
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("A grouped analysis payload is required to generate a report.");
    }

    const format = cleanInput(req.body?.format || "pdf", 8).toLowerCase();
    const save = cleanBool(req.body?.save);
    const title = cleanInput(req.body?.title || payload.summary?.headline || "InterviewPal report", 180);

    if (save) {
      if (!req.session.userId) {
        res.status(401).json({ error: "Please sign in to save downloadable reports." });
        return;
      }

      const reportId = await saveWorkspaceItem(req.session.userId, "report", title, payload, format);
      res.json({
        reportId,
        downloadUrl: `/api/saved/reports/${reportId}/download?format=${format}`
      });
      return;
    }

    const token = makeReportToken({
      title,
      payload,
      format
    });
    res.json({
      downloadUrl: `/api/reports/download/${token}?format=${format}`
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Failed to prepare the report." });
  }
});

app.get("/api/reports/download/:token", async (req, res) => {
  const report = getReportToken(req.params.token);

  if (!report) {
    res.status(404).json({ error: "Report link expired. Please regenerate the report." });
    return;
  }

  const format = cleanInput(req.query.format || report.format || "pdf", 8).toLowerCase();
  const buffer = format === "json" ? createJsonReport(report.payload) : await createPdfReport(report.payload);
  const fileName = `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "interviewpal-report"}.${format}`;

  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.type(format === "json" ? "application/json" : "application/pdf");
  res.send(buffer);
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Resume file is too large. Please keep uploads under 5 MB." });
    return;
  }

  if (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Request failed." });
    return;
  }

  next();
});

app.use(express.static(path.join(rootDir, "public")));

app.use(/^\/api\//, (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use((req, res) => {
  res.sendFile(path.join(rootDir, "public", "index.html"));
});

async function startServer() {
  await dbReady;
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`InterviewPal running at http://${host}:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  app,
  buildAnalysisResponse,
  getInternalProviders,
  startServer
};
