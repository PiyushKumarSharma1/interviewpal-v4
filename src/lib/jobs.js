const { URL } = require("url");
const cheerio = require("cheerio");
const { normalizeCandidateProfile, getCandidateSkillSet, uniqueCompact } = require("./candidate-profile");
const { ROLE_KEYWORDS, normalizeText } = require("./keywords");
const { safeFetchJson, safeFetchText, safeUrlString } = require("./network");

const JOB_CACHE = new Map();
const NEGATIVE_CACHE = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;

const ATS_HOST_PATTERNS = [
  { type: "greenhouse", match: /greenhouse\.io|boards-api\.greenhouse\.io/ },
  { type: "lever", match: /lever\.co|api\.lever\.co/ },
  { type: "ashby", match: /ashbyhq\.com/ },
  { type: "workday", match: /myworkdayjobs\.com|wd\d+\.myworkdayjobs\.com/ },
  { type: "smartrecruiters", match: /smartrecruiters\.com/ },
  { type: "workable", match: /workable\.com/ },
  { type: "icims", match: /icims\.com/ },
  { type: "jobvite", match: /jobvite\.com/ }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function compact(values) {
  return uniqueCompact(values);
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

function nowIso() {
  return new Date().toISOString();
}

function getCacheEntry(store, key) {
  const entry = store.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

function setCacheEntry(store, key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function searchCacheKey(input) {
  return [
    normalizeText(input.role),
    normalizeText(input.company),
    normalizeText(input.location),
    normalizeText(input.jobUrl),
    input.internshipOnly ? "intern-only" : "all"
  ].join("::");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

function detectAtsType(url, html = "") {
  const parsed = parseUrl(url);
  const hostname = parsed?.hostname.toLowerCase() || "";
  const combined = `${hostname} ${html}`.toLowerCase();
  return ATS_HOST_PATTERNS.find((item) => item.match.test(combined))?.type || "generic";
}

function getRoleKeywords(role) {
  const lowered = normalizeText(role);
  const matched = Object.entries(ROLE_KEYWORDS)
    .filter(([keyword]) => lowered.includes(keyword))
    .flatMap(([, keywords]) => keywords);

  return compact(matched.length ? matched : ["Software Engineering", "React", "Python", "SQL", "Communication"]);
}

function extractJsonLdObjects(html) {
  const $ = cheerio.load(html);
  const collected = [];

  $('script[type="application/ld+json"]').each((_, node) => {
    const value = $(node).contents().text().trim();

    if (!value) {
      return;
    }

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        collected.push(...parsed);
      } else {
        collected.push(parsed);
      }
    } catch (error) {
      // Ignore malformed structured data snippets.
    }
  });

  return collected;
}

function toText(value, max = 320) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeJob({
  title,
  company,
  location,
  employmentType,
  internshipConfidence,
  applyUrl,
  description,
  source,
  sourceType = "official",
  postedAt = "",
  retrievedAt = nowIso(),
  role,
  candidateProfile
}) {
  const safeApplyUrl = safeUrlString(applyUrl);
  const normalizedTitle = toText(title, 160);
  const normalizedCompany = toText(company || source?.label || "Target Company", 160);
  const normalizedLocation = toText(location || "Not specified", 140);
  const normalizedEmploymentType = toText(employmentType || (/\bintern|internship|co-op\b/i.test(normalizedTitle) ? "Internship" : "Full-time"), 60);
  const descriptionSnippet = toText(description, 420);
  const candidate = normalizeCandidateProfile(candidateProfile || {});
  const skillSet = getCandidateSkillSet(candidate);
  const roleKeywords = getRoleKeywords(role);
  const matchedKeywords = roleKeywords.filter((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return descriptionSnippet.toLowerCase().includes(normalizedKeyword) || skillSet.has(normalizedKeyword);
  });
  const companyBoost = normalizeText(company) && normalizeText(normalizedCompany).includes(normalizeText(company)) ? 12 : 0;
  const internshipBoost = /\bintern|internship|co-op|student|university|new grad\b/i.test(`${normalizedTitle} ${descriptionSnippet}`) ? 18 : 0;
  const matchScore = clamp(
    32 + matchedKeywords.length * 11 + companyBoost + internshipBoost + Math.round((internshipConfidence || 0.2) * 18),
    0,
    100
  );

  return {
    title: normalizedTitle,
    company: normalizedCompany,
    location: normalizedLocation,
    employmentType: normalizedEmploymentType,
    internshipConfidence: clamp(internshipConfidence || (internshipBoost ? 0.88 : 0.32), 0.05, 0.99),
    applyUrl: safeApplyUrl,
    descriptionSnippet,
    source: {
      label: source?.label || normalizedCompany,
      url: safeUrlString(source?.url || safeApplyUrl),
      type: source?.type || sourceType
    },
    postedAt: toText(postedAt, 80),
    retrievedAt,
    matchScore,
    matchReasons: compact([
      matchedKeywords[0] ? `Matches ${matchedKeywords[0]} signal in your profile or the job description.` : "",
      internshipBoost ? "The role reads as student or internship friendly." : "",
      companyBoost ? `The job lines up with the selected company target.` : "",
      descriptionSnippet ? "Live posting text was used to tailor recommendations." : ""
    ]).slice(0, 3)
  };
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const deduped = [];

  for (const job of jobs) {
    const key = [normalizeText(job.title), normalizeText(job.company), normalizeText(job.applyUrl)].join("::");

    if (!job.title || !job.applyUrl || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(job);
  }

  return deduped;
}

function buildCompanyCandidates(company, jobUrl) {
  const urls = [];

  if (jobUrl) {
    urls.push(jobUrl);

    try {
      const parsed = new URL(jobUrl);
      urls.push(new URL("/careers", parsed.origin).toString());
      urls.push(new URL("/jobs", parsed.origin).toString());
      urls.push(new URL("/about", parsed.origin).toString());
    } catch (error) {
      // Ignore invalid URLs and continue with name-based guessing.
    }
  }

  const companyName = normalizeText(company);
  const slug = companyName.replace(/[^a-z0-9]+/g, "");
  const hyphenSlug = companyName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  if (slug) {
    urls.push(`https://www.${slug}.com/careers`);
    urls.push(`https://${slug}.com/careers`);
    urls.push(`https://careers.${slug}.com`);
    urls.push(`https://jobs.${slug}.com`);
    urls.push(`https://boards.greenhouse.io/${hyphenSlug || slug}`);
    urls.push(`https://job-boards.greenhouse.io/${hyphenSlug || slug}`);
    urls.push(`https://jobs.lever.co/${hyphenSlug || slug}`);
    urls.push(`https://jobs.ashbyhq.com/${hyphenSlug || slug}`);
    urls.push(`https://jobs.smartrecruiters.com/${hyphenSlug || slug}`);
    urls.push(`https://apply.workable.com/${hyphenSlug || slug}`);
    urls.push(`https://${hyphenSlug || slug}.jobvite.com`);
  }

  return compact(urls);
}

function extractJobPostingObjects(html, pageUrl, company) {
  const objects = extractJsonLdObjects(html);
  const jobs = [];

  for (const object of objects) {
    const entries = Array.isArray(object?.itemListElement) ? object.itemListElement : [object];

    for (const entry of entries) {
      const target = entry?.item || entry;

      if (!target || !String(target["@type"] || "").toLowerCase().includes("jobposting")) {
        continue;
      }

      const location = Array.isArray(target.jobLocation)
        ? target.jobLocation.map((item) => item?.address?.addressLocality || item?.address?.addressRegion || item?.address?.addressCountry).filter(Boolean).join(", ")
        : target?.jobLocation?.address?.addressLocality || target?.jobLocation?.address?.addressRegion || target?.jobLocation?.address?.addressCountry || "";

      jobs.push({
        title: target.title || target.name,
        company: target.hiringOrganization?.name || company,
        location,
        employmentType: Array.isArray(target.employmentType) ? target.employmentType.join(", ") : target.employmentType,
        description: target.description,
        applyUrl: safeUrlString(target.url || pageUrl),
        postedAt: target.datePosted || "",
        internshipConfidence: /\bintern|internship|student|co-op\b/i.test(`${target.title || ""} ${target.description || ""}`) ? 0.92 : 0.36
      });
    }
  }

  return jobs;
}

function extractAnchorJobs(html, pageUrl, company) {
  const $ = cheerio.load(html);
  const parsedBase = parseUrl(pageUrl);
  const jobs = [];

  $("a[href]").each((_, node) => {
    const href = $(node).attr("href");
    const label = toText($(node).text(), 180);

    if (!href || !label) {
      return;
    }

    const absolute = safeUrlString(new URL(href, parsedBase?.origin || pageUrl).toString());

    if (!absolute) {
      return;
    }

    if (!/job|career|position|opening|opportunit|intern/i.test(`${label} ${absolute}`)) {
      return;
    }

    jobs.push({
      title: label.replace(/\s*apply now\s*/i, "").trim(),
      company,
      location: "",
      employmentType: /\bintern|internship|co-op\b/i.test(label) ? "Internship" : "",
      description: label,
      applyUrl: absolute,
      postedAt: "",
      internshipConfidence: /\bintern|internship|co-op|student\b/i.test(label) ? 0.9 : 0.35
    });
  });

  return jobs.slice(0, 24);
}

function extractBoardLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, node) => {
    const href = $(node).attr("href");

    if (!href) {
      return;
    }

    const absolute = safeUrlString(new URL(href, pageUrl).toString());
    if (!absolute) {
      return;
    }

    const type = detectAtsType(absolute);
    if (type !== "generic") {
      links.push({ type, url: absolute });
    }
  });

  return compact(links.map((item) => `${item.type}::${item.url}`)).map((value) => {
    const [type, url] = value.split("::");
    return { type, url };
  });
}

function extractGreenhouseToken(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return "";
  }

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (host.includes("greenhouse.io")) {
    if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
      return pathParts[0] || "";
    }

    return host.split(".")[0];
  }

  return "";
}

