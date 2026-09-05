import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectors } from './selectors.js';
import { scoreJob } from './matcher.js';
import { applyToJob } from './application.js';
import { loadHistory, saveHistory, shouldSkip } from './history.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const candidatePath = path.join(root, 'data/candidate.json');
const historyPath = path.join(root, 'data/applications.json');
const artifactDir = path.join(root, 'artifacts');
const candidate = JSON.parse(await fs.readFile(candidatePath, 'utf8').catch(() => { throw new Error('Missing data/candidate.json. Copy data/candidate.example.json and complete your private details.'); }));
const history = await loadHistory(historyPath);
const dryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const autoSubmit = String(process.env.AUTO_SUBMIT ?? 'false').toLowerCase() === 'true';
const maxJobs = Math.max(1, Number(process.env.MAX_JOBS ?? 10));
const minMatch = Number(process.env.MIN_MATCH ?? candidate.minimumMatch ?? 75);

await fs.mkdir(artifactDir, { recursive: true });
const context = await chromium.launchPersistentContext(path.join(root, '.browser-profile'), { headless: false, viewport: { width: 1440, height: 900 } });
try {
  const page = context.pages()[0] || await context.newPage();
  console.log('Opening Naukri. Complete login/OTP/CAPTCHA manually if requested.');
  await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log('Search for your target jobs in the opened browser. Waiting up to 5 minutes.');
  await page.locator(selectors.jobCard).first().waitFor({ state: 'visible', timeout: 300000 });
  const cards = page.locator(selectors.jobCard);
  const jobs = [];
  const count = Math.min(await cards.count(), maxJobs);
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const title = (await card.locator(selectors.jobTitle).first().textContent().catch(() => ''))?.trim() || '';
    const location = (await card.locator(selectors.location).first().textContent().catch(() => ''))?.trim() || '';
    const description = (await card.innerText().catch(() => '')) || '';
    const href = await card.locator(selectors.jobTitle).first().getAttribute('href').catch(() => null);
    if (href) jobs.push({ title, location, description, url: new URL(href, page.url()).href });
  }
  console.log(`Checking ${jobs.length} jobs; minimum match ${minMatch}%. DRY_RUN=${dryRun}; AUTO_SUBMIT=${autoSubmit}`);
  for (const job of jobs) {
    const score = scoreJob(job, candidate);
    if (shouldSkip(history, job.url)) { console.log(`SKIP applied: ${job.title}`); continue; }
    if (score < minMatch) { console.log(`SKIP ${score}%: ${job.title}`); continue; }
    if (dryRun) {
      console.log(`DRY RUN MATCH ${score}%: ${job.title}`);
      history.push({ ...job, score, status: 'DRY_RUN_MATCH', at: new Date().toISOString() });
      await saveHistory(historyPath, history);
      continue;
    }
    console.log(`APPLYING ${score}%: ${job.title}`);
    const jobPage = await context.newPage();
    let result;
    try { result = await applyToJob({ jobPage, job, candidate, autoSubmit, artifactDir }); }
    catch (error) { result = { status: 'ERROR', reason: error.message }; }
    history.push({ ...job, score, ...result, at: new Date().toISOString() });
    await saveHistory(historyPath, history);
    console.log(`${result.status}: ${job.title}${result.reason ? ` - ${result.reason}` : ''}`);
    if (!['NEEDS_REVIEW', 'MANUAL_REQUIRED', 'READY_FOR_REVIEW'].includes(result.status)) await jobPage.close().catch(() => {});
  }
  console.log('Finished. Verified results saved to data/applications.json');
} finally {
  if (dryRun || autoSubmit) await context.close();
  else console.log('Browser left open for your final review because AUTO_SUBMIT=false.');
}
