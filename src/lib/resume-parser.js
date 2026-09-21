const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { normalizeCandidateProfile, uniqueCompact } = require("./candidate-profile");
const { SKILL_TAXONOMY, normalizeText } = require("./keywords");

const SECTION_ALIASES = {
  education: ["education", "academic background", "academics", "education and coursework"],
  skills: ["skills", "technical skills", "technologies", "tech stack", "tools", "languages", "frameworks"],
  projects: ["projects", "project experience", "selected projects", "academic projects", "personal projects"],
  experience: ["experience", "work experience", "employment", "professional experience", "internships", "research", "work history"],
  leadership: ["leadership", "activities", "extracurriculars", "involvement", "awards", "certifications", "leadership and activities"]
};

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;
const LINK_REGEX = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;
const METRIC_REGEX = /\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b\d+\+\b/g;
const DATE_RANGE_REGEX = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*(?:-|–|—|to)\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})|\b20\d{2}\s*(?:-|–|—|to)\s*(?:20\d{2}|Present|Current)\b/i;

function hasPhone(value) {
  return /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(String(value || ""));
}

function flattenTaxonomy() {
  return Object.values(SKILL_TAXONOMY).flat();
}

function normalizeResumeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[•●▪◦]/g, "- ")
    .replace(/[|•]/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function repairMultiColumnText(text) {
  return normalizeResumeText(text)
    .split("\n")
    .flatMap((line) => {
      if (!line.includes("  ")) {
        return [line.trim()];
      }

      const parts = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);

      if (parts.length >= 2 && parts.every((part) => part.length < 80)) {
        return parts;
      }

      return [line.trim()];
    })
    .join("\n");
}

function headingToSection(line) {
  const normalized = normalizeText(line).replace(/[:|]/g, "");
  return Object.entries(SECTION_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

function looksLikeBullet(line) {
  return /^[-*]\s*/.test(line) || /^[\u2022\u2023\u25E6]\s*/.test(line);
}

function cleanBullet(line) {
  return String(line || "").replace(/^[-*\u2022\u2023\u25E6]\s*/, "").replace(/\s+/g, " ").trim();
}

function looksLikeHeading(line) {
  if (!line || looksLikeBullet(line)) {
    return false;
  }

  if (line.length > 100 || /[.!?]$/.test(line)) {
    return false;
  }

  if (DATE_RANGE_REGEX.test(line) || line.includes(" | ") || line.includes(" - ") || line.includes(" — ")) {
    return true;
  }

  return /^[A-Z0-9][A-Za-z0-9/&(),.'+:-]*(?:\s+[A-Z0-9][A-Za-z0-9/&(),.'+:-]*){0,8}$/.test(line);
}

function segmentSections(text) {
  const lines = repairMultiColumnText(text).split("\n").map((line) => line.trim());
  const sections = {
    general: []
  };
  let current = "general";

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const section = headingToSection(line);

    if (section && line.length < 60) {
      current = section;
      sections[current] = sections[current] || [];
      continue;
    }

    sections[current] = sections[current] || [];
    sections[current].push(line);
  }

  return sections;
}

function splitBlocks(lines = []) {
  const blocks = [];
  let current = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (current.length && looksLikeHeading(line) && !looksLikeBullet(line)) {
      blocks.push(current);
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length) {
    blocks.push(current);
  }

  return blocks;
}

function collectEvidence(label, lines) {
  return {
    label,
    snippets: uniqueCompact((lines || []).slice(0, 4).map((line) => String(line || "").slice(0, 160)))
  };
}

