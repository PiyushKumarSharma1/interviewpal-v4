const profileCard = document.getElementById("profile-card");
const prepForm = document.getElementById("prep-form");
const statusNode = document.getElementById("status");
const resultsNode = document.getElementById("results");
const submitButton = document.getElementById("submit-button");

function renderProfile(profile) {
  profileCard.innerHTML = `
    <p class="eyebrow">Candidate snapshot</p>
    <h2>${profile.name}</h2>
    <p>${profile.headline}</p>
    <div class="profile-meta">
      <span>${profile.location}</span>
      <span>${profile.education.school}</span>
      <span>Grad ${profile.education.graduation}</span>
    </div>
    <div class="chip-row">
      ${profile.skills.languages.slice(0, 4).map((skill) => `<span class="chip">${skill}</span>`).join("")}
      ${profile.skills.frameworks.slice(0, 3).map((skill) => `<span class="chip chip-soft">${skill}</span>`).join("")}
    </div>
  `;
}

function renderList(items, itemRenderer) {
  return `<div class="stack">${items.map(itemRenderer).join("")}</div>`;
}

function renderResults(prep) {
  resultsNode.innerHTML = `
    <section class="result-card">
      <div class="result-header">
        <div>
          <p class="eyebrow">Target</p>
          <h3>${prep.target.role} ${prep.target.company ? `at ${prep.target.company}` : ""}</h3>
        </div>
        <span class="mode-pill">${prep.mode === "ai" ? "AI mode" : "Demo mode"}</span>
      </div>
      <p>${prep.candidatePitch}</p>
    </section>

    <section class="result-grid">
      <article class="result-card">
        <p class="eyebrow">Strengths</p>
        <h3>What to lead with</h3>
        ${renderList(prep.roleMatch.strengths, (item) => `<div class="list-row">${item}</div>`)}
      </article>

      <article class="result-card">
        <p class="eyebrow">Gaps</p>
        <h3>What to frame carefully</h3>
        ${renderList(prep.roleMatch.gaps.length ? prep.roleMatch.gaps : ["No major gaps flagged for this target"], (item) => `<div class="list-row">${item}</div>`)}
      </article>
    </section>

    <section class="result-card">
      <p class="eyebrow">Focus plan</p>
      <h3>How to prepare tonight</h3>
      ${renderList(prep.focusPlan, (item) => `<div class="list-row">${item}</div>`)}
    </section>

    <section class="result-card">
      <p class="eyebrow">Project stories</p>
      <h3>Best stories to anchor your interview</h3>
      ${renderList(prep.topProjects, (project) => `
        <div class="story-card">
          <h4>${project.name}</h4>
          <p>${project.summary}</p>
          <div class="mini-list">
            ${project.talkingPoints.map((point) => `<span>${point}</span>`).join("")}
          </div>
        </div>
      `)}
    </section>

    <section class="result-card">
      <p class="eyebrow">Mock questions</p>
      <h3>Questions to practice out loud</h3>
      ${renderList(prep.mockQuestions, (question) => `
        <div class="question-card">
          <div class="question-topline">${question.category}</div>
          <h4>${question.question}</h4>
          <p>${question.whatToShow}</p>
        </div>
      `)}
    </section>

    <section class="result-grid">
      <article class="result-card">
        <p class="eyebrow">Story bank</p>
        <h3>Behavioral anchors</h3>
        ${renderList(prep.storyBank, (story) => `
          <div class="list-row">
            <strong>${story.title}</strong><br />
            ${story.angle}
          </div>
        `)}
      </article>

      <article class="result-card">
        <p class="eyebrow">Warm-up drills</p>
        <h3>15-minute prep loop</h3>
        ${renderList(prep.warmupDrills, (item) => `<div class="list-row">${item}</div>`)}
      </article>
    </section>
  `;

  if (prep.aiError) {
    statusNode.textContent = `AI mode fell back to demo mode: ${prep.aiError}`;
    statusNode.className = "status warning";
  } else if (prep.mode === "ai") {
    statusNode.textContent = "AI mode generated this interview brief.";
    statusNode.className = "status success";
  } else {
    statusNode.textContent = "Demo mode generated this interview brief. Add API env vars to switch on AI output.";
    statusNode.className = "status";
  }
}

async function loadProfile() {
  const response = await fetch("/api/profile");
  const profile = await response.json();
  renderProfile(profile);
}

async function submitPrep(event) {
  event.preventDefault();

  statusNode.textContent = "Building your interview brief...";
  statusNode.className = "status";
  submitButton.disabled = true;
  submitButton.textContent = "Generating...";

  const formData = new FormData(prepForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/prep", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to generate prep.");
    }

    const prep = await response.json();
    renderResults(prep);
  } catch (error) {
    statusNode.textContent = error.message;
    statusNode.className = "status warning";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate prep";
  }
}

prepForm.addEventListener("submit", submitPrep);
loadProfile().catch((error) => {
  profileCard.innerHTML = `<p class="muted">Failed to load profile: ${error.message}</p>`;
});

