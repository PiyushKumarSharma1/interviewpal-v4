const { getCandidateSkillSet, uniqueCompact } = require("./candidate-profile");
const { normalizeText } = require("./keywords");

const IMPACT_VERB_REGEX = /\b(built|designed|implemented|developed|automated|reduced|improved|optimized|launched|created|led|owned|shipped|deployed)\b/gi;
const COLLAB_REGEX = /\b(team|collaborat|partnered|cross-functional|worked with|supported|stakeholder|communicat)\b/i;
const OWNERSHIP_REGEX = /\b(led|owned|designed|built|architected|drove|launched|created|shipped)\b/i;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function compact(values) {
  return uniqueCompact(values);
}

function collectBullets(candidate) {
  return [
    ...toSafeList(candidate.projects).flatMap((item) => item.highlights || []),
    ...toSafeList(candidate.experience).flatMap((item) => item.bullets || [])
  ].filter(Boolean);
}

function toSafeList(values) {
  return Array.isArray(values) ? values : [];
}

function detectEducationLevel(candidate) {
  const education = toSafeList(candidate.education);
  const degree = `${education[0]?.degree || ""}`.toLowerCase();

  if (degree.includes("phd") || degree.includes("doctor")) return "doctoral";
  if (degree.includes("master") || degree.includes("m.s") || degree.includes("ms")) return "masters";
  if (degree.includes("bachelor") || degree.includes("b.s") || degree.includes("bs")) return "bachelors";
  if (education.length) return "student";
  return "unknown";
}

function graduationTiming(candidate) {
  const education = toSafeList(candidate.education);
  const graduation = education[0]?.graduation || "";
  const match = graduation.match(/\b(20\d{2})\b/);

  if (!match) {
    return {
      label: education.length ? "in progress" : "unknown",
      year: null
    };
  }

  const year = Number(match[1]);
  const currentYear = new Date().getFullYear();
  if (year <= currentYear + 1) {
    return {
      label: "near-term graduation",
      year
    };
  }

  return {
    label: "multi-year student runway",
    year
  };
}

function roleFamilyMatch(role, skillSet) {
  const lowered = normalizeText(role);

  if (lowered.includes("data") || lowered.includes("machine learning")) {
    return skillSet.has("python") || skillSet.has("sql") ? "data" : "generalist";
  }

  if (lowered.includes("frontend")) {
    return skillSet.has("react") || skillSet.has("javascript") ? "frontend" : "generalist";
  }

  if (lowered.includes("backend")) {
    return skillSet.has("fastapi") || skillSet.has("postgresql") || skillSet.has("api design") ? "backend" : "generalist";
  }

  if (skillSet.has("react") && (skillSet.has("fastapi") || skillSet.has("api design"))) {
    return "full-stack";
  }

  return "software-engineering";
}

function countQuantifiedBullets(bullets) {
  return bullets.filter((bullet) => /\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b\d+\+\b/.test(bullet));
}

function collectEvidence(candidate, predicate) {
  return collectBullets(candidate).filter((bullet) => predicate(bullet)).slice(0, 5);
}

function extractCandidateSignals(first, roleArg, targetJobArg, locationArg) {
  const options = first && typeof first === "object" && first.candidate !== undefined
    ? first
    : { candidate: first, role: roleArg, targetJob: targetJobArg, location: locationArg };
  const { candidate = {}, role = roleArg, targetJob = targetJobArg, location = locationArg } = options;
  const projects = toSafeList(candidate.projects);
  const experience = toSafeList(candidate.experience);
  const education = toSafeList(candidate.education);
  const leadership = toSafeList(candidate.leadership);
  const skillSet = getCandidateSkillSet(candidate);
  const bullets = collectBullets(candidate);
  const impactVerbMatches = compact(
    bullets.flatMap((bullet) => Array.from(String(bullet).matchAll(IMPACT_VERB_REGEX)).map((match) => match[0]))
  ).slice(0, 10);
  const quantifiedBullets = countQuantifiedBullets(bullets);
  const collaborationEvidence = collectEvidence(candidate, (bullet) => COLLAB_REGEX.test(bullet));
  const ownershipEvidence = collectEvidence(candidate, (bullet) => OWNERSHIP_REGEX.test(bullet));
  const targetDescription = `${targetJob?.title || ""} ${targetJob?.descriptionSnippet || ""}`.trim();
  const targetTokens = compact(targetDescription.split(/[^A-Za-z0-9.+#/-]+/).filter((token) => token.length >= 4)).slice(0, 16);
  const missingRoleKeywords = targetTokens.filter((token) => !skillSet.has(normalizeText(token))).slice(0, 8);
  const internshipRelevance = clamp(
    46 +
      education.length * 10 +
      projects.length * 8 +
      experience.length * 8 +
      Math.min(quantifiedBullets.length, 4) * 5,
    0,
    100
  );
  const seniorityMismatch = /\b(senior|staff|principal|lead|manager)\b/i.test(targetDescription || role || "")
    ? "target role may be more senior than an internship-ready student profile"
    : "";
  const locationCompatibility = !location || !targetJob?.location
    ? "unscoped"
    : normalizeText(targetJob.location).includes(normalizeText(location)) || normalizeText(targetJob.location).includes("remote")
      ? "compatible"
      : "potential mismatch";
  const technicalStackAlignment = compact(
    targetTokens.filter((token) => skillSet.has(normalizeText(token))).slice(0, 8)
  );

  return {
    educationLevel: detectEducationLevel(candidate),
    graduationTiming: graduationTiming(candidate),
    quantifiedBullets: {
      count: quantifiedBullets.length,
      evidence: quantifiedBullets.slice(0, 4)
    },
    impactVerbs: impactVerbMatches,
    missingRoleKeywords,
    roleFamilyMatch: roleFamilyMatch(role, skillSet),
    studentPositioningSignals: compact([
      education.length ? "education present" : "",
      projects.length >= 2 ? "multiple projects" : "",
      experience.length ? "work or internship history" : "",
      leadership.length ? "leadership or extracurricular signal" : ""
    ]),
    collaborationEvidence,
    ownershipEvidence,
    technicalStackAlignment,
    internshipRelevance,
    seniorityMismatch,
    locationCompatibility,
    projectDepth: {
      count: projects.length,
      strongProjects: projects.filter((item) => (item.highlights || []).length >= 2).length
    }
  };
}

module.exports = {
  extractCandidateSignals
};
