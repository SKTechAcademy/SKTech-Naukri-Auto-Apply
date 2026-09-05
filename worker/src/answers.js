const clean = value => String(value ?? '').trim();
export function answerFor(label, candidate) {
  const text = clean(label).toLowerCase(); const answers = candidate.answers ?? {};
  const mappings = [
    [/current.*(ctc|salary)|present.*salary/, answers.currentCTC ?? candidate.currentCTC],
    [/expected.*(ctc|salary)|salary.*expect/, answers.expectedCTC ?? candidate.expectedCTC],
    [/notice.*period|days.*join|joining.*time/, answers.noticePeriod ?? candidate.noticePeriod],
    [/total.*experience|years.*experience|experience.*years/, answers.experienceYears ?? candidate.experienceYears],
    [/current.*location|where.*located|city/, answers.currentLocation ?? candidate.locations?.[0]],
    [/preferred.*location/, answers.preferredLocation ?? candidate.locations?.[0]],
    [/full.*name|your.*name/, answers.name ?? candidate.name], [/email/, answers.email ?? candidate.email], [/phone|mobile/, answers.phone ?? candidate.phone],
    [/serving.*notice/, answers.servingNotice], [/relocat/, answers.willingToRelocate], [/work.*shift|night.*shift/, answers.willingForShifts], [/work.*office|on.?site/, answers.willingForOffice], [/remote/, answers.willingForRemote]
  ];
  for (const [pattern, value] of mappings) if (pattern.test(text) && clean(value)) return clean(value);
  for (const [key, value] of Object.entries(answers.custom ?? {})) if (text.includes(key.toLowerCase()) && clean(value)) return clean(value);
  return null;
}
