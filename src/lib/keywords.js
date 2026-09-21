const SKILL_TAXONOMY = {
  languages: [
    "Python",
    "JavaScript",
    "TypeScript",
    "Java",
    "C++",
    "C",
    "SQL",
    "Go",
    "Rust",
    "Ruby",
    "PHP",
    "R",
    "Swift",
    "Kotlin"
  ],
  frameworks: [
    "React",
    "Next.js",
    "Node.js",
    "Express",
    "FastAPI",
    "Flask",
    "Django",
    "Spring Boot",
    "REST APIs",
    "GraphQL",
    "Pytest",
    "Jest",
    "Tailwind CSS",
    "SQLAlchemy",
    "Pandas",
    "NumPy",
    "scikit-learn",
    "spaCy"
  ],
  databases: [
    "PostgreSQL",
    "MySQL",
    "SQLite",
    "MongoDB",
    "Redis",
    "Supabase",
    "Firebase"
  ],
  cloud: [
    "AWS",
    "AWS EC2",
    "AWS S3",
    "GCP",
    "Azure",
    "Docker",
    "Kubernetes",
    "CI/CD",
    "Vercel",
    "Netlify"
  ],
  core: [
    "Data Structures and Algorithms",
    "Machine Learning",
    "Operating Systems",
    "Software Engineering",
    "Computer Networks",
    "OOP",
    "JWT auth",
    "API design",
    "System Design",
    "Responsive UI"
  ]
};

const ROLE_KEYWORDS = {
  "software engineer": ["JavaScript", "React", "Node.js", "FastAPI", "REST APIs", "PostgreSQL"],
  frontend: ["React", "JavaScript", "TypeScript", "Responsive UI", "REST APIs", "Tailwind CSS"],
  backend: ["FastAPI", "Flask", "Node.js", "Express", "PostgreSQL", "SQL", "API design", "JWT auth"],
  "full stack": ["React", "Node.js", "Express", "FastAPI", "PostgreSQL", "Docker", "JWT auth"],
  data: ["Python", "SQL", "Machine Learning", "Pandas", "NumPy", "scikit-learn", "PostgreSQL"],
  "machine learning": ["Python", "Machine Learning", "Pandas", "NumPy", "scikit-learn", "spaCy", "SQL"],
  dsa: ["Data Structures and Algorithms", "Problem solving", "Complexity analysis"],
  intern: ["Communication", "Adaptability", "Ownership", "Project depth"],
  internship: ["Communication", "Adaptability", "Ownership", "Project depth"],
  student: ["Coursework relevance", "Project depth", "Learning velocity"]
};

const STUDENT_COMPANY_BUCKETS = [
  {
    label: "Developer tools and platform teams",
    roles: ["Software Engineer Intern", "Backend Engineer Intern", "Full Stack Engineer Intern"],
    searchKeywords: ["developer tools intern", "platform engineer intern", "software engineer intern backend"]
  },
  {
    label: "Health tech and mission-driven data teams",
    roles: ["Data Analyst Intern", "Data Science Intern", "Software Engineer Intern"],
    searchKeywords: ["health tech intern python sql", "data science intern nonprofit", "analytics intern healthcare"]
  },
  {
    label: "Campus, education, and student product teams",
    roles: ["Product Engineering Intern", "Frontend Engineer Intern", "IT Intern"],
    searchKeywords: ["education software intern", "student platform engineering intern", "frontend intern react"]
  },
  {
    label: "High-growth startups",
    roles: ["Full Stack Intern", "Generalist Engineer Intern", "Founding Engineer Intern"],
    searchKeywords: ["startup software engineer intern", "full stack intern react fastapi", "generalist engineer intern"]
  }
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function flattenTaxonomy() {
  return Object.values(SKILL_TAXONOMY).flat();
}

module.exports = {
  ROLE_KEYWORDS,
  SKILL_TAXONOMY,
  STUDENT_COMPANY_BUCKETS,
  flattenTaxonomy,
  normalizeText
};