function extractLeverSite(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return "";
  }

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (host === "jobs.lever.co" || host === "api.lever.co") {
    return pathParts[0] || "";
  }

  if (host.endsWith(".lever.co")) {
    return host.split(".")[0];
  }

  return "";
}

function extractAshbyBoard(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return "";
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  return pathParts[0] || "";
}

async function fetchGreenhouseJobs(source, options) {
  const token = extractGreenhouseToken(source.url);

  if (!token) {
    return [];
  }

  const payload = await safeFetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs.map((job) => normalizeJob({
    title: job.title,
    company: source.company,
    location: job.location?.name || "",
    employmentType: job.metadata?.find?.((item) => /employment/i.test(item.name))?.value || "",
    description: cheerio.load(job.content || "").text(),
    applyUrl: job.absolute_url,
    postedAt: job.updated_at || job.created_at || "",
    internshipConfidence: /\bintern|internship|co-op|student\b/i.test(`${job.title} ${job.content || ""}`) ? 0.95 : 0.35,
    source: {
      label: `Greenhouse: ${source.label}`,
      url: source.url,
      type: "official"
    },
    role: options.role,
    candidateProfile: options.candidateProfile
  }));
}

async function fetchLeverJobs(source, options) {
  const site = extractLeverSite(source.url);

  if (!site) {
    return [];
  }

  const jobs = await safeFetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);

  return (Array.isArray(jobs) ? jobs : []).map((job) => normalizeJob({
    title: job.text,
    company: source.company,
    location: job.categories?.location || "",
    employmentType: job.categories?.commitment || "",
    description: cheerio.load(job.descriptionPlain || job.description || "").text(),
    applyUrl: job.hostedUrl || job.applyUrl,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : "",
    internshipConfidence: /\bintern|internship|co-op|student\b/i.test(`${job.text} ${job.descriptionPlain || ""}`) ? 0.95 : 0.34,
    source: {
      label: `Lever: ${source.label}`,
      url: source.url,
      type: "official"
    },
    role: options.role,
    candidateProfile: options.candidateProfile
  }));
}

