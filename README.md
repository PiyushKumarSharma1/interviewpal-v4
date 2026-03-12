# InterviewPal

InterviewPal is a resume-driven interview prep app seeded with Piyush Sharma's profile. It generates a role-specific interview brief with:

- a sharper personal pitch
- role-fit strengths and likely gaps
- project stories to anchor interview answers
- mock questions and a warm-up drill list

## Run locally

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Optional AI mode

Create a `.env` file based on `.env.example` and add:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=your_model_here
```

Without those env vars, the app runs in demo mode using local heuristics.

## Project structure

- `server.js` - static server and API routes
- `src/data/profile.js` - seeded resume/profile data
- `src/lib/interview-engine.js` - deterministic interview-prep generator
- `src/lib/openai.js` - optional OpenAI-backed generation
- `public/` - UI assets
