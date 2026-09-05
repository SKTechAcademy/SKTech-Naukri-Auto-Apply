import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectors } from './selectors.js';
import { matchJob, validateCandidate } from './matcher.js';
import { applyToJob } from './application.js';
import { loadHistory, saveHistory, shouldSkip } from './history.js';
import { searchUrl, jobIdentity, firstSearchPageUrl } from './search.js';
import { CandidateStore } from './candidates.js';
import { verifyAccount } from './account.js';
import { checkFreshness, postingLabel } from './freshness.js';
import { enrichJob } from './job-details.js';
import { createHash } from 'node:crypto';
export async function sessionFingerprint(context) {
  const cookies = await context.cookies('https://www.naukri.com');
  const values = cookies.map(({name,value,domain,path})=>[name,value,domain,path]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export class Runner {
  constructor({ store = new CandidateStore(root), launch = (...args) => chromium.launchPersistentContext(...args), accountVerifier = verifyAccount } = {}) { this.store = store; this.launch = launch; this.accountVerifier = accountVerifier; }
  state = { running: false, message: 'Save your profile, log in, then start.', jobs: [], mode: 'preview' };
  context = null;
  stopRequested = false;
  ownerId = null;
  ownerVersion = null;
  verified = null;
  verifiedFingerprint = null;
  async login(candidate) {
    if (!candidate?.id) throw new Error('Select a saved candidate first.');
    if (this.state.running && this.state.candidateId !== candidate.id) throw new Error('Cannot switch candidates during a run.');
    if (this.context && (this.ownerId !== candidate.id || this.ownerVersion !== (candidate.accountVersion || 1))) { await this.context.close(); this.context = null; this.verified = null; }
    if (!this.context) {
      const version = candidate.accountVersion || 1;
      const browserPath = version === 1 ? this.store.paths(candidate.id).browser : `${this.store.paths(candidate.id).browser}-account-${version}`;
      this.context = await this.launch(browserPath, { headless: false, viewport: { width: 1440, height: 900 } });
      this.ownerId = candidate.id;
      this.ownerVersion = version;
      this.context.setDefaultTimeout(5000);
      const owned = this.context;
      this.context.on('close', () => { if (this.context === owned) { this.context = null; this.ownerId = null; this.ownerVersion = null; this.verified = null; } });
    }
    return this.context;
  }
  async openLogin(id) {
    if (this.state.running) throw new Error('Stop the current run before opening login.');
    const candidate = await this.store.get(id);
    const context = await this.login(candidate);
    this.verified = null;
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });
    this.state = { running: false, candidateId: id, message: `Sign in as ${candidate.name}, then verify the account here.`, jobs: [], mode: 'preview' };
  }
  async verify(id) {
    if (this.state.running) throw new Error('Wait for the current run to finish.');
    const candidate = await this.store.get(id);
    const context = await this.login(candidate);
    this.verified = null;
    const identity = await this.accountVerifier(context, candidate, { artifactDir: this.store.paths(id).artifacts });
    this.verified = { ...identity, candidateId: id };
    this.verifiedFingerprint = await sessionFingerprint(context);
    this.state = {...this.state,candidateId:id,message:'Naukri account verified. Ready to preview or apply.'};
    return this.verified;
  }
  stop() { this.stopRequested = true; this.state.message = 'Stopping after the current browser action…'; }
  async run(candidateId, { mode = 'preview', maxJobs = 20, pages = null, source = 'profile', matchPolicy = 'profile' } = {}) {
    if (this.state.running) throw new Error('A run is already active.');
    if (!['preview', 'apply'].includes(mode)) throw new Error('Invalid run mode.');
    if(!['profile','current'].includes(source)||!['profile','search'].includes(matchPolicy)||(matchPolicy==='search'&&source!=='current'))throw new Error('Apply search jobs requires an open Naukri search.');
    if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100 || (pages !== null && (!Number.isInteger(pages) || pages < 1))) throw new Error('Use 1–100 matching jobs.');
    this.stopRequested = false;
    this.store.paths(candidateId);
    this.state = { running: true, candidateId, message: 'Checking candidate account…', jobs: [], mode, source, matchPolicy };
    try {
      const candidate = structuredClone(await this.store.get(candidateId));
      validateCandidate(candidate);
      if (candidate.profileConfirmed !== true) throw new Error('Review and confirm this candidate’s profile first.');
      const files = this.store.paths(candidateId);
      await this.store.verifyResume(candidate);
      const context = await this.login(candidate);
      const guard = async (force = false) => {
        if (this.stopRequested) throw new Error('Stopped by user.');
        if (this.ownerId !== candidateId || context !== this.context) throw new Error('Candidate browser ownership changed; stopping.');
        const current = await this.store.get(candidateId);
        if (current.revision !== candidate.revision) throw new Error('Candidate profile changed during the run; stopping.');
        await this.store.verifyResume(candidate);
        const fingerprint = await sessionFingerprint(context);
        const fresh = this.verified?.candidateId === candidateId && Date.now() - Date.parse(this.verified.at) < 30000 && fingerprint === this.verifiedFingerprint;
        if(force || !fresh){
          this.verified = null;
          this.verified = { ...await this.accountVerifier(context, candidate, { artifactDir: files.artifacts }), candidateId };
          this.verifiedFingerprint = await sessionFingerprint(context);
        }
        if (this.stopRequested) throw new Error('Stopped by user.');
      };
      await guard(true);
      let page = context.pages()[0] || await context.newPage();
      let currentSearchStart = '';
      if(source==='current'){
        const searches=context.pages().filter(p=>{try{const u=new URL(p.url());return /(^|\.)naukri\.com$/.test(u.hostname)&&/-jobs(?:-|\/|$)|\/jobs-in-/.test(u.pathname)&&!u.pathname.includes('job-listings');}catch{return false;}});
        page=searches.at(-1);
        if(!page)throw new Error('Open a Naukri job search in this candidate’s login browser first, then click Apply open search.');
        currentSearchStart=firstSearchPageUrl(page.url());
        this.state.searchUrl=currentSearchStart;
      }
      const historyFile = files.history;
      const history = await loadHistory(historyFile);
      const accountHistory = () => history.filter(item => !item.accountEmail || item.accountEmail.toLowerCase() === candidate.naukriEmail.toLowerCase());
      const seen = new Set();
      let scanned = 0, matched = 0;
      const searchPlans=source==='current'?[{role:'open Naukri search',location:''}]:candidate.roles.flatMap(role=>candidate.locations.map(location=>({role,location})));
      search: for (const {role,location} of searchPlans) for (let n = 1; pages === null || n <= pages; n++) {
        if (this.stopRequested || matched >= maxJobs) break search;
        this.state.message = `Searching ${role} in ${location}, page ${n}`;
        if(source==='profile')await page.goto(searchUrl(role, location, n), { waitUntil: 'domcontentloaded' });
        else if(n===1)await page.goto(currentSearchStart,{waitUntil:'domcontentloaded'});
        else {const next=page.getByRole('link',{name:/^next$/i}).or(page.getByRole('button',{name:/^next$/i})).first();if(!await next.isVisible().catch(()=>false))break;await next.click();await page.waitForLoadState('domcontentloaded');}
        const body = await page.locator('body').innerText();
        if (/captcha|verify you are human|enter otp|access denied/i.test(body) || /nlogin|login/i.test(new URL(page.url()).pathname)) {
          this.state.message = 'Login/security check required. Complete it in the browser and start again.'; return;
        }
        const cards = page.locator(selectors.jobCard);
        await cards.first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
        if (!await cards.count()) break;
        const extracted = await cards.evaluateAll((elements, s) => elements.map(card => {
          const link=card.querySelector('a.title, a[href*="job-listings"]');
          return { url:link?.href,title:card.querySelector(s.jobTitle)?.textContent?.trim()||'',location:card.querySelector(s.location)?.textContent?.trim()||'',experience:card.querySelector(s.experience)?.textContent?.trim()||'',description:card.innerText };
        }),selectors);
        const jobs = [];
        for (const job of extracted) {
          if(!job.url)continue;
          const url = job.url;
          let key; try { key = jobIdentity(url); } catch { continue; }
          if (seen.has(key)) continue;
          seen.add(key);
          job.postedText = postingLabel(job.description);
          jobs.push(job);
        }
        if (!jobs.length) break;
        for (let job of jobs) {
          if (this.stopRequested) break search;
          scanned++;
          let result, pending;
          let freshness = checkFreshness(job, candidate.freshnessDays);
          const duplicate = shouldSkip(accountHistory(), job.url);
          if (!duplicate && freshness.postedAgeDays === null) {
            this.state.message = `Checking posting date: ${job.title}`;
            try { job = await enrichJob(context, job); } catch (error) { job.detailError = error.message; }
            freshness = checkFreshness(job, candidate.freshnessDays);
          }
          let match = matchJob(job, candidate);
          if(freshness.eligible && !job.detailChecked && matchPolicy==='profile' && !duplicate && ['Below minimum match',''].includes(match.reason)){
            this.state.message=`Reading full job description: ${job.title}`;
            try {job=await enrichJob(context,job);match=matchJob(job,candidate);freshness=checkFreshness(job,candidate.freshnessDays);} catch(error) {job.detailError=error.message;}
          }
          if(this.stopRequested)break search;
          if (shouldSkip(accountHistory(), job.url)) result = { status: 'SKIPPED', reason: 'Previously applied or submission needs reconciliation' };
          else if (!freshness.eligible) result = { status: 'SKIPPED', reason: freshness.reason };
          else if (matchPolicy==='profile' && !match.eligible) result = { status: 'SKIPPED', reason: match.reason };
          else if (matched >= maxJobs) break search;
          else if (mode === 'preview') { matched++; result = { status: 'DRY_RUN_MATCH' }; }
          else {
            matched++;
            this.state.message = `Applying: ${job.title}`;
            const jobPage = await context.newPage();
            pending = { ...job, candidateId, candidateName: candidate.name, accountEmail: candidate.naukriEmail, profileRevision: candidate.revision, score: match.score, status: 'SUBMITTING', at: new Date().toISOString() };
            history.push(pending); await saveHistory(historyFile, history);
            result = await applyToJob({ jobPage, job, candidate, autoSubmit: true, artifactDir: files.artifacts, stopped: () => this.stopRequested, beforeAction: guard }).catch(error => ({ status: 'SUBMISSION_UNCONFIRMED', reason: error.message }));
            if (['APPLIED', 'ALREADY_APPLIED', 'NEEDS_REVIEW', 'SKIPPED'].includes(result.status)) {
              await jobPage.close();
              if (['NEEDS_REVIEW', 'SKIPPED'].includes(result.status)) this.state.message = `${result.reason}. Continuing to next job…`;
            } else this.stopRequested = true;
          }
          const record = { ...job, postedAgeDays: freshness.postedAgeDays, freshnessDays: freshness.freshnessDays, candidateId, candidateName: candidate.name, accountEmail: candidate.naukriEmail, profileRevision: candidate.revision, score: match.score, source, matchPolicy, ...result, at: new Date().toISOString() };
          if (pending) Object.assign(pending, record); else history.push(record); await saveHistory(historyFile, history);
          this.state.jobs.unshift(record);
          if (this.stopRequested) { this.state.message = result.reason || 'Stopped. Review the browser before restarting.'; return; }
        }
      }
      this.state.message = this.stopRequested ? 'Stopped.' : `Finished. Scanned ${scanned} jobs and processed ${matched} matches.`;
    } catch (error) { this.state.message = `Error: ${error.message}`; }
    finally { this.state.running = false; }
  }
}
