function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function generatePrepWithOpenAI({ role, company, focusArea, profile, fallbackPrep }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey || !model) {
    return null;
  }

  const prompt = [
    "You are InterviewPal, an interview coach for early-career software candidates.",
    "Return only valid JSON with the same top-level shape as the provided fallback object.",
    "Keep the response concise, practical, and personalized to the candidate profile.",
    "",
    `Target role: ${role || "Software Engineer Intern"}`,
    `Target company: ${company || "Target Company"}`,
    `Focus area: ${focusArea || "Behavioral and project storytelling"}`,
    "",
    "Candidate profile JSON:",
    JSON.stringify(profile, null, 2),
    "",
    "Fallback structure to match:",
    JSON.stringify(fallbackPrep, null, 2)
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "Return only JSON. Do not use markdown fences."
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
  parsed.generatedAt = new Date().toISOString();
  parsed.mode = "ai";

  return parsed;
}

module.exports = { generatePrepWithOpenAI };

