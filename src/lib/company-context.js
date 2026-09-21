const { URL } = require("url");
const cheerio = require("cheerio");
const { normalizeText, ROLE_KEYWORDS } = require("./keywords");
const { safeFetchJson, safeFetchText } = require("./network");

const COMPANY_CACHE = new Map();
const COMPANY_NEGATIVE_CACHE = new Map();
const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function compact(values) {
  return [...new Set((values || []).map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function nowIso() {
  return new Date().toISOString();
}

function cacheKey({ company, role, jobUrl }) {
  return [normalizeText(company), normalizeText(role), normalizeText(jobUrl)].join("::");
}

function getCached(store, key) {
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

function setCached(store, key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function buildInterviewSignals(text, role) {
  const lowered = normalizeText(text);
  const keywords = Object.entries(ROLE_KEYWORDS)
    .filter(([key]) => normalizeText(role).includes(key))
    .flatMap(([, items]) => items);
  const matched = compact(keywords.filter((item) => lowered.includes(normalizeText(item))));

  if (matched.length) {
    return matched.slice(0, 4).map((item) => `Expect questions tied to ${item}.`);
  }

  return [
    "Expect a mix of project walkthrough, learning velocity, and communication questions.",
    "Be ready to connect student projects to production-style team impact."
  ];
}

function buildCompanyCandidates(company, jobUrl) {
  const urls = [];

  if (jobUrl) {
    urls.push(jobUrl);

    try {
      const parsed = new URL(jobUrl);
      urls.push(new URL("/about", parsed.origin).toString());
      urls.push(new URL("/careers", parsed.origin).toString());
      urls.push(new URL("/blog", parsed.origin).toString());
      urls.push(new URL("/news", parsed.origin).toString());
      urls.push(new URL("/engineering", parsed.origin).toString());
    } catch (error) {
      // Ignore invalid input and continue with name-based guesses.
    }
  }

  const slug = normalizeText(company).replace(/[^a-z0-9]+/g, "");
  const hyphenSlug = normalizeText(company).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  if (slug) {
    urls.push(`https://www.${slug}.com`);
    urls.push(`https://${slug}.com`);
    urls.push(`https://www.${slug}.com/about`);
    urls.push(`https://${slug}.com/about`);
    urls.push(`https://www.${slug}.com/careers`);
    urls.push(`https://${slug}.com/careers`);
    urls.push(`https://careers.${slug}.com`);
    urls.push(`https://jobs.${slug}.com`);
    urls.push(`https://www.${slug}.com/blog`);
    urls.push(`https://${slug}.com/blog`);
    urls.push(`https://www.${slug}.com/news`);
    urls.push(`https://${slug}.com/news`);
    urls.push(`https://www.${slug}.com/engineering`);
    urls.push(`https://${slug}.com/engineering`);
  }

  if (hyphenSlug && hyphenSlug !== slug) {
    urls.push(`https://www.${hyphenSlug}.com`);
    urls.push(`https://${hyphenSlug}.com`);
  }

  return compact(urls);
}

function extractTextSegments(url, html) {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
  const headings = $("h1, h2, h3").slice(0, 12).map((_, node) => $(node).text().trim()).get();
  const paragraphs = $("p").slice(0, 14).map((_, node) => $(node).text().trim()).get();
  const listItems = $("li").slice(0, 16).map((_, node) => $(node).text().trim()).get();
  const textPool = compact([title, description, ...headings, ...paragraphs, ...listItems]);
  const hostname = new URL(url).hostname.replace(/^www\./, "");

  return {
    hostname,
    summary: textPool.slice(0, 5).join(" ").slice(0, 480),
    products: compact(
      textPool.filter((item) => /platform|product|service|tool|api|cloud|software|workspace|assistant|model|data/i.test(item))
    ).slice(0, 5),
    hiringSignals: compact(
      textPool.filter((item) => /career|engineer|intern|student|grow|learn|ship|build|collaborat|team|mission/i.test(item))
    ).slice(0, 5),
    recentContext: compact(
      textPool.filter((item) => /news|launch|announc|recent|blog|engineering|update|release/i.test(item))
    ).slice(0, 4),
    source: {
      label: title || hostname,
      url,
      type: "official"
    },
    confidence: clamp((textPool.length * 0.05) + (description ? 0.2 : 0.05) + (headings.length * 0.03), 0.18, 0.96),
    textPool
  };
}

function mergeContexts(collected, role) {
  const summary = compact(collected.map((item) => item.summary)).join(" ").slice(0, 520);
  const mergedText = compact(collected.flatMap((item) => item.textPool)).join(" ");

  return {
    mode: "live",
    summary,
    products: compact(collected.flatMap((item) => item.products)).slice(0, 6),
    hiringSignals: compact(collected.flatMap((item) => item.hiringSignals)).slice(0, 6),
    interviewSignals: buildInterviewSignals(mergedText, role),
    recentContext: compact(collected.flatMap((item) => item.recentContext)).slice(0, 5),
    sources: collected.map((item) => item.source).slice(0, 6),
    confidence: clamp(collected.reduce((sum, item) => sum + item.confidence, 0) / Math.max(collected.length, 1), 0.2, 0.98),
    fallbackReason: "",
    retrievedAt: nowIso()
  };
}

function buildFallbackContext({ company, role, fallbackReason = "" }) {
  const companyName = company || "the target company";
  const targetRole = role || "software engineering internship";

  return {
    mode: company ? "fallback" : "none",
    summary: `InterviewPal could not verify strong live company context for ${companyName}, so this brief is using student-first fallback guidance tailored to ${targetRole}.`,
    products: company ? [`Likely team context relevant to ${targetRole}`] : [],
    hiringSignals: [
      "Expect emphasis on ramp-up speed, collaboration, and translating classwork into practical team impact.",
      "Use one coursework story and two product stories to reduce internship ramp-up risk."
    ],
    interviewSignals: buildInterviewSignals(`${companyName} ${targetRole}`, role),
    recentContext: company ? ["Refresh this brief against the company website and latest newsroom posts before interviews."] : [],
    sources: [],
    confidence: company ? 0.28 : 0.14,
    fallbackReason: fallbackReason || (company ? "Live company research was unavailable or too weak." : "No company was provided."),
    retrievedAt: nowIso()
  };
}

async function fetchWikipediaContext(company, role) {
  if (!company) {
    return null;
  }

  try {
    const payload = await safeFetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(company)}`);

    if (!payload.extract) {
      return null;
    }

    return {
      mode: "fallback",
      summary: payload.extract.slice(0, 480),
      products: compact([payload.description]).slice(0, 3),
      hiringSignals: [
        "This is broad public context rather than the current official company careers signal.",
        "Translate the mission into concrete reasons your projects and coursework fit."
      ],
      interviewSignals: buildInterviewSignals(`${payload.extract} ${payload.description || ""}`, role),
      recentContext: [],
      sources: [{
        label: payload.title || company,
        url: payload.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(company)}`,
        type: "public"
      }],
      confidence: 0.4,
      fallbackReason: "Official company pages were unavailable, so public context was used instead.",
      retrievedAt: nowIso()
    };
  } catch (error) {
    return null;
  }
}

async function resolveCompanyContext({ company, role, jobUrl, forceRefresh = false }) {
  const key = cacheKey({ company, role, jobUrl });

  if (!forceRefresh) {
    const cached = getCached(COMPANY_CACHE, key);
    if (cached) {
      return cached;
    }
  }

  const negative = getCached(COMPANY_NEGATIVE_CACHE, key);
  if (negative && !forceRefresh) {
    return negative;
  }

  const collected = [];
  const candidates = buildCompanyCandidates(company, jobUrl);

  for (const candidateUrl of candidates.slice(0, 7)) {
    try {
      const html = await safeFetchText(candidateUrl, { maxBytes: 900 * 1024 });
      const context = extractTextSegments(candidateUrl, html);

      if (context.summary) {
        collected.push(context);
      }

      if (collected.length >= 3) {
        break;
      }
    } catch (error) {
      continue;
    }
  }

  if (collected.length) {
    const merged = mergeContexts(collected, role);
    setCached(COMPANY_CACHE, key, merged, CONTEXT_TTL_MS);
    return merged;
  }

  const wikipedia = await fetchWikipediaContext(company, role);

  if (wikipedia) {
    setCached(COMPANY_CACHE, key, wikipedia, CONTEXT_TTL_MS);
    return wikipedia;
  }

  const fallback = buildFallbackContext({
    company,
    role,
    fallbackReason: company ? "Official company pages and public company context were unavailable." : "No company was provided."
  });
  setCached(COMPANY_NEGATIVE_CACHE, key, fallback, NEGATIVE_TTL_MS);
  return fallback;
}

module.exports = {
  COMPANY_CACHE,
  buildFallbackContext,
  resolveCompanyContext
};
