const { candidateToPromptSummary } = require("./candidate-profile");

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function mergeRefinement(baseAnalysis, refinement) {
  if (!refinement || typeof refinement !== "object") {
    return baseAnalysis;
  }

  return {
    ...baseAnalysis,
    summary: {
      ...baseAnalysis.summary,
      ...(refinement.summary || {})
    },
    resumeAnalysis: {
      ...baseAnalysis.resumeAnalysis,
      ...(refinement.resumeAnalysis || {})
    },
    jobSearchRecommendations: {
      ...baseAnalysis.jobSearchRecommendations,
      ...(refinement.jobSearchRecommendations || {})
    },
    recommendedQuestions: Array.isArray(refinement.recommendedQuestions)
      ? refinement.recommendedQuestions
      : baseAnalysis.recommendedQuestions,
    resumeQuestions: Array.isArray(refinement.resumeQuestions)
      ? refinement.resumeQuestions
      : baseAnalysis.resumeQuestions,
    jobQuestions: Array.isArray(refinement.jobQuestions)
      ? refinement.jobQuestions
      : baseAnalysis.jobQuestions,
    metadata: {
      ...baseAnalysis.metadata,
      ...(refinement.metadata || {}),
      provider: "openai"
    }
  };
}

async function refineAnalysisWithOpenAI({
  role,
  company,
  focusArea,
  candidateProfile,
  baseAnalysis
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey || !model) {
    return null;
  }

  const prompt = [
    "You are an owner-only refinement step for InterviewPal's local mygpt workflow.",
    "Return only valid JSON.",
    "Do not change numeric scores, candidate identity fields, or company context sources.",
    "Only refine tone and usefulness in summary, resumeAnalysis text arrays, recommendedQuestions, resumeQuestions, jobQuestions, jobSearchRecommendations, and metadata.note.",
    "Stay concise, practical, privacy-conscious, and aligned with a student-built local-first product.",
    "",
    `Target role: ${role || "Software Engineer Intern"}`,
    `Target company: ${company || "Target Company"}`,
    `Focus area: ${focusArea || "Behavioral and project storytelling"}`,
    "",
    "Candidate profile summary JSON:",
    JSON.stringify(candidateToPromptSummary(candidateProfile), null, 2),
    "",
    "Current grouped analysis JSON:",
    JSON.stringify(baseAnalysis, null, 2),
    "",
    "Return the same grouped top-level shape."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: "Return only JSON. Never wrap the answer in markdown fences."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI response did not include message content.");
  }

  const parsed = extractJson(content);
  return mergeRefinement(baseAnalysis, parsed);
}

module.exports = {
  refineAnalysisWithOpenAI
};
