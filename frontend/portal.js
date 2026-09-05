const $ = id => document.getElementById(id);
const scalarFields = ['name','email','naukriEmail','phone','experienceYears','skillExperienceYears','minimumMatch','freshnessDays','noticePeriod','currentCTC','expectedCTC','resumeSource'];
let candidates = [], selected = null, dirty = false, working = false, state = {}, history = [], lastHistoryKey = '', selectedView = 'profile';
const initials = name => String(name || '?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const reviewStatuses = new Set(['NEEDS_REVIEW','MANUAL_REQUIRED','SUBMISSION_UNCONFIRMED','SUBMITTING','ERROR','STOPPED']);
async function api(route, body) {
  const response = await fetch('/api/' + route, body === undefined ? {} : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
  const data = await response.json(); if(!response.ok)throw Error(data.error || 'Request failed.'); return data;
}
function toast(text, error=false) { $('toast').textContent=text;$('toast').classList.toggle('error',error);$('toast').hidden=false; }
function locked() { return working || !!state.running || !!state.busy; }
function updateLocks() {
  const lock=locked();
  $('profileFields').disabled=lock||!selected;
  $('addCandidate').disabled=lock;$('addFirst').disabled=lock;
  for(const b of $('candidateList').querySelectorAll('button')) b.disabled=lock;
  for(const id of ['login','verify','preview','apply','applySearch']) $(id).disabled=lock||!selected||dirty;
  $('verify').disabled ||= !selected?.naukriEmail;
  $('apply').disabled ||= !selected?.profileConfirmed;
  $('applySearch').disabled ||= !selected?.profileConfirmed;
  $('preview').disabled ||= !selected?.profileConfirmed;
  $('stop').hidden=!(state.running&&state.candidateId===selected?.id);
  $('unsaved').hidden=!dirty;$('discard').hidden=!dirty;
  $('activeRun').hidden=!(state.running||state.busy);
  if(state.running||state.busy){const id=state.candidateId||state.busy?.candidateId;const person=candidates.find(x=>x.id===id);$('activeRunText').textContent=`${person?.name||'Candidate operation'} · ${state.running?state.message:'Operation in progress'} · candidate switching is locked`;}
}
function renderCandidates() {
  $('candidateCount').textContent=candidates.length;$('candidateList').replaceChildren();
  const term=$('candidateSearch').value.trim().toLowerCase();
  for(const c of candidates.filter(c=>`${c.name} ${c.roles.join(' ')} ${c.skills.join(' ')}`.toLowerCase().includes(term))){
    const button=document.createElement('button');button.type='button';button.className='candidate-item';button.classList.toggle('active',selected?.id===c.id);button.setAttribute('aria-pressed',String(selected?.id===c.id));button.dataset.candidateId=c.id;
    const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=initials(c.name);
    const text=document.createElement('span'),name=document.createElement('strong'),role=document.createElement('small');name.textContent=c.name;role.textContent=c.roles[0]||'New candidate';text.append(name,role);button.append(avatar,text);
    button.onclick=()=>action(()=>selectCandidate(c.id));$('candidateList').append(button);
  }
  updateLocks();
}
function renderProfile() {
  for(const key of scalarFields)$(key).value=selected[key]??'';
  for(const key of ['roles','skills','locations'])$(key).value=(selected[key]||[]).join(', ');
  $('answers').value=JSON.stringify(selected.answers||{},null,2);
  $('profileConfirmed').checked=selected.profileConfirmed===true;
  $('naukriEmail').readOnly=false;
  $('candidateName').textContent=selected.name;$('runCandidateName').textContent=selected.name;
  $('candidateAvatar').textContent=initials(selected.name);$('runAvatar').textContent=initials(selected.name);
  $('runEmail').textContent=selected.naukriEmail||'Naukri account not added';
  $('candidateSummary').replaceChildren();
  for(const value of [selected.roles[0]||'Add target roles', selected.experienceYears==null?'Add experience':`${selected.experienceYears} years`,`${selected.minimumMatch}% minimum match`, `Last ${selected.freshnessDays ?? 15} days`]){const tag=document.createElement('span');tag.className='tag';tag.textContent=value;$('candidateSummary').append(tag);}
  $('profileBadge').textContent=selected.profileConfirmed?'Profile reviewed':'Needs profile review';$('profileBadge').className=`badge ${selected.profileConfirmed?'success':'warning'}`;
  $('savedAt').textContent=`Saved ${new Date(selected.updatedAt).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`;
  $('resumeStatus').textContent=selected.resumePath?'✓ Separate resume copy saved for this candidate.':selected.resumeSource?'Save this profile to create its own resume copy.':'No local resume copy. Naukri’s attached resume may be used.';
  dirty=false;renderSession();updateLocks();
}
async function selectCandidate(id) {
  if(dirty)throw Error('Save or discard your changes before selecting another candidate.');
  const profile=await api(`candidates/${id}`);
  // Both profile and history must load before showing a different candidate.
  const records=await api(`candidates/${id}/history`);
  selected=profile;history=records;lastHistoryKey='';sessionStorage.setItem('sktechCandidateId',id);
  $('emptyState').hidden=true;$('candidateWorkspace').hidden=false;
  renderProfile();renderCandidates();renderHistory();showView('profile');
}
function showView(view) {
  selectedView=view;
  for(const value of ['profile','applications']){$(value+'Panel').hidden=view!==value;$(value+'Tab').setAttribute('aria-selected',String(view===value));}
}
function renderSession() {
  const verified=state.verified?.candidateId===selected?.id&&state.sessionCandidateId===selected?.id;
  $('sessionBadge').textContent=verified?'Email matched':'Not verified';$('sessionBadge').className=`badge ${verified?'success':'neutral'}`;
  $('sessionDescription').textContent=verified?`Matched ${state.verified.email}. The account is checked again before applications.`:'Open this candidate’s separate browser and sign in, then verify the account.';
  $('runMessage').textContent=state.candidateId===selected?.id?state.message:'Save this candidate’s profile, open their login, and verify the account.';
}
function statusLabel(status){return {APPLIED:'Applied',ALREADY_APPLIED:'Already applied',DRY_RUN_MATCH:'Preview match',NEEDS_REVIEW:'Needs review',MANUAL_REQUIRED:'Manual action',SUBMISSION_UNCONFIRMED:'Check submission',SUBMITTING:'Check submission',SKIPPED:'Skipped',ERROR:'Error',STOPPED:'Stopped'}[status]||status;}
function renderHistory() {
  const current=state.candidateId===selected?.id?state.jobs||[]:[];
  // Persisted results take precedence; skipped results exist only in the current run.
  const recorded=new Set(history.map(j=>`${j.url}:${j.at}`));
  const records=[...history,...current.filter(j=>!recorded.has(`${j.url}:${j.at}`))].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  $('metricTotal').textContent=records.length;$('metricMatches').textContent=records.filter(j=>j.status==='DRY_RUN_MATCH').length;$('metricApplied').textContent=records.filter(j=>['APPLIED','ALREADY_APPLIED'].includes(j.status)).length;$('metricReview').textContent=records.filter(j=>reviewStatuses.has(j.status)).length;$('historyCount').textContent=records.length;
  const filter=$('historyFilter').value;
  const filtered=records.filter(j=>filter==='all'||filter==='applied'&&['APPLIED','ALREADY_APPLIED'].includes(j.status)||filter==='preview'&&j.status==='DRY_RUN_MATCH'||filter==='review'&&reviewStatuses.has(j.status)||filter==='skipped'&&j.status==='SKIPPED');
  $('historyRows').replaceChildren();$('historyEmpty').hidden=filtered.length>0;$('historyTable').hidden=!filtered.length;
  for(const j of filtered){
    const tr=document.createElement('tr'),job=document.createElement('td'),score=document.createElement('td'),status=document.createElement('td');
    const title=document.createElement('a');title.textContent=j.title;try{const u=new URL(j.url);if(u.protocol==='https:'&&/(^|\.)naukri\.com$/.test(u.hostname)){title.href=u.href;title.target='_blank';title.rel='noopener noreferrer';}}catch{}
    const detail=document.createElement('small');detail.textContent=[j.location,j.postedText,j.reason].filter(Boolean).join(' · ');job.append(title,detail);
    score.textContent=`${j.score??0}%`;const badge=document.createElement('span');badge.className=`badge ${['APPLIED','ALREADY_APPLIED'].includes(j.status)?'success':reviewStatuses.has(j.status)?'warning':'neutral'}`;badge.textContent=statusLabel(j.status);status.append(badge);tr.append(job,score,status);$('historyRows').append(tr);
  }
}
async function refreshHistory(){if(!selected)return;const id=selected.id;const records=await api(`candidates/${id}/history`);if(selected?.id===id){history=records;renderHistory();}}
async function action(fn) {
  if(working)return;
  working=true;updateLocks();
  try{await fn();}catch(error){toast(error.message,true);}finally{working=false;updateLocks();}
}
function readProfile() {
  const p={id:selected.id,revision:selected.revision};
  for(const key of scalarFields)p[key]=['experienceYears','skillExperienceYears','minimumMatch','freshnessDays'].includes(key)?Number($(key).value):$(key).value.trim();
  for(const key of ['roles','skills','locations'])p[key]=$(key).value.split(',').map(x=>x.trim()).filter(Boolean);
  p.answers=JSON.parse($('answers').value||'{}');p.profileConfirmed=$('profileConfirmed').checked;return p;
}
function openNew(){if(locked())return;if(dirty){toast('Save or discard your current changes before adding a candidate.',true);return;}$('newCandidateName').value='';$('newCandidateDialog').showModal();$('newCandidateName').focus();}
$('addCandidate').onclick=openNew;$('addFirst').onclick=openNew;$('cancelNew').onclick=()=>$('newCandidateDialog').close();
$('newCandidateForm').onsubmit=event=>{event.preventDefault();action(async()=>{const added=await api('candidates',{name:$('newCandidateName').value});candidates=await api('candidates');$('newCandidateDialog').close();await selectCandidate(added.id);toast('New candidate created with a separate, empty workspace.');});};
$('candidateSearch').oninput=renderCandidates;
$('profileForm').oninput=event=>{dirty=true;if(event.target.id!=='profileConfirmed')$('profileConfirmed').checked=false;updateLocks();};
$('profileForm').onsubmit=event=>{event.preventDefault();if(!$('profileForm').reportValidity())return;action(async()=>{selected=await api(`candidates/${selected.id}/profile`,readProfile());candidates=await api('candidates');state.verified=null;renderProfile();renderCandidates();toast('Candidate profile saved. Details are kept separate from other candidates.');});};
$('discard').onclick=()=>action(async()=>{dirty=false;await selectCandidate(selected.id);toast('Saved profile restored.');});
$('profileTab').onclick=()=>showView('profile');$('applicationsTab').onclick=()=>showView('applications');
$('historyFilter').onchange=renderHistory;$('refreshHistory').onclick=()=>action(refreshHistory);
$('login').onclick=()=>action(async()=>{await api(`candidates/${selected.id}/login`,{});toast(`Naukri opened for ${selected.name}. Sign in with their registered email.`);await poll();});
$('verify').onclick=()=>action(async()=>{await api(`candidates/${selected.id}/verify`,{});toast('Naukri account email matches this candidate.');await poll();});
for(const mode of ['preview','apply'])$(mode).onclick=()=>action(async()=>{
  if(dirty)throw Error('Save and review your profile changes first.');
  await api(`candidates/${selected.id}/run`,{mode,maxJobs:Number($('maxJobs').value),revision:selected.revision});
  showView('applications');toast(mode==='apply'?`Auto Apply started for ${selected.name}.`:`Preview started for ${selected.name}.`);await poll();
});
$('stop').onclick=async()=>{try{await api(`candidates/${selected.id}/stop`,{});await poll();}catch(error){toast(error.message,true);}};
$('applySearch').onclick=()=>action(async()=>{
  if(dirty)throw Error('Save and review your profile changes first.');
  await api(`candidates/${selected.id}/run`,{mode:'apply',source:'current',matchPolicy:'search',maxJobs:Number($('maxJobs').value),revision:selected.revision});
  showView('applications');toast(`Applying the open Naukri search for ${selected.name}.`);await poll();
});
let polling=false;
async function poll(){
  if(polling)return;polling=true;
  try{state=await api('state');$('connection').lastChild.textContent=' Local workspace';if($('toast').textContent==='The local worker is offline. Restart SK Tech to continue.')$('toast').hidden=true;renderSession();updateLocks();
    const key=`${selected?.id}:${state.candidateId}:${state.running}:${state.jobs?.length}:${state.message}`;
    if(selected&&key!==lastHistoryKey){lastHistoryKey=key;await refreshHistory();}
  }finally{polling=false;}
}
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
action(async()=>{candidates=await api('candidates');state=await api('state');renderCandidates();const remembered=sessionStorage.getItem('sktechCandidateId');const id=candidates.find(x=>x.id===remembered)?.id||candidates[0]?.id;if(id)await selectCandidate(id);else{$('emptyState').hidden=false;$('candidateWorkspace').hidden=true;}await poll();});
setInterval(()=>poll().catch(()=>{$('connection').lastChild.textContent=' Disconnected';toast('The local worker is offline. Restart SK Tech to continue.',true);}),2000);
