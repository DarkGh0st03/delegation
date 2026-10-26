import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,readdir,chmod,symlink,rm,lstat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedExecutionCoordinator}
  from "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {
  verifyR5PostRunEvidence,assertR5EvidenceDirectory,
  persistR5PostRunEvidence
} from "../src/trusted-r5-scripted-completion-evidence.mjs";
const SHA="a".repeat(40),DIGEST="b".repeat(64);
const TASKS=["branch","backend","frontend","test","pr"];
function deferred(){
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}
async function originalCoordinator({gatewayWait,failRevoke=false}={}){
  const revoked=[];
  const credentials={
    async revokeRoot(id){
      revoked.push(id);
      if(failRevoke)throw Error("native Rust EVM revocation rejected");
    }
  };
  const gateway={
    async activate(){return DIGEST;},
    async closeSession(){if(gatewayWait)await gatewayWait.promise;},
    bindTask(){},async confirmTaskCompletion(){}
  };
  const authority={
    async startPlanning(root){
      return {phase:"planning",credential_id:root.credential_id,
        permissions:[]};
    },
    async approveAndIssueOperationalRoot(root){
      return {credential_id:root.credential_id,
        plan_digest:DIGEST,permissions:[]};
    }
  };
  const coordinator=new TrustedExecutionCoordinator({
    sessionId:"original-r5-session",baseRevision:SHA,
    authority,approvedGatewayPlans:gateway,credentials
  });
  await coordinator.beginPlanning({credential_id:"urn:r5:preliminary"});
  await coordinator.beginExecution({credential_id:"urn:r5:operational"});
  return {coordinator,revoked};
}
async function fixture(){
  const {coordinator}=await originalCoordinator();
  await coordinator.closeExecution();
  return {
    runId:"40299999991",sourceSha:SHA,sessionId:"original-r5-session",
    review:{
      session_id:"original-r5-session",plan_digest:DIGEST,
      authenticated_engineer_did:"did:example:engineer"
    },
    approvedTaskIds:[...TASKS],
    dagResult:{
      plan_digest:DIGEST,
      completed_task_ids:["branch","frontend","backend","test","pr"],
      specialized_results:[{artifact:{sensitive:"never-in-receipt"}}]
    },
    coordinator
  };
}
async function dirFixture(){
  const dir=await mkdtemp(join(tmpdir(),"r5-verified-local-witness-"));
  return {dir,close:()=>rm(dir,{recursive:true,force:true})};
}
test("R5 post-run evidence is only available after exact original signed DAG and CLOSED Coordinator",async()=>{
  const evidence=await verifyR5PostRunEvidence(await fixture());
  assert.equal(evidence.status,"verified_complete_local_owner_observation");
  assert.equal(evidence.external_r5_go,false);
  assert.equal(evidence.independently_attested,false);
  assert.equal(evidence.original_runtime_returned_success,true);
  assert.deepEqual(evidence.approved_task_ids,TASKS);
  assert.deepEqual(evidence.completed_task_ids,
    ["branch","frontend","backend","test","pr"]);
  assert.equal(Object.isFrozen(evidence),true);
  assert.equal(Object.isFrozen(evidence.approved_task_ids),true);
  assert.equal(JSON.stringify(evidence).includes("sensitive"),false);
  assert.equal(JSON.stringify(evidence).includes("Bearer"),false);
});
test("R5 refuses missing, partial, repeated or invented DAG Tasks and wrong digest",async()=>{
  const bad=[
    o=>o.dagResult.completed_task_ids=["branch","backend"],
    o=>o.dagResult.completed_task_ids.push("injected"),
    o=>o.dagResult.completed_task_ids[1]="branch",
    o=>o.dagResult.plan_digest="c".repeat(64),
    o=>o.review.authenticated_engineer_did="",
    o=>o.review.session_id="another",
    o=>o.sourceSha="not-a-sha",
    o=>o.runId="0",
    o=>o.coordinator={phase:"execution"},
    o=>o.coordinator={phase:"failed_closed"},
    o=>o.approvedTaskIds.push("branch")
  ];
  for(const mutate of bad){
    const state=await fixture();mutate(state);
    await assert.rejects(verifyR5PostRunEvidence(state),/NO-GO/);
  }
});
test("R5 CLOSED Coordinator during in-flight Gateway retirement cannot create positive owner evidence",async()=>{
  const pending=deferred();
  const {coordinator,revoked}=await originalCoordinator({
    gatewayWait:pending
  });
  const closing=coordinator.closeExecution();
  assert.equal(coordinator.phase,"closed");
  const input=await fixture();
  input.coordinator=coordinator;
  let completed=false;
  const checking=verifyR5PostRunEvidence(input)
    .then(()=>{completed=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completed,false,
    "synchronous closed phase must NOT certify pending Gateway/native revocation");
  assert.deepEqual(revoked,[]);
  pending.resolve();
  await closing;
  await checking;
  assert.equal(completed,true);
  assert.deepEqual(revoked,["urn:r5:operational"]);
});
test("R5 rejected native Rust revocation forbids positive evidence even with CLOSED phase",async()=>{
  const {coordinator,revoked}=await originalCoordinator({failRevoke:true});
  await assert.rejects(coordinator.closeExecution(),
    /native Rust EVM revocation rejected/);
  assert.equal(coordinator.phase,"closed");
  const input=await fixture();
  input.coordinator=coordinator;
  await assert.rejects(verifyR5PostRunEvidence(input),
    /native operational root or Gateway retirement unconfirmed/);
  assert.deepEqual(revoked,["urn:r5:operational"]);
});
test("R5 local owner receipt is exclusive, 0600, no secrets and cannot overwrite same run",async()=>{
  const f=await dirFixture();
  try{
    const evidence=await verifyR5PostRunEvidence(await fixture());
    const first=await persistR5PostRunEvidence(f.dir,evidence);
    assert.equal(first.status,"verified_local_receipt_written");
    const payload=JSON.parse(await readFile(first.filename,"utf8"));
    assert.equal(payload.github_run_id,"40299999991");
    assert.equal(payload.external_r5_go,false);
    assert.equal(payload.independently_attested,false);
    assert.equal(JSON.stringify(payload).includes("sensitive"),false);
    const stat=await lstat(first.filename);
    assert.equal(stat.mode&0o777,0o600);
    await assert.rejects(persistR5PostRunEvidence(f.dir,evidence),/NO-GO/);
    assert.deepEqual(await readdir(f.dir),["r5-scripted-run-40299999991.json"]);
  }finally{await f.close();}
});
test("R5 fabricated owner completion objects and clones cannot be persisted without native verification",async()=>{
  const f=await dirFixture();
  try{
    const valid=await verifyR5PostRunEvidence(await fixture());
    const forged=Object.freeze({...valid});
    const clone=structuredClone(valid);
    await assert.rejects(persistR5PostRunEvidence(f.dir,forged),
      /genuine, unused Coordinator-verified witness/);
    await assert.rejects(persistR5PostRunEvidence(f.dir,clone),
      /genuine, unused Coordinator-verified witness/);
    await assert.rejects(persistR5PostRunEvidence(f.dir,{
      schema:"r5-scripted-owner-completion-v1",
      status:"verified_complete_local_owner_observation",
      github_run_id:"40299999991",external_r5_go:false
    }),/genuine, unused Coordinator-verified witness/);
    assert.deepEqual(await readdir(f.dir),[]);
    await persistR5PostRunEvidence(f.dir,valid);
  }finally{await f.close();}
});

test("R5 cannot publish same verified observation twice under simultaneous callers",async()=>{
  const f=await dirFixture();
  try{
    const evidence=await verifyR5PostRunEvidence(await fixture());
    const attempts=await Promise.allSettled([
      persistR5PostRunEvidence(f.dir,evidence),
      persistR5PostRunEvidence(f.dir,evidence)
    ]);
    assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(attempts.filter(r=>r.status==="rejected").length,1);
    const files=await readdir(f.dir);
    assert.deepEqual(files,["r5-scripted-run-40299999991.json"]);
    const parsed=JSON.parse(await readFile(join(f.dir,files[0]),"utf8"));
    assert.equal(parsed.approved_plan_digest,DIGEST);
    assert.equal(parsed.coordinator_terminal_phase,"closed");
  }finally{await f.close();}
});

test("R5 atomic publication never replaces an existing completed-run file",async()=>{
  const f=await dirFixture();
  try{
    const filename=join(f.dir,"r5-scripted-run-40299999991.json");
    await (await import("node:fs/promises")).writeFile(filename,
      "previous-independent-trial",{mode:0o600});
    const evidence=await verifyR5PostRunEvidence(await fixture());
    await assert.rejects(persistR5PostRunEvidence(f.dir,evidence),
      /atomic receipt publication unconfirmed/);
    assert.equal(await readFile(filename,"utf8"),
      "previous-independent-trial");
    assert.deepEqual(await readdir(f.dir),
      ["r5-scripted-run-40299999991.json"],
      "all exclusive temporary files must be cleaned on failure");
  }finally{await f.close();}
});

test("R5 owner evidence rejects unprotected directory, symlink and unverified status",async()=>{
  const f=await dirFixture();
  try{
    const unsafeDirectoryEvidence=await verifyR5PostRunEvidence(await fixture());
    await chmod(f.dir,0o755);
    await assert.rejects(assertR5EvidenceDirectory(f.dir),/NO-GO/);
    await assert.rejects(persistR5PostRunEvidence(
      f.dir,unsafeDirectoryEvidence),/NO-GO/);
    await chmod(f.dir,0o700);
    const link=f.dir+"-link";
    await symlink(f.dir,link);
    try{
      // This is a DISTINCT verified observation. The denial must be
      // about the symlink itself, not the preceding one-use rejection.
      const symlinkEvidence=await verifyR5PostRunEvidence(await fixture());
      await assert.rejects(
        persistR5PostRunEvidence(link,symlinkEvidence),/NO-GO/);
    }finally{await rm(link,{force:true});}
    const valid=await verifyR5PostRunEvidence(await fixture());
    await assert.rejects(persistR5PostRunEvidence(f.dir,{
      ...valid,status:"unverified"
    }),/genuine, unused Coordinator-verified witness/);
    assert.deepEqual(await readdir(f.dir),[]);
  }finally{await f.close();}
});
