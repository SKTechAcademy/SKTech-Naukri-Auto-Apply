export function searchUrl(role, location, page = 1) {
  const slug = role.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = new URL(`https://www.naukri.com/${slug}-jobs${page > 1 ? `-${page}` : ''}`);
  url.searchParams.set('k', role);
  url.searchParams.set('l', location);
  return url.href;
}
export function firstSearchPageUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !/(^|\.)naukri\.com$/.test(url.hostname)) throw new Error('Only Naukri search URLs are supported.');
  url.pathname = url.pathname.replace(/(-jobs)-\d+\/?$/i, '$1');
  for (const key of ['page','pageNo','pageno']) url.searchParams.delete(key);
  return url.href;
}
export function jobIdentity(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !/(^|\.)naukri\.com$/.test(url.hostname)) throw new Error('Only Naukri job URLs are supported.');
  const id = url.pathname.match(/-(\d{10,})(?:\/)?$/)?.[1];
  return id || `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
