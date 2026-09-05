import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CandidateStore } from '../src/candidates.js';
import { assertAccount } from '../src/account.js';
import { Runner } from '../src/runner.js';
import { createPortal } from '../src/portal-server.js';
const details=(profile,email)=>({...profile,naukriEmail:email,email,name:profile.name,roles:['Java Developer'],skills:['Java','Spring'],locations:['Hyderabad'],experienceYears:3,minimumMatch:50,profileConfirmed:true,answers:{},resumeSource:''});
async function workspace(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-isolation-'));try{const store=new CandidateStore(directory);await store.init();await fn(store,directory);}finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});}}
test('new candidates have independent IDs, empty details, resume and history',()=>workspace(async store=>{
  const a=await store.create('Candidate A'),b=await store.create('Candidate B');assert.notEqual(a.id,b.id);assert.deepEqual(b.skills,[]);assert.equal(b.naukriEmail,'');assert.equal(b.resumePath,'');assert.equal(b.profileConfirmed,false);
  const saved=await store.save(a.id,details(a,'a@example.test'));assert.equal(saved.revision,2);assert.deepEqual((await store.get(b.id)).skills,[]);
  await fs.writeFile(store.paths(a.id).history,JSON.stringify([{status:'APPLIED',url:'https://www.naukri.com/job-a'}]));assert.deepEqual(JSON.parse(await fs.readFile(store.paths(b.id).history)),[]);
  assert.notEqual(store.paths(a.id).browser,store.paths(b.id).browser);assert.notEqual(store.paths(a.id).artifacts,store.paths(b.id).artifacts);
}));
test('rejects duplicate accounts and stale edits but allows account correction with a new session generation',()=>workspace(async store=>{
  const a=await store.create('A'),b=await store.create('B'),saved=await store.save(a.id,details(a,'a@example.test'));
  await assert.rejects(store.save(b.id,details(b,'A@EXAMPLE.TEST')),/already belongs/);
  const corrected=await store.save(a.id,details(saved,'b@example.test'));assert.equal(corrected.naukriEmail,'b@example.test');assert.equal(corrected.accountVersion,saved.accountVersion+1);
  await assert.rejects(store.save(a.id,details(a,'a@example.test')),/changed in another tab/);
  await assert.rejects(store.save(a.id,{...saved,id:b.id}),/changed in another tab/);
  assert.throws(()=>store.paths('../candidate-b'),/Invalid/);
}));
test('resume copies are owned and integrity checked per candidate',()=>workspace(async(store,directory)=>{
  const source=path.join(directory,'resume.pdf');await fs.writeFile(source,'fixture resume A');
  const a=await store.create('A');const saved=await store.save(a.id,{...details(a,'a@example.test'),resumeSource:`"${source}"`});assert.equal(path.dirname(saved.resumePath),store.paths(a.id).directory);await store.verifyResume(saved);
  await fs.writeFile(source,'changed original');await store.verifyResume(saved);
  const b=await store.create('B');await assert.rejects(store.verifyResume({...saved,id:b.id}),/does not belong/);
  await fs.writeFile(saved.resumePath,'modified candidate copy');await assert.rejects(store.verifyResume(saved),/Resume changed|resume changed/);
}));
test('migration preserves legacy files but never imports the shared browser or history',()=>workspace(async(store,directory)=>{
  await fs.mkdir(path.join(directory,'data'));await fs.writeFile(path.join(directory,'data/candidate.json'),JSON.stringify({name:'Legacy',email:'legacy@example.test',skills:['C#'],minimumMatch:50,profileConfirmed:true}));
  await fs.writeFile(path.join(directory,'data/applications.json'),'[{"status":"APPLIED"}]');await store.init();await store.init();const candidates=await store.list();assert.equal(candidates.length,1);assert.equal(candidates[0].profileConfirmed,false);assert.deepEqual(JSON.parse(await fs.readFile(store.paths(candidates[0].id).history)),[]);assert.equal(await fs.readFile(path.join(directory,'data/applications.json'),'utf8'),'[{"status":"APPLIED"}]');
}));
test('account check fails closed for mismatch, missing and ambiguous identities',()=>{
  assert.equal(assertAccount(' A@example.test ',['a@example.test','A@example.test']),'a@example.test');
  for(const observed of [[],['b@example.test'],['a@example.test','b@example.test']])assert.throws(()=>assertAccount('a@example.test',observed),/could not be verified/);
});
test('all candidate fields can be edited without changing another candidate',()=>workspace(async store=>{
  const a=await store.create('Original'),b=await store.create('Unchanged');const original=await store.save(a.id,details(a,'original@example.test'));
  const updated=await store.save(a.id,{...original,name:'Updated name',naukriEmail:'updated@example.test',email:'contact@example.test',phone:'1234567890',roles:['Python Developer'],skills:['Python','Django'],locations:['Chennai'],experienceYears:4.5,skillExperienceYears:3.5,minimumMatch:40,noticePeriod:'15 days',currentCTC:'8 LPA',expectedCTC:'12 LPA',answers:{currentLocation:'Chennai',custom:{'Python experience':'3'}},profileConfirmed:true,resumeSource:''});
  assert.equal(updated.name,'Updated name');assert.equal(updated.naukriEmail,'updated@example.test');assert.deepEqual(updated.skills,['Python','Django']);assert.equal(updated.minimumMatch,40);assert.equal(updated.experienceYears,4.5);assert.equal(updated.skillExperienceYears,3.5);assert.equal(updated.answers.custom['Python experience'],'3');assert.equal((await store.get(b.id)).name,'Unchanged');assert.deepEqual((await store.get(b.id)).skills,[]);
}));
test('browser switching closes old context and uses the candidate’s own persistent path',()=>workspace(async store=>{
  const a=await store.create('A'),b=await store.create('B'),paths=[],closed=[];
  const runner=new Runner({store,launch:async location=>{paths.push(location);let onClose;return{setDefaultTimeout(){},on(event,callback){onClose=callback},async close(){closed.push(location);onClose?.();}};}});
  await runner.login(a);await runner.login(b);await runner.login(a);assert.deepEqual(paths,[store.paths(a.id).browser,store.paths(b.id).browser,store.paths(a.id).browser]);assert.equal(closed.length,2);
  runner.state={running:true,candidateId:a.id};await assert.rejects(runner.login(b),/Cannot switch/);assert.equal(paths.length,3);
}));
test('wrong account stops runner before job search or submission',()=>workspace(async store=>{
  const a=await store.create('A');await store.save(a.id,details(a,'a@example.test'));let newPages=0;
  const runner=new Runner({store,launch:async()=>({setDefaultTimeout(){},on(){},async cookies(){return[];},newPage(){newPages++;throw Error('Browser should not search');}}),accountVerifier:async()=>{assertAccount('a@example.test',['b@example.test']);}});
  await runner.run(a.id,{mode:'apply',maxJobs:1});assert.equal(runner.state.running,false);assert.match(runner.state.message,/could not be verified/);assert.equal(newPages,0);assert.deepEqual(JSON.parse(await fs.readFile(store.paths(a.id).history)),[]);
}));
test('API requires explicit candidate IDs and prevents edits or switching during active operations',()=>workspace(async store=>{
  const a=await store.create('A'),b=await store.create('B');const saved=await store.save(a.id,details(a,'a@example.test'));
  const fake={store,state:{running:false,jobs:[]},ownerId:null,verified:null,run(id){this.state={running:true,candidateId:id,jobs:[]};return Promise.resolve();},stop(){this.state.running=false;}};
  const {server}=await createPortal({runner:fake});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await post('/api/start',{mode:'apply'})).status,404);
    assert.equal((await post(`/api/candidates/${a.id}/run`,{mode:'apply',maxJobs:1,revision:saved.revision})).status,202);
    assert.equal((await post(`/api/candidates/${b.id}/login`,{})).status,409);
    assert.equal((await post(`/api/candidates/${a.id}/profile`,saved)).status,409);
    assert.equal((await post(`/api/candidates/${b.id}/stop`,{})).status,409);
    assert.equal((await post(`/api/candidates/${a.id}/stop`,{})).status,200);
    assert.equal((await fetch(base+'/api/candidates',{headers:{Origin:'https://other.test'}})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));
