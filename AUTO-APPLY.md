# SK Tech Candidate Workspace

A local dashboard for managing Naukri applications for different candidates and technologies.

## Start

Double-click START-AUTO-APPLY.cmd and open http://127.0.0.1:8788. Keep the terminal open. Node.js 20+ is required; the launcher installs the declared dependencies and Playwright Chromium if needed.

## Candidate workflow

1. Select a candidate in the sidebar or choose Add candidate. New candidates start with empty details.
2. Enter their name, Naukri registered email, contact details, roles, skills, locations and experience. Any technology is supported. Set **Default years for listed skills**; skill-specific chatbot questions use this number only when every technology named in the question appears in the candidate's Technical skills. Custom screening answers can override exceptional cases.
3. Set the match threshold (50% by default). Role and location must also match. Any advertised experience range is accepted; screening answers retain the candidate’s actual experience. Select Freshness: 1, 2, 3, 7 or 15 days (default 15). Both apply modes skip older jobs and unreadable posting dates.
4. Enter an absolute path to their PDF, DOC or DOCX resume. Saving creates a separate, hashed copy for this candidate. The Naukri upload receives the original filename rather than the internal hash name. If no local resume is supplied, Naukri may use the resume attached to the verified account.
5. Review the details, check the ownership/review box, and save.
6. Open login and sign into that candidate's own Naukri session. Passwords, OTP and CAPTCHA are entered manually.
7. Click Verify account. The visible Naukri profile email must exactly match the saved account email.
8. Use **Auto Apply profile matches** for profile-filtered jobs. Use **Apply open search** to process the jobs already open in this candidate’s Naukri search, without extra score or experience filters. Both use the real saved candidate details. Preview never clicks Apply; live mode can submit one-click applications.
9. Preview and live apply start from page 1 and follow Naukri's Next control until the result set ends. The matching-job limit controls how many eligible jobs are previewed or attempted; skipped and nonmatching jobs do not consume it.
10. Review Applications for this candidate's results. Unknown questions and unsupported pre-submit flows are recorded and skipped; an uncertain submission, CAPTCHA, or account verification failure stops the run.

## Candidate separation

- Every candidate has an immutable UUID and a separate profile, browser directory, application history, artifacts directory and resume copy.
- All candidate fields are editable, including Naukri account email. A duplicate email cannot be assigned to two candidates. Changing the email closes the old session and starts a new session generation; sign in and verify again.
- Switching browser owners closes the previous context and launches the selected candidate's own persistent session.
- Every API operation names the candidate explicitly. Stale profile revisions are rejected.
- Candidate changes, saves and new logins are blocked during an active operation. Unsaved UI edits block candidate switching.
- A run reads one saved profile snapshot, checks its revision and resume integrity, and verifies the Naukri account. Each application action checks browser ownership and the session-cookie fingerprint; changed sessions or a verification older than 30 seconds trigger another profile check. Unknown, masked, ambiguous or mismatched account emails block the run.
- Global RESUME_PATH is no longer used. Identity answers cannot be overridden through custom screening answers.
- An uncertain submission is recorded before attempting the application and excluded from automatic retries. Review these entries in Naukri before making any manual history correction.
- The server binds to localhost and rejects other web origins. A worker lock prevents ordinary duplicate launches against the same workspace.

These controls prevent automatic cross-candidate reuse. They cannot establish that manually entered details or a manually selected resume are truthful. Review those inputs, and do not manually switch accounts or edit Naukri settings while a run is active.

## Existing data

The former data/candidate.json is imported once as a separate candidate with its match threshold preserved. The profile requires review again. Its old shared login is never imported.

Old data/candidate.json, data/applications.json and .browser-profile are retained untouched as legacy files. Shared history is not assigned to a candidate because its original account ownership may be uncertain. New history starts in each candidate's private folder.

Private records live under private/candidates/<candidate-id>/. This directory is ignored by Git. The dashboard serves only its UI assets and explicit APIs, never arbitrary local files.

## Current limits and validation

The worker runs one candidate at a time on this PC. It scans result pages until Naukri has no next page, within a 1–100 matching-job limit for preview or application attempts. An open paginated search is reset to page 1 before scanning. Profile matching reads full descriptions for otherwise relevant jobs; experience ranges do not reject a job. Freshness is enforced from each job’s posting label in both modes. Jobs that open an external company application, lack an Apply control, or present an unknown question before submission are recorded and skipped so the next job can proceed. An uncertain submission, CAPTCHA, or account mismatch still stops the run for review. The chatbot is scoped separately from the background job page, answers known profile questions, and stops on facts that are not saved rather than inventing them. Naukri UI changes may require selector updates; account verification deliberately has no bypass.

Tests cover candidate isolation, API locking, editable fields, stale edits, duplicate account binding, browser ownership, resume integrity, account mismatch, open-search behavior and application confirmations. Live verification was checked against Naukri’s email title attribute. A BDO application and an AI/full-stack .NET application were confirmed live for the selected candidate; an existing Infosys Applied badge was recognized from captured evidence. This does not guarantee every employer’s screening form is supported. No recurring schedule or public hosting is installed.

Developer commands from worker: npm start, npm test. The old server.js and index.js entry points start the new portal. Direct CLI applications are disabled so they cannot conflict with a dashboard run. The temporary UI fixture server can be started with node scripts/ui-fixture.js; it disables logins and applications.

Set PORT to use another local port. Never run the legacy worker in a different project folder at the same time as this workspace.
