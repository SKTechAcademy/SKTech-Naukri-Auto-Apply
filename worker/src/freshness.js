export const freshnessOptions = [1, 2, 3, 7, 15];
export const defaultFreshnessDays = 15;

// Read relative posting labels, never experience ranges or recommendation dates.
export function postingLabel(text) {
  return String(text || '').match(/\b(?:(?:\d+\+?|a|an|few)\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s*ago|today|yesterday|just now)\b/i)?.[0] || '';
}
export function postingAgeDays(text) {
  const label = postingLabel(text).toLowerCase();
  if (/^(today|just now)$/.test(label)) return 0;
  if (label === 'yesterday') return 1;
  const match = label.match(/^(\d+\+?|a|an|few)\s*(minute|min|hour|hr|day|week|month)/);
  if (!match) return null;
  // An unspecified number of days/weeks cannot safely fit a selected window.
  if (match[1] === 'few' && !/^(minute|min|hour|hr)$/.test(match[2])) return null;
  const count = match[1] === 'few' ? 23 : /^(a|an)$/.test(match[1]) ? 1 : Number.parseInt(match[1], 10);
  const factor = { minute: 1/1440, min: 1/1440, hour: 1/24, hr: 1/24, day: 1, week: 7, month: 30 }[match[2]];
  return count * factor;
}
export function checkFreshness(job, days = defaultFreshnessDays) {
  const age = postingAgeDays(job.postedText);
  const tooOld = age > days || (age === days && /\d+\+/.test(job.postedText || ''));
  return { postedAgeDays: age, freshnessDays: days, eligible: age !== null && !tooOld,
    reason: age === null ? 'Posting date unavailable; freshness could not be verified' : tooOld ? `Older than selected freshness (${days} days)` : '' };
}
