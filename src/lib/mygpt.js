const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { recordDiagnostic } = require("./diagnostics");

const HEALTH_CACHE = new Map();
const HEALTH_TTL_MS = 20 * 1000;

const TASK_SCHEMAS = {
  coaching_note: {
    maxChars: 280,
    fallbackType: "text"
  },
  rewrite_bullet: {
    maxChars: 280,
    fallbackType: "text"
  },
  generate_questions: {
    maxChars: 420,
    fallbackType: "lines"
  },
  summarize_company_context: {
    maxChars: 320,
    fallbackType: "text"
  },
  next_actions: {
    maxChars: 320,
    fallbackType: "lines"
  },
  report_polish: {
    maxChars: 420,
    fallbackType: "text"
  }
};

function getMyGPTArtifacts(rootDir) {
  const checkpointPath = path.join(rootDir, "model.pt");
  const scriptPath = path.join(rootDir, "ml", "generate_mygpt.py");
  const trainPath = path.join(rootDir, "ml", "train_mygpt.py");
  const workerPath = path.join(rootDir, "ml", "mygpt_worker.py");

  return {
    checkpointPath,
    scriptPath,
    trainPath,
    workerPath,
    checkpointExists: fs.existsSync(checkpointPath),
    scriptExists: fs.existsSync(scriptPath),
    trainExists: fs.existsSync(trainPath),
    workerExists: fs.existsSync(workerPath)
  };
}

function sha256ForFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function validateModelChecksum(checkpointPath) {
  if (!fs.existsSync(checkpointPath)) {
    return {
      ok: false,
      detail: "Train your local model first to create model.pt."
    };
  }

  const actual = sha256ForFile(checkpointPath);
  const expected = process.env.MYGPT_MODEL_SHA256;

  if (expected && expected !== actual) {
    return {
      ok: false,
      detail: "The local mygpt checkpoint failed checksum validation."
    };
  }

  return {
    ok: true,
    hash: actual
  };
}

