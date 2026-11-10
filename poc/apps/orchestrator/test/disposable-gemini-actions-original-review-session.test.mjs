/**
 * No Google/ADK inference, no Rust Root and no private Engineer key.
 * Only the ORIGINAL host lifecycle's liveness and cleanup are simulated.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {runOneOriginalReviewHostWithWatch,
 startDisposableActionsOriginalReviewSession}
 from "../src/disposable-gemini-actions-original-review-session.mjs";

const DENY=/Disposable Actions original reviewed session NO-GO/u;
const AUTH=Object.freeze({checkpoint:"synthetic-original"});
const noop=()=>{throw Error("No live provider allowed");};
function fixture({
 waitForStartup=false,failAt="",closeFails=false
}={}){
 const calls=[],state={status:"active",stopped:false},pending={};
 let revokes=0,starts=0,execution=0,readiness=0;
 const resolved=()=>Object.freeze({
  close:async()=>{
   revokes++;
   calls.push("original.close");
   if(closeFails)throw Error("original Root retirement unconfirmed");
  },
  phase:"planning",
  engineerUrl:"http://127.0.0.1:1234",
  createReviewedCanonicalHandoff({provision}){
   calls.push("original.handoff");
   assert.equal(typeof provision,"function");
   if(failAt==="handoff")throw Error("original handoff rejected");
   return {
    close:async()=>{revokes++;calls.push("original.handoff.close");
     if(closeFails)throw Error("original Root retirement unconfirmed");
    },
    reviewReadiness:async()=>{readiness++;
     calls.push("original.review");
     return Object.freeze({status:"original_signed_review_verified_by_host"});
    },
    runApprovedCanonical:async()=>{execution++;
     calls.push("original.run");
     if(failAt==="run")throw Error("original native run rejected");
     return Object.freeze({status:"original_execution_pass"});
    }
   };
  }
 });
 const watchFactory=onClose=>{
  return {
   get status(){return state.status;},
   async start(){
    calls.push("watch.start");
    if(failAt==="watch.start"){
     state.status="closing";
     await onClose();
     state.status="closed";
     throw Error("GitHub admission denied");
    }
   },
   async checkNow(){
    calls.push("watch.check");
    if(state.status!=="active")throw Error("watch no longer active");
   },
   async close(){
    if(state.stopped)return;
    state.stopped=true;
    state.status="closing";
    try{await onClose();state.status="closed";}
    catch(error){state.status="revocation_unconfirmed";throw error;}
   }
  };
 };
 const startOriginalHost=async authority=>{
  starts++;
  calls.push("original.start");
  assert.equal(authority,AUTH);
  if(failAt==="start")throw Error("original startup failed");
  if(waitForStartup)return new Promise(resolve=>{pending.resolve=resolve;});
  return resolved();
 };
 return {
  options:{watchFactory,startOriginalHost,authority:AUTH,
   provision:noop},
  calls,release:()=>pending.resolve(resolved()),
  hasPending:()=>typeof pending.resolve==="function",
  closeCount:()=>revokes,starts:()=>starts,
  readiness:()=>readiness,executions:()=>execution,
  state
 };
}
test("no automatic signed approval, Root or execution at original startup",async()=>{
 const f=fixture(),s=await runOneOriginalReviewHostWithWatch(f.options);
 assert.equal(s.status,
  "actions_original_planning_awaiting_original_signed_engineer_review");
 assert.equal(s.phase,"planning");
 assert.equal(s.engineerUrl,"http://127.0.0.1:1234");
 assert.equal(f.starts(),1);
 assert.equal(f.readiness(),0);
 assert.equal(f.executions(),0);
 assert.equal(f.closeCount(),0);
 assert.deepEqual(f.calls.slice(0,5),[
  "watch.start","watch.check","original.start","watch.check",
  "original.handoff"
 ]);
 assert.deepEqual(await s.reviewReadiness(),
  {status:"original_signed_review_verified_by_host"});
 assert.equal(f.readiness(),1);
 assert.equal(f.executions(),0);
 assert.deepEqual(await s.runApprovedCanonical(),
  {status:"original_execution_pass"});
 assert.equal(f.executions(),1);
 await assert.rejects(s.runApprovedCanonical(),DENY);
 await s.close();
 assert.equal(f.closeCount(),1);
 assert.equal(f.state.status,"closed");
});

test("completed original Github job aborts before starting any Host",async()=>{
 const f=fixture();
 f.state.status="closed";
 await assert.rejects(runOneOriginalReviewHostWithWatch(f.options));
 assert.equal(f.starts(),0);
 assert.equal(f.closeCount(),0);
});

test("failure at handoff closes only the ORIGINAL already started Host",async()=>{
 const f=fixture({failAt:"handoff"});
 await assert.rejects(runOneOriginalReviewHostWithWatch(f.options),
  /original handoff rejected/u);
 assert.equal(f.starts(),1);
 assert.equal(f.closeCount(),1);
 assert.deepEqual(f.calls.filter(x=>x==="original.close"),
  ["original.close"]);
});

test("failure after Root admission retires original handoff; never retries",async()=>{
 const f=fixture({failAt:"run"});
 const s=await runOneOriginalReviewHostWithWatch(f.options);
 await assert.rejects(s.runApprovedCanonical(),/original native run rejected/u);
 assert.equal(f.executions(),1);
 assert.equal(f.closeCount(),1);
 assert.ok(f.calls.includes("original.handoff.close"));
 assert.equal(f.state.status,"closed");
 await assert.rejects(s.runApprovedCanonical(),DENY);
});

test("unconfirmed original retirement is terminal rather than successful",async()=>{
 const f=fixture({failAt:"handoff",closeFails:true});
 await assert.rejects(runOneOriginalReviewHostWithWatch(f.options),
  /original Root retirement unconfirmed/u);
 assert.equal(f.closeCount(),1);
 assert.equal(f.state.status,"revocation_unconfirmed");
});

test("cancel during original startup closes exactly the resolved Host",async()=>{
 const f=fixture({waitForStartup:true});
 const start=runOneOriginalReviewHostWithWatch(f.options);
 for(let i=0;i<100&&!f.hasPending();i++)await Promise.resolve();
 assert.equal(f.hasPending(),true);
 // The watcher can mark cancellation synchronously while the original
 // Host is still starting. Its close awaits startup and then retires it.
 f.state.status="closed";
 f.release();
 await assert.rejects(start);
 assert.equal(f.starts(),1);
 assert.equal(f.closeCount(),1);
 assert.deepEqual(f.calls.filter(x=>x==="original.close"),
  ["original.close"]);
});

test("public Actions entrypoint is NO-GO without explicit billing approval",async()=>{
 await assert.rejects(startDisposableActionsOriginalReviewSession(),
  DENY);
 await assert.rejects(startDisposableActionsOriginalReviewSession({
  operatorChargeAuthorization:"I AUTHORIZE GEMINI API CHARGES",
  operatorSpendCapAcknowledgement:"I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  prepared:{status:"unissued"}
 }),DENY);
});
