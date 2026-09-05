// Isolated local UI test workspace; never uses real candidate files or accounts.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root } from '../src/runner.js';
import { CandidateStore } from '../src/candidates.js';
import { createPortal } from '../src/portal-server.js';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sktech-ui-fixture-'));
await fs.cp(path.join(root,'frontend'),path.join(directory,'frontend'),{recursive:true});
const store=new CandidateStore(directory);await store.init();
for(const [name,email,role,skills,location,experience] of [['Test Java Candidate','java@example.test','Java Developer',['Java','Spring Boot'],'Hyderabad',3],['Test Python Candidate','python@example.test','Python Developer',['Python','Django'],'Pune',5]]){
  const candidate=await store.create(name);await store.save(candidate.id,{...candidate,naukriEmail:email,email,roles:[role],skills,locations:[location],experienceYears:experience,profileConfirmed:true});
}
const fake={store,state:{running:false,jobs:[],message:'Isolated UI test workspace'},ownerId:null,verified:null,async openLogin(){throw new Error('Login disabled in UI test workspace');},async verify(){throw new Error('Verification disabled in UI test workspace');},run(){throw new Error('Applications disabled in UI test workspace');},stop(){}};
const {server}=await createPortal({projectRoot:directory,runner:fake});server.listen(8790,'127.0.0.1',()=>console.log('Isolated UI fixtures: http://127.0.0.1:8790'));
async function close(){server.close();if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected test path');await fs.rm(directory,{recursive:true,force:true});}
process.on('SIGINT',close);process.on('SIGTERM',close);
