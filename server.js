const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { profile } = require("./src/data/profile");
const { buildInterviewPrep } = require("./src/lib/interview-engine");
const { generatePrepWithOpenAI } = require("./src/lib/openai");

const publicDir = path.join(__dirname, "public");
const host = "127.0.0.1";

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const port = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, target));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      sendJson(res, 500, { error: "Failed to load asset" });
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/profile") {
    sendJson(res, 200, profile);
    return;
  }

  if (req.method === "POST" && pathname === "/api/prep") {
    try {
      const body = await readBody(req);
      const fallbackPrep = buildInterviewPrep(body);

      let prep = fallbackPrep;

      try {
        const aiPrep = await generatePrepWithOpenAI({
          role: body.role,
          company: body.company,
          focusArea: body.focusArea,
          profile,
          fallbackPrep
        });

        if (aiPrep) {
          prep = aiPrep;
        }
      } catch (error) {
        prep.aiError = error.message;
      }

      sendJson(res, 200, prep);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const currentUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (currentUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, currentUrl.pathname);
      return;
    }

    serveStatic(req, res, currentUrl.pathname);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`InterviewPal running at http://${host}:${port}`);
  });
}

module.exports = { createServer };
