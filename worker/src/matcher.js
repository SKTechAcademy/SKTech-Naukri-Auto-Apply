const norm = s => (s || '').toLowerCase();
export function scoreJob(job, candidate) {
  const text = norm(`${job.title} ${job.description}`);
  const skillHits = candidate.skills.filter(s => text.includes(norm(s))).length;
  const skillScore = candidate.skills.length ? (skillHits / candidate.skills.length) * 60 : 0;
  const roleHit = candidate.roles.some(r => norm(job.title).includes(norm(r)) || text.includes(norm(r)));
  const roleScore = roleHit ? 25 : 0;
  const locationHit = candidate.locations.some(l => norm(job.location).includes(norm(l)) || text.includes(norm(l)));
  const locationScore = locationHit ? 15 : 0;
  return Math.round(skillScore + roleScore + locationScore);
}
