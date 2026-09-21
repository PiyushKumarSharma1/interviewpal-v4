const { profile } = require("../data/profile");
const { flattenTaxonomy, normalizeText } = require("./keywords");

function uniqueCompact(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((value) => String(value || "").trim()).filter(Boolean))];
}

function toSafeArray(values) {
  return Array.isArray(values) ? values : [];
}

function sliceText(value, max = 280) {
  return String(value || "").trim().slice(0, max);
}

function profileToCandidateProfile(seedProfile = profile) {
  const links = uniqueCompact([seedProfile.github].filter(Boolean));
  const allSkills = uniqueCompact([
    ...seedProfile.skills.languages,
    ...seedProfile.skills.frameworks,
    ...seedProfile.skills.databases,
    ...seedProfile.skills.cloud,
    ...seedProfile.skills.core
  ]);

  return {
    identity: {
      name: seedProfile.name,
      headline: seedProfile.headline,
      email: seedProfile.email,
      phone: seedProfile.phone,
      location: seedProfile.location,
      links
    },
    education: [
      {
        school: seedProfile.education.school,
        degree: seedProfile.education.degree,
        graduation: seedProfile.education.graduation,
        coursework: uniqueCompact(seedProfile.education.coursework)
      }
    ],
    skills: {
      languages: uniqueCompact(seedProfile.skills.languages),
      frameworks: uniqueCompact(seedProfile.skills.frameworks),
      databases: uniqueCompact(seedProfile.skills.databases),
      cloud: uniqueCompact(seedProfile.skills.cloud),
      core: uniqueCompact(seedProfile.skills.core),
      all: allSkills
    },
    projects: toSafeArray(seedProfile.projects).map((item) => ({
      name: sliceText(item.name, 120),
      status: sliceText(item.status, 80),
      summary: sliceText(item.summary, 320),
      highlights: uniqueCompact(item.highlights).slice(0, 6)
    })),
    experience: toSafeArray(seedProfile.experience).map((item) => ({
      role: sliceText(item.role, 120),
      company: sliceText(item.company, 140),
      period: sliceText(item.period, 80),
      bullets: uniqueCompact(item.bullets).slice(0, 6)
    })),
    leadership: toSafeArray(seedProfile.extracurriculars).map((item) => ({
      title: sliceText(item, 160),
      summary: sliceText(item, 240)
    })),
    rawSignals: {
      source: "seeded",
      textLength: 0,
      extractionMode: "seeded",
      warnings: [],
      evidence: []
    }
  };
}

function normalizeCandidateProfile(candidate = {}) {
  const identity = candidate.identity || {};
  const skills = candidate.skills || {};

  const normalized = {
    identity: {
      name: sliceText(identity.name, 120),
      headline: sliceText(identity.headline, 220),
      email: sliceText(identity.email, 160),
      phone: sliceText(identity.phone, 60),
      location: sliceText(identity.location, 120),
      links: uniqueCompact(identity.links).slice(0, 6)
    },
    education: toSafeArray(candidate.education).map((item) => ({
      school: sliceText(item.school, 160),
      degree: sliceText(item.degree, 160),
      graduation: sliceText(item.graduation, 80),
      coursework: uniqueCompact(item.coursework).slice(0, 10)
    })).slice(0, 4),
    skills: {
      languages: uniqueCompact(skills.languages).slice(0, 20),
      frameworks: uniqueCompact(skills.frameworks).slice(0, 20),
      databases: uniqueCompact(skills.databases).slice(0, 20),
      cloud: uniqueCompact(skills.cloud).slice(0, 20),
      core: uniqueCompact(skills.core).slice(0, 20),
      all: uniqueCompact(skills.all).slice(0, 60)
    },
    projects: toSafeArray(candidate.projects).map((item) => ({
      name: sliceText(item.name, 140),
      status: sliceText(item.status, 80),
      summary: sliceText(item.summary, 360),
      highlights: uniqueCompact(item.highlights).slice(0, 6)
    })).slice(0, 8),
    experience: toSafeArray(candidate.experience).map((item) => ({
      role: sliceText(item.role, 140),
      company: sliceText(item.company, 160),
      period: sliceText(item.period, 80),
      bullets: uniqueCompact(item.bullets).slice(0, 6)
    })).slice(0, 8),
    leadership: toSafeArray(candidate.leadership).map((item) => ({
      title: sliceText(item.title, 160),
      summary: sliceText(item.summary, 240)
    })).slice(0, 8),
    rawSignals: {
      source: sliceText(candidate.rawSignals?.source, 60) || "uploaded",
      extractionMode: sliceText(candidate.rawSignals?.extractionMode, 60) || "uploaded",
      textLength: Number(candidate.rawSignals?.textLength || 0),
      warnings: uniqueCompact(candidate.rawSignals?.warnings).slice(0, 10),
      metricsCount: Number(candidate.rawSignals?.metricsCount || 0),
      bulletCount: Number(candidate.rawSignals?.bulletCount || 0),
      sectionCoverage: Number(candidate.rawSignals?.sectionCoverage || 0),
      evidence: toSafeArray(candidate.rawSignals?.evidence).map((item) => ({
        label: sliceText(item.label, 60),
        snippets: uniqueCompact(item.snippets).slice(0, 5)
      })).slice(0, 10)
    }
  };

  if (normalized.skills.all.length === 0) {
    normalized.skills.all = uniqueCompact([
      ...normalized.skills.languages,
      ...normalized.skills.frameworks,
      ...normalized.skills.databases,
      ...normalized.skills.cloud,
      ...normalized.skills.core
    ]);
  }

  return normalized;
}

function getCandidateSkillSet(candidateProfile) {
  const normalized = normalizeCandidateProfile(candidateProfile);
  return new Set(
    uniqueCompact([
      ...normalized.skills.all,
      ...normalized.skills.languages,
      ...normalized.skills.frameworks,
      ...normalized.skills.databases,
      ...normalized.skills.cloud,
      ...normalized.skills.core
    ]).map((item) => normalizeText(item))
  );
}

function candidateToPromptSummary(candidateProfile) {
  const normalized = normalizeCandidateProfile(candidateProfile);
  const topProjects = normalized.projects.slice(0, 3).map((item) => ({
    name: item.name,
    summary: item.summary
  }));

  return {
    identity: {
      ...normalized.identity,
      email: "",
      phone: "",
      links: []
    },
    education: normalized.education.slice(0, 2),
    skills: normalized.skills,
    projects: topProjects,
    experience: normalized.experience.slice(0, 3),
    leadership: normalized.leadership.slice(0, 3)
  };
}

function detectKnownSkills(text) {
  const normalizedText = normalizeText(text);
  const detected = flattenTaxonomy().filter((skill) => {
    const escaped = normalizeText(skill).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundaryPattern = escaped
      .replace(/\\\+/g, "\\+")
      .replace(/\\\./g, "\\.")
      .replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^a-z0-9])${boundaryPattern}([^a-z0-9]|$)`, "i");
    return regex.test(normalizedText);
  });
  return uniqueCompact(detected);
}

module.exports = {
  detectKnownSkills,
  getCandidateSkillSet,
  normalizeCandidateProfile,
  profileToCandidateProfile,
  candidateToPromptSummary,
  uniqueCompact
};
