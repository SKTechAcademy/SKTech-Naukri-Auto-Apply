import { freshnessOptions, defaultFreshnessDays } from './freshness.js';
const norm = value => String(value ?? '').toLowerCase().replace(/bengaluru/g, 'bangalore').replace(/dot\s*net|\.net/g, 'dotnet');
export function contains(text, term) {
  const escaped = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(norm(text));
}
export function validateCandidate(candidate) {
  for (const key of ['roles', 'skills', 'locations']) {
    if (!Array.isArray(candidate[key]) || !candidate[key].length || candidate[key].some(x => typeof x !== 'string' || !x.trim())) throw new Error(`${key} must contain at least one nonempty value.`);
  }
  if (!Number.isFinite(candidate.experienceYears) || candidate.experienceYears < 0) throw new Error('Enter your experience in years.');
  if (candidate.skillExperienceYears != null && (!Number.isFinite(candidate.skillExperienceYears) || candidate.skillExperienceYears < 0 || candidate.skillExperienceYears > candidate.experienceYears)) throw new Error('Default skill experience must be between 0 and total experience.');
  if (!Number.isFinite(candidate.minimumMatch) || candidate.minimumMatch < 1 || candidate.minimumMatch > 100) throw new Error('Minimum match must be between 1 and 100.');
  if (!freshnessOptions.includes(candidate.freshnessDays ?? defaultFreshnessDays)) throw new Error('Freshness must be 1, 2, 3, 7 or 15 days.');
  return candidate;
}
export function matchJob(job, candidate) {
  const text = `${job.title} ${job.description}`;
  const skills = candidate.skills.filter(skill => contains(text, skill));
  const exactRoleHit = candidate.roles.some(role => contains(job.title, role));
  const profileTerms = `${candidate.roles.join(' ')} ${candidate.skills.join(' ')}`;
  const namedTechnologies = ['dotnet','java','python','php','ruby','golang','android','ios','flutter','salesforce','sap','mainframe','devops'];
  const conflictingTitleTechnology = namedTechnologies.some(technology => contains(job.title, technology) && !contains(profileTerms, technology));
  const roleHit = exactRoleHit || (/\b(?:developer|engineer)\b/i.test(job.title) && skills.length >= 2 && !conflictingTitleTechnology);
  const locationHit = candidate.locations.some(location => contains(job.location, location));
  const score = Math.round(Math.min(skills.length / 3, 1) * 60 + (roleHit ? 25 : 0) + (locationHit ? 15 : 0));
  const reason = !roleHit ? 'Role does not match' : !locationHit ? 'Location does not match' : score < candidate.minimumMatch ? 'Below minimum match' : '';
  return { score, skills, eligible: !reason, reason };
}
export function scoreJob(job, candidate) { return matchJob(job, candidate).score; }