function parseIdentity(sections) {
  const lines = (sections.general || []).filter(Boolean).slice(0, 12);
  const combined = lines.join(" ");
  const email = combined.match(EMAIL_REGEX)?.[0] || "";
  const phone = combined.match(PHONE_REGEX)?.[0] || "";
  const links = uniqueCompact((combined.match(LINK_REGEX) || []).map((link) => link.startsWith("http") ? link : `https://${link}`));
  const locationLine = lines.find((line) => /\b[A-Z][a-z]+,\s*[A-Z]{2}\b|\bRemote\b/i.test(line)) || "";
  const name = (lines.find((line) => {
    if (line.includes("@") || hasPhone(line)) {
      return false;
    }

    const words = line.split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 5 && !/education|experience|skills|projects/i.test(line);
  }) || "").replace(/\b(resume|curriculum vitae|cv)\b/i, "").trim();
  const headline = lines.find((line) => /engineer|developer|student|science|analytics|full-stack|data/i.test(line) && line !== name) || "";

  return {
    name,
    headline,
    email,
    phone,
    location: locationLine,
    links
  };
}

function parseEducation(lines = []) {
  return splitBlocks(lines).map((block) => {
    const joined = block.join(" ");
    const school = block.find((line) => /university|college|school|institute/i.test(line)) || block[0] || "";
    const degree = block.find((line) => /\bB\.?S\b|\bM\.?S\b|\bBachelor\b|\bMaster\b|\bB\.?A\b|\bData Science\b|\bComputer Science\b/i.test(line)) || "";
    const graduation = joined.match(/(?:Expected\s+)?(?:May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr)\s+\d{4}|\b20\d{2}\b/)?.[0] || "";
    const courseworkLine = block.find((line) => /coursework|relevant courses/i.test(line)) || "";
    const coursework = courseworkLine
      .split(":")
      .slice(1)
      .join(":")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const gpa = joined.match(/\bGPA[:\s]+([0-4]\.\d{1,2})/i)?.[1] || "";

    return {
      school,
      degree,
      graduation,
      coursework,
      gpa
    };
  }).filter((item) => item.school || item.degree);
}

function detectSkills(text) {
  const normalized = normalizeText(text);
  const detected = flattenTaxonomy().filter((skill) => {
    const pattern = normalizeText(skill).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(normalized);
  });
  return uniqueCompact(detected);
}

function parseSkills(lines = [], fullText) {
  const combined = `${lines.join("\n")}\n${fullText}`;
  const detected = detectSkills(combined);
  const groups = {
    languages: [],
    frameworks: [],
    databases: [],
    cloud: [],
    core: []
  };

  for (const skill of detected) {
    const normalized = normalizeText(skill);

    if (SKILL_TAXONOMY.languages.map(normalizeText).includes(normalized)) {
      groups.languages.push(skill);
    } else if (SKILL_TAXONOMY.databases.map(normalizeText).includes(normalized)) {
      groups.databases.push(skill);
    } else if (SKILL_TAXONOMY.cloud.map(normalizeText).includes(normalized)) {
      groups.cloud.push(skill);
    } else if (SKILL_TAXONOMY.core.map(normalizeText).includes(normalized)) {
      groups.core.push(skill);
    } else {
      groups.frameworks.push(skill);
    }
  }

  return {
    ...groups,
    all: uniqueCompact(detected)
  };
}

