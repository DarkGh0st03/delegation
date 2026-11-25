// One scripted (no-AI) console session, same input as reference s-935407ed1332.
import {writeFileSync} from "node:fs";
import {api,login,password} from "./console.mjs";
const label=process.argv[2]??"run", out=process.argv[3];
const REQ="Add a genre filter to the book list: users can filter books by genre in the API and in the UI, with tests.";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await login();
const t0=Date.now();
const created=await api("POST","/api/requests",{repository:"campus-library",requirement:REQ}).catch(async e=>{
  if(!/repository/i.test(e.message))throw e;
  return api("POST","/api/requests",{repository:"thesis/campus-library",requirement:REQ});
});
const requestId=created.request?.id??created.id;
const started=await api("POST",`/api/requests/${requestId}/planning`,{mode:"scripted"});
const sid=started.session?.id??started.id;
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
const ids=review.proposal.permissions.map(p=>p.id);
const tApprove=Date.now();
await api("POST",`/api/sessions/${sid}/approve`,{password:password(),permission_ids:ids});
const done=await wait(["completed"],30*60_000);
const tDone=Date.now();
const result={label,sid,phase:done.phase,error:done.error,permissions:ids.length,
  planning_ms:tPlanned-t0,execution_ms:tDone-tApprove,total_ms:tDone-t0,
  pull_request:done.pull_request,gateway_decisions:done.gateway_decisions,log:done.log};
writeFileSync(out,JSON.stringify(result,null,1));
console.log(JSON.stringify({label,sid,phase:done.phase,error:done.error,permissions:ids.length,
  planning_s:(tPlanned-t0)/1e3,execution_s:(tDone-tApprove)/1e3,decisions:done.gateway_decisions.length,
  pr:done.pull_request?.number}));