function runWorker(rootDir, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const artifacts = getMyGPTArtifacts(rootDir);

    if (!artifacts.workerExists) {
      reject(new Error("mygpt worker script is missing."));
      return;
    }

    const child = spawn("python3", [artifacts.workerPath], {
      cwd: rootDir,
      env: {
        ...process.env,
        MYGPT_DISABLE_NETWORK: "1",
        http_proxy: "",
        https_proxy: "",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NO_PROXY: "*"
      }
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("mygpt timed out while generating a response."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `mygpt worker exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("mygpt worker returned invalid JSON."));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function getMyGPTHealth(rootDir, { forceRefresh = false } = {}) {
  const cacheKey = rootDir;
  const cached = HEALTH_CACHE.get(cacheKey);

  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const artifacts = getMyGPTArtifacts(rootDir);

  if (!artifacts.scriptExists || !artifacts.workerExists) {
    const missing = {
      available: false,
      detail: "Local mygpt scripts are incomplete.",
      capabilities: ["task-constrained local generation", "career note polishing", "job-fit explanations"]
    };
    HEALTH_CACHE.set(cacheKey, {
      value: missing,
      expiresAt: Date.now() + HEALTH_TTL_MS
    });
    return missing;
  }

  const checksum = validateModelChecksum(artifacts.checkpointPath);

  if (!checksum.ok) {
    const unavailable = {
      available: false,
      detail: checksum.detail,
      capabilities: ["task-constrained local generation", "career note polishing", "job-fit explanations"]
    };
    HEALTH_CACHE.set(cacheKey, {
      value: unavailable,
      expiresAt: Date.now() + HEALTH_TTL_MS
    });
    return unavailable;
  }

  try {
    const payload = await runWorker(rootDir, {
      mode: "health"
    }, 16000);

    const health = {
      available: Boolean(payload?.ok),
      detail: payload?.ok ? "Local mygpt worker is healthy and ready." : "Local mygpt worker could not load the checkpoint.",
      capabilities: ["task-constrained local generation", "career note polishing", "job-fit explanations", "report phrasing"],
      version: payload?.version || "local-mygpt",
      modelHash: checksum.hash
    };

    HEALTH_CACHE.set(cacheKey, {
      value: health,
      expiresAt: Date.now() + HEALTH_TTL_MS
    });
    return health;
  } catch (error) {
    const failed = {
      available: false,
      detail: error.message,
      capabilities: ["task-constrained local generation", "career note polishing", "job-fit explanations"]
    };
    HEALTH_CACHE.set(cacheKey, {
      value: failed,
      expiresAt: Date.now() + HEALTH_TTL_MS
    });
    return failed;
  }
}

function compact(values) {
  return [...new Set((values || []).map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function looksLikePromptEcho(text) {
  const normalized = String(text || "").toLowerCase();
  return [
    "you are mygpt",
    "return a concise",
    "focus area:",
    "role:",
    "company:",
    "top strengths:",
    "target job:",
    "### task",
    "input:",
    "output:"
  ].some((snippet) => normalized.includes(snippet));
}

function looksCorrupted(text) {
  const value = String(text || "");
  const weirdFragments = value.match(/\b[a-z]?[.]?[a-z]{0,2}\.[a-z]{1,5}\b/gi) || [];
  const repeatedFragments = value.match(/\b(\w{2,})\b(?:\s+\1\b){2,}/gi) || [];
  const brokenWords = value.match(/\b\w{1,2}\.\w{2,}\b/g) || [];
  return weirdFragments.length >= 3 || repeatedFragments.length >= 1 || brokenWords.length >= 2;
}

function cleanGeneratedText(text, maxChars) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-:|>]+/, "")
    .trim()
    .slice(0, maxChars || 280);
}

function cleanClause(value, maxChars = 260) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.!,;:]+$/g, "")
    .trim()
    .slice(0, maxChars);
}

function validateMyGPTText(taskType, text) {
  const schema = TASK_SCHEMAS[taskType] || TASK_SCHEMAS.coaching_note;
  const cleaned = cleanGeneratedText(text, schema.maxChars);
  const passed = Boolean(
    cleaned &&
      cleaned.length >= 24 &&
      cleaned.length <= schema.maxChars &&
      !looksLikePromptEcho(cleaned) &&
      !looksCorrupted(cleaned)
  );

  return {
    passed,
    cleaned,
    reason: passed ? "passed" : "failed_validation"
  };
}

function buildFallbackTaskResult(taskType, packet) {
  switch (taskType) {
    case "rewrite_bullet": {
      const originalBullet = String(packet.originalBullet || "").replace(/^[-*]\s*/, "").replace(/\.$/, "").trim();
      if (!originalBullet) {
        return "Built a stronger outcome-first bullet that emphasizes tools, scope, and measurable impact.";
      }

      const rewrittenStem = /^built\b/i.test(originalBullet) ? originalBullet : `Built ${originalBullet.charAt(0).toLowerCase()}${originalBullet.slice(1)}`;
      return `${rewrittenStem}, emphasizing tools, ownership, and measurable impact where accurate.`;
    }
    case "generate_questions":
      return compact([
        `What makes you a strong fit for ${packet.targetRole || "this role"} right now?`,
        packet.topProject ? `Walk me through ${packet.topProject} and the hardest technical decision you made.` : "Tell me about the strongest project on your resume.",
        packet.topRisk ? `How are you closing the gap around ${packet.topRisk.toLowerCase()}?` : "What is the biggest gap you are closing before your next interview?"
      ]).join("\n");
    case "summarize_company_context":
      return packet.companySummary || "This company context was assembled from official and public sources, so focus on role fit, mission alignment, and how your projects reduce ramp-up risk.";
    case "next_actions":
      return compact(packet.actions || [
        "Tighten one project bullet with clearer impact.",
        "Practice a concise project walkthrough.",
        "Align your resume language to the target role."
      ]).join("\n");
    case "report_polish": {
      const cleanedSummary = cleanClause(packet.summary);
      const cleanedRisk = cleanClause(packet.topRisk);

      if (!cleanedSummary) {
        return "This report combines resume analysis, job-fit signals, and company-aware preparation into a private local-first workflow.";
      }

      if (cleanedRisk && !/biggest risk|top risk/i.test(cleanedSummary)) {
        return `${cleanedSummary}. The next improvement is to tighten ${cleanedRisk.toLowerCase()}.`;
      }

      return `${cleanedSummary}.`;
    }
    case "coaching_note":
    default:
      return cleanClause(packet.topRisk)
        ? `You are positioned well for ${packet.targetRole || "internship"} opportunities. Strengthen your next pass by addressing ${cleanClause(packet.topRisk).toLowerCase()} and leading with your best project evidence.`
        : `You are positioned well for ${packet.targetRole || "internship"} opportunities. Lead with your strongest project, show measurable impact, and make the fit story tighter.`;
  }
}

function buildTaskPrompt(taskType, packet, retry = false) {
  const schema = TASK_SCHEMAS[taskType] || TASK_SCHEMAS.coaching_note;
  return [
    "You are mygpt, a privacy-first local career model.",
    `Task: ${taskType}`,
    retry ? "Retry mode: avoid prompt echo, malformed words, repetition, and extra framing." : "Generate only the requested content.",
    `Max chars: ${schema.maxChars}`,
    "Use only the structured packet below.",
    JSON.stringify(packet)
  ].join("\n");
}

function toTaskPacket(taskType, input = {}) {
  switch (taskType) {
    case "rewrite_bullet":
      return {
        task: taskType,
        targetRole: input.targetRole || "Software Engineer Intern",
        company: input.company || "",
        originalBullet: input.originalBullet || "",
        missingSignals: compact(input.missingSignals || []).slice(0, 4),
        tone: "professional, concise, ownership-forward"
      };
    case "generate_questions":
      return {
        task: taskType,
        targetRole: input.targetRole || "Software Engineer Intern",
        company: input.company || "",
        topProject: input.topProject || "",
        topRisk: input.topRisk || "",
        strengths: compact(input.strengths || []).slice(0, 3),
        maxQuestions: 3
      };
    case "summarize_company_context":
      return {
        task: taskType,
        company: input.company || "",
        targetRole: input.targetRole || "Software Engineer Intern",
        companySummary: input.companySummary || "",
        products: compact(input.products || []).slice(0, 4),
        interviewSignals: compact(input.interviewSignals || []).slice(0, 3)
      };
    case "next_actions":
      return {
        task: taskType,
        targetRole: input.targetRole || "Software Engineer Intern",
        topStrengths: compact(input.topStrengths || []).slice(0, 3),
        topRisk: input.topRisk || "",
        actions: compact(input.actions || []).slice(0, 4)
      };
    case "report_polish":
      return {
        task: taskType,
        targetRole: input.targetRole || "Software Engineer Intern",
        company: input.company || "",
        summary: input.summary || "",
        topStrengths: compact(input.topStrengths || []).slice(0, 3),
        topRisk: input.topRisk || ""
      };
    case "coaching_note":
    default:
      return {
        task: "coaching_note",
        candidateName: input.candidateName || "Candidate",
        targetRole: input.targetRole || "Software Engineer Intern",
        company: input.company || "",
        topStrengths: compact(input.topStrengths || []).slice(0, 3),
        topRisk: input.topRisk || "",
        actions: compact(input.actions || []).slice(0, 4),
        maxWords: 45
      };
  }
}

async function generateMyGPTTask(rootDir, { taskType, input }) {
  const packet = toTaskPacket(taskType, input);
  const schema = TASK_SCHEMAS[taskType] || TASK_SCHEMAS.coaching_note;
  const health = await getMyGPTHealth(rootDir);
  const fallbackContent = buildFallbackTaskResult(taskType, {
    ...packet,
    ...input
  });

  if (!health.available) {
    recordDiagnostic({
      type: "warning",
      scope: "mygpt",
      taskType,
      validationState: "fallback",
      fallbackUsed: true,
      note: health.detail
    });

    return {
      taskType,
      content: fallbackContent,
      validationState: "fallback",
      fallbackUsed: true,
      actualProvider: "deterministic",
      modelVersion: "deterministic-fallback",
      modelHash: "",
      packet
    };
  }

  for (const retry of [false, true]) {
    try {
      const raw = await runWorker(rootDir, {
        mode: "generate",
        prompt: buildTaskPrompt(taskType, packet, retry),
        maxNewTokens: retry ? 60 : 90
      });
      const validation = validateMyGPTText(taskType, raw?.note || raw?.rawText || "");

      if (validation.passed) {
        recordDiagnostic({
          type: "info",
          scope: "mygpt",
          taskType,
          validationState: retry ? "passed_on_retry" : "passed",
          fallbackUsed: false,
          note: "mygpt task passed validation",
          details: {
            version: raw?.version || health.version
          }
        });

        return {
          taskType,
          content: validation.cleaned,
          validationState: retry ? "passed_on_retry" : "passed",
          fallbackUsed: false,
          actualProvider: "mygpt",
          modelVersion: raw?.version || health.version,
          modelHash: health.modelHash,
          packet
        };
      }
    } catch (error) {
      recordDiagnostic({
        type: "warning",
        scope: "mygpt",
        taskType,
        validationState: retry ? "retry_error" : "first_pass_error",
        fallbackUsed: false,
        note: error.message
      });
    }
  }

  recordDiagnostic({
    type: "warning",
    scope: "mygpt",
    taskType,
    validationState: "fallback",
    fallbackUsed: true,
    note: "mygpt output failed validation and deterministic fallback was used."
  });

  return {
    taskType,
    content: cleanGeneratedText(fallbackContent, schema.maxChars),
    validationState: "fallback",
    fallbackUsed: true,
    actualProvider: "deterministic",
    modelVersion: health.version || "deterministic-fallback",
    modelHash: health.modelHash || "",
    packet
  };
}

module.exports = {
  TASK_SCHEMAS,
  generateMyGPTTask,
  getMyGPTArtifacts,
  getMyGPTHealth,
  validateMyGPTText
};
