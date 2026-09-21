const dns = require("dns").promises;
const { URL } = require("url");

const REQUEST_TIMEOUT_MS = 5500;
const MAX_RESPONSE_BYTES = 1.5 * 1024 * 1024;

function isPrivateAddress(address) {
  return (
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    address.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80")
  );
}

async function isSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home") ||
      !hostname.includes(".")
    ) {
      return false;
    }

    const results = await dns.lookup(hostname, { all: true });
    return results.every((result) => !isPrivateAddress(result.address));
  } catch (error) {
    return false;
  }
}

async function safeFetchResponse(url, options = {}) {
  if (!(await isSafeExternalUrl(url))) {
    throw new Error("Blocked unsafe external URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "InterviewPal/3.0 (+student-first career copilot)",
        Accept: options.accept || "text/html,application/json,application/ld+json,application/xml,text/xml;q=0.9,*/*;q=0.5",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > (options.maxBytes || MAX_RESPONSE_BYTES)) {
      throw new Error("Response body exceeded the allowed size.");
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const text = await response.text();

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("Response body exceeded the allowed size.");
  }

  return text;
}

async function safeFetchText(url, options = {}) {
  const response = await safeFetchResponse(url, options);
  return readResponseText(response, options.maxBytes);
}

async function safeFetchJson(url, options = {}) {
  const response = await safeFetchResponse(url, {
    ...options,
    accept: "application/json,application/ld+json,text/plain;q=0.5,*/*;q=0.1"
  });
  const text = await readResponseText(response, options.maxBytes);
  return JSON.parse(text);
}

function safeUrlString(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch (error) {
    return "";
  }
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  isSafeExternalUrl,
  safeFetchJson,
  safeFetchResponse,
  safeFetchText,
  safeUrlString
};