async function fetchHtmlBoardJobs(source, options) {
  const html = await safeFetchText(source.url);
  const schemaJobs = extractJobPostingObjects(html, source.url, source.company);
  const anchorJobs = extractAnchorJobs(html, source.url, source.company);
  const combined = schemaJobs.length ? schemaJobs : anchorJobs;

  return combined.map((job) => normalizeJob({
    ...job,
    source: {
      label: source.label,
      url: source.url,
      type: "official"
    },
    role: options.role,
    candidateProfile: options.candidateProfile
  }));
}

const SOURCE_REGISTRY = {
  greenhouse: fetchGreenhouseJobs,
  lever: fetchLeverJobs,
  ashby: fetchHtmlBoardJobs,
  workday: fetchHtmlBoardJobs,
  smartrecruiters: fetchHtmlBoardJobs,
  workable: fetchHtmlBoardJobs,
  icims: fetchHtmlBoardJobs,
  jobvite: fetchHtmlBoardJobs,
  generic: fetchHtmlBoardJobs
};

async function discoverOfficialBoards({ company, jobUrl }) {
  const candidates = buildCompanyCandidates(company, jobUrl);
  const discovered = [];

  for (const candidateUrl of candidates.slice(0, 10)) {
    const type = detectAtsType(candidateUrl);

    if (type !== "generic") {
      discovered.push({
        type,
        url: candidateUrl,
        label: company || parseUrl(candidateUrl)?.hostname || "Official board",
        company: company || ""
      });
      continue;
    }

    try {
      const html = await safeFetchText(candidateUrl, { maxBytes: 900 * 1024 });
      discovered.push({
        type: "generic",
        url: candidateUrl,
        label: company || parseUrl(candidateUrl)?.hostname || "Careers page",
        company: company || ""
      });

      for (const board of extractBoardLinks(html, candidateUrl)) {
        discovered.push({
          ...board,
          label: company || parseUrl(board.url)?.hostname || board.type,
          company: company || ""
        });
      }
    } catch (error) {
      continue;
    }
  }

  return compact(discovered.map((item) => `${item.type}::${item.url}::${item.label}::${item.company}`)).map((value) => {
    const [type, url, label, companyName] = value.split("::");
    return { type, url, label, company: companyName };
  });
}

