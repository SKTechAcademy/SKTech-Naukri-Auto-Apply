import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { applyToJob, fillQuestions, applicationRoot, uploadResume } from '../src/application.js';
import { verifyAccount } from '../src/account.js';
test('application behavior on isolated browser fixtures', async t => {
  const browser = await chromium.launch({ headless: true });
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naukri-flow-test-'));
  const job = { title: '.NET Developer', url: 'https://www.naukri.com/job-listings-fixture-123456789012' };
  async function fixture(html, options = {}) {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType:'text/html', body:html }));
    const page = await context.newPage();
    try { return await applyToJob({jobPage:page,job,candidate:{},autoSubmit:true,artifactDir,beforeAction:async()=>{},...options}); }
    finally { await context.close(); }
  }
  try {
    await t.test('recognizes successful one-click application', async () => {
      const result = await fixture(`<button onclick="document.body.innerHTML='Successfully applied'">Apply</button>`);
      assert.equal(result.status,'APPLIED',JSON.stringify(result));
    });
    await t.test('recognizes the real Naukri Applied to confirmation', async()=>{
      const result=await fixture(`<button onclick="document.body.innerHTML='Applied to &quot;.NET Developer&quot;'">Apply</button>`);
      assert.equal(result.status,'APPLIED',JSON.stringify(result));
    });
    await t.test('recognizes the existing green Applied badge without clicking anything',async()=>{
      const result=await fixture('<button class="styles_applied-button" disabled>Applied</button>');
      assert.equal(result.status,'ALREADY_APPLIED');
    });
    await t.test('does not submit unknown required questions', async () => {
      const result = await fixture(`<button onclick="this.remove();document.querySelector('form').hidden=false">Apply</button><form hidden><label>Certification number<input required></label><button type="button" onclick="document.body.innerHTML='Successfully applied'">Submit</button></form>`);
      assert.equal(result.status,'NEEDS_REVIEW'); assert.match(result.reason,/Certification/);
    });
    await t.test('does not report success without confirmation', async () => {
      const result = await fixture(`<button onclick="this.textContent='Submit'">Apply</button>`);
      assert.equal(result.status,'SUBMISSION_UNCONFIRMED');
    });
    await t.test('leaves security challenges for manual action', async () => {
      assert.equal((await fixture('<p>Enter OTP to continue</p><button>Apply</button>')).status,'MANUAL_REQUIRED');
    });
    await t.test('stop prevents initial application click', async () => {
      assert.equal((await fixture('<button>Apply</button>',{stopped:()=>true})).status,'STOPPED');
    });
    await t.test('fills nested labels and blocks required choices', async () => {
      const page = await browser.newPage();
      await page.setContent('<label>Current CTC<input></label><label><input type="checkbox" required>Consent</label>');
      const unknown=await fillQuestions(page,{currentCTC:'10'});
      assert.equal(await page.locator('input').first().inputValue(),'10');
      assert.ok(unknown.length); await page.close();
    });
    await t.test('answers Naukri chatbot skill experience and clicks its Save button', async () => {
      const probe=await browser.newPage();await probe.setContent('<button id="open" onclick="this.remove();document.getElementById(\'_fixtureChatbotContainer\').hidden=false">Apply</button><div id="_fixtureChatbotContainer" hidden><input><button>Save</button></div>');await probe.locator('#open').click();assert.equal(await (await applicationRoot(probe)).getAttribute('id'),'_fixtureChatbotContainer');await probe.close();
      const result=await fixture(`<button id="background" onclick="window.wrong=true">Save</button><button onclick="this.remove();document.getElementById('_fixtureChatbotContainer').hidden=false">Apply</button><div id="_fixtureChatbotContainer" hidden><div class="chatbot_Overlay"></div><p>How many years of experience do you have in C#/.net core?</p><input id="reply" placeholder="Type message here..."><button onclick="document.body.innerHTML=document.getElementById('reply').value==='4.2'&&!window.wrong?'Successfully applied':'Wrong answer'">Save</button></div>`,{candidate:{skills:['C#','.NET Core'],experienceYears:4.2,skillExperienceYears:4.2}});
      assert.equal(result.status,'APPLIED',JSON.stringify(result));
    });
    await t.test('uploads the resume with its original name instead of the internal hash', async () => {
      const resumePath=path.join(artifactDir,'resume-long-internal-hash.pdf');await fs.writeFile(resumePath,'resume');
      const page=await browser.newPage();await page.setContent('<input type="file">');
      assert.equal(await uploadResume(page,{resumePath,resumeSource:'C:\\Resumes\\Candidate Resume.pdf'}),true);
      assert.equal(await page.locator('input').evaluate(input=>input.files[0].name),'Candidate Resume.pdf');await page.close();
    });
    await t.test('account guard can block the very first application click', async () => {
      await assert.rejects(fixture(`<button onclick="document.body.innerHTML='Successfully applied'">Apply</button>`, {beforeAction:async()=>{throw new Error('Wrong candidate account');}}),/Wrong candidate account/);
    });
    await t.test('account is checked again before final submission', async () => {
      let checks=0;
      await assert.rejects(fixture(`<button onclick="this.textContent='Submit'">Apply</button>`,{beforeAction:async()=>{checks++;if(checks===3)throw new Error('Account changed before Submit');}}),/Account changed before Submit/);assert.equal(checks,3);
    });
    await t.test('verifies visible Naukri account email and rejects login fields', async () => {
      const context=await browser.newContext();
      await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<span class="txt" title="candidate@example.test">candidate@example.test</span>'}));
      assert.equal((await verifyAccount(context,{naukriEmail:'candidate@example.test'})).email,'candidate@example.test');
      await assert.rejects(verifyAccount(context,{naukriEmail:'different@example.test'}),/could not be verified/);
      await context.unroute('**/*');
      await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<input type="email" id="email" value="candidate@example.test">'}));
      await assert.rejects(verifyAccount(context,{naukriEmail:'candidate@example.test'}),/could not be verified/);await context.close();
    });
  } finally { await browser.close(); await fs.rm(artifactDir,{recursive:true,force:true}); }
});
