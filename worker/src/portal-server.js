import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Runner, root } from './runner.js';
import { CandidateStore } from './candidates.js';
import { loadHistory } from './history.js';
import { validateCandidate } from './matcher.js';

export async function createPortal({ projectRoot = root, runner: suppliedRunner } = {}) {
  const store = suppliedRunner?.store || new CandidateStore(projectRoot);
  await store.init();
  const runner = suppliedRunner || new Runner({ store });
  let busy = null;
  const server = http.createServer(async (req, res) => {
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: 'Use the SK Tech dashboard on this PC.' });
      const url = new URL(req.url, origin);
      const match = url.pathname.match(/^\/api\/candidates\/([^/]+)(?:\/(profile|login|verify|run|stop|history))?$/);
      if (req.method === 'GET') {
        const assets = { '/': ['portal.html','text/html; charset=utf-8'], '/portal.js': ['portal.js','text/javascript; charset=utf-8'], '/portal.css': ['portal.css','text/css; charset=utf-8'] };
        if (assets[url.pathname]) { const [file,type] = assets[url.pathname]; return send(200, await fs.readFile(path.join(projectRoot,'frontend',file)),type); }
        if (url.pathname === '/api/state') return send(200, { ...runner.state, busy, sessionCandidateId: runner.ownerId, verified: runner.verified });
        if (url.pathname === '/api/candidates') return send(200, (await store.list()).map(({id,name,roles,skills,profileConfirmed,naukriEmail,revision}) => ({id,name,roles,skills,profileConfirmed,naukriEmail,revision})));
        if (match) {
          const [,id,action] = match;
          if (!action) return send(200, await store.get(id));
          if (action === 'history') { await store.get(id); return send(200, await loadHistory(store.paths(id).history)); }
        }
        return send(404, { error: 'Not found. Refresh to load the current dashboard.' });
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Use the local dashboard.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 64000) return send(413, { error: 'Profile is too large.' }); }
      const body = JSON.parse(raw || '{}');
      if (match?.[2] === 'stop') {
        if (runner.state.candidateId !== match[1]) return send(409, { error: 'This run belongs to another candidate.' });
        runner.stop(); return send(200, { stopped: true });
      }
      if (busy || runner.state.running) return send(409, { error: 'A candidate operation is active. Wait or stop the current run before making changes.' });
      busy = { candidateId: match?.[1] || null, action: match?.[2] || 'create' };
      try {
        if (url.pathname === '/api/candidates') return send(201, await store.create(body.name));
        if (!match) return send(404, { error: 'Unknown operation.' });
        const [,id,action] = match;
        const candidate = await store.get(id);
        if (action === 'profile') {
          const saved = await store.save(id,body);
          if(runner.verified?.candidateId===id) runner.verified=null;
          if(candidate.naukriEmail !== saved.naukriEmail && runner.ownerId===id && runner.context) await runner.context.close();
          return send(200,saved);
        }
        if (action === 'login') { await runner.openLogin(id); return send(200,{opened:true}); }
        if (action === 'verify') return send(200,await runner.verify(id));
        if (action === 'run') {
          if (body.revision !== candidate.revision) return send(409,{error:'Profile changed. Reload and review it before starting.'});
          validateCandidate(candidate);
          if (!candidate.profileConfirmed) throw new Error('Review and confirm the candidate details before running.');
          if (!['preview','apply'].includes(body.mode) || !Number.isInteger(body.maxJobs) || body.maxJobs<1 || body.maxJobs>100) throw new Error('Choose preview or apply and 1–100 jobs.');
          const pages = body.mode === 'preview' ? body.pages : 2;
          if (!Number.isInteger(pages) || pages<1 || pages>10) throw new Error('Choose 1–10 pages for preview.');
          const source=body.source||'profile',matchPolicy=body.matchPolicy||'profile';
          if(!['profile','current'].includes(source)||!['profile','search'].includes(matchPolicy)||(matchPolicy==='search'&&source!=='current'))throw new Error('Apply search jobs requires an open Naukri search.');
          runner.completion = runner.run(id,{mode:body.mode,maxJobs:body.maxJobs,pages,source,matchPolicy}).catch(error=>{runner.state.message=error.message;});
          return send(202,{started:true,candidateId:id});
        }
        return send(404,{error:'Unknown operation.'});
      } finally { busy=null; }
    } catch(error) { send(error.code==='ENOENT'?404:400,{error:error.message}); }
  });
  return { server, store, runner };
}

export async function startPortal() {
  const lockFile = path.join(root,'private','.sktech-worker.lock');
  await fs.mkdir(path.dirname(lockFile),{recursive:true});
  async function acquire() {
    try { await fs.writeFile(lockFile,String(process.pid),{flag:'wx'}); }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const pid=Number(await fs.readFile(lockFile,'utf8'));
      if(!Number.isInteger(pid)||pid<=0)throw new Error('Worker lock needs manual review.');
      try { process.kill(pid,0); throw new Error('Another SK Tech candidate worker is already running.'); }
      catch(check) { if(check.code!=='ESRCH')throw check; }
      await fs.unlink(lockFile); await fs.writeFile(lockFile,String(process.pid),{flag:'wx'});
    }
  }
  await acquire();
  const {server,runner}=await createPortal();
  const release=async()=>{if(await fs.readFile(lockFile,'utf8').catch(()=>null)===String(process.pid))await fs.unlink(lockFile);};
  server.on('error',async error=>{console.error(error.message);await release();process.exitCode=1;});
  const port=Number(process.env.PORT||8788);
  server.listen(port,'127.0.0.1',()=>console.log(`SK Tech Candidate Workspace: http://127.0.0.1:${port}`));
  let closing=false;
  async function shutdown(){if(closing)return;closing=true;runner.stop();const closed=new Promise(resolve=>server.close(resolve));await runner.context?.close();await runner.completion;await closed;await release();}
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startPortal();
