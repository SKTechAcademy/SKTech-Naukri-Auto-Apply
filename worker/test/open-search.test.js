import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { CandidateStore } from '../src/candidates.js';
import { Runner } from '../src/runner.js';
for (const source of ['profile', 'current']) test(source+' mode enforces freshness before any Apply action',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-freshness-'));
  const browser=await chromium.launch({headless:true});
  try {
    const store=new CandidateStore(dir);await store.init();const p=await store.create('Freshness fixture');
    const candidate=await store.save(p.id,{...p,naukriEmail:'fixture@example.test',roles:['.NET Developer'],skills:['C#'],locations:['Bangalore'],experienceYears:4.6,minimumMatch:50,freshnessDays:3,profileConfirmed:true});
    const context=await browser.newContext();
    let jobVisits=0;
    await context.route('**/*',route=>{
      if(route.request().url().includes('job-listings')) { jobVisits++;return route.fulfill({contentType:'text/html',body:'<h1>.NET Developer</h1><p>Job description C#</p><button>Apply</button>'}); }
      return route.fulfill({contentType:'text/html',body:'<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-fixture-123456789012">.NET Developer</a><span class="locWdth">Bangalore</span><span class="expwdth">0 - 4 Yrs</span>C# <span>7 days ago</span></div>'});
    });
    const page=await context.newPage();await page.goto('https://www.naukri.com/dot-net-developer-jobs');
    const runner=new Runner({store,launch:async()=>context,accountVerifier:async()=>({email:candidate.naukriEmail,at:new Date().toISOString()})});
    await runner.run(candidate.id,{source,matchPolicy:source==='current'?'search':'profile',mode:'apply',maxJobs:1,pages:1});
    assert.equal(runner.state.jobs[0].status,'SKIPPED');
    assert.match(runner.state.jobs[0].reason,/Older than selected freshness \(3 days\)/);
    assert.equal(jobVisits,0);
    assert.equal((await store.get(candidate.id)).freshnessDays,3);
    const other=await store.create('Other candidate');assert.equal(other.freshnessDays,15);
  } finally {await browser.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
test('open-search mode preserves the searched page and does not apply profile score or experience filters',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-open-search-'));
  const browser=await chromium.launch({headless:true});
  try{
    const store=new CandidateStore(dir);await store.init();const p=await store.create('Fixture candidate');
    const candidate=await store.save(p.id,{...p,naukriEmail:'fixture@example.test',roles:['Java Developer'],skills:['Java'],locations:['Pune'],experienceYears:2,minimumMatch:90,profileConfirmed:true});
    const context=await browser.newContext();
    const url='https://www.naukri.com/dot-net-developer-jobs-in-bangalore';
    await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-fixture-123456789012">.NET Developer</a><span class="locWdth">Bangalore</span><span class="expwdth">5 - 8 Yrs</span>C# SQL <span>1 day ago</span></div>'}));
    const page=await context.newPage();await page.goto(url);
    const runner=new Runner({store,launch:async()=>context,accountVerifier:async()=>({email:candidate.naukriEmail,at:new Date().toISOString()})});
    await runner.run(candidate.id,{source:'current',matchPolicy:'search',mode:'preview',maxJobs:1,pages:1});
    assert.equal(runner.state.jobs[0].status,'DRY_RUN_MATCH');assert.equal(runner.state.jobs[0].score,0);assert.equal(runner.state.searchUrl,url);assert.equal(page.url(),url);assert.equal((await store.get(candidate.id)).experienceYears,2);
  }finally{await browser.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
test('open-search preview starts at page one and follows pagination',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-pages-'));const browser=await chromium.launch({headless:true});
  try{
    const store=new CandidateStore(dir);await store.init();const p=await store.create('Page fixture');const candidate=await store.save(p.id,{...p,naukriEmail:'fixture@example.test',roles:['.NET Developer'],skills:['C#'],locations:['Bangalore'],experienceYears:4.2,minimumMatch:50,profileConfirmed:true});
    const context=await browser.newContext();
    await context.route('**/*',route=>{const url=new URL(route.request().url());const second=/-jobs-2$/.test(url.pathname);const id=second?'222222222222':'111111111111';const next=second?'':'<a href="https://www.naukri.com/dot-net-developer-jobs-2?k=.net&jobAge=7">Next</a>';return route.fulfill({contentType:'text/html',body:`<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-page-${id}">Page ${second?2:1} .NET Developer</a><span class="locWdth">Bangalore</span>C# <span>1 day ago</span></div>${next}`});});
    const page=await context.newPage();await page.goto('https://www.naukri.com/dot-net-developer-jobs-2?k=.net&jobAge=7');
    const runner=new Runner({store,launch:async()=>context,accountVerifier:async()=>({email:candidate.naukriEmail,at:new Date().toISOString()})});
    await runner.run(candidate.id,{source:'current',matchPolicy:'search',mode:'preview',maxJobs:2,pages:2});
    assert.deepEqual(new Set(runner.state.jobs.map(job=>job.title)),new Set(['Page 1 .NET Developer','Page 2 .NET Developer']));
    assert.equal(new URL(runner.state.searchUrl).pathname,'/dot-net-developer-jobs');
  }finally{await browser.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
test('live run skips an external-company job and continues to the next Naukri application',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-continue-'));const browser=await chromium.launch({headless:true});
  try{
    const store=new CandidateStore(dir);await store.init();const p=await store.create('Continue fixture');const candidate=await store.save(p.id,{...p,naukriEmail:'fixture@example.test',roles:['.NET Developer'],skills:['C#'],locations:['Bangalore'],experienceYears:4.2,minimumMatch:50,profileConfirmed:true});
    const context=await browser.newContext();
    await context.route('**/*',route=>{const url=route.request().url();if(url.includes('job-listings-external-111111111111'))return route.fulfill({contentType:'text/html',body:'<button>Apply on company site</button>'});if(url.includes('job-listings-naukri-222222222222'))return route.fulfill({contentType:'text/html',body:'<button onclick="document.body.innerHTML=\'Successfully applied\'">Apply</button>'});return route.fulfill({contentType:'text/html',body:'<div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-external-111111111111">External .NET Developer</a><span class="locWdth">Bangalore</span>C# <span>1 day ago</span></div><div class="srp-jobtuple-wrapper"><a class="title" href="https://www.naukri.com/job-listings-naukri-222222222222">Naukri .NET Developer</a><span class="locWdth">Bangalore</span>C# <span>1 day ago</span></div>'});});
    const page=await context.newPage();await page.goto('https://www.naukri.com/dot-net-developer-jobs');
    const runner=new Runner({store,launch:async()=>context,accountVerifier:async()=>({email:candidate.naukriEmail,at:new Date().toISOString()})});
    await runner.run(candidate.id,{source:'current',matchPolicy:'search',mode:'apply',maxJobs:2,pages:1});
    const byTitle=Object.fromEntries(runner.state.jobs.map(job=>[job.title,job.status]));
    assert.equal(byTitle['External .NET Developer'],'SKIPPED');assert.equal(byTitle['Naukri .NET Developer'],'APPLIED');assert.match(runner.state.message,/Finished. Scanned 2 jobs and processed 2 matches/);
  }finally{await browser.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
