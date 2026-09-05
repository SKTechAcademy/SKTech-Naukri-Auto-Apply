import fs from 'node:fs/promises';
import path from 'node:path';
import { selectors } from './selectors.js';
import { answerFor } from './answers.js';
import { jobIdentity } from './search.js';
const confirmation = /already applied|application (?:has been )?submitted|successfully applied|you (?:have )?applied/i;
export function applicationConfirmed(text, job) {
  if(confirmation.test(text))return true;
  const title=String(job.title||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  return !!title && new RegExp(`(?:^|\\n)\\s*Applied to\\s+["“']?${title}(?:["”']|\\s|$)`,'i').test(text);
}
const security = /captcha|verify you are human|one.?time password|\botp\b/i;
const finalAction = /^(submit|submit application|apply now|send application)$/i;
const nextAction = /^(save|next|continue|save and continue)$/i;
async function visibleText(page) { return (await page.locator('body').innerText().catch(() => '')) || ''; }
async function hasAppliedBadge(page) {
  return page.getByRole('button',{name:'Applied',exact:true}).or(page.locator('[class*="applied" i]').filter({hasText:/^\s*Applied\s*$/})).filter({visible:true}).first().isVisible().catch(()=>false);
}
async function saveEvidence(page, dir, job, prefix) { await fs.mkdir(dir, { recursive: true }); const safe = job.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'job'; const file = path.join(dir, `${Date.now()}-${prefix}-${safe}.png`); return page.screenshot({ path: file, fullPage: true }).then(() => file).catch(() => null); }
export async function applicationRoot(page) {
  const chatbot = page.locator('[id*="chatbot" i]:visible, [class*="chatbotcontainer" i]:visible').last();
  return await chatbot.isVisible().catch(() => false) ? chatbot : page;
}
export async function fillQuestions(page, candidate, root = page) {
  const unknown = []; const controls = root.locator('input:not([type=hidden]):not([type=submit]), textarea, select');
  const conversation = root === page ? '' : await root.innerText().catch(() => '');
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i); if (!(await control.isVisible().catch(() => false)) || !(await control.isEnabled().catch(() => false))) continue;
    const type = ((await control.getAttribute('type').catch(() => '')) || '').toLowerCase(); if (['button', 'submit', 'file', 'checkbox', 'radio'].includes(type)) continue;
    const value = await control.inputValue().catch(() => ''); if (value) continue;
    let prompt = await control.evaluate(el => [Array.from(el.labels || []).map(label => label.textContent).join(' '), el.getAttribute('aria-label'), el.placeholder, el.name].filter(Boolean).join(' '));
    if (conversation && /^(?:type )?(?:a )?message|chat|reply/i.test(prompt.trim())) prompt = conversation;
    const answer = answerFor(prompt, candidate);
    if (!answer) { unknown.push(prompt || `unanswered-control-${i + 1}`); continue; }
    const tag = await control.evaluate(el => el.tagName.toLowerCase());
    try { if (tag === 'select') await control.selectOption({ label: answer }).catch(() => control.selectOption(answer)); else await control.fill(answer); } catch { unknown.push(prompt); }
  }
  const unresolvedChoices = await root.locator('input[type=radio]:visible, input[type=checkbox][required]:visible').evaluateAll(elements => elements.filter(el => !el.disabled && !el.checked && (el.type === 'checkbox' || !elements.some(other => other.name === el.name && other.checked))).map(el => el.name || 'Unanswered choice'));
  return [...new Set([...unknown, ...unresolvedChoices])];
}
export async function uploadResume(root, candidate) {
  const resumePath = candidate.resumePath; if (!resumePath) return false;
  const bytes = await fs.readFile(resumePath);
  const uploads = root.locator('input[type=file]');
  if (await uploads.count() > 1) throw new Error('Multiple document uploads need manual review.');
  if (!await uploads.count()) return false;
  const extension = path.extname(resumePath).toLowerCase();
  const sourceName = path.basename(candidate.resumeSource || `resume${extension}`).replace(/[^a-z0-9._ -]/gi,'-').slice(-90) || `resume${extension}`;
  const mimeType = extension === '.pdf' ? 'application/pdf' : extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
  await uploads.first().setInputFiles({ name: sourceName, mimeType, buffer: bytes });
  return true;
}
export async function applyToJob({ jobPage, job, candidate, autoSubmit, artifactDir, stopped = () => false, beforeAction = async () => { throw new Error('Account verification is required before applying.'); } }) {
  if (!autoSubmit) return { status: 'DRY_RUN_MATCH', reason: 'Preview: no Apply buttons clicked, including one-click applications' };
  jobIdentity(job.url);
  await jobPage.goto(job.url, { waitUntil: 'domcontentloaded' }); await jobPage.waitForTimeout(1500); let text = await visibleText(jobPage);
  if (applicationConfirmed(text, job) || await hasAppliedBadge(jobPage)) return { status: 'ALREADY_APPLIED' };
  if (security.test(text)) return { status: 'MANUAL_REQUIRED', reason: 'OTP/CAPTCHA detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'security') };
  const externalApply = jobPage.getByRole('button',{name:/^apply on company site$/i}).or(jobPage.getByRole('link',{name:/^apply on company site$/i})).first();
  if (await externalApply.isVisible().catch(() => false)) return { status: 'SKIPPED', reason: 'External company application skipped; continuing to next Naukri job' };
  const apply = jobPage.locator(selectors.applyButton).first(); if (!(await apply.isVisible().catch(() => false))) return { status: 'NEEDS_REVIEW', reason: 'Apply button not found', evidence: await saveEvidence(jobPage, artifactDir, job, 'no-apply-button') };
  if (stopped()) return { status: 'STOPPED' };
  await beforeAction();
  await apply.click(); await jobPage.waitForTimeout(1200);
  let resumeUploaded = false;
  for (let step = 0; step < 8; step++) {
    if (stopped()) return { status: 'SUBMISSION_UNCONFIRMED', reason: 'Stopped during application; review before retrying' };
    try { jobIdentity(jobPage.url()); } catch { return { status: 'NEEDS_REVIEW', reason: 'External employer application requires manual review' }; }
    text = await visibleText(jobPage); if (applicationConfirmed(text, job) || await hasAppliedBadge(jobPage)) return { status: 'APPLIED' }; if (security.test(text)) return { status: 'MANUAL_REQUIRED', reason: 'OTP/CAPTCHA detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'security') };
    await beforeAction();
    const flow = await applicationRoot(jobPage);
    if (await flow.locator('input[type=file]').count() && !candidate.resumePath) return { status: 'NEEDS_REVIEW', reason: 'Resume upload requested; save this candidate’s resume first' };
    if (!resumeUploaded && await uploadResume(flow, candidate)) {
      resumeUploaded = true; await jobPage.waitForTimeout(1000);
      if (/file upload was unsuccessful|upload (?:failed|unsuccessful)|could not upload/i.test(await flow.innerText().catch(() => ''))) return { status: 'NEEDS_REVIEW', reason: 'Naukri rejected the resume upload', evidence: await saveEvidence(jobPage, artifactDir, job, 'resume-upload') };
    }
    const unknown = await fillQuestions(jobPage, candidate, flow);
    if (unknown.length) return { status: 'NEEDS_REVIEW', reason: `Unknown required questions: ${unknown.join(' | ')}`, evidence: await saveEvidence(jobPage, artifactDir, job, 'questions') };
    const finalButton = flow.getByRole('button', { name: finalAction }).or(flow.getByRole('link', { name: finalAction })).first();
    if (await finalButton.isVisible().catch(() => false)) { if (stopped()) return { status: 'SUBMISSION_UNCONFIRMED', reason: 'Stopped before final submit' }; await beforeAction(); await finalButton.click(); await jobPage.waitForTimeout(1500); text = await visibleText(jobPage); if (applicationConfirmed(text, job) || await hasAppliedBadge(jobPage)) return { status: 'APPLIED' }; return { status: 'SUBMISSION_UNCONFIRMED', reason: 'Final confirmation was not detected', evidence: await saveEvidence(jobPage, artifactDir, job, 'unconfirmed') }; }
    const next = flow.getByRole('button', { name: nextAction }).first(); if (!(await next.isVisible().catch(() => false))) break; if (stopped()) return { status: 'SUBMISSION_UNCONFIRMED', reason: 'Stopped before next step' }; await beforeAction(); await next.click(); await jobPage.waitForTimeout(800);
  }
  return { status: 'SUBMISSION_UNCONFIRMED', reason: 'Application flow was not recognized', evidence: await saveEvidence(jobPage, artifactDir, job, 'unknown-flow') };
}
