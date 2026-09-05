import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateCandidate } from './matcher.js';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}
export class CandidateStore {
  constructor(root) { this.root = root; this.base = path.join(root, 'private/candidates'); }
  paths(id) {
    if (!idPattern.test(id || '')) throw new Error('Invalid candidate ID.');
    const directory = path.join(this.base, id);
    return { directory, profile: path.join(directory, 'profile.json'), history: path.join(directory, 'applications.json'), browser: path.join(directory, 'browser'), artifacts: path.join(directory, 'artifacts') };
  }
  async init() {
    await fs.mkdir(this.base, { recursive: true });
    // A deterministic migration is idempotent. Never reuse the old shared login.
    const id = '00000000-0000-4000-8000-000000000001';
    const target = this.paths(id);
    try { await fs.access(target.profile); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let legacy;
    try { legacy = JSON.parse(await fs.readFile(path.join(this.root, 'data/candidate.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await fs.mkdir(target.directory, { recursive: true });
    const profile = { ...legacy, id, revision: 1, name: legacy.name || 'Imported candidate', naukriEmail: normalizeEmail(legacy.email), profileConfirmed: false, resumeSource: String(legacy.resumePath || '').replace(/^"|"$/g, ''), resumePath: '', resumeHash: '', updatedAt: new Date().toISOString() };
    await atomicJson(target.profile, profile);
    // Shared history is retained as an archive, not assigned to a possibly different account.
    await atomicJson(target.history, []);
  }
  async list() {
    const directories = await fs.readdir(this.base, { withFileTypes: true });
    const profiles = await Promise.all(directories.filter(x => x.isDirectory() && idPattern.test(x.name)).map(x => this.get(x.name)));
    return profiles.sort((a,b) => a.name.localeCompare(b.name));
  }
  async get(id) { const profile = JSON.parse(await fs.readFile(this.paths(id).profile, 'utf8')); return { freshnessDays: 15, skillExperienceYears: profile.experienceYears ?? null, ...profile }; }
  async uniqueEmail(email, id) {
    if (email && (await this.list()).some(p => p.id !== id && normalizeEmail(p.naukriEmail) === email)) throw new Error('This Naukri email already belongs to another candidate. Open that candidate instead.');
  }
  async create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('Enter a candidate name (up to 100 characters).');
    const id = randomUUID(), files = this.paths(id);
    await fs.mkdir(files.directory, { recursive: true });
    const profile = { id, revision: 1, name: name.trim(), email: '', naukriEmail: '', phone: '', roles: [], skills: [], locations: [], experienceYears: null, skillExperienceYears: null, minimumMatch: 50, freshnessDays: 15, currentCTC: '', expectedCTC: '', noticePeriod: '', resumeSource: '', resumePath: '', resumeHash: '', answers: {}, profileConfirmed: false, updatedAt: new Date().toISOString() };
    await atomicJson(files.profile, profile); await atomicJson(files.history, []);
    return profile;
  }
  async save(id, body) {
    const old = await this.get(id);
    if (body.id !== id || body.revision !== old.revision) throw new Error('This profile changed in another tab. Reload it before saving.');
    if (!String(body.name || '').trim()) throw new Error('Candidate name is required.');
    const email = normalizeEmail(body.naukriEmail);
    if (!emailPattern.test(email)) throw new Error('Enter the email registered with this candidate’s Naukri account.');
    const accountChanged = normalizeEmail(old.naukriEmail) !== email;
    await this.uniqueEmail(email, id);
    validateCandidate(body);
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) throw new Error('Screening answers must be a JSON object.');
    if (body.answers.custom && (typeof body.answers.custom !== 'object' || Array.isArray(body.answers.custom))) throw new Error('Custom answers must be an object.');
    // Identity answers always come from this candidate, never from custom overrides.
    for (const key of ['name','email','phone','experienceYears']) if (body.answers[key] != null) throw new Error(`Use the candidate ${key} field instead of overriding it in screening answers.`);
    for (const key of Object.keys(body.answers.custom || {})) if (/name|email|phone|mobile/i.test(key)) throw new Error('Keep identity information in the candidate contact fields.');
    const profile = { ...old };
    profile.accountVersion = (old.accountVersion || 1) + (old.naukriEmail && accountChanged ? 1 : 0);
    for (const key of ['name','email','phone','currentCTC','expectedCTC','noticePeriod']) profile[key] = String(body[key] || '').trim();
    for (const key of ['roles','skills','locations']) profile[key] = [...new Set(body[key].map(x => x.trim()))];
    Object.assign(profile, { naukriEmail: email, experienceYears: body.experienceYears, skillExperienceYears: body.skillExperienceYears ?? body.experienceYears, minimumMatch: body.minimumMatch, freshnessDays: body.freshnessDays ?? 15, answers: structuredClone(body.answers), profileConfirmed: body.profileConfirmed === true });
    const source = String(body.resumeSource || '').trim().replace(/^"|"$/g, '');
    profile.resumeSource = source;
    profile.resumePath = ''; profile.resumeHash = '';
    if (source) {
      if (!path.isAbsolute(source) || !/\.(pdf|docx|doc)$/i.test(source)) throw new Error('Choose an absolute path to a PDF, DOC or DOCX resume.');
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Resume must be a file smaller than 10 MB.');
      const bytes = await fs.readFile(source);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const own = path.join(this.paths(id).directory, `resume-${hash}${path.extname(source).toLowerCase()}`);
      await fs.writeFile(own, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      profile.resumePath = own; profile.resumeHash = hash;
    }
    profile.revision++; profile.updatedAt = new Date().toISOString();
    await atomicJson(this.paths(id).profile, profile);
    return profile;
  }
  async verifyResume(profile) {
    if (!profile.resumePath) return;
    const files = this.paths(profile.id);
    if (path.dirname(profile.resumePath) !== files.directory) throw new Error('Resume does not belong to this candidate.');
    const hash = createHash('sha256').update(await fs.readFile(profile.resumePath)).digest('hex');
    if (hash !== profile.resumeHash) throw new Error('Candidate resume changed. Save and review the profile again.');
  }
}
