<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/01fc6a8d-f75c-4274-a8e3-afe8af5ca7ec

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

---

## Developer Guides & Test Suites

The game relies heavily on automated and visual testing for physical interactions and biome balance:

- **Ecology Simulator (`index.html` journal)**: Found in `/simtests/index.html`. This journal benchmarks our `beaver-sim` performance for water bounds and ecosystem resource balance.
- **Agentic Playtests (`index.html` journal)**: Found in `/playtests/index.html`. This acts as an automated frame-rate logging and visual validation suite for all major gameplay systems over actual play sessions.
- **Agentic Workflows & Skills**: Look in `.agents/workflows` and `.agents/skills` for formalized protocols on running automated gameplay benchmarks and journaling new scenario results.

