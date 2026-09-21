const { normalizeCandidateProfile, getCandidateSkillSet, profileToCandidateProfile, uniqueCompact } = require("./candidate-profile");
const { ROLE_KEYWORDS, STUDENT_COMPANY_BUCKETS, normalizeText } = require("./keywords");
const { buildFallbackContext } = require("./company-context");
const { extractCandidateSignals } = require("./feature-engine");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dedupeSources(sources = []) {
  const seen = new Set();
  const deduped = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const key = `${source.label || ""}::${source.url || ""}::${source.type || ""}`;
    if (!source.url || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function targetRole(role) {
  return role || "Software Engineer Intern";
}

function getRoleKeywords(role) {
  const normalized = normalizeText(role);
  const matched = Object.entries(ROLE_KEYWORDS)
    .filter(([keyword]) => normalized.includes(keyword))
    .flatMap(([, items]) => items);

  return uniqueCompact(matched.length ? matched : ["React", "FastAPI", "Python", "SQL", "Problem solving", "Ownership"]);
}

function profileCompletionScore(candidate) {
  let points = 0;

  if (candidate.identity.name) points += 10;
  if (candidate.identity.email || candidate.identity.links.length) points += 10;
  if (candidate.education.length) points += 15;
  if (candidate.skills.all.length >= 6) points += 20;
  if (candidate.projects.length >= 2) points += 20;
  if (candidate.experience.length >= 1) points += 15;
  if (candidate.leadership.length >= 1) points += 10;

  return clamp(points, 0, 100);
}

function getWeakBulletPatterns(candidate) {
  const bullets = [
    ...candidate.projects.flatMap((item) => item.highlights || []),
    ...candidate.experience.flatMap((item) => item.bullets || [])
  ];

  return uniqueCompact(
    bullets.filter((bullet) => bullet && (bullet.length < 16 || !/\d|built|designed|implemented|developed|automated|reduced|improved|optimized|launched/i.test(bullet))).slice(0, 5)
  );
}

function buildDimension(score, why, evidence = [], missing = [], improvementLever = "") {
  return {
    score: clamp(Math.round(score), 0, 100),
    why,
    evidence: uniqueCompact(evidence).slice(0, 5),
    missing: uniqueCompact(missing).slice(0, 5),
    improvementLever
  };
}

function buildScoreDimensions(candidate, role, targetJob, signals) {
  const weakBullets = getWeakBulletPatterns(candidate);
  const skills = candidate.skills.all || [];
  const projectHighlights = candidate.projects.flatMap((item) => item.highlights || []);

  const contentScore = clamp(34 + profileCompletionScore(candidate) * 0.5 + candidate.education.length * 8 + candidate.projects.length * 5, 0, 100);
  const technicalDepthScore = clamp(30 + skills.length * 3 + candidate.projects.length * 8 + candidate.experience.length * 4, 0, 100);
  const impactScore = clamp(24 + signals.quantifiedBullets.count * 9 + Math.min(signals.impactVerbs.length, 6) * 5, 0, 100);
  const clarityScore = clamp(76 - weakBullets.length * 7 + Math.min(candidate.rawSignals.bulletCount || 0, 12), 0, 100);
  const studentPositioningScore = clamp(44 + candidate.education.length * 18 + candidate.projects.length * 6 + candidate.leadership.length * 7, 0, 100);
  const roleFitScore = clamp(26 + signals.technicalStackAlignment.length * 10 + (targetJob ? 8 : 0) - signals.missingRoleKeywords.length * 2, 0, 100);
  const projectDepthScore = clamp(34 + signals.projectDepth.strongProjects * 16 + candidate.projects.length * 6, 0, 100);
  const internshipReadinessScore = clamp(signals.internshipRelevance, 0, 100);
  const collaborationSignalScore = clamp(28 + signals.collaborationEvidence.length * 14 + candidate.experience.length * 6, 0, 100);
  const ownershipSignalScore = clamp(24 + signals.ownershipEvidence.length * 16 + Math.min(projectHighlights.length, 4) * 5, 0, 100);

  return {
    content: buildDimension(
      contentScore,
      "The resume is strongest when core sections are complete and easy to scan.",
      [
        candidate.education[0]?.school,
        candidate.projects[0]?.name,
        candidate.identity.links[0]
      ],
      candidate.education.length ? [] : ["education details"],
      "Make sure education, links, and your strongest two projects are immediately visible."
    ),
    technicalDepth: buildDimension(
      technicalDepthScore,
      "Technical depth comes from tool overlap, build complexity, and visible implementation detail.",
      skills.slice(0, 5),
      skills.length < 5 ? getRoleKeywords(role).slice(0, 3) : [],
      "Add one more technically specific bullet showing architecture, data flow, or backend depth."
    ),
    impact: buildDimension(
      impactScore,
      "Impact improves when outcomes are quantified and action verbs are concrete.",
      [...signals.quantifiedBullets.evidence, ...signals.impactVerbs].slice(0, 5),
      signals.quantifiedBullets.count >= 2 ? [] : ["more metrics", "clearer outcomes"],
      "Rewrite the best bullets so they show scope, metric, and result."
    ),
    clarity: buildDimension(
      clarityScore,
      "Clarity is driven by concise bullets and readable, non-generic phrasing.",
      candidate.rawSignals.evidence?.flatMap((item) => item.snippets || []).slice(0, 3) || [],
      weakBullets,
      "Turn weak bullets into short outcome-first lines with specific tools."
    ),
    studentPositioning: buildDimension(
      studentPositioningScore,
      "A student resume should clearly show education, growth trajectory, and internship readiness.",
      signals.studentPositioningSignals,
      candidate.education.length ? [] : ["clear student identity"],
      "Connect coursework and side projects to the target role more explicitly."
    ),
    roleFit: buildDimension(
      roleFitScore,
      "Role fit improves when your visible stack overlaps with the target role or live job posting.",
      signals.technicalStackAlignment,
      signals.missingRoleKeywords,
      "Mirror the target role language only where it truthfully matches your work."
    ),
    projectDepth: buildDimension(
      projectDepthScore,
      "Project depth matters most for student candidates because projects carry technical storytelling.",
      candidate.projects.slice(0, 3).map((item) => item.name),
      candidate.projects.length >= 2 ? [] : ["another shipped or expanded project"],
      "Expand one project with architecture, tradeoffs, and measurable outcomes."
    ),
    internshipReadiness: buildDimension(
      internshipReadinessScore,
      "Internship readiness combines education, project maturity, and evidence you can ramp quickly.",
      [
        candidate.education[0]?.school,
        candidate.experience[0]?.company,
        candidate.projects[0]?.name
      ],
      signals.seniorityMismatch ? [signals.seniorityMismatch] : [],
      "Frame your profile around ramp-up speed, coachability, and shipped work."
    ),
    collaborationSignal: buildDimension(
      collaborationSignalScore,
      "Recruiters trust early-career candidates more when teamwork and communication show up in concrete bullets.",
      signals.collaborationEvidence,
      signals.collaborationEvidence.length ? [] : ["teamwork evidence"],
      "Add one bullet that shows partnership, support, or cross-functional work."
    ),
    ownershipSignal: buildDimension(
      ownershipSignalScore,
      "Ownership language helps a student profile feel more proactive and less passive.",
      signals.ownershipEvidence,
      signals.ownershipEvidence.length ? [] : ["ownership wording"],
      "Use verbs like built, designed, led, and shipped where they are accurate."
    )
  };
}

function buildScorecard(candidate, role, targetJob, signals) {
  const dimensions = buildScoreDimensions(candidate, role, targetJob, signals);
  const overallScore = Math.round(
    dimensions.content.score * 0.12 +
      dimensions.technicalDepth.score * 0.13 +
      dimensions.impact.score * 0.11 +
      dimensions.clarity.score * 0.09 +
      dimensions.studentPositioning.score * 0.1 +
      dimensions.roleFit.score * 0.12 +
      dimensions.projectDepth.score * 0.1 +
      dimensions.internshipReadiness.score * 0.1 +
      dimensions.collaborationSignal.score * 0.06 +
      dimensions.ownershipSignal.score * 0.07
  );

  return {
    overallScore: clamp(overallScore, 0, 100),
    subscores: Object.fromEntries(
      Object.entries(dimensions).map(([key, value]) => [key, value.score])
    ),
    dimensions
  };
}

function deriveAnalysis(candidate, role, targetJob, signals, scorecard) {
  const strengths = [];
  const gaps = [];
  const bestSections = [];
  const weakestSections = [];

  if (candidate.education.length) {
    strengths.push("Clear student identity with visible education and internship-ready trajectory.");
    bestSections.push("Education");
  } else {
    gaps.push("Education details are missing or weak for a student-targeted resume.");
    weakestSections.push("Education");
  }

  if (candidate.projects.length >= 2) {
    strengths.push("Projects provide strong material for technical and storytelling interviews.");
    bestSections.push("Projects");
  } else {
    gaps.push("Project depth is limited. Add another concrete build or expand current project bullets.");
    weakestSections.push("Projects");
  }

  if (candidate.experience.length) {
    strengths.push("Experience section helps prove reliability and applied execution.");
    bestSections.push("Experience");
  } else {
    gaps.push("Experience section is thin. Add internships, assistant roles, or volunteer technical work.");
    weakestSections.push("Experience");
  }

  if (signals.missingRoleKeywords.length) {
    gaps.push(`Role-fit keywords are missing or under-expressed: ${signals.missingRoleKeywords.join(", ")}.`);
  } else {
    strengths.push("Role-aligned keywords are already represented across the resume.");
  }

  if (candidate.rawSignals.warnings?.length) {
    gaps.push(candidate.rawSignals.warnings[0]);
  }

  if (signals.seniorityMismatch) {
    gaps.push(`Potential targeting issue: ${signals.seniorityMismatch}.`);
  }

  const weakBulletPatterns = getWeakBulletPatterns(candidate);
  if (weakBulletPatterns.length) {
    gaps.push("Some bullets are still too generic and need stronger action verbs or metrics.");
  }

  const improvementActions = uniqueCompact([
    scorecard.dimensions.roleFit.missing[0]
      ? `Add evidence for ${scorecard.dimensions.roleFit.missing[0]} using a project bullet, coursework note, or technical experience line.`
      : "Keep reinforcing your strongest role-fit keywords with concrete evidence.",
    signals.quantifiedBullets.count < 2
      ? "Add measurable outcomes to at least two bullets so impact is easier to trust."
      : "Keep the best quantified bullets near the top of each section.",
    candidate.identity.links.length === 0
      ? "Add at least one portfolio, GitHub, or project link to improve recruiter confidence."
      : "Lead with the link that best supports your strongest project story.",
    weakBulletPatterns.length
      ? "Rewrite vague bullets into outcome-first statements with tools, scope, and impact."
      : "Tighten longer bullets so each one lands quickly in recruiter screens.",
    scorecard.dimensions.ownershipSignal.score < 65
      ? "Use stronger ownership phrasing where it is true: built, designed, led, shipped."
      : ""
  ]).slice(0, 5);

  return {
    strengths: uniqueCompact(strengths).slice(0, 5),
    gaps: uniqueCompact(gaps).slice(0, 5),
    bestSections: uniqueCompact(bestSections).slice(0, 4),
    weakestSections: uniqueCompact(weakestSections).slice(0, 4),
    weakBulletPatterns,
    missingKeywords: signals.missingRoleKeywords,
    improvementActions,
    internshipReadiness: scorecard.dimensions.internshipReadiness.score,
    collaborationEvidence: signals.collaborationEvidence,
    ownershipEvidence: signals.ownershipEvidence
  };
}

function buildResumeQuestions(candidate, role, company, signals) {
  const projects = candidate.projects.slice(0, 3);
  const experience = candidate.experience.slice(0, 2);
  const companyLabel = company || "the team";
  const questions = [
    {
      category: "Resume walkthrough",
      question: `Walk me through your background and why it fits this ${targetRole(role)} role.`,
      rationale: "Tests whether the candidate can connect school, projects, and early experience into a focused pitch."
    },
    {
      category: "Student positioning",
      question: "How have your coursework and side projects prepared you to contribute in an internship environment?",
      rationale: "Checks internship readiness and learning velocity."
    }
  ];

  for (const project of projects) {
    questions.push({
      category: "Project depth",
      question: `Tell me about ${project.name} and the technical decisions you made.`,
      rationale: "Projects are the strongest source of technical depth for student candidates."
    });
  }

  for (const item of experience) {
    questions.push({
      category: "Behavioral",
      question: `What did you learn from your time at ${item.company || companyLabel}, and how would that help you ramp up faster here?`,
      rationale: "Connects execution, teamwork, and maturity."
    });
  }

  if (signals.ownershipEvidence.length === 0) {
    questions.push({
      category: "Ownership",
      question: "Tell me about a time you took ownership of a technical task from start to finish.",
      rationale: "Targets one of the most common student-profile gaps."
    });
  }

  questions.push({
    category: "Growth",
    question: `What is the biggest gap between your current profile and what ${companyLabel} might need, and how are you closing it?`,
    rationale: "Surfaces self-awareness and coachability."
  });

  return questions.slice(0, 7);
}

function buildJobQuestions(candidate, role, company, targetJob, companyContext) {
  if (!targetJob) {
    return [];
  }

  const project = candidate.projects[0]?.name || "your strongest project";
  const companyLabel = company || targetJob.company || "the company";
  const signal = companyContext?.interviewSignals?.[0] || "role-fit tradeoffs";

  return [
    {
      category: "Job fit",
      question: `Why does this ${targetJob.title} opening at ${companyLabel} fit your background right now?`,
      rationale: "Checks whether the candidate can map their experience to the live opening."
    },
    {
      category: "Targeted project depth",
      question: `Which parts of ${project} best demonstrate the skills this job posting is asking for?`,
      rationale: "Connects a real student project to a current role requirement."
    },
    {
      category: "Company context",
      question: `How would you tailor your first 30 days based on this signal: ${signal}`,
      rationale: "Tests company-specific preparation beyond generic interview answers."
    }
  ];
}

function buildInternshipRecommendations(candidate, role, signals) {
  const normalizedRole = normalizeText(role);
  const skillSet = getCandidateSkillSet(candidate);
  const isDataLean = skillSet.has("python") || skillSet.has("machine learning") || skillSet.has("sql");
  const isFrontendLean = skillSet.has("react") || skillSet.has("javascript") || skillSet.has("responsive ui");
  const isBackendLean = skillSet.has("fastapi") || skillSet.has("flask") || skillSet.has("postgresql") || skillSet.has("api design");

  const roleFamilies = uniqueCompact([
    normalizedRole.includes("data") ? "Data Science Intern" : "",
    isBackendLean ? "Backend Engineer Intern" : "",
    isFrontendLean ? "Frontend Engineer Intern" : "",
    isBackendLean && isFrontendLean ? "Full Stack Engineer Intern" : "",
    "Software Engineer Intern"
  ]).map((title) => ({
    title,
    fitReason: `This path aligns with current resume signal around ${candidate.skills.all.slice(0, 3).join(", ") || "core engineering skills"}.`
  })).slice(0, 4);

  const companyBuckets = STUDENT_COMPANY_BUCKETS
    .filter((bucket) => bucket.roles.some((bucketRole) => roleFamilies.some((item) => item.title === bucketRole)) || normalizedRole === "")
    .map((bucket) => ({
      label: bucket.label,
      why: `A student profile with ${candidate.projects.length} visible projects is competitive here when the story is clear and role-targeted.`
    }))
    .slice(0, 4);

  const searchKeywords = uniqueCompact([
    role || "software engineer intern",
    `${isBackendLean ? "backend " : ""}${isFrontendLean ? "frontend " : ""}intern`,
    isDataLean ? "python sql intern" : "",
    candidate.skills.all.slice(0, 3).join(" ").toLowerCase()
  ]).slice(0, 6);

  const readinessNotes = [
    "Focus search efforts on internship and new-grad adjacent roles, not senior or lead titles.",
    "Lead applications with your two strongest project stories and one clear reliability story from work or leadership.",
    "Customize keywords for each internship family instead of sending the same resume everywhere."
  ];

  if (signals.locationCompatibility === "potential mismatch") {
    readinessNotes.unshift("Check the job location carefully and prioritize roles where you can realistically interview and work.");
  }

  const nextSkillSuggestions = uniqueCompact([
    !isBackendLean ? "Strengthen backend depth with one API-heavy project and clearer database bullets." : "",
    !isFrontendLean ? "Add one stronger UI or product-facing project if you want broader full-stack coverage." : "",
    signals.quantifiedBullets.count < 2 ? "Add measurable outcomes to projects and internships before your next application wave." : "",
    "Practice concise 45-second answers for your top two projects."
  ]).slice(0, 4);

  return {
    roleFamilies,
    companyBuckets,
    searchKeywords,
    readinessNotes,
    nextSkillSuggestions
  };
}

function buildJobSearchRecommendations(candidate, role, jobs, targetJob, signals) {
  const liveMatches = (jobs || []).slice(0, 5).map((job) => ({
    title: job.title,
    company: job.company,
    applyUrl: job.applyUrl,
    matchScore: job.matchScore,
    reason: job.matchReasons?.[0] || "Live opening matched against current profile signal."
  }));

  return {
    liveMatches,
    optimizationTips: uniqueCompact([
      targetJob?.descriptionSnippet ? `Mirror the language in the live posting for ${targetJob.title} when it truthfully reflects your work.` : "",
      `Prioritize ${targetRole(role)} applications where your project stack already overlaps with the posting.`,
      signals.quantifiedBullets.count < 2 ? "Quantify impact before the next application sprint so recruiters can gauge execution faster." : "",
      "Keep a tailored resume variant for backend, full-stack, and data-lean internship families."
    ]).slice(0, 4),
    nextActions: uniqueCompact([
      liveMatches[0] ? `Rework one project bullet to better match ${liveMatches[0].title}.` : "",
      "Practice a one-minute answer that explains why your current experience is internship-ready.",
      "Apply with your strongest project link near the top of the resume."
    ]).slice(0, 4)
  };
}

function buildPitch(candidate, role, company, companyContext, targetJob) {
  const name = candidate.identity.name || "This candidate";
  const school = candidate.education[0]?.school || "their university";
  const standoutProject = candidate.projects[0]?.name || "their strongest project";
  const companyLabel = company || targetJob?.company || "the team";
  const contextLine = companyContext?.summary
    ? ` I would connect my background to ${companyLabel} by referencing ${companyContext.summary.slice(0, 140)}.`
    : "";
  const targetLine = targetJob?.title ? ` The live target opening is ${targetJob.title}.` : "";

  return `${name} is a student candidate from ${school} who is building internship-ready technical depth through practical projects and early professional experience. For a ${targetRole(role)} opportunity, the strongest story is how coursework and shipped work come together through ${standoutProject}.${targetLine}${contextLine}`;
}

function buildSummary(candidate, role, company, scorecard, analysis, companyContext, targetJob) {
  const strength = analysis.strengths[0] || "Strong student trajectory with practical project work.";
  const topRisk = analysis.gaps[0] || "Role targeting could be sharper.";
  const nextActions = uniqueCompact([
    ...analysis.improvementActions,
    targetJob?.title ? `Customize your resume summary and top project bullet for ${targetJob.title}.` : "",
    "Practice two project walkthroughs and one reliability story before your next interview."
  ]).slice(0, 5);

  return {
    headline: `${candidate.identity.name || "Student candidate"}: ${scorecard.overallScore}/100 internship readiness score`,
    fitSnapshot: `${strength} Current fit for ${targetRole(role)} is ${scorecard.overallScore}/100 with the biggest risk around ${topRisk.toLowerCase()}.`,
    pitch: buildPitch(candidate, role, company, companyContext, targetJob),
    topStrengths: analysis.strengths.slice(0, 3),
    topRisk,
    nextActions
  };
}

function buildCandidateResponse(candidate) {
  return {
    identity: candidate.identity,
    education: candidate.education,
    skills: candidate.skills,
    projects: candidate.projects,
    experience: candidate.experience,
    leadership: candidate.leadership,
    rawSignals: candidate.rawSignals
  };
}

function buildBaseAnalysis({
  candidateProfile,
  role,
  company,
  focusArea,
  companyContext,
  provider = "mygpt",
  analysisMode = "default-profile",
  note = "",
  jobs = [],
  targetJob = null,
  jobUrl = "",
  location = "",
  taskType = "prep_brief",
  sourceFreshness = {}
}) {
  const candidate = normalizeCandidateProfile(candidateProfile || profileToCandidateProfile());
  const context = companyContext || buildFallbackContext({ company, role });
  const signals = extractCandidateSignals({
    candidate,
    role,
    targetJob,
    location
  });
  const scorecard = buildScorecard(candidate, role, targetJob, signals);
  const resumeAnalysis = deriveAnalysis(candidate, role, targetJob, signals, scorecard);
  const resumeQuestions = buildResumeQuestions(candidate, role, company, signals);
  const jobQuestions = buildJobQuestions(candidate, role, company, targetJob, context);
  const recommendedQuestions = [...resumeQuestions, ...jobQuestions].slice(0, 10);
  const internshipRecommendations = buildInternshipRecommendations(candidate, role, signals);
  const jobSearchRecommendations = buildJobSearchRecommendations(candidate, role, jobs, targetJob, signals);
  const summary = buildSummary(candidate, role, company, scorecard, resumeAnalysis, context, targetJob);
  const metadataSources = dedupeSources([...(context.sources || []), ...(jobs || []).map((job) => job.source || null)]);
  const confidence = clamp(((scorecard.overallScore / 100) + Number(context.confidence || 0.25)) / 2, 0.12, 0.96);

  return {
    target: {
      role: role || "Software Engineer Intern",
      company: company || "",
      focusArea: focusArea || "",
      location: location || "",
      jobUrl: jobUrl || ""
    },
    targetJob,
    candidate: buildCandidateResponse(candidate),
    summary,
    signals,
    resumeAnalysis,
    scorecard,
    recommendedQuestions,
    resumeQuestions,
    jobQuestions,
    internshipRecommendations,
    jobSearchRecommendations,
    companyContext: context,
    liveJobs: (jobs || []).slice(0, 8),
    metadata: {
      engine: "mygpt",
      provider,
      contextMode: context.mode,
      analysisMode,
      taskType,
      confidence,
      sources: metadataSources.slice(0, 10),
      note: note || (focusArea ? `Focus area: ${focusArea}` : ""),
      sourceFreshness: {
        jobs: sourceFreshness.jobs || "",
        company: sourceFreshness.company || ""
      },
      validationState: "deterministic",
      fallbackUsed: false,
      retrievedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  buildBaseAnalysis,
  buildInternshipRecommendations,
  buildScorecard,
  deriveAnalysis,
  getRoleKeywords,
  profileCompletionScore
};
