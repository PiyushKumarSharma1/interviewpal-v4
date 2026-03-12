const profile = {
  name: "Piyush Kumar Sharma",
  location: "East Lansing, MI",
  email: "sharm232@msu.edu",
  phone: "(517) 242-3388",
  github: "https://github.com/PiyushKumarSharma1",
  headline: "Data Science student building practical full-stack products with FastAPI, React, and SQL.",
  education: {
    school: "Michigan State University",
    degree: "B.S. in Data Science (in progress)",
    graduation: "May 2027",
    coursework: [
      "Data Structures and Algorithms",
      "Database Systems",
      "Operating Systems",
      "Software Engineering",
      "Machine Learning"
    ]
  },
  skills: {
    languages: ["Python", "C++", "Java", "JavaScript", "SQL"],
    frameworks: ["FastAPI", "Flask", "React", "Docker", "REST APIs", "Pytest"],
    databases: ["PostgreSQL", "SQLite", "MongoDB"],
    cloud: ["AWS EC2", "AWS S3", "Dockerized deployment"],
    core: ["OOP", "Computer Networks", "JWT auth", "API design"]
  },
  projects: [
    {
      name: "URL Shortener",
      status: "Shipped",
      summary: "Built a full-stack URL shortener with FastAPI, React, PostgreSQL, SQLAlchemy, and JWT authentication.",
      highlights: [
        "Designed RESTful APIs for link creation, redirect handling, and analytics",
        "Built a React dashboard for creating and managing shortened links",
        "Structured backend modules for scalability and maintainability"
      ]
    },
    {
      name: "InterviewPal",
      status: "In progress",
      summary: "Smart DSA practice and progress tracker with FastAPI auth, PostgreSQL, progress graphs, streaks, and Dockerized deployment.",
      highlights: [
        "Personalized DSA practice flows",
        "JWT authentication and modular backend services",
        "React dashboard with progress visualizations"
      ]
    },
    {
      name: "Portfolio Website with Admin Panel",
      status: "Shipped",
      summary: "React and Flask project with an admin dashboard for editing portfolio content through REST APIs.",
      highlights: [
        "SQLite-backed persistence",
        "Responsive UI with content management",
        "Structured for easy scaling"
      ]
    },
    {
      name: "AI-Based Resume Screener",
      status: "Prototype",
      summary: "NLP pipeline that parses resumes and compares them against job descriptions using Python, scikit-learn, and spaCy.",
      highlights: [
        "Exposed through a Flask API",
        "Designed to streamline recruiter screening workflows"
      ]
    }
  ],
  experience: [
    {
      role: "Student Assistant (Level 1)",
      company: "RHS South Neighborhood, Michigan State University",
      period: "Jan 2024 - Jul 2025",
      bullets: [
        "Provided technical and administrative support in a high-traffic academic housing environment",
        "Handled database entry, scheduling, and basic IT troubleshooting",
        "Balanced long-term part-time work with academics"
      ]
    },
    {
      role: "Tech and Operations Intern",
      company: "Lung Care Foundation",
      period: "2022 - 2023",
      bullets: [
        "Automated health-survey data collection with Python and SQL",
        "Built dashboards for campaign data at 10,000+ daily attendees",
        "Worked across technical and non-technical teams to improve reporting accuracy"
      ]
    },
    {
      role: "Data and Automation Intern",
      company: "NGO Projects",
      period: "2021 - 2023",
      bullets: [
        "Digitized records for 5,000+ beneficiaries",
        "Automated reporting and resource allocation with Python scripts",
        "Built simple web tools for outreach and event tracking"
      ]
    }
  ],
  extracurriculars: [
    "Member, MSU Coding Club",
    "YouTube host with 400+ subscribers focused on automotive and tech content"
  ]
};

module.exports = { profile };

