// Phase W4: one scripted (no-AI) console session. Derived from the Phase R driver.
// APPROVE=creates approves only create_file plus the repository/branch permissions.
import {writeFileSync} from "node:fs";
import {api,login,password} from "./console.mjs";
const label=process.argv[2]??"run", out=process.argv[3];
const REPO=process.argv[4]??"campus-library";
const REQ=process.argv[5]??"Add a genre filter to the book list: users can filter books by genre in the API and in the UI, with tests.";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await login();
let t0=Date.now();
const created=await api("POST","/api/requests",{repository:REPO,requirement:REQ}).catch(async e=>{
  if(!/repository/i.test(e.message))throw e;
  return api("POST","/api/requests",{repository:"thesis/"+REPO,requirement:REQ});
});
const requestId=created.request?.id??created.id;
// Wait (up to 10 min) for the Engineer Rust core and Gateway verifier after a restart.
let started;
for(let i=0;;i++){
  try{started=await api("POST",`/api/requests/${requestId}/planning`,{mode:"scripted"});break;}
  catch(e){if(!/409/.test(e.message)||!/pronti/.test(e.message)||i>300)throw e;await sleep(2000);}
}
const sid=started.session?.id??started.id;
t0=Date.now();
const wait=async(phases,limitMs)=>{
  const end=Date.now()+limitMs;
  for(;;){
    const {session}=await api("GET",`/api/sessions/${sid}`);
    if(phases.includes(session.phase))return session;
    if(["failed","rejected","stopped"].includes(session.phase))return session;
    if(Date.now()>end)throw Error("timeout in phase "+session.phase);
    await sleep(1000);
  }
};
const review=await wait(["awaiting_review"],10*60_000);
const tPlanned=Date.now();
if(review.phase!=="awaiting_review"){writeFileSync(out,JSON.stringify({label,sid,review},null,1));throw Error("planning ended "+review.phase);}
const ids=review.proposal.permissions
  .filter(p=>process.env.APPROVE!=="creates"||!["read_file","update_file"].includes(p.operation))
  .map(p=>p.id);
const tApprove=Date.now();
await api("POST",`/api/sessions/${sid}/approve`,{password:password(),permission_ids:ids});
const done=await wait(["completed"],30*60_000);
const tDone=Date.now();
const result={label,sid,phase:done.phase,error:done.error,permissions:ids.length,
  planning_ms:tPlanned-t0,execution_ms:tDone-tApprove,total_ms:tDone-t0,
  pull_request:done.pull_request,gateway_decisions:done.gateway_decisions,log:done.log,
  w4_probe:done.w4_probe??null,base_sha:done.base_sha,work_branch:done.work_branch};
writeFileSync(out,JSON.stringify(result,null,1));
console.log(JSON.stringify({label,sid,phase:done.phase,error:done.error,permissions:ids.length,
  planning_s:(tPlanned-t0)/1e3,execution_s:(tDone-tApprove)/1e3,decisions:done.gateway_decisions.length,
  pr:done.pull_request?.number}));
