import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectors } from './selectors.js';
import { scoreJob } from './matcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const candidate = JSON.parse(await fs.readFile(path.join(root, 'data/candidate.json'), 'utf8'));
const historyPath = path.join(root, 'data/applications.json');
const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
const dryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const maxJobs = Number(process.env.MAX_JOBS ?? 10);
const minMatch = Number(process.env.MIN_MATCH ?? candidate.minimumMatch ?? 75);

const context = await chromium.launchPersistentContext(path.join(root, '.browser-profile'), {
  headless: false,
  viewport: { width: 1440, height: 900 }
});
const page = context.pages()[0] || await context.newPage();

console.log('Opening Naukri. Complete login/OTP/CAPTCHA manually if requested.');
await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

console.log('After login, search for your target jobs in the opened browser.');
console.log('The POC will wait up to 5 minutes for job cards to appear.');
await page.locator(selectors.jobCard).first().waitFor({ state: 'visible', timeout: 300000 });

const cards = page.locator(selectors.jobCard);
const count = Math.min(await cards.count(), maxJobs);
console.log(`Checking ${count} jobs; minimum match ${minMatch}%. DRY_RUN=${dryRun}`);

for (let i = 0; i < count; i++) {
  const card = cards.nth(i);
  const title = (await card.locator(selectors.jobTitle).first().textContent().catch(() => ''))?.trim() || '';
  const location = (await card.locator(selectors.location).first().textContent().catch(() => ''))?.trim() || '';
  const description = (await card.innerText().catch(() => '')) || '';
  const href = await card.locator(selectors.jobTitle).first().getAttribute('href').catch(() => null);
  const url = href ? new URL(href, page.url()).href : page.url();
  const score = scoreJob({ title, location, description }, candidate);

  if (history.some(x => x.url === url)) { console.log(`SKIP duplicate: ${title}`); continue; }
  if (score < minMatch) { console.log(`SKIP ${score}%: ${title}`); continue; }

  console.log(`MATCH ${score}%: ${title}`);
  const jobPage = await context.newPage();
  await jobPage.goto(url, { waitUntil: 'domcontentloaded' });
  await jobPage.waitForTimeout(1500);

  if (await jobPage.locator(selectors.alreadyApplied).count()) {
    history.push({ title, url, score, status: 'ALREADY_APPLIED', at: new Date().toISOString() });
    await jobPage.close();
    continue;
  }

  const apply = jobPage.locator(selectors.applyButton).first();
  if (!(await apply.count())) {
    history.push({ title, url, score, status: 'NEEDS_REVIEW', reason: 'Apply button not found', at: new Date().toISOString() });
    await jobPage.close();
    continue;
  }

  if (dryRun) {
    console.log(`DRY RUN: would apply to ${title}`);
    history.push({ title, url, score, status: 'DRY_RUN_MATCH', at: new Date().toISOString() });
  } else {
    // Only normal UI interaction. Do not bypass CAPTCHA/OTP/security challenges.
    await apply.click();
    await jobPage.waitForTimeout(1500);
    history.push({ title, url, score, status: 'APPLY_STARTED', at: new Date().toISOString() });
    console.log('Apply flow started. Unexpected screening questions/security checks require manual review.');
  }
  await jobPage.close();
}

await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
console.log('Finished. Results saved to data/applications.json');
await context.close();
