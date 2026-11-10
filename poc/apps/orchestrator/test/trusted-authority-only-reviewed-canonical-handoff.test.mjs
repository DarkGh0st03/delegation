import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedAuthorityOnlyReviewedCanonicalHandoff}
 from "../src/trusted-authority-only-reviewed-canonical-handoff.mjs";

const sha="a".repeat(40),digest="b".repeat(64);
const sessionId="r3825-approved-original-planning";
const engineerDid="did:ethr:0x7a69:0x"+"1".repeat(40);
function proof(){return {
 status:"signed_human_review_verified_only_not_oidc_admitted",
 session_id:sessionId,base_revision:sha,plan_digest:digest,
 authenticated_engineer_did:engineerDid,
 operational_root_issued:false,dag_executed:false,
 source_sha_verified_here:false
};}
const root=()=>({
 credential_id:"urn:r3825:approved-root",
 valid_from:new Date().toISOString(),
 validity_seconds:600,
 credential_status:{statusPurpose:"revocation",statusListIndex:"7"}
});
function dependencies(){
 return {
  operationalSessionStore:{original:true},gatewayTaskJournal:{},
  issuerChildJournal:{},gatewayChildJournal:{},
  nativeCryptoPort:{issueChildViaPrivateMcp:async()=>({})},
  effectFenceJournal:{},sequentialEffectJournal:{},
  completionObserver:{}
 };
}
function workflow(){
 return {createBranch:{model:{},branch:"feature/account-suspension",
  baseBranch:"main",permission:{operation:"create_branch",resource:"gitea://r3825"},
  prepare:async()=>{},execute:async()=>{}},
  sdk:{agentBaseUrls:{},stageChannels:{},agentBindingChannels:{}},
  adaptive:{model:{},nextChildParameters:()=>({})}
 };
}
function fixture(t,opts={}){
 const keys=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP"];
 const previous=new Map(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{
  for(const [k,v] of previous){
   if(v===undefined)delete process.env[k]; else process.env[k]=v;
  }
 });
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 const events=[];let phase="planning";let signed=true;
 const gateway={};
 const effects={};
 const host={
  readOnlySessionId:sessionId,
  get phase(){return phase;},
  async activateOperational(r){
   events.push("root");
   assert.equal(r.credential_id,"urn:r3825:approved-root");
   phase="operational";
   return {activation:{status:"original_root_live"}};
  },
  async admitOperationalExecution(deps){
   events.push("admission");
   assert.equal(phase,"operational");
   assert.equal(deps.privateChildMcpTransport,"native-stdio");
   assert.equal(typeof deps.nativeCryptoPort.issueChildViaPrivateMcp,"function");
   return {gateway,bindNativeGatewayEffects(input){
    assert.equal(input,effects);
    events.push("bind");
    if(opts.failBinding)throw Error("foreign native Gateway effects");
   },runCanonicalOperationalWorkflow:async input=>{
    events.push("canonical");
    assert.ok(input.createBranch,"original Branch is mandatory");
    if(opts.failCanonical)throw Error("original Gateway provider failed");
    return {status:"owner_operational_draft_pr_independently_attested",
     pr_created:true,pull_request_number:1};
   }};
  },
  async close(){
   events.push("retire");
   phase="revoked";
   if(opts.failRetire)throw Error("original native revocation unconfirmed");
  }
 };
 let provisions=0,reviews=0;
 const handoff=createTrustedAuthorityOnlyReviewedCanonicalHandoff({
  reviewHost:host,sessionId,baseRevision:sha,planDigest:digest,engineerDid,
  readSignedReview:async()=>{
   reviews++;
   if(opts.pendingReview)return opts.pendingReview.promise;
   if(!signed)throw Error("No signed Engineer review on disk");
   return opts.proofOverride??proof();
  },
  provision:async()=>{
   provisions++;
   return opts.provisionOverride??{
    root:root(),dependencies:dependencies(),workflow:opts.localWorkers?
     {createBranch:workflow().createBranch,adaptive:workflow().adaptive}:workflow(),
    ...(opts.localWorkers?{async startLocalWorkers(){
     events.push("start-workers");
     return {sdk:workflow().sdk,async close(){events.push("close-workers");}};
    }}:{}),
    async prepareNativeEffects(admitted){
     assert.equal(admitted,gateway);
     events.push("prepare-effects");
     return effects;
    },
    ...(opts.installAuthorization?{async installNativeAuthorization(){
     events.push("install");
     if(opts.failInstall)throw Error("native authorization install failed");
    }}:{})
   };
  }
 });
 return {handoff,events,host,setSigned:v=>{signed=v;},
  get reviews(){return reviews;},get provisions(){return provisions;}};
}
function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b;});
 return {promise,resolve,reject};
}

test("R382.5 original Engineer review -> one Root -> native MCP admission -> canonical Branch/Executor",async t=>{
 const f=fixture(t);
 assert.equal(f.handoff.status,"awaiting_human_review");
 const ready=await f.handoff.reviewReadiness();
 assert.equal(ready.plan_digest,digest);
 assert.equal(ready.operational_root_issued,false);
 assert.equal(f.provisions,0);
 assert.deepEqual(f.events,[]);
 const result=await f.handoff.runApprovedCanonical();
 assert.equal(result.pr_created,true);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","canonical"]);
 assert.equal(f.provisions,1);
 assert.equal(f.handoff.status,"canonical_execution_selected");
 assert.throws(()=>f.handoff.runApprovedCanonical(),/already attempted/u);
 await f.handoff.close();await f.handoff.close();
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","canonical","retire"]);
});