function normalizeHeaderParts(header) {
  return String(header || "")
    .split(/ \| | — | - /)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseProjects(lines = []) {
  return splitBlocks(lines).map((block) => {
    const [header, ...rest] = block;
    const headerParts = normalizeHeaderParts(header);
    const highlights = rest.filter((line) => looksLikeBullet(line)).map(cleanBullet);
    const nonBullets = rest.filter((line) => !looksLikeBullet(line));

    return {
      name: headerParts[0] || header || "",
      status: headerParts[1] || "",
      summary: nonBullets.join(" ").trim() || highlights[0] || "",
      highlights: highlights.length ? highlights : nonBullets.slice(0, 4).map(cleanBullet)
    };
  }).filter((item) => item.name || item.summary);
}

function parseExperience(lines = []) {
  return splitBlocks(lines).map((block) => {
    const [header, ...rest] = block;
    const headerParts = normalizeHeaderParts(header);
    const joined = `${header} ${rest.join(" ")}`;
    const bullets = rest.filter((line) => looksLikeBullet(line)).map(cleanBullet);
    const nonBullets = rest.filter((line) => !looksLikeBullet(line));
    const period = joined.match(DATE_RANGE_REGEX)?.[0] || "";

    return {
      role: headerParts[0] || header || "",
      company: headerParts[1] || nonBullets[0] || "",
      period,
      bullets: bullets.length ? bullets : nonBullets.slice(0, 5)
    };
  }).filter((item) => item.role || item.company || item.bullets.length);
}

function parseLeadership(lines = []) {
  return splitBlocks(lines).map((block) => ({
    title: cleanBullet(block[0]),
    summary: block.slice(1).map(cleanBullet).join(" ").trim() || cleanBullet(block[0])
  })).filter((item) => item.title);
}

async function tryOcrFallback(file) {
  try {
    const { recognize } = require("tesseract.js");
    const result = await recognize(file.buffer, "eng", {
      logger: () => {}
    });
    return normalizeResumeText(result?.data?.text || "");
  } catch (error) {
    return "";
  }
}

async function extractTextFromResume(file) {
  const extension = String(file.originalname || "").split(".").pop()?.toLowerCase();

  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return {
      text: normalizeResumeText(result.value),
      extractionMode: "docx-text"
    };
  }

  if (extension === "pdf") {
    const parser = new PDFParse({ data: file.buffer });

    try {
      const result = await parser.getText();
      let text = normalizeResumeText(result.text);
      let extractionMode = "pdf-text";

      if (text.length < 160) {
        const ocrText = await tryOcrFallback(file);

        if (ocrText.length > text.length) {
          text = ocrText;
          extractionMode = "pdf-ocr";
        }
      }

      return {
        text,
        extractionMode
      };
    } finally {
      await parser.destroy();
    }
  }

  throw new Error("Unsupported resume file type. Please upload a PDF or DOCX file.");
}

async function parseResumeFile(file) {
  const extraction = await extractTextFromResume(file);
  const extractedText = repairMultiColumnText(extraction.text);
  const sections = segmentSections(extractedText);
  const education = parseEducation(sections.education || []);
  const projects = parseProjects(sections.projects || []);
  const experience = parseExperience(sections.experience || []);
  const leadership = parseLeadership(sections.leadership || []);
  const candidateProfile = normalizeCandidateProfile({
    identity: parseIdentity(sections),
    education,
    skills: parseSkills(sections.skills || [], extractedText),
    projects,
    experience,
    leadership,
    rawSignals: {
      source: "uploaded",
      extractionMode: extraction.extractionMode,
      textLength: extractedText.length,
      metricsCount: (extractedText.match(METRIC_REGEX) || []).length,
      bulletCount: extractedText.split("\n").filter((line) => looksLikeBullet(line)).length,
      sectionCoverage: Object.keys(sections).filter((key) => key !== "general" && (sections[key] || []).filter(Boolean).length).length,
      warnings: [],
      evidence: [
        collectEvidence("Education", sections.education),
        collectEvidence("Skills", sections.skills),
        collectEvidence("Projects", sections.projects),
        collectEvidence("Experience", sections.experience),
        collectEvidence("Leadership", sections.leadership)
      ].filter((item) => item.snippets.length)
    }
  });

  if (!candidateProfile.identity.name) {
    candidateProfile.rawSignals.warnings.push("Could not confidently extract the candidate name.");
  }

  if (candidateProfile.skills.all.length < 4) {
    candidateProfile.rawSignals.warnings.push("Skill extraction was limited. Review resume formatting and headings.");
  }

  if (projects.length === 0 && experience.length === 0) {
    candidateProfile.rawSignals.warnings.push("Project and experience extraction was limited.");
  }

  if (extraction.extractionMode === "pdf-ocr") {
    candidateProfile.rawSignals.warnings.push("OCR fallback was used because the PDF had limited extractable text.");
  }

  return {
    candidateProfile,
    extractedText,
    extractionMode: extraction.extractionMode
  };
}

module.exports = {
  extractTextFromResume,
  normalizeResumeText,
  parseResumeFile
};
