const { profile } = require("../data/profile");

const ROLE_KEYWORDS = {
  "software engineer": ["JavaScript", "React", "FastAPI", "REST APIs", "Docker", "PostgreSQL"],
  "frontend": ["React", "JavaScript", "responsive UI", "REST APIs"],
  "backend": ["FastAPI", "Flask", "PostgreSQL", "SQL", "JWT auth", "API design"],
  "full stack": ["React", "FastAPI", "PostgreSQL", "Docker", "JWT auth"],
  "data": ["Python", "SQL", "Machine Learning", "PostgreSQL", "MongoDB"],
  "machine learning": ["Python", "Machine Learning", "SQL", "APIs"],
  "intern": ["communication", "adaptability", "ownership", "project depth"],
  "dsa": ["Data Structures and Algorithms", "problem solving", "complexity analysis"]
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function pickRoleKeywords(role) {
  const normalized = normalizeText(role);
  const hits = Object.entries(ROLE_KEYWORDS)
    .filter(([keyword]) => normalized.includes(keyword))
    .flatMap(([, skills]) => skills);

  if (hits.length > 0) {
    return [...new Set(hits)];
  }

  return ["React", "FastAPI", "Python", "SQL", "problem solving", "ownership"];
}

function collectProfileSkills() {
  return [
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.databases,
    ...profile.skills.cloud,
    ...profile.skills.core,
    "responsive UI",
    "communication",
    "adaptability",
    "problem solving",
    "ownership"
  ];
}

function splitStrengthsAndGaps(targetKeywords) {
  const known = new Set(collectProfileSkills().map((item) => normalizeText(item)));
  const strengths = [];
  const gaps = [];

  for (const keyword of targetKeywords) {
    if (known.has(normalizeText(keyword))) {
      strengths.push(keyword);
    } else {
      gaps.push(keyword);
    }
  }

  return {
    strengths: strengths.slice(0, 5),
    gaps: gaps.slice(0, 4)
  };
}

function buildPitch(role, company) {
  const roleLabel = role || "software engineering";
  const companyLabel = company || "your target team";

  return `I am a Data Science student at Michigan State University who enjoys shipping full-stack products. My work combines FastAPI backends, React frontends, and SQL-backed systems, and I usually focus on turning practical problems into clean, usable tools. For ${companyLabel}, I would position myself as an early-career builder who can learn quickly, communicate clearly, and contribute across product and engineering details in a ${roleLabel} setting.`;
}

function buildStoryBank() {
  return [
    {
      title: "Balancing academics with high-volume support work",
      useFor: "behavioral questions about responsibility, time management, or handling pressure",
      angle: "Highlight consistency, calm execution, and customer empathy from the Michigan State housing role."
    },
    {
      title: "Shipping a full-stack URL Shortener",
      useFor: "questions about architecture, tradeoffs, APIs, or end-to-end ownership",
      angle: "Walk through backend structure, authentication, persistence, and the React dashboard."
    },
    {
      title: "Automating reporting for NGO and healthcare workflows",
      useFor: "questions about impact, automation, or data-focused projects",
      angle: "Emphasize manual-effort reduction, dashboarding, and cross-functional collaboration."
    }
  ];
}

function buildQuestions(role, company, focusArea, strengths, gaps) {
  const companyLabel = company || "the company";
  const focusLabel = focusArea || "core interview readiness";

  return [
    {
      category: "Resume walkthrough",
      question: `Walk me through your background and why it fits this ${role || "role"}.`,
      whatToShow: "Give a crisp story from coursework to projects to hands-on experience, then connect directly to the job."
    },
    {
      category: "Project depth",
      question: "How did you structure your URL Shortener, and what tradeoffs did you make in the backend design?",
      whatToShow: "Explain routes, auth, persistence, modular architecture, and one decision you would improve next."
    },
    {
      category: "Behavioral",
      question: `Tell me about a time you had to stay reliable while juggling several priorities at ${companyLabel === "the company" ? "work and school" : companyLabel}.`,
      whatToShow: "Use the student assistant role, focus on ownership, communication, and steady execution."
    },
    {
      category: "Growth",
      question: `What is the biggest gap between your current profile and this ${role || "position"}, and how are you closing it?`,
      whatToShow: `Name a real gap such as ${gaps[0] || "depth in one technical area"}, then show a concrete learning plan.`
    },
    {
      category: "Focus area",
      question: `If we hired you tomorrow, how would you ramp up in ${focusLabel}?`,
      whatToShow: `Tie your answer to existing strengths like ${strengths.join(", ") || "full-stack execution"} and a clear 30-day learning plan.`
    }
  ];
}

function buildFocusPlan(strengths, gaps) {
  const gap = gaps[0] || "system design depth";

  return [
    `Lead with ${strengths[0] || "your full-stack project work"} in your intro and first project story.`,
    `Prepare one deeper technical explanation around ${strengths[1] || "API design"} with concrete implementation details.`,
    `Acknowledge ${gap} honestly and explain the exact resource or project step you are using to improve it.`,
    "Practice 2-minute answers, then tighten them to 45-second versions for recruiter screens."
  ];
}

function buildWarmupDrills(role) {
  return [
    `Give a 60-second pitch for why you fit a ${role || "software engineering"} role.`,
    "Explain one project architecture from frontend request to database write.",
    "Practice one STAR answer about reliability and one about conflict or collaboration.",
    "Solve one medium DSA problem aloud and narrate your tradeoffs.",
    "Prepare three thoughtful questions for the interviewer about team ownership, tooling, and growth."
  ];
}

function buildInterviewPrep({ role, company, focusArea }) {
  const targetKeywords = pickRoleKeywords(role);
  const { strengths, gaps } = splitStrengthsAndGaps(targetKeywords);

  return {
    generatedAt: new Date().toISOString(),
    mode: "demo",
    target: {
      role: role || "Software Engineer Intern",
      company: company || "Target Company",
      focusArea: focusArea || "Behavioral and project storytelling"
    },
    candidatePitch: buildPitch(role, company),
    roleMatch: {
      strengths,
      gaps,
      recommendedKeywords: targetKeywords
    },
    topProjects: profile.projects.slice(0, 3).map((project) => ({
      name: project.name,
      summary: project.summary,
      talkingPoints: project.highlights
    })),
    storyBank: buildStoryBank(),
    focusPlan: buildFocusPlan(strengths, gaps),
    mockQuestions: buildQuestions(role, company, focusArea, strengths, gaps),
    warmupDrills: buildWarmupDrills(role)
  };
}

module.exports = { buildInterviewPrep };