test("R382.5 unsigned review is retryable before any Rust Root or Gitea effect",async t=>{
 const f=fixture(t);
 f.setSigned(false);
 await assert.rejects(f.handoff.runApprovedCanonical(),/No signed Engineer review on disk/u);
 assert.equal(f.provisions,0);
 assert.deepEqual(f.events,[]);
 f.setSigned(true);
 assert.equal((await f.handoff.runApprovedCanonical()).pr_created,true);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","canonical"]);
 await f.handoff.close();
});

test("R382.5 mismatched immutable Planning digest or Engineer DID denies before owner provision",async t=>{
 const f=fixture(t,{proofOverride:{...proof(),plan_digest:"0".repeat(64)}});
 await assert.rejects(f.handoff.runApprovedCanonical(),
  /Engineer-signed immutable Planning review mismatched/u);
 assert.equal(f.provisions,0);
 assert.deepEqual(f.events,[]);
 await f.handoff.close();
});

test("R382.5 malformed private native MCP port cannot activate Root",async t=>{
 const broken=dependencies();broken.nativeCryptoPort={issueChild:async()=>({})};
 const f=fixture(t,{provisionOverride:{root:root(),
  dependencies:broken,workflow:workflow(),prepareNativeEffects:async()=>({})}});
 await assert.rejects(f.handoff.runApprovedCanonical(),
  /original live Root, MCP native owner and Branch required/u);
 assert.equal(f.provisions,1);
 assert.deepEqual(f.events,["retire"]);
 assert.throws(()=>f.handoff.runApprovedCanonical(),/already attempted/u);
});

test("R382.5 native provider failure retires original Root once and never retries",async t=>{
 const f=fixture(t,{failCanonical:true});
 await assert.rejects(f.handoff.runApprovedCanonical(),
  /original Gateway provider failed/u);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","canonical","retire"]);
 assert.equal(f.provisions,1);
 assert.equal(f.handoff.status,"closing_or_closed");
 await f.handoff.close();
 assert.throws(()=>f.handoff.runApprovedCanonical(),/already attempted/u);
});

test("R382.5 uncertain original Root retirement cannot be reported as successful",async t=>{
 const f=fixture(t,{failCanonical:true,failRetire:true});
 await assert.rejects(f.handoff.runApprovedCanonical(),
  /original Root retirement unconfirmed after ambiguous execution/u);
 assert.equal(f.provisions,1);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","canonical","retire"]);
});

test("R382.5 shutdown racing signed review prevents later Root activation",async t=>{
 const pendingReview=deferred();
 const f=fixture(t,{pendingReview});
 const running=f.handoff.runApprovedCanonical();
 const closed=f.handoff.close();
 pendingReview.resolve(proof());
 await assert.rejects(running,/changed before activation/u);
 await closed;
 assert.equal(f.provisions,0);
 assert.deepEqual(f.events,["retire"]);
});

test("R382.5 refuses legacy/no-native host before reading any signature",t=>{
 const f=fixture(t);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="legacy-signed-dag";
 assert.throws(()=>f.handoff.runApprovedCanonical(),/already attempted/u);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="0";
 assert.throws(()=>f.handoff.runApprovedCanonical(),/already attempted/u);
});

test("R382.8 native Gateway binding failure prevents Branch and retires the original Host",async t=>{
 const f=fixture(t,{failBinding:true,installAuthorization:true});
 await assert.rejects(f.handoff.runApprovedCanonical(),/foreign native Gateway effects/u);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","retire"]);
});

test("native authorization is installed after binding and before the canonical workflow",async t=>{
 const f=fixture(t,{installAuthorization:true});
 await f.handoff.runApprovedCanonical();
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","install","canonical"]);
 await f.handoff.close();
});

test("native authorization installation failure retires the original Host before Branch",async t=>{
 const f=fixture(t,{installAuthorization:true,failInstall:true});
 await assert.rejects(f.handoff.runApprovedCanonical(),/native authorization install failed/u);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","install","retire"]);
});

test("local A2A workers start after Gateway binding and close on workflow failure",async t=>{
 const f=fixture(t,{localWorkers:true,installAuthorization:true,failCanonical:true});
 await assert.rejects(f.handoff.runApprovedCanonical(),/original Gateway provider failed/u);
 assert.deepEqual(f.events,["root","admission","prepare-effects","bind","install",
  "start-workers","canonical","close-workers","retire"]);
});

test("a workflow or A2A-supplied source gate cannot masquerade as the original consented Owner",async t=>{
 const forged=async()=>({status:"forged_success"});
 const f=fixture(t,{provisionOverride:{
  root:root(),dependencies:dependencies(),workflow:workflow(),
  prepareNativeEffects:async()=>({}),
  ownerSourceGate:forged
 }});
 await assert.rejects(f.handoff.runApprovedCanonical(),
  /original live Root, MCP native owner and Branch required/u);
 assert.equal(f.events.includes("root"),false);
 assert.equal(f.events.includes("canonical"),false);
 assert.equal(f.events.includes("retire"),true);
});
