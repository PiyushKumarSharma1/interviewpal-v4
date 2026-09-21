const crypto = require("crypto");
const argon2 = require("argon2");

function deriveKey() {
  const base = process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || "interviewpal-development-key";
  return crypto.createHash("sha256").update(String(base)).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  });
}

function decryptJson(value) {
  const payload = JSON.parse(String(value || "{}"));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

function generateId() {
  return crypto.randomUUID();
}

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function sanitizeDisplayName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function hashPassword(password) {
  return argon2.hash(String(password || ""), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 3,
    parallelism: 1
  });
}

async function verifyPassword(hash, password) {
  return argon2.verify(String(hash || ""), String(password || ""));
}

function ensureCsrfToken(session) {
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(24).toString("hex");
  }

  return session.csrfToken;
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function redactCandidateForModel(candidate) {
  return {
    ...candidate,
    identity: {
      ...candidate.identity,
      email: "",
      phone: "",
      links: []
    }
  };
}

module.exports = {
  constantTimeEquals,
  decryptJson,
  encryptJson,
  ensureCsrfToken,
  generateId,
  hashPassword,
  redactCandidateForModel,
  sanitizeDisplayName,
  sanitizeEmail,
  verifyPassword
};
