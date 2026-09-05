import fs from 'node:fs/promises';
import path from 'node:path';
import { selectors } from './selectors.js';
import { answerFor } from './answers.js';
const confirmation = /already applied|application submitted|successfully applied|you applied/i;
const security = /captcha|verify you are human|one.?time password|\botp\b/i;
const finalAction = /submit|apply now|send application/i;
const nextAction = /save|next|continue/i;
async function visibleText(page) { return (await page.locator('body').innerText().catch(() => '')) || ''; }
async function saveEvidence(page, dir, job, prefix) { const safe = job.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'job'; const file = path.join(dir, `${Date.now()}-${prefix}-${safe}.png`); await page.screenshot({ path: file, fullPage: true }).catch(() => {}); return file; }
async function fillQuestions(page, candidate) {
  const unknown = []; const controls = page.locator('input:not([type=hidden]):not([type=submit]), textarea, select');
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i); if (!(await control.isVisible().catch(() => false)) || !(await control.isEnabled().catch(() => false))) continue;
    const type = ((await control.getAttribute('type').catch(() => '')) || '').toLowerCase(); if (['button', 'submit', 'file', 'checkbox', 'radio'].includes(type)) continue;
    const required = await control.getAttribute('required').then(Boolean).catch(() => false); const value = await control.inputValue().catch(() => ''); if (value) continue;
    const id = await control.getAttribute('id').catch(() => null); const name = await control.getAttribute('name').catch(() => null); const placeholder = await control.getAttribute('placeholder').catch(() => '') || '';
    const label = id ? await page.locator(`label[for="${id}"]`).textContent().catch(() => '') : ''; const prompt = `${label || ''} ${placeholder} ${name || ''}`.trim(); const answer = answerFor(prompt, candidate);
    if (!answer) { if (required) unknown.push(prompt || `required-control-${i + 1}`); continue; }
    const tag = await control.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'select') await control.selectOption({ label: answer }).catch(async () => control.selectOption(answer).catch(() => {})); else await control.fill(answer).catch(() => {});
  }
  return unknown;
}
async function uploadResume(page, candidate) { const resumePath = candidate.resumePath || process.env.RESUME_PATH; if (!resumePath) return; await fs.access(resumePath); const uploads = page.locator('input[type=file]'); for (let i = 0; i < await uploads.count(); i++) await uploads.nth(i).setInputFiles(resumePath); }
export async function applyToJob({ jobPage, job, candidate, autoSubmit, artifactDir }) {
  await jobPage.goto(job.url, { waitUntil: 'domcontentloaded' }); await jobPage.waitForTimeout(1500); let text = await visibleText(jobPage);
  if (confirmation.test(text)) return { status: 'ALREADY_APPLIED' };
  if (security.test(text)) return { status: 'MANUAL_REQUIRED', reason: 'OTP/CAPTCHA detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'security') };
  const apply = jobPage.locator(selectors.applyButton).first(); if (!(await apply.isVisible().catch(() => false))) return { status: 'NEEDS_REVIEW', reason: 'Apply button not found', evidence: await saveEvidence(jobPage, artifactDir, job, 'no-apply-button') };
  await apply.click(); await jobPage.waitForTimeout(1200);
  for (let step = 0; step < 8; step++) {
    text = await visibleText(jobPage); if (confirmation.test(text)) return { status: 'APPLIED' }; if (security.test(text)) return { status: 'MANUAL_REQUIRED', reason: 'OTP/CAPTCHA detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'security') };
    await uploadResume(jobPage, candidate).catch(() => {}); const unknown = await fillQuestions(jobPage, candidate);
    if (unknown.length) return { status: 'NEEDS_REVIEW', reason: `Unknown required questions: ${unknown.join(' | ')}`, evidence: await saveEvidence(jobPage, artifactDir, job, 'questions') };
    const finalButton = jobPage.getByRole('button', { name: finalAction }).or(jobPage.getByRole('link', { name: finalAction })).first();
    if (await finalButton.isVisible().catch(() => false)) { if (!autoSubmit) return { status: 'READY_FOR_REVIEW', reason: 'Final submit is ready; AUTO_SUBMIT=false', evidence: await saveEvidence(jobPage, artifactDir, job, 'ready') }; await finalButton.click(); await jobPage.waitForTimeout(1500); text = await visibleText(jobPage); if (confirmation.test(text)) return { status: 'APPLIED' }; return { status: 'NEEDS_REVIEW', reason: 'Final confirmation was not detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'unconfirmed') }; }
    const next = jobPage.getByRole('button', { name: nextAction }).first(); if (!(await next.isVisible().catch(() => false))) break; await next.click(); await jobPage.waitForTimeout(800);
  }
  return { status: 'NEEDS_REVIEW', reason: 'Application flow was not recognized', evidence: await saveEvidence(jobPage, artifactDir, job, 'unknown-flow') };
}
