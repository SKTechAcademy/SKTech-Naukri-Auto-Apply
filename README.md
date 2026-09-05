# Naukri Auto Apply POC

POC architecture:
- `frontend/`: static dashboard suitable for GitHub Pages.
- `worker/`: local Node.js + Playwright worker.
- `data/`: candidate profile and local application history.

## Important
This POC does not bypass CAPTCHA, OTP, or other security controls. Login is manual and the persistent Playwright browser profile reuses the authenticated session while Naukri permits it. The worker pauses before final submission by default (`DRY_RUN=true`) so you can verify selectors and matching safely.

## Requirements
- Node.js 20+
- Chrome/Chromium installed by Playwright

## Setup
```bash
cd worker
npm install
npx playwright install chromium
cp .env.example .env
cp ../data/candidate.example.json ../data/candidate.json
npm start
```

Update your private `data/candidate.json` before starting. This file and the persistent browser login profile are excluded from Git.

The first run opens a browser. Log in manually when requested. Update selectors in `src/selectors.js` if Naukri's UI differs.

## GitHub Pages
Deploy the contents of `frontend/` as a static site. The frontend cannot directly run Playwright; the worker runs on your Windows PC or a server.
