import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {corroborateR5PostRunGithub,validateR5OwnerCompletionClaim,
  corroborateProtectedR5PostRunGithub}
  from "../r5-post-run-github-crosscheck.mjs";

const SHA="a".repeat(40),RUN="40312345678",DIGEST="b".repeat(64);
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const JOB="Authenticated OIDC then host-verified signed DAG closure, no models";
const LABELS=["self-hosted","linux","x64","delegation-private"];
const names=[
  "Validate default-branch registration and immutable runner source",
  "Probe pinned private Engineer mTLS before GitHub OIDC",
  "Submit signed OIDC then wait for offline root revocation",
  "Report zero-cost authenticated role only"
];
function evidence(){
  return {
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,
    session_id:"r5-original-approved-session",
    approved_plan_digest:DIGEST,
    approved_task_ids:["branch","backend","frontend","test","pr"],
    completed_task_ids:["branch","frontend","backend","test","pr"],
    authenticated_engineer_did:"did:example:engineer",
    coordinator_terminal_phase:"closed",
    original_runtime_returned_success:true,
    independently_attested:false,provider_model_calls_verified_here:false,
    external_r5_go:false
  };
}
function run(){
  return {
    id:Number(RUN),event:"workflow_dispatch",run_attempt:1,
    status:"completed",conclusion:"success",
    head_sha:SHA,head_branch:"refactor/post-prof-plan-contracts-20261021",
    path:WORKFLOW,
    repository:{full_name:"DarkGh0st03/delegation"},
    head_repository:{full_name:"DarkGh0st03/delegation"}
  };
}
function page(){
  return {total_count:1,jobs:[{
    name:JOB,status:"completed",conclusion:"success",
    runner_id:17,runner_name:"owner-priv-runner",
    labels:LABELS,
    steps:[{name:"Set up job",status:"completed",conclusion:"success"},
      ...names.map(name=>({name,status:"completed",conclusion:"success"})),
      {name:"Complete job",status:"completed",conclusion:"success"}]
  }]};
}
function fetcher(actualRun,actualJobs,seen){
  return async(url,options)=>{
    seen.push({url,method:options.method,auth:options.headers.authorization});
    return {ok:true,async json(){
      return url.endsWith("?per_page=100")?actualJobs:actualRun;
    }};
  };
}
const params=()=>({evidence:evidence(),expectedSourceSha:SHA,
  expectedRunId:RUN,githubToken:"owner-private-github-token"});
