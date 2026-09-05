import { normalizeEmail } from './candidates.js';
import fs from 'node:fs/promises';
import path from 'node:path';
export function assertAccount(expected, observed) {
  const target = normalizeEmail(expected);
  const values = [...new Set(observed.map(normalizeEmail).filter(Boolean))];
  if (!target || values.length !== 1 || values[0] !== target) throw new Error('Naukri account could not be verified for this candidate. Open their session and sign in with their registered email.');
  return target;
}
export async function verifyAccount(context, candidate, { artifactDir } = {}) {
  const page = await context.newPage();
  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).hostname !== 'www.naukri.com' || !new URL(page.url()).pathname.startsWith('/mnjuser/profile')) throw new Error('Sign in to the candidate’s Naukri account first.');
    // Naukri renders the contact email as <span class="txt" title="address">.
    const emailSelector = '[title*="@"], [class*="email" i], [id*="email" i], a[href^="mailto:"]';
    await page.locator(emailSelector).filter({visible:true}).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    const observed = await page.locator(emailSelector).evaluateAll(elements => {
      const emails = [];
      for (const el of elements) {
        if (!el.getClientRects().length) continue;
        // Do not trust editable login fields as proof of an authenticated account.
        if (['INPUT','TEXTAREA','FORM'].includes(el.tagName)) continue;
        const text = [el.textContent, el.getAttribute('title'), el.getAttribute('href')].filter(Boolean).join(' ');
        emails.push(...(text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []));
      }
      return emails;
    });
    return { email: assertAccount(candidate.naukriEmail, observed), at: new Date().toISOString() };
  } catch(error) {
    if(artifactDir){
      await fs.mkdir(artifactDir,{recursive:true});
      const diagnostic=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText, emailElements:Array.from(document.querySelectorAll('[class*="email" i], [id*="email" i], [title*="@"]')).map(el=>({tag:el.tagName,class:el.className,id:el.id,title:el.getAttribute('title'),text:el.textContent,visible:!!el.getClientRects().length})).slice(0,30)})).catch(()=>({}));
      await fs.writeFile(path.join(artifactDir,'account-diagnostic.json'),JSON.stringify(diagnostic,null,2));
    }
    throw error;
  } finally { await page.close().catch(() => {}); }
}
