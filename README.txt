CoachOS prototype v0.3 (coach: Sanidhi)

What it is
- The Phase 0 to 1 interface from coachos-prd.pdf, for the Marketing coach.
- Four screens: Coach (F1, F5), Queue (F3), Agent (F2), Progress (F4, F6).
- Everything runs in the browser. Data stays in localStorage (key: coachos_v02).

Files
- index.html     markup for the shell, four views and two dialogs
- app.css        the page's styles (Hallmark stamp on line 1)
- tokens.css     Coral theme tokens (Hallmark scaffold)
- base.css       base rules (Hallmark scaffold)
- cotton.svg     generated paper texture used on sheets and cards
- app.js         state, coach engine, diff-based edit capture, scoring
- coachos-prd.pdf the product requirements this build follows

Run locally
- Open index.html in a browser, or serve the folder with any static server.

Deploy
- Vercel serves this folder as a static site. No build step.

Going live (optional)
- Choose "API key" in the top bar and paste an Anthropic API key.
- Drafts and coaching are then written by the model. Without a key the app
  runs in guided mode: drafts come from templates and standing rules are
  saved but not applied to them.

Sample data and reset
- Add ?demo=1 to the address to load sample data for review.
- "Start over" clears local progress. The API key is kept.

Not built yet (see the PRD)
- Team dashboard, intervention outreach and knowledge connectors (P1).
- Cross-user pattern library (P2).
