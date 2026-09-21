const state = {
  csrfToken: "",
  user: null,
  defaultProfile: null,
  sessionCandidateProfile: null,
  sessionCandidateProfileId: "",
  currentAnalysis: null
};

const els = {
  profileCard: document.getElementById("profile-card"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  actionBar: document.getElementById("action-bar"),
  downloadPdf: document.getElementById("download-pdf"),
  downloadJson: document.getElementById("download-json"),
  saveReport: document.getElementById("save-report"),
  authForm: document.getElementById("auth-form"),
  authDisplayName: document.getElementById("auth-display-name"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authMygptOptIn: document.getElementById("auth-mygpt-opt-in"),
  signupSubmit: document.getElementById("signup-submit"),
  loginSubmit: document.getElementById("login-submit"),
  accountSummary: document.getElementById("account-summary"),
  accountName: document.getElementById("account-name"),
  accountEmail: document.getElementById("account-email"),
  accountMygptOptIn: document.getElementById("account-mygpt-opt-in"),
  refreshWorkspace: document.getElementById("refresh-workspace"),
  exportAccount: document.getElementById("export-account"),
  logoutSubmit: document.getElementById("logout-submit"),
  deleteAccount: document.getElementById("delete-account"),
  assistantThread: document.getElementById("assistant-thread"),
  assistantForm: document.getElementById("assistant-form"),
  assistantMessage: document.getElementById("assistant-message"),
  assistantUseSessionProfile: document.getElementById("assistant-use-session-profile"),
  assistantForceRefresh: document.getElementById("assistant-force-refresh"),
  assistantSave: document.getElementById("assistant-save"),
  quickPrompts: document.getElementById("quick-prompts"),
  resumeForm: document.getElementById("resume-form"),
  resumeInput: document.getElementById("resume"),
  resumeRole: document.getElementById("resume-role"),
  resumeCompany: document.getElementById("resume-company"),
  resumeLocation: document.getElementById("resume-location"),
  resumeJobUrl: document.getElementById("resume-job-url"),
  resumeForceRefresh: document.getElementById("resume-force-refresh"),
  resumeSave: document.getElementById("resume-save"),
  jobsForm: document.getElementById("jobs-form"),
  jobsRole: document.getElementById("jobs-role"),
  jobsCompany: document.getElementById("jobs-company"),
  jobsLocation: document.getElementById("jobs-location"),
  jobsJobUrl: document.getElementById("jobs-job-url"),
  jobsUseSessionProfile: document.getElementById("jobs-use-session-profile"),
  jobsForceRefresh: document.getElementById("jobs-force-refresh"),
  jobsSave: document.getElementById("jobs-save"),
  prepForm: document.getElementById("prep-form"),
  prepRole: document.getElementById("prep-role"),
  prepCompany: document.getElementById("prep-company"),
  prepLocation: document.getElementById("prep-location"),
  prepJobUrl: document.getElementById("prep-job-url"),
  prepFocusArea: document.getElementById("focusArea"),
  prepUseSessionProfile: document.getElementById("use-session-profile"),
  prepForceRefresh: document.getElementById("prep-force-refresh"),
  prepSave: document.getElementById("prep-save"),
  sessionNote: document.getElementById("session-note"),
  savedProfiles: document.getElementById("saved-profiles"),
  savedSearches: document.getElementById("saved-searches"),
  savedPrep: document.getElementById("saved-prep"),
  savedReports: document.getElementById("saved-reports"),
  advancedPanel: document.getElementById("advanced-panel"),
  advancedProvider: document.getElementById("advanced-provider"),
  advancedRefresh: document.getElementById("advanced-refresh"),
  advancedDiagnostics: document.getElementById("advanced-diagnostics")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compact(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function truncate(value, max = 220) {
  const text = String(value || "").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function isOwner() {
  return Boolean(state.user?.owner);
}

function getAdvancedProvider() {
  return isOwner() ? String(els.advancedProvider.value || "") : "";
}

function setStatus(message, variant = "") {
  els.status.className = variant ? `status ${variant}` : "status";
  els.status.textContent = message;
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken) {
    headers.set("x-csrf-token", state.csrfToken);
  }

  const request = {
    method,
    headers,
    credentials: "same-origin"
  };

  if (options.formData) {
    request.body = options.formData;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, request);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage = typeof payload === "object" && payload?.error ? payload.error : response.statusText || "Request failed.";
    throw new Error(errorMessage);
  }

  return payload;
}

function renderProfileSnapshot(profile, label = "Default candidate snapshot") {
  const candidate = profile || state.defaultProfile;
  if (!candidate) {
    els.profileCard.innerHTML = '<p class="muted">Unable to load the local candidate snapshot.</p>';
    return;
  }

  const skills = compact(candidate.skills?.all || []);
  const education = candidate.education?.[0];
  const projects = candidate.projects || [];

  els.profileCard.innerHTML = `
    <p class="eyebrow">${escapeHtml(label)}</p>
    <h2>${escapeHtml(candidate.identity?.name || "Student candidate")}</h2>
    <p class="lede small">${escapeHtml(candidate.identity?.headline || "Local-first student career copilot profile.")}</p>
    <div class="profile-meta">
      ${candidate.identity?.location ? `<span>${escapeHtml(candidate.identity.location)}</span>` : ""}
      ${education?.school ? `<span>${escapeHtml(education.school)}</span>` : ""}
      ${education?.graduation ? `<span>${escapeHtml(education.graduation)}</span>` : ""}
    </div>
    <div class="mini-list">
      ${skills.slice(0, 8).map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}
    </div>
    <div class="muted-row compact">
      <strong>${projects.length}</strong> project stories ready for job search, prep, and report generation.
    </div>
  `;
}

function updateSessionNote() {
  if (state.sessionCandidateProfile) {
    const name = state.sessionCandidateProfile.identity?.name || "Uploaded profile";
    els.sessionNote.textContent = `${name} is active in this session. Chat, jobs, and prep can reuse this parsed resume without storing the raw file.`;
    return;
  }

  els.sessionNote.textContent = "No uploaded resume is active in this session yet. Prep will use the default Piyush profile.";
}

function appendThreadMessage(role, text, badges = []) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "mygpt";
  article.appendChild(label);

  const body = document.createElement("p");
  body.textContent = text;
  article.appendChild(body);

  if (badges.length) {
    const row = document.createElement("div");
    row.className = "badge-row";
    compact(badges).forEach((badge) => {
      const pill = document.createElement("span");
      pill.className = "meta-badge soft";
      pill.textContent = badge;
      row.appendChild(pill);
    });
    article.appendChild(row);
  }

  els.assistantThread.appendChild(article);
  els.assistantThread.scrollTop = els.assistantThread.scrollHeight;
}

function uniqueQuestions(analysis) {
  const questions = [
    ...(analysis?.recommendedQuestions || []),
    ...(analysis?.resumeQuestions || []),
    ...(analysis?.jobQuestions || [])
  ];
  const seen = new Set();
  return questions.filter((item) => {
    const key = String(item?.question || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function computeBadges(analysis) {
  const badges = ["mygpt local"];

  if (analysis?.liveJobs?.length || analysis?.companyContext?.mode === "live") {
    badges.push("live data");
  }

  if ((analysis?.metadata?.sources || []).some((source) => source?.type === "official")) {
    badges.push("official sources");
  }

  if (analysis?.metadata?.fallbackUsed || analysis?.companyContext?.mode === "fallback") {
    badges.push("fallback used");
  }

  return badges;
}

function scoreTone(score) {
  if (score >= 80) return "strong";
  if (score >= 65) return "warm";
  return "soft";
}

function renderListItems(items, emptyText = "No details available.") {
  const list = compact(items);
  if (!list.length) {
    return `<div class="muted-row">${escapeHtml(emptyText)}</div>`;
  }

  return list
    .map((item) => `<div class="list-row">${escapeHtml(item)}</div>`)
    .join("");
}

function renderSourceLinks(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) {
    return '<div class="muted-row">No source links were returned for this result.</div>';
  }

  return `
    <div class="source-list">
      ${list.map((source) => `
        <a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(source.label || source.url || "Source")}
        </a>
      `).join("")}
    </div>
  `;
}

function renderQuestionCards(questions) {
  const list = questions.slice(0, 9);
  if (!list.length) {
    return '<div class="muted-row">Ask mygpt for interview prep or upload a resume to generate tailored questions.</div>';
  }

  return list.map((item) => `
    <article class="question-card">
      <p class="question-topline">${escapeHtml(item.category || "Question")}</p>
      <h4>${escapeHtml(item.question || "Question")}</h4>
      <p>${escapeHtml(item.rationale || "Generated from your current role, resume, and company context.")}</p>
    </article>
  `).join("");
}

function renderJobCards(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) {
    return '<div class="muted-row">No live openings were attached to this result yet.</div>';
  }

  return list.slice(0, 8).map((job) => `
    <article class="job-card">
      <div class="job-topline">
        <strong>${escapeHtml(job.title || "Target role")}</strong>
        <span class="meta-badge soft">${escapeHtml(`${job.matchScore || 0}% match`)}</span>
      </div>
      <p>${escapeHtml(job.company || "Company")} • ${escapeHtml(job.location || "Location flexible")}</p>
      <p>${escapeHtml(job.descriptionSnippet || "Official ATS or company posting used to tailor the analysis.")}</p>
      <div class="job-tags">
        ${compact(job.matchReasons || []).map((reason) => `<span class="chip">${escapeHtml(reason)}</span>`).join("")}
      </div>
      <div class="saved-item-actions horizontal">
        ${job.applyUrl ? `<a href="${escapeHtml(job.applyUrl)}" target="_blank" rel="noopener noreferrer">Open job</a>` : ""}
        <span class="muted small">${escapeHtml(job.source?.label || "Source")} • ${escapeHtml(formatDateTime(job.retrievedAt))}</span>
      </div>
    </article>
  `).join("");
}

function renderAnalysis(analysis) {
  state.currentAnalysis = analysis;
  if (analysis?.candidate) {
    state.sessionCandidateProfile = analysis.candidate;
  }
  updateSessionNote();
  renderProfileSnapshot(analysis?.candidate || state.defaultProfile, analysis?.candidate ? "Active session profile" : "Default candidate snapshot");

  const badges = analysis?.metadata?.userVisibleBadges || computeBadges(analysis);
  const questions = uniqueQuestions(analysis);
  const scorecard = analysis?.scorecard || {};
  const dimensions = Object.entries(scorecard.dimensions || {});
  const overallScore = Number(scorecard.overallScore || 0);
  const improvementItems = compact(analysis?.resumeAnalysis?.improvementActions || analysis?.summary?.nextActions || []);
  const strengthItems = compact(analysis?.summary?.topStrengths || analysis?.resumeAnalysis?.strengths || []);
  const readinessNotes = compact([
    ...(analysis?.internshipRecommendations?.readinessNotes || []),
    ...(analysis?.jobSearchRecommendations?.optimizationTips || [])
  ]);
  const searchKeywords = compact([
    ...(analysis?.internshipRecommendations?.searchKeywords || []),
    ...(analysis?.jobSearchRecommendations?.searchKeywords || [])
  ]);
  const nextSkillSuggestions = compact([
    ...(analysis?.internshipRecommendations?.nextSkillSuggestions || []),
    ...(analysis?.jobSearchRecommendations?.nextSkillSuggestions || [])
  ]);
  const topActions = compact(analysis?.summary?.nextActions || []);
  const contextMode = analysis?.companyContext?.mode || "fallback";

  els.actionBar.classList.remove("hidden");
  els.results.innerHTML = `
    <section class="result-card hero-result">
      <div class="result-header">
        <div>
          <p class="eyebrow">mygpt workspace result</p>
          <h2>${escapeHtml(analysis?.summary?.headline || "Local-first career copilot result")}</h2>
          <p>${escapeHtml(analysis?.summary?.fitSnapshot || "No fit snapshot was generated.")}</p>
        </div>
        <div class="score-pill ${scoreTone(overallScore)}">
          ${escapeHtml(String(overallScore))}
          <small>overall</small>
        </div>
      </div>
      <div class="badge-row">
        ${badges.map((badge) => `<span class="meta-badge">${escapeHtml(badge)}</span>`).join("")}
        ${analysis?.target?.role ? `<span class="meta-badge soft">${escapeHtml(analysis.target.role)}</span>` : ""}
        ${analysis?.target?.company ? `<span class="meta-badge soft">${escapeHtml(analysis.target.company)}</span>` : ""}
      </div>
      <p>${escapeHtml(analysis?.summary?.pitch || analysis?.summary?.reportSummary || "mygpt combines deterministic scoring with local generation and safe fallbacks.")}</p>
      ${analysis?.summary?.topRisk ? `<div class="warning-strip">Top risk: ${escapeHtml(analysis.summary.topRisk)}</div>` : ""}
      <div class="target-highlight">
        Freshness: jobs ${escapeHtml(formatDateTime(analysis?.metadata?.sourceFreshness?.jobs || analysis?.metadata?.jobsRetrievedAt || analysis?.metadata?.retrievedAt || "")) || "not available"} •
        company ${escapeHtml(formatDateTime(analysis?.metadata?.sourceFreshness?.company || analysis?.metadata?.retrievedAt || "")) || "not available"} •
        company context ${escapeHtml(contextMode)}
      </div>
    </section>

    <section class="result-card">
      <div class="result-header">
        <h3>Score dimensions</h3>
        <span class="muted small">Deterministic and explainable</span>
      </div>
      <div class="score-grid">
        ${dimensions.map(([key, value]) => `
          <article class="score-chip">
            <strong>${escapeHtml(key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()))}</strong>
            <span>${escapeHtml(String(value.score || 0))}</span>
            <p>${escapeHtml(value.why || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <div class="result-grid">
      <section class="result-card">
        <h3>Candidate snapshot</h3>
        <div class="candidate-summary">
          <strong>${escapeHtml(analysis?.candidate?.identity?.name || "Student candidate")}</strong>
          <p>${escapeHtml(analysis?.candidate?.identity?.headline || "Career profile available in the structured analysis.")}</p>
          <div class="profile-meta">
            ${analysis?.candidate?.identity?.location ? `<span>${escapeHtml(analysis.candidate.identity.location)}</span>` : ""}
            ${analysis?.candidate?.education?.[0]?.school ? `<span>${escapeHtml(analysis.candidate.education[0].school)}</span>` : ""}
            ${analysis?.candidate?.education?.[0]?.graduation ? `<span>${escapeHtml(analysis.candidate.education[0].graduation)}</span>` : ""}
          </div>
          <div class="mini-list">
            ${compact(analysis?.candidate?.skills?.all || []).slice(0, 10).map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}
          </div>
        </div>
      </section>

      <section class="result-card">
        <h3>Top strengths</h3>
        ${renderListItems(strengthItems, "The score engine did not surface strengths yet.")}
      </section>

      <section class="result-card">
        <h3>What to improve next</h3>
        ${renderListItems(improvementItems, "No improvement actions were generated.")}
      </section>

      <section class="result-card">
        <h3>Next actions</h3>
        ${renderListItems(topActions, "Ask mygpt for a tighter action plan if you want a faster prep loop.")}
      </section>
    </div>

    <div class="result-grid">
      <section class="result-card">
        <h3>Recommended questions</h3>
        <div class="stack">
          ${renderQuestionCards(questions)}
        </div>
      </section>

      <section class="result-card">
        <h3>Internship and job direction</h3>
        <div class="stack">
          <div class="list-row">
            <strong>Role families</strong>
            <p>${escapeHtml(compact(analysis?.internshipRecommendations?.roleFamilies || []).join(", ") || "Software engineering, full-stack, and student internship tracks.")}</p>
          </div>
          <div class="list-row">
            <strong>Company buckets</strong>
            <p>${escapeHtml(compact(analysis?.internshipRecommendations?.companyBuckets || []).join(", ") || "Fast-learning, student-friendly engineering teams.")}</p>
          </div>
          <div class="list-row">
            <strong>Search keywords</strong>
            <p>${escapeHtml(searchKeywords.join(", ") || "software engineer intern, backend intern, full stack intern")}</p>
          </div>
          <div class="list-row">
            <strong>Readiness notes</strong>
            <p>${escapeHtml(readinessNotes.join(" ") || "Use project depth, quantified bullets, and internship-ready framing.")}</p>
          </div>
          <div class="list-row">
            <strong>Next skills</strong>
            <p>${escapeHtml(nextSkillSuggestions.join(", ") || "Ownership wording, metrics, and role-specific tooling evidence.")}</p>
          </div>
        </div>
      </section>
    </div>

    <div class="result-grid">
      <section class="result-card">
        <div class="result-header">
          <h3>Live roles</h3>
          <span class="muted small">${escapeHtml(String((analysis?.liveJobs || []).length))} results</span>
        </div>
        <div class="stack">
          ${renderJobCards(analysis?.liveJobs || [])}
        </div>
      </section>

      <section class="result-card">
        <div class="result-header">
          <h3>Company context</h3>
          <span class="meta-badge soft">${escapeHtml(contextMode)}</span>
        </div>
        <p>${escapeHtml(analysis?.companyContext?.summary || "No company context was generated for this result.")}</p>
        <div class="stack">
          ${renderListItems(analysis?.companyContext?.interviewSignals || [], "Company-specific interview signals were limited, so mygpt leaned on general role-fit reasoning.")}
          ${renderSourceLinks(analysis?.metadata?.sources || analysis?.companyContext?.sources || [])}
        </div>
      </section>
    </div>

    <div class="result-grid">
      <section class="result-card">
        <h3>Resume analytics</h3>
        <div class="stack">
          <div class="list-row"><strong>Best sections</strong><p>${escapeHtml(compact(analysis?.resumeAnalysis?.bestSections || []).join(", ") || "No standout sections identified yet.")}</p></div>
          <div class="list-row"><strong>Weakest sections</strong><p>${escapeHtml(compact(analysis?.resumeAnalysis?.weakestSections || []).join(", ") || "No weak sections flagged.")}</p></div>
          <div class="list-row"><strong>Missing keywords</strong><p>${escapeHtml(compact(analysis?.resumeAnalysis?.missingKeywords || []).join(", ") || "No major keyword gaps were flagged.")}</p></div>
          <div class="list-row"><strong>Weak bullet patterns</strong><p>${escapeHtml(compact(analysis?.resumeAnalysis?.weakBulletPatterns || []).join(" | ") || "No weak bullet patterns were highlighted.")}</p></div>
        </div>
      </section>

      <section class="result-card">
        <h3>Local engine notes</h3>
        <div class="stack">
          <div class="list-row">
            <strong>Report summary</strong>
            <p>${escapeHtml(analysis?.summary?.reportSummary || analysis?.summary?.fitSnapshot || "Report narrative not available.")}</p>
          </div>
          <div class="list-row">
            <strong>Validation state</strong>
            <p>${escapeHtml(analysis?.metadata?.fallbackUsed ? "Deterministic fallback protected the output from bad model text." : "mygpt local generation passed validation for this result.")}</p>
          </div>
          <div class="list-row">
            <strong>Workspace note</strong>
            <p>${escapeHtml(analysis?.metadata?.note || "Structured analysis is ready for secure saving or export.")}</p>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderStandaloneResponse(response) {
  els.actionBar.classList.add("hidden");
  const cards = Array.isArray(response?.cards) ? response.cards : [];

  els.results.innerHTML = `
    <section class="result-card hero-result">
      <div class="result-header">
        <div>
          <p class="eyebrow">mygpt response</p>
          <h2>${escapeHtml(response?.taskType || "Assistant result")}</h2>
        </div>
      </div>
      <p>${escapeHtml(response?.reply || "mygpt returned a quick response.")}</p>
    </section>

    <div class="result-grid">
      ${cards.map((card) => `
        <section class="result-card">
          <h3>${escapeHtml(card.title || "Assistant card")}</h3>
          ${card.original ? `<p><strong>Original:</strong> ${escapeHtml(card.original)}</p>` : ""}
          ${card.rewritten ? `<p><strong>Rewrite:</strong> ${escapeHtml(card.rewritten)}</p>` : ""}
          ${card.body ? `<p>${escapeHtml(card.body)}</p>` : ""}
        </section>
      `).join("") || '<section class="result-card"><p>No structured cards were attached to this assistant response.</p></section>'}
    </div>
  `;
}

function applyResponse(response, options = {}) {
  if (response?.analysis) {
    renderAnalysis(response.analysis);
    if (options.appendReply !== false && response.reply) {
      appendThreadMessage("assistant", response.reply, response?.metadata?.userVisibleBadges || computeBadges(response.analysis));
    }
    return;
  }

  renderStandaloneResponse(response);
  if (options.appendReply !== false && response?.reply) {
    appendThreadMessage("assistant", response.reply, response?.metadata?.userVisibleBadges || []);
  }
}

function openDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setAuthUi() {
  const authenticated = Boolean(state.user);
  els.authForm.classList.toggle("hidden", authenticated);
  els.accountSummary.classList.toggle("hidden", !authenticated);

  if (authenticated) {
    els.accountName.textContent = state.user.displayName || state.user.email || "Workspace owner";
    els.accountEmail.textContent = state.user.email || "";
    els.accountMygptOptIn.checked = Boolean(state.user.mygptOptIn);
  }

  const owner = isOwner();
  els.advancedPanel.classList.toggle("hidden", !owner);
}

async function refreshAuthState(showStatus = false) {
  const data = await apiFetch("/api/auth/me");
  state.csrfToken = data.csrfToken || state.csrfToken;
  state.user = data.authenticated ? data.user : null;
  setAuthUi();

  if (showStatus) {
    setStatus(
      state.user
        ? `Signed in as ${state.user.displayName || state.user.email}. Workspace encryption and mygpt session controls are active.`
        : "InterviewPal is ready. Raw resumes stay in memory, structured workspace items are encrypted, and mygpt falls back safely if local generation fails validation.",
      state.user ? "success" : ""
    );
  }

  if (state.user) {
    await refreshWorkspaceLists();
    if (isOwner()) {
      await refreshDiagnostics();
    }
  } else {
    clearWorkspaceLists();
  }
}

function clearWorkspaceLists() {
  els.savedProfiles.innerHTML = '<p class="muted">Sign in to view saved profiles.</p>';
  els.savedSearches.innerHTML = '<p class="muted">Sign in to view saved searches.</p>';
  els.savedPrep.innerHTML = '<p class="muted">Sign in to view saved prep sessions.</p>';
  els.savedReports.innerHTML = '<p class="muted">Sign in to view saved reports.</p>';
  els.advancedDiagnostics.innerHTML = '<p class="muted">Owner diagnostics load here.</p>';
}

function renderSavedItems(container, items, emptyText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    container.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
    return;
  }

  container.innerHTML = list.map((item) => `
    <article class="saved-item">
      <div class="saved-item-copy">
        <strong>${escapeHtml(item.title || "Saved item")}</strong>
        <p>${escapeHtml(truncate(item.summary || "Saved workspace snapshot", 140))}</p>
        <span>${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</span>
      </div>
      <div class="saved-item-actions">
        <button type="button" class="secondary" data-open-saved="true" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(item.id)}">Open</button>
        ${item.kind === "report"
          ? `<a href="/api/saved/reports/${encodeURIComponent(item.id)}/download?format=${encodeURIComponent(item.format || "pdf")}" target="_blank" rel="noopener noreferrer">Download</a>`
          : ""}
      </div>
    </article>
  `).join("");
}

async function refreshWorkspaceLists() {
  if (!state.user) {
    clearWorkspaceLists();
    return;
  }

  try {
    const [profiles, searches, prep, reports] = await Promise.all([
      apiFetch("/api/saved/profiles"),
      apiFetch("/api/saved/searches"),
      apiFetch("/api/saved/prep"),
      apiFetch("/api/saved/reports")
    ]);

    renderSavedItems(els.savedProfiles, profiles, "No saved profiles yet.");
    renderSavedItems(els.savedSearches, searches, "No saved searches yet.");
    renderSavedItems(els.savedPrep, prep, "No saved prep sessions yet.");
    renderSavedItems(els.savedReports, reports, "No saved reports yet.");
  } catch (error) {
    setStatus(error.message, "warning");
  }
}

async function refreshDiagnostics() {
  if (!isOwner()) {
    return;
  }

  try {
    const diagnostics = await apiFetch("/api/advanced/diagnostics");
    const providers = diagnostics.providers || {};
    const logs = diagnostics.logs || [];

    els.advancedDiagnostics.innerHTML = `
      <div class="stack">
        <div class="list-row">
          <strong>mygpt</strong>
          <p>${escapeHtml(providers.mygpt?.available ? "Healthy local worker is available." : providers.mygpt?.detail || "Unavailable.")}</p>
        </div>
        <div class="list-row">
          <strong>Owner-only hosted refine</strong>
          <p>${escapeHtml(providers.openai?.detail || "Not configured.")}</p>
        </div>
        <div class="list-row">
          <strong>Deterministic backbone</strong>
          <p>${escapeHtml(providers.deterministic?.detail || "Fallback stack is ready.")}</p>
        </div>
        <div class="list-row">
          <strong>Recent local logs</strong>
          <p>${escapeHtml(logs.slice(0, 6).map((entry) => `${entry.timestamp}: ${entry.note}`).join(" | ") || "No diagnostics recorded yet.")}</p>
        </div>
      </div>
    `;
  } catch (error) {
    els.advancedDiagnostics.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

async function handleAuth(action) {
  const payload = {
    displayName: els.authDisplayName.value,
    email: els.authEmail.value,
    password: els.authPassword.value,
    mygptOptIn: els.authMygptOptIn.checked
  };

  const endpoint = action === "signup" ? "/api/auth/signup" : "/api/auth/login";
  const data = await apiFetch(endpoint, {
    method: "POST",
    body: payload
  });

  state.csrfToken = data.csrfToken || state.csrfToken;
  state.user = data.user || null;
  setAuthUi();
  await refreshWorkspaceLists();
  if (isOwner()) {
    await refreshDiagnostics();
  }
  setStatus(
    action === "signup"
      ? "Account created. Your secure workspace is ready."
      : "Signed in successfully. Saved workspaces and owner-only tools are now available.",
    "success"
  );
}

async function handleResumeSubmit(event) {
  event.preventDefault();

  const file = els.resumeInput.files?.[0];
  if (!file) {
    setStatus("Please upload a PDF or DOCX resume first.", "warning");
    return;
  }

  const formData = new FormData();
  formData.append("resume", file);
  formData.append("role", els.resumeRole.value);
  formData.append("company", els.resumeCompany.value);
  formData.append("location", els.resumeLocation.value);
  formData.append("jobUrl", els.resumeJobUrl.value);
  formData.append("forceRefresh", String(els.resumeForceRefresh.checked));
  formData.append("save", String(els.resumeSave.checked));

  if (isOwner() && getAdvancedProvider()) {
    formData.append("advancedProvider", getAdvancedProvider());
  }

  setStatus("Analyzing your resume locally and assembling fresh context...", "");

  const response = await apiFetch("/api/analyze-resume", {
    method: "POST",
    formData
  });

  state.sessionCandidateProfile = response.candidate || null;
  state.sessionCandidateProfileId = response.savedProfileId || "";
  updateSessionNote();
  renderAnalysis(response);
  appendThreadMessage("assistant", response.summary?.reportSummary || response.summary?.fitSnapshot || "Resume analysis is ready.", computeBadges(response));
  if (response.savedProfileId && state.user) {
    await refreshWorkspaceLists();
  }
  setStatus("Resume analyzed securely in memory. The raw file has been discarded.", "success");
}

function buildSharedAnalysisBody({ role, company, location, jobUrl, save, forceRefresh, includeSessionProfile }) {
  const body = {
    role,
    company,
    location,
    jobUrl,
    save,
    forceRefresh
  };

  if (includeSessionProfile && state.sessionCandidateProfile) {
    body.candidateProfile = state.sessionCandidateProfile;
  }

  if (isOwner() && getAdvancedProvider()) {
    body.advancedProvider = getAdvancedProvider();
  }

  return body;
}

async function handleJobSearchSubmit(event) {
  event.preventDefault();

  setStatus("Searching live jobs and internships through official ATS-first sources...", "");

  const body = buildSharedAnalysisBody({
    role: els.jobsRole.value,
    company: els.jobsCompany.value,
    location: els.jobsLocation.value,
    jobUrl: els.jobsJobUrl.value,
    save: els.jobsSave.checked,
    forceRefresh: els.jobsForceRefresh.checked,
    includeSessionProfile: els.jobsUseSessionProfile.checked
  });

  const response = await apiFetch("/api/jobs/search", {
    method: "POST",
    body
  });

  renderAnalysis(response);
  appendThreadMessage("assistant", response.summary?.reportSummary || response.summary?.fitSnapshot || "Live jobs are ready.", computeBadges(response));
  if (response.savedSearchId && state.user) {
    await refreshWorkspaceLists();
  }
  setStatus("Live job search complete. Freshness and fallback status are visible in the results.", "success");
}

async function handlePrepSubmit(event) {
  event.preventDefault();

  setStatus("Generating company-aware interview prep with mygpt and deterministic scoring...", "");

  const body = buildSharedAnalysisBody({
    role: els.prepRole.value,
    company: els.prepCompany.value,
    location: els.prepLocation.value,
    jobUrl: els.prepJobUrl.value,
    save: els.prepSave.checked,
    forceRefresh: els.prepForceRefresh.checked,
    includeSessionProfile: els.prepUseSessionProfile.checked
  });
  body.focusArea = els.prepFocusArea.value;

  const response = await apiFetch("/api/prep", {
    method: "POST",
    body
  });

  renderAnalysis(response);
  appendThreadMessage("assistant", response.summary?.reportSummary || response.summary?.fitSnapshot || "Prep is ready.", computeBadges(response));
  if (response.savedPrepId && state.user) {
    await refreshWorkspaceLists();
  }
  setStatus("Interview prep generated. mygpt used the local stack and deterministic fallback logic where needed.", "success");
}

async function handleAssistantSubmit(event) {
  event.preventDefault();

  const message = String(els.assistantMessage.value || "").trim();
  if (!message) {
    setStatus("Type a request for mygpt first.", "warning");
    return;
  }

  appendThreadMessage("user", message);
  els.assistantMessage.value = "";
  setStatus("mygpt is routing your request through the local career stack...", "");

  const body = {
    message,
    forceRefresh: els.assistantForceRefresh.checked,
    save: els.assistantSave.checked
  };

  if (els.assistantUseSessionProfile.checked && state.sessionCandidateProfile) {
    body.candidateProfile = state.sessionCandidateProfile;
  }

  if (isOwner() && getAdvancedProvider()) {
    body.advancedProvider = getAdvancedProvider();
  }

  const response = await apiFetch("/api/assistant/turn", {
    method: "POST",
    body
  });

  applyResponse(response);
  if (response.analysis?.savedByAssistantId && state.user) {
    await refreshWorkspaceLists();
  }
  setStatus("Assistant turn completed. Invalid local generations are filtered before they reach the UI.", "success");
}

async function loadSavedItem(kind, id) {
  const item = await apiFetch(`/api/saved/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
  if (item?.payload?.candidate) {
    state.sessionCandidateProfile = item.payload.candidate;
  }
  updateSessionNote();
  renderAnalysis(item.payload);
  appendThreadMessage("assistant", `Loaded saved ${kind.replace(/-/g, " ")} snapshot: ${item.title}.`, computeBadges(item.payload));
  setStatus("Saved workspace item loaded.", "success");
}

async function requestReport(format, save) {
  if (!state.currentAnalysis) {
    setStatus("Generate or load an analysis before downloading a report.", "warning");
    return;
  }

  const response = await apiFetch("/api/reports", {
    method: "POST",
    body: {
      payload: state.currentAnalysis,
      format,
      save,
      title: state.currentAnalysis.summary?.headline || "InterviewPal report"
    }
  });

  if (save) {
    if (state.user) {
      await refreshWorkspaceLists();
    }
    setStatus("Report saved to your secure workspace.", "success");
    if (response.downloadUrl) {
      openDownload(response.downloadUrl);
    }
    return;
  }

  if (response.downloadUrl) {
    openDownload(response.downloadUrl);
  }
  setStatus(`Prepared ${format.toUpperCase()} report download.`, "success");
}

function bindEvents() {
  els.signupSubmit.addEventListener("click", async () => {
    try {
      await handleAuth("signup");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.loginSubmit.addEventListener("click", async () => {
    try {
      await handleAuth("login");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.logoutSubmit.addEventListener("click", async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", body: {} });
      state.user = null;
      setAuthUi();
      clearWorkspaceLists();
      setStatus("Signed out. Session-only resume state remains only until refresh.", "success");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.accountMygptOptIn.addEventListener("change", async () => {
    try {
      const response = await apiFetch("/api/auth/preferences", {
        method: "POST",
        body: {
          mygptOptIn: els.accountMygptOptIn.checked
        }
      });
      state.user = response.user || state.user;
      setAuthUi();
      setStatus("Workspace preferences updated.", "success");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.refreshWorkspace.addEventListener("click", async () => {
    try {
      await refreshWorkspaceLists();
      setStatus("Workspace refreshed.", "success");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.exportAccount.addEventListener("click", () => {
    window.location.assign("/api/account/export");
  });

  els.deleteAccount.addEventListener("click", async () => {
    if (!window.confirm("Delete your account and encrypted saved workspace items? This cannot be undone.")) {
      return;
    }

    try {
      await apiFetch("/api/account", {
        method: "DELETE",
        body: {}
      });
      state.user = null;
      setAuthUi();
      clearWorkspaceLists();
      setStatus("Account deleted.", "success");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.assistantForm.addEventListener("submit", async (event) => {
    try {
      await handleAssistantSubmit(event);
    } catch (error) {
      appendThreadMessage("assistant", `I hit an issue: ${error.message}`);
      setStatus(error.message, "warning");
    }
  });

  els.resumeForm.addEventListener("submit", async (event) => {
    try {
      await handleResumeSubmit(event);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.jobsForm.addEventListener("submit", async (event) => {
    try {
      await handleJobSearchSubmit(event);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.prepForm.addEventListener("submit", async (event) => {
    try {
      await handlePrepSubmit(event);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.quickPrompts.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-prompt");
    if (!button) {
      return;
    }

    els.assistantMessage.value = button.dataset.prompt || "";
    els.assistantMessage.focus();
  });

  document.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-open-saved='true']");
    if (openButton) {
      try {
        await loadSavedItem(openButton.dataset.kind, openButton.dataset.id);
      } catch (error) {
        setStatus(error.message, "warning");
      }
      return;
    }

    const refreshButton = event.target.closest("[data-refresh-kind]");
    if (refreshButton) {
      try {
        await refreshWorkspaceLists();
        setStatus("Saved workspace list refreshed.", "success");
      } catch (error) {
        setStatus(error.message, "warning");
      }
    }
  });

  els.downloadPdf.addEventListener("click", async () => {
    try {
      await requestReport("pdf", false);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.downloadJson.addEventListener("click", async () => {
    try {
      await requestReport("json", false);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.saveReport.addEventListener("click", async () => {
    try {
      await requestReport("pdf", true);
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });

  els.advancedRefresh.addEventListener("click", async () => {
    try {
      await refreshDiagnostics();
      setStatus("Diagnostics refreshed.", "success");
    } catch (error) {
      setStatus(error.message, "warning");
    }
  });
}

async function bootstrap() {
  bindEvents();
  updateSessionNote();
  els.actionBar.classList.add("hidden");

  try {
    state.defaultProfile = await apiFetch("/api/profile");
    renderProfileSnapshot(state.defaultProfile);
    await refreshAuthState();
    setStatus("InterviewPal is ready. Ask mygpt for jobs, prep, resume feedback, or bullet rewrites.", "success");
  } catch (error) {
    renderProfileSnapshot(null);
    setStatus(error.message || "Failed to initialize the workspace.", "warning");
  }
}

bootstrap();
