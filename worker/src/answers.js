const clean = value => String(value ?? '').trim();
const tech = value => clean(value).toLowerCase().replace(/react\.?js/g,'react').replace(/angular\.?js/g,'angular').replace(/node\.?js/g,'node').replace(/dot\s*net|\.net/g,'dotnet').replace(/[^a-z0-9#+]+/g,' ');
function listedSkillExperience(text, candidate) {
  if (!/(?:how many|number of).*years?.*experience|years?.*experience.*(?:in|with|of)/i.test(text)) return null;
  const requested = text.match(/(?:experience.*?(?:in|with|of))\s+([^?\n]+)/i)?.[1]?.split(/\s*(?:\/|,|\band\b|\bor\b)\s*/i).map(tech).filter(Boolean) || [];
  if (!requested.length) return null;
  const skillTokens = new Set(tech((candidate.skills || []).join(' ')).split(/\s+/).filter(Boolean));
  if (!requested.every(item => item.split(/\s+/).filter(Boolean).every(token => skillTokens.has(token)))) return null;
  const years = candidate.skillExperienceYears ?? candidate.experienceYears;
  return Number.isFinite(Number(years)) ? clean(years) : null;
}
export function answerFor(label, candidate) {
  const text = clean(label).toLowerCase(); const answers = candidate.answers ?? {};
  for (const [key, value] of Object.entries(answers.custom ?? {})) if (key.trim() && text.includes(key.toLowerCase()) && clean(value)) return clean(value);
  const skillYears = listedSkillExperience(text, candidate); if (skillYears) return skillYears;
  const mappings = [
    [/current.*(ctc|salary)|present.*salary/, answers.currentCTC ?? candidate.currentCTC],
    [/expected.*(ctc|salary)|salary.*expect/, answers.expectedCTC ?? candidate.expectedCTC],
    [/notice.*period|days.*join|joining.*time/, answers.noticePeriod ?? candidate.noticePeriod],
    [/total.*experience|overall.*experience/, answers.experienceYears ?? candidate.experienceYears],
    [/current.*location|where.*located/, answers.currentLocation ?? candidate.currentLocation],
    [/preferred.*location/, answers.preferredLocation],
    [/full.*name|your.*name/, answers.name ?? candidate.name], [/email/, answers.email ?? candidate.email], [/phone|mobile/, answers.phone ?? candidate.phone],
    [/serving.*notice/, answers.servingNotice], [/relocat/, answers.willingToRelocate], [/work.*shift|night.*shift/, answers.willingForShifts], [/work.*office|on.?site/, answers.willingForOffice], [/remote/, answers.willingForRemote]
  ];
  for (const [pattern, value] of mappings) if (pattern.test(text) && clean(value)) return clean(value);
  return null;
}
