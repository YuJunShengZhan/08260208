# CPBL Guess Game Deploy

This version is set up for Git + Vercel deployment.

Files:
- `index.html`: static frontend
- `api/cpbl-schedule.js`: serverless API that fetches today's CPBL schedule from the official stats site
- `vercel.json`: small Vercel config

Deploy steps:
1. Push these files to GitHub
2. Import the repo into Vercel
3. Deploy

How it works:
- On Vercel, the page calls `/api/cpbl-schedule`
- For local `file://` usage, the page can still fall back to `http://127.0.0.1:8787`

Notes:
- GitHub Pages alone cannot run `/api/cpbl-schedule`
- Use Vercel for the deployed version
