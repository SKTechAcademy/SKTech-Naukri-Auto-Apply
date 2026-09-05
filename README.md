# Naukri Auto Apply POC

POC architecture:
- `frontend/`: static dashboard suitable for GitHub Pages.
- `worker/`: local Node.js + Playwright worker.
- `data/`: candidate profile and local application history.

## Important
This worker does not bypass CAPTCHA, OTP, or other security controls. Login is manual and the persistent Playwright browser profile reuses the authenticated session while Naukri permits it. It verifies an Applied/Submitted confirmation before recording an application as successful.

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

## Safe test sequence

1. Start with `DRY_RUN=true` and `AUTO_SUBMIT=false`.
2. Confirm that the job scores and `DRY_RUN_MATCH` results are correct.
3. Change only `DRY_RUN=false`. The worker will fill known questions and stop at the final submit step with `READY_FOR_REVIEW`.
4. After reviewing several applications, set `AUTO_SUBMIT=true` to permit final submission.

Statuses in `data/applications.json`:

- `DRY_RUN_MATCH`: matched only; nothing was applied.
- `READY_FOR_REVIEW`: form completed but final submission was not clicked.
- `APPLIED`: the site displayed an Applied/Submitted confirmation.
- `ALREADY_APPLIED`: Naukri reported that the job was already applied.
- `NEEDS_REVIEW`: an unknown question or unrecognized page needs manual review; a screenshot is saved under `artifacts/`.
- `MANUAL_REQUIRED`: CAPTCHA or OTP needs manual action.

Never commit `.env`, `data/candidate.json`, `private/`, `.browser-profile/`, or `artifacts/`; they can contain personal or session data.

The first run opens a browser. Log in manually when requested. Update selectors in `src/selectors.js` if Naukri's UI differs.

## GitHub Pages
Deploy the contents of `frontend/` as a static informational page. With no backend, its button cannot start the worker; run the worker from PowerShell on your Windows PC.
