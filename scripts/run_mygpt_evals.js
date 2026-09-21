const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateMyGPTTask, TASK_SCHEMAS } = require("../src/lib/mygpt");

const ROOT_DIR = path.resolve(__dirname, "..");
const EVAL_DIR = path.join(ROOT_DIR, "evals");
const SUMMARY_PATH = path.join(EVAL_DIR, "latest-summary.json");

function compact(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function readCases() {
  return fs.readdirSync(EVAL_DIR)
    .filter((fileName) => fileName.endsWith("_cases.json"))
    .sort()
    .flatMap((fileName) => {
      const fullPath = path.join(EVAL_DIR, fileName);
      const items = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      return items.map((item) => ({
        ...item,
        fileName
      }));
    });
}

function tokenSet(value) {
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9+#.-]+/).filter((token) => token.length >= 3));
}

function overlapScore(text, targets = []) {
  const haystack = tokenSet(text);
  const normalizedTargets = compact(targets).map((token) => String(token).toLowerCase());

  if (!normalizedTargets.length) {
    return 1;
  }

  let hits = 0;
  for (const token of normalizedTargets) {
    if (haystack.has(token) || String(text || "").toLowerCase().includes(token)) {
      hits += 1;
    }
  }
  return Number((hits / normalizedTargets.length).toFixed(2));
}

function evaluateCase(testCase, result) {
  const text = String(result.content || "").trim();
  const schema = TASK_SCHEMAS[testCase.taskType] || TASK_SCHEMAS.coaching_note;
  const promptEchoPass = !/(you are mygpt|### task|input:|output:|return only|task:)/i.test(text);
  const coherencePass = !/(\b\w+\b)(?:\s+\1\b){2,}/i.test(text) && !/\b[a-z]?\.[a-z]{2,}\b/gi.test(text);
  const formatPass = text.length >= 24 && text.length <= schema.maxChars;
  const relevanceScore = overlapScore(text, testCase.expectedKeywords);
  const faithfulnessScore = overlapScore(text, testCase.mustReference);
  const professionalismScore = Number((Math.max(0, 1 - (/[!?]{2,}|lol|bro|dude/i.test(text) ? 0.35 : 0)) * (text.length >= 32 ? 1 : 0.7)).toFixed(2));
  const forbiddenViolations = compact(testCase.forbiddenKeywords).filter((item) => text.toLowerCase().includes(item.toLowerCase()));

  return {
    id: testCase.id,
    taskType: testCase.taskType,
    fileName: testCase.fileName,
    content: text,
    formatPass,
    coherencePass,
    relevanceScore,
    faithfulnessScore,
    professionalismScore,
    promptEchoPass,
    fallbackTriggered: Boolean(result.fallbackUsed),
    validationState: result.validationState,
    actualProvider: result.actualProvider,
    modelVersion: result.modelVersion,
    forbiddenViolations
  };
}

function summarize(results) {
  const total = results.length || 1;
  const average = (key) => Number((results.reduce((sum, item) => sum + Number(item[key] || 0), 0) / total).toFixed(2));
  const passRate = (key) => Number((results.filter((item) => item[key]).length / total).toFixed(2));
  const byTask = {};

  for (const result of results) {
    byTask[result.taskType] = byTask[result.taskType] || [];
    byTask[result.taskType].push(result);
  }

  return {
    overall: {
      cases: results.length,
      formatPassRate: passRate("formatPass"),
      coherencePassRate: passRate("coherencePass"),
      promptEchoPassRate: passRate("promptEchoPass"),
      fallbackRate: passRate("fallbackTriggered"),
      avgRelevanceScore: average("relevanceScore"),
      avgFaithfulnessScore: average("faithfulnessScore"),
      avgProfessionalismScore: average("professionalismScore")
    },
    tasks: Object.fromEntries(
      Object.entries(byTask).map(([taskType, taskResults]) => [
        taskType,
        {
          cases: taskResults.length,
          formatPassRate: Number((taskResults.filter((item) => item.formatPass).length / taskResults.length).toFixed(2)),
          coherencePassRate: Number((taskResults.filter((item) => item.coherencePass).length / taskResults.length).toFixed(2)),
          promptEchoPassRate: Number((taskResults.filter((item) => item.promptEchoPass).length / taskResults.length).toFixed(2)),
          fallbackRate: Number((taskResults.filter((item) => item.fallbackTriggered).length / taskResults.length).toFixed(2)),
          avgRelevanceScore: Number((taskResults.reduce((sum, item) => sum + item.relevanceScore, 0) / taskResults.length).toFixed(2)),
          avgFaithfulnessScore: Number((taskResults.reduce((sum, item) => sum + item.faithfulnessScore, 0) / taskResults.length).toFixed(2)),
          avgProfessionalismScore: Number((taskResults.reduce((sum, item) => sum + item.professionalismScore, 0) / taskResults.length).toFixed(2))
        }
      ])
    )
  };
}

async function main() {
  const cases = readCases();
  if (!cases.length) {
    throw new Error("No eval cases found.");
  }

  const results = [];

  for (const testCase of cases) {
    const taskResult = await generateMyGPTTask(ROOT_DIR, {
      taskType: testCase.taskType,
      input: testCase.input
    });
    results.push(evaluateCase(testCase, taskResult));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    checkpointHash: fs.existsSync(path.join(ROOT_DIR, "model.pt"))
      ? crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT_DIR, "model.pt"))).digest("hex")
      : "",
    summary: summarize(results),
    results
  };

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  console.log("mygpt eval summary");
  console.log(JSON.stringify(summary.summary, null, 2));
  console.log(`Saved detailed eval output to ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