test("R5 independent GitHub completed private-run cross-check has no authority, billing or native revocation attestation",async()=>{
  const seen=[];
  const outcome=await corroborateR5PostRunGithub({
    ...params(),fetchFn:fetcher(run(),page(),seen)
  });
  assert.equal(outcome.status,
    "github_completed_private_job_correlated_owner_claim_only");
  assert.equal(outcome.observed_private_job_steps,4);
  assert.equal(outcome.external_r5_go,false);
  assert.equal(outcome.native_rust_evm_revocation_independently_verified,false);
  assert.equal(outcome.owner_receipt_provenance_independently_verified,false);
  assert.equal(outcome.physical_runner_identity_independently_verified,false);
  assert.equal(outcome.model_api_calls_independently_verified,false);
  assert.equal(seen.length,2);
  assert.equal(seen.every(x=>x.method==="GET"),true);
  assert.equal(seen[0].url,
    "https://api.github.com/repos/DarkGh0st03/delegation/actions/runs/"+RUN);
  assert.equal(seen[1].url,seen[0].url+"/jobs?per_page=100");
  assert.equal(JSON.stringify(outcome).includes("owner-private-github-token"),false);
});
test("R5 rejects forged, modified, partial or mismatched local owner witness before network calls",async()=>{
  const changes=[
    x=>x.github_run_id="42",
    x=>x.source_sha="c".repeat(40),
    x=>x.approved_plan_digest="invalid",
    x=>x.completed_task_ids.pop(),
    x=>x.completed_task_ids[2]="frontend",
    x=>x.approved_task_ids.push("branch"),
    x=>x.external_r5_go=true,
    x=>x.independently_attested=true,
    x=>x.provider_model_calls_verified_here=true,
    x=>x.forged_external_attestation="fake",
    x=>x.original_runtime_returned_success=false,
    x=>x.coordinator_terminal_phase="execution",
    x=>x.authenticated_engineer_did="",
    x=>x.session_id="contains slash"
  ];
  let calls=0;
  for(const change of changes){
    const item=evidence();change(item);
    await assert.rejects(corroborateR5PostRunGithub({
      ...params(),evidence:item,
      fetchFn:async()=>{calls++;throw Error("must not be requested");}
    }),/NO-GO/);
  }
  assert.equal(calls,0);
  assert.throws(()=>validateR5OwnerCompletionClaim(evidence(),{
    expectedSourceSha:"z".repeat(40),expectedRunId:RUN
  }),/NO-GO/);
});
test("R5 rejects workflow rerun, canceled or failed conclusion, other repository and source SHA",async()=>{
  const changes=[
    r=>r.event="push",
    r=>r.run_attempt=2,
    r=>r.status="in_progress",
    r=>r.conclusion="failure",
    r=>r.head_sha="f".repeat(40),
    r=>r.head_branch="main",
    r=>r.path="other-workflow.yml",
    r=>r.head_repository.full_name="attacker/delegation",
    r=>r.repository.full_name="attacker/delegation",
    r=>r.id=55
  ];
  for(const change of changes){
    const changed=run();change(changed);
    await assert.rejects(corroborateR5PostRunGithub({
      ...params(),fetchFn:fetcher(changed,page(),[])
    }),/NO-GO/);
  }
});
test("R5 rejects non-private, failed or ambiguous GitHub job and any skipped hold step",async()=>{
  const changes=[
    p=>p.total_count=2,
    p=>p.jobs.push({...p.jobs[0]}),
    p=>p.jobs[0].runner_id=0,
    p=>p.jobs[0].runner_name="",
    p=>p.jobs[0].labels=["ubuntu-latest"],
    p=>p.jobs[0].labels=["self-hosted","linux","x64"],
    p=>p.jobs[0].conclusion="failure",
    p=>p.jobs[0].name="Unrelated job",
    p=>p.jobs[0].steps[2].conclusion="skipped",
    p=>p.jobs[0].steps[3].status="in_progress",
    p=>p.jobs[0].steps[2].name="unreviewed mTLS step",
    p=>p.jobs[0].steps.splice(2,1),
    p=>p.jobs[0].steps[1].name=p.jobs[0].steps[2].name
  ];
  for(const change of changes){
    const changed=page();change(changed);
    await assert.rejects(corroborateR5PostRunGithub({
      ...params(),fetchFn:fetcher(run(),changed,[])
    }),/NO-GO/);
  }
});
test("R5 rejects untrusted HTTP response, missing owner token and malformed job pagination",async()=>{
  await assert.rejects(corroborateR5PostRunGithub({
    ...params(),githubToken:"",
    fetchFn:()=>{throw Error("must not be used");}
  }),/NO-GO/);
  await assert.rejects(corroborateR5PostRunGithub({
    ...params(),fetchFn:async()=>({ok:false})
  }),/NO-GO/);
  await assert.rejects(corroborateR5PostRunGithub({
    ...params(),fetchFn:async()=>{throw Error("Bearer secret");}
  }),/NO-GO/);
  assert.throws(()=>validateR5OwnerCompletionClaim(null,{
    expectedRunId:RUN,expectedSourceSha:SHA
  }),/NO-GO/);
});
test("R5 operator token and local evidence require owner-only 0600 files and no symlinks",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r5-postrun-owner-audit-"));
  const receipt=join(dir,"r5-scripted-run-"+RUN+".json");
  const token=join(dir,"operator.token");
  try{
    await writeFile(receipt,JSON.stringify(evidence()),{mode:0o600});
    await writeFile(token,"private-owner-github-token",{mode:0o600});
    // GitHub Actions is never an authorized source for local evidence.
    const old=process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS="true";
    try{
      await assert.rejects(corroborateProtectedR5PostRunGithub({
        evidenceDirectory:dir,expectedRunId:RUN,expectedSourceSha:SHA,
        operatorTokenFile:token
      }),/NO-GO/);
    }finally{
      if(old===undefined)delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS=old;
    }
    await chmod(receipt,0o644);
    await assert.rejects(corroborateProtectedR5PostRunGithub({
      evidenceDirectory:dir,expectedRunId:RUN,expectedSourceSha:SHA,
      operatorTokenFile:token
    }),/NO-GO/);
    await chmod(receipt,0o600);
    const symlinkPath=join(dir,"link.token");
    await symlink(token,symlinkPath);
    try{
      await assert.rejects(corroborateProtectedR5PostRunGithub({
        evidenceDirectory:dir,expectedRunId:RUN,expectedSourceSha:SHA,
        operatorTokenFile:symlinkPath
      }),/NO-GO/);
    }finally{await rm(symlinkPath);}
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("R5 standalone post-run cross-check denies missing config without leaking secrets",()=>{
  const script=new URL("../r5-post-run-github-crosscheck.mjs",import.meta.url);
  const p=spawnSync(process.execPath,[
    "--experimental-strip-types",script.pathname
  ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
  assert.equal(p.status,1);
  assert.equal(p.stdout,"");
  assert.match(p.stderr,/cross-check NO-GO/);
  assert.doesNotMatch(p.stderr,/Bearer|PRIVATE KEY|owner-private-github-token/);
});
