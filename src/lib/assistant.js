const { normalizeCandidateProfile } = require("./candidate-profile");
const { generateMyGPTTask } = require("./mygpt");
const { normalizeText } = require("./keywords");
const { recordDiagnostic } = require("./diagnostics");

function cleanInput(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compact(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function inferRole(message) {
  const lowered = normalizeText(message);

  if (lowered.includes("frontend")) return "Frontend Engineer Intern";
  if (lowered.includes("backend")) return "Backend Engineer Intern";
  if (lowered.includes("full stack") || lowered.includes("full-stack")) return "Full Stack Engineer Intern";
  if (lowered.includes("data science")) return "Data Science Intern";
  if (lowered.includes("data analyst")) return "Data Analyst Intern";
  if (lowered.includes("machine learning")) return "Machine Learning Intern";
  if (lowered.includes("software engineer")) return "Software Engineer Intern";
  return "Software Engineer Intern";
}

function inferCompany(message) {
  const patterns = [
    /(?:at|for)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/,
    /(?:company|employer)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/
  ];

  for (const pattern of patterns) {
    const match = String(message || "").match(pattern);
    if (match?.[1]) {
      return cleanInput(match[1], 80);
    }
  }

  return "";
}

function inferLocation(message) {
  const match = String(message || "").match(/(?:in|near)\s+([A-Z][A-Za-z .-]{1,40})/);
  return match?.[1] ? cleanInput(match[1], 80) : "";
}

function extractBulletText(message) {
  const quoted = String(message || "").match(/["“](.+?)["”]/);
  if (quoted?.[1]) {
    return cleanInput(quoted[1], 260);
  }

  const afterColon = String(message || "").split(":").slice(1).join(":").trim();
  if (afterColon) {
    return cleanInput(afterColon, 260);
  }

  return "";
}

function detectIntent(message) {
  const lowered = normalizeText(message);

  if (/rewrite|improve|fix/.test(lowered) && lowered.includes("bullet")) {
    return "rewrite_bullet";
  }

  if (/(download|export|report)/.test(lowered)) {
    return "report_export";
  }

  if (/(load|open|show).*(saved|report|profile|prep|search)/.test(lowered)) {
    return "workspace_load";
  }

  if (/(question|interview|mock|prep|behavioral)/.test(lowered)) {
    return "prep_brief";
  }

  if (/(job|internship|intern|opening|apply|role)/.test(lowered)) {
    return "job_search";
  }

  if (/(resume|cv|analyze my profile|review my profile)/.test(lowered)) {
    return "resume_review";
  }

  return "career_coach";
}

function buildFriendlyBadges(analysis) {
  const badges = ["mygpt local"];

  if (analysis?.companyContext?.mode === "live" || analysis?.liveJobs?.length) {
    badges.push("live data");
  }

  if (analysis?.metadata?.sources?.some((source) => source.type === "official")) {
    badges.push("official sources");
  }

  if (analysis?.metadata?.fallbackUsed || analysis?.companyContext?.mode === "fallback") {
    badges.push("fallback used");
  }

  return badges;
}

async function buildAssistantReply(rootDir, taskType, analysis, extras = {}) {
  const taskInputs = {
    coaching_note: {
      candidateName: analysis?.candidate?.identity?.name || "Candidate",
      targetRole: analysis?.target?.role || extras.role || "Software Engineer Intern",
      company: analysis?.target?.company || extras.company || "",
      topStrengths: analysis?.summary?.topStrengths || [],
      topRisk: analysis?.summary?.topRisk || "",
      actions: analysis?.summary?.nextActions || []
    },
    next_actions: {
      targetRole: analysis?.target?.role || extras.role || "Software Engineer Intern",
      topStrengths: analysis?.summary?.topStrengths || [],
      topRisk: analysis?.summary?.topRisk || "",
      actions: analysis?.summary?.nextActions || extras.actions || []
    },
    summarize_company_context: {
      company: analysis?.target?.company || extras.company || "",
      targetRole: analysis?.target?.role || extras.role || "Software Engineer Intern",
      companySummary: analysis?.companyContext?.summary || "",
      products: analysis?.companyContext?.products || [],
      interviewSignals: analysis?.companyContext?.interviewSignals || []
    },
    rewrite_bullet: {
      targetRole: extras.role || analysis?.target?.role || "Software Engineer Intern",
      company: extras.company || analysis?.target?.company || "",
      originalBullet: extras.originalBullet || "",
      missingSignals: extras.missingSignals || analysis?.resumeAnalysis?.missingKeywords || []
    },
    generate_questions: {
      targetRole: analysis?.target?.role || extras.role || "Software Engineer Intern",
      company: analysis?.target?.company || extras.company || "",
      topProject: analysis?.candidate?.projects?.[0]?.name || "",
      topRisk: analysis?.summary?.topRisk || "",
      strengths: analysis?.summary?.topStrengths || []
    },
    report_polish: {
      targetRole: analysis?.target?.role || extras.role || "Software Engineer Intern",
      company: analysis?.target?.company || extras.company || "",
      summary: analysis?.summary?.fitSnapshot || extras.summary || "",
      topStrengths: analysis?.summary?.topStrengths || [],
      topRisk: analysis?.summary?.topRisk || ""
    }
  };

  return generateMyGPTTask(rootDir, {
    taskType,
    input: taskInputs[taskType] || taskInputs.coaching_note
  });
}

async function routeAssistantTurn({
  rootDir,
  message,
  candidateProfile,
  candidateProfileId,
  savedItemId,
  role,
  company,
  location,
  jobUrl,
  forceRefresh = false,
  save = false,
  advancedProvider = "",
  buildAnalysisResponse,
  workspace
}) {
  const taskType = detectIntent(message);
  const inferredRole = cleanInput(role || inferRole(message), 120);
  const inferredCompany = cleanInput(company || inferCompany(message), 120);
  const inferredLocation = cleanInput(location || inferLocation(message), 120);
  const normalizedCandidate = candidateProfile ? normalizeCandidateProfile(candidateProfile) : null;

  recordDiagnostic({
    type: "info",
    scope: "assistant",
    taskType,
    note: `Natural-language request routed: ${cleanInput(message, 180)}`
  });

  if (taskType === "rewrite_bullet") {
    const originalBullet = extractBulletText(message);
    const rewrite = await buildAssistantReply(rootDir, "rewrite_bullet", null, {
      originalBullet,
      role: inferredRole,
      company: inferredCompany
    });

    return {
      taskType,
      reply: rewrite.content,
      cards: [{
        type: "bullet-rewrite",
        title: "Bullet rewrite",
        original: originalBullet || "No original bullet was detected.",
        rewritten: rewrite.content
      }],
      metadata: {
        engine: "mygpt",
        modelVersion: rewrite.modelVersion,
        validationState: rewrite.validationState,
        fallbackUsed: rewrite.fallbackUsed,
        actualProvider: rewrite.actualProvider
      }
    };
  }

  if (taskType === "report_export") {
    return {
      taskType,
      reply: "I can package the current analysis as a downloadable report. Use the download buttons in the report bar or ask me again after you generate a resume review, job search, or prep brief.",
      cards: [{
        type: "hint",
        title: "Report export",
        body: "Generate or load an analysis first, then export it as PDF or JSON."
      }],
      metadata: {
        engine: "mygpt",
        validationState: "deterministic",
        fallbackUsed: false
      }
    };
  }

  if (taskType === "workspace_load") {
    if (!workspace?.loadSavedItem) {
      return {
        taskType,
        reply: "Sign in first and I can open saved profiles, job searches, prep sessions, or reports from your workspace.",
        cards: [],
        metadata: {
          engine: "mygpt",
          validationState: "deterministic",
          fallbackUsed: false
        }
      };
    }

    const item = await workspace.loadSavedItem({
      savedItemId,
      message
    });

    if (!item) {
      return {
        taskType,
        reply: "I could not find a matching saved workspace item yet. Try loading one from the saved panel.",
        cards: [],
        metadata: {
          engine: "mygpt",
          validationState: "deterministic",
          fallbackUsed: false
        }
      };
    }

    return {
      taskType,
      reply: `Loaded ${item.kind} snapshot: ${item.title}.`,
      analysis: item.payload,
      cards: [{
        type: "workspace-load",
        title: item.title,
        body: item.payload?.summary?.fitSnapshot || "Saved workspace snapshot loaded."
      }],
      metadata: {
        engine: "mygpt",
        validationState: "deterministic",
        fallbackUsed: false
      }
    };
  }

  if (taskType === "resume_review" && !normalizedCandidate && !candidateProfileId) {
    return {
      taskType,
      reply: "I can analyze your resume and use it for job search or interview prep. Upload a PDF or DOCX in the workspace tools, then I’ll use that profile in chat.",
      cards: [{
        type: "hint",
        title: "Resume needed",
        body: "Upload a PDF or DOCX resume first, or reuse an already parsed profile."
      }],
      metadata: {
        engine: "mygpt",
        validationState: "deterministic",
        fallbackUsed: false
      }
    };
  }

  const analysis = await buildAnalysisResponse({
    role: inferredRole,
    company: inferredCompany,
    location: inferredLocation,
    focusArea:
      taskType === "job_search"
        ? "Live internship and job search"
        : taskType === "resume_review"
          ? "Resume review and internship readiness"
          : "Interview prep, questions, and company targeting",
    jobUrl: jobUrl || "",
    advancedProvider,
    candidateProfile: normalizedCandidate,
    candidateProfileId,
    analysisMode: normalizedCandidate ? "assistant-session-profile" : candidateProfileId ? "assistant-saved-profile" : "assistant-default-profile",
    note: "Natural-language request routed through mygpt.",
    forceRefresh,
    taskType
  });

  let replyTask = "coaching_note";
  if (taskType === "job_search") {
    replyTask = "next_actions";
  } else if (taskType === "prep_brief") {
    replyTask = "coaching_note";
  } else if (taskType === "career_coach") {
    replyTask = "coaching_note";
  } else if (taskType === "resume_review") {
    replyTask = "coaching_note";
  }

  const assistantReply = await buildAssistantReply(rootDir, replyTask, analysis, {
    role: inferredRole,
    company: inferredCompany
  });

  if (save && workspace?.saveAnalysis) {
    const savedId = await workspace.saveAnalysis(taskType === "job_search" ? "job-search" : taskType === "prep_brief" ? "prep" : "profile", analysis);
    analysis.savedByAssistantId = savedId;
  }

  analysis.metadata.engine = "mygpt";
  analysis.metadata.validationState = assistantReply.validationState;
  analysis.metadata.fallbackUsed = assistantReply.fallbackUsed;
  analysis.metadata.modelVersion = assistantReply.modelVersion;
  analysis.metadata.actualProvider = assistantReply.actualProvider;
  analysis.metadata.taskType = taskType;
  analysis.metadata.userVisibleBadges = buildFriendlyBadges(analysis);

  return {
    taskType,
    reply: assistantReply.content,
    analysis,
    cards: [{
      type: "assistant-summary",
      title: analysis.summary?.headline || "mygpt response",
      body: assistantReply.content
    }],
    metadata: {
      engine: "mygpt",
      modelVersion: assistantReply.modelVersion,
      validationState: assistantReply.validationState,
      fallbackUsed: assistantReply.fallbackUsed,
      actualProvider: assistantReply.actualProvider,
      userVisibleBadges: buildFriendlyBadges(analysis)
    }
  };
}

module.exports = {
  detectIntent,
  routeAssistantTurn
};