function shouldSkipNegativeCache(source) {
  return Boolean(getCacheEntry(NEGATIVE_CACHE, `${source.type}::${source.url}`));
}

function rememberFailure(source, error) {
  setCacheEntry(NEGATIVE_CACHE, `${source.type}::${source.url}`, {
    note: error.message || "Source fetch failed."
  }, NEGATIVE_TTL_MS);
}

async function fetchOfficialJobs(input) {
  const sources = await discoverOfficialBoards(input);
  const jobs = [];
  const usedSources = [];

  for (const source of sources.slice(0, 8)) {
    if (shouldSkipNegativeCache(source)) {
      continue;
    }

    const adapter = SOURCE_REGISTRY[source.type] || SOURCE_REGISTRY.generic;

    try {
      const found = await adapter(source, input);

      if (found.length) {
        jobs.push(...found);
        usedSources.push({
          label: source.label,
          url: source.url,
          type: "official"
        });
      }
    } catch (error) {
      rememberFailure(source, error);
    }
  }

  return {
    jobs,
    sources: usedSources
  };
}

async function fetchAggregatorJobs(input) {
  const searchTerms = compact([input.company, input.role, input.location]).join(" ");
  const jobs = [];
  const sources = [];

  try {
    const remotive = await safeFetchJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchTerms || input.role || "software engineer intern")}`);
    const resultJobs = Array.isArray(remotive?.jobs) ? remotive.jobs : [];

    jobs.push(
      ...resultJobs.slice(0, 20).map((job) => normalizeJob({
        title: job.title,
        company: job.company_name,
        location: job.candidate_required_location || "Remote",
        employmentType: job.job_type || "Remote",
        description: job.description,
        applyUrl: job.url,
        postedAt: job.publication_date || "",
        internshipConfidence: /\bintern|internship|co-op|student\b/i.test(`${job.title} ${job.description || ""}`) ? 0.88 : 0.24,
        source: {
          label: "Remotive",
          url: "https://remotive.com/api/remote-jobs",
          type: "public"
        },
        sourceType: "public",
        role: input.role,
        candidateProfile: input.candidateProfile
      }))
    );
    sources.push({
      label: "Remotive",
      url: "https://remotive.com/api/remote-jobs",
      type: "public"
    });
  } catch (error) {
    // Aggregator fallback is best-effort only.
  }

  return {
    jobs,
    sources
  };
}

function filterAndSortJobs(jobs, input) {
  const companyFilter = normalizeText(input.company);
  const locationFilter = normalizeText(input.location);
  const internshipOnly = Boolean(input.internshipOnly);

  return jobs
    .filter((job) => {
      if (companyFilter && !normalizeText(job.company).includes(companyFilter) && !normalizeText(job.source?.label).includes(companyFilter)) {
        return false;
      }

      if (locationFilter && !normalizeText(job.location).includes(locationFilter) && !normalizeText(job.location).includes("remote")) {
        return false;
      }

      if (internshipOnly && job.internshipConfidence < 0.45) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }

      return normalizeText(left.title).localeCompare(normalizeText(right.title));
    })
    .slice(0, 20);
}

function buildSearchMetadata(input, official, fallbackUsed) {
  return {
    role: input.role || "Software Engineer Intern",
    company: input.company || "",
    location: input.location || "",
    internshipOnly: Boolean(input.internshipOnly),
    retrievedAt: nowIso(),
    officialSourceCount: official.sources.length,
    fallbackUsed,
    sources: dedupeSources([...official.sources, ...fallbackUsed])
  };
}

async function searchLiveJobs(input = {}) {
  const cacheKey = searchCacheKey(input);

  if (!input.forceRefresh) {
    const cached = getCacheEntry(JOB_CACHE, cacheKey);
    if (cached) {
      return cached;
    }
  }

  const official = await fetchOfficialJobs(input);
  let jobs = dedupeJobs(official.jobs);
  let fallbackSources = [];

  if (jobs.length < 8) {
    const fallback = await fetchAggregatorJobs(input);
    jobs = dedupeJobs([...jobs, ...fallback.jobs]);
    fallbackSources = fallback.sources;
  }

  const filteredJobs = filterAndSortJobs(jobs, input);
  const result = {
    jobs: filteredJobs,
    metadata: buildSearchMetadata(input, official, fallbackSources),
    note: filteredJobs.length
      ? "Live job results are current to the latest fetch window and prefer official ATS or company sources."
      : "InterviewPal could not verify live openings for this search yet. Try a broader role or another company."
  };

  setCacheEntry(JOB_CACHE, cacheKey, result, JOB_TTL_MS);
  return result;
}

module.exports = {
  JOB_CACHE,
  NEGATIVE_CACHE,
  SOURCE_REGISTRY,
  searchLiveJobs
};
