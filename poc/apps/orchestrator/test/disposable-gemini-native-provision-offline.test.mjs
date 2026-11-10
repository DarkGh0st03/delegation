/**
 * No-inference ORIGINAL canonical provisioning integration test.
 *
 * This is stronger than checking BaseLlm constructors alone: the same three
 * agent models and original Planner/Loop/Branch/PR models are handed to the
 * EXISTING createProtectedCanonicalOperationalProvision with a real typed
 * original durable Gateway session store and CompletionObserver.
 *
 * This does not start the Review Host, reserve a Root, open a native Rust
 * socket, launch A2A workers, run Gitea/Docker or call Gemini.
 * It is NOT evidence of real model-authored files or a signed Engineer grant.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {Gemini} from "@google/adk";
import {TrustedOperationalSessionStore}
 from "../../gateway/src/trusted-operational-session-store.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import {createProtectedCanonicalOperationalProvision}
 from "../src/trusted-authority-only-owner-bootstrap.mjs";
import {createDisposableLiveGeminiModelSetFromPrivateFile,
 createDisposableActionsOwnerGeminiModelsFromPrivateFile}
 from "../src/disposable-gemini-live-model-set.mjs";
import {bindDisposableLiveGeminiCanonicalInputs}
 from "../src/disposable-gemini-live-canonical-binding.mjs";

const SHA="a".repeat(40);
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const ROLES=["backend","frontend","test"];
const noop=()=>{throw Error("Forbidden side effect in no-inference integration test");};

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),"disposable-native-provision-"));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=name=>join(root,name);
 const dirs=Object.fromEntries([
  "journal","sessions","status-index","local-workers",
  "mutationIntent","giteaReceipts","runnerIntent",
  "runnerFailureReceipts","runnerPassReceipts"
 ].map(name=>[name,folder(name)]));
 for(const dir of Object.values(dirs))
  await mkdir(dir,{mode:0o700});
 for(const name of ["gateway-tasks","issuer-children","gateway-children",
  "effect-fences","sequences"]){
  await mkdir(join(dirs.journal,name),{mode:0o700});
 }
 const secret=folder("gemini.secret");
 await writeFile(secret,"synthetic-no-network-key\n",{mode:0o600,flag:"wx"});
 const tokenFile=folder("orchestrator.token");
 await writeFile(tokenFile,"ORIGINAL_PRIVATE_NATIVE_TOKEN",{
  mode:0o600,flag:"wx"
 });

 const relevant=[
  "GITHUB_ACTIONS","DELEGATION_GATEWAY_ARCHITECTURE",
  "APPROVED_RUNNER_NATIVE_MCP","ENGINEER_CORE_NATIVE_MODE",
  "ADAPTER_ENGINEER_NATIVE_SOCKET"
 ];
 const before=new Map(relevant.map(name=>[name,process.env[name]]));
 t.after(()=>{for(const [name,value] of before)
  if(value===undefined)delete process.env[name];
  else process.env[name]=value;
 });
 // The test uses a synthetic key file with an input describing Actions;
 // original native provision is a separate private-owner process contract.
 delete process.env.GITHUB_ACTIONS;
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.ENGINEER_CORE_NATIVE_MODE="1";
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=folder("rust-native.sock");

 const env={
  GITHUB_ACTIONS:"true",
  GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:
   "DarkGh0st03/delegation/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+REF,
  GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"999999999",
  GITHUB_SHA:SHA,DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES"
 };
 const models=await createDisposableLiveGeminiModelSetFromPrivateFile({
  env,checkoutSha:SHA,keyFile:secret
 });
 let effects=0,observations=0;
 const originalStore=new TrustedOperationalSessionStore(dirs.sessions);
 const observer=new TrustedAuthorityOnlyCompletionObserver({
  readVerifiedCompletion:async()=>{observations++;throw Error(
   "Forbidden independent completion read in no-inference test");
  }
 });
 const authority={
  snapshot:{
   session_id:"disposable-owner-native-integration",
   repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
   base_revision:"b".repeat(40),
   directories:["","src","tests"],files:["src/account.ts","tests/account.test.ts"]
  },
  preliminaryRoot:{
   credential_id:"urn:original:preliminary",
   valid_from:"2026-11-09T00:00:00.000Z",
   validity_seconds:2700,
   credential_status:{
    type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListCredential:"https://status.invalid/list",
    statusListIndex:"4"
   }
  },
  planner:{planId:"original-plan"},
  checkpoint:{backendKeyId:"original-backend-id",store:{original:true}},
  workBranch:"feature/account-suspension",
  trustedAgentRegistry:{
   orchestrator:{did:"did:original:orchestrator"},
   backend:{did:"did:original:backend"},
   frontend:{did:"did:original:frontend"},
   test:{did:"did:original:test"}
  },
  operationalSessionStore:originalStore
 };
 const resource="gitea://gitea.local/thesis/iam";
 const effectsConfig={
  store:{original:true},
  giteaClient:{original:true},
  independentGiteaClient:{original:true},
  runnerClient:{original:true},
  runnerPassObserver:{original:true},
  directories:Object.fromEntries(
   ["mutationIntent","giteaReceipts","runnerIntent",
    "runnerFailureReceipts","runnerPassReceipts"]
    .map(key=>[key,dirs[key]])),
  evidenceKey:Buffer.alloc(32,7),
  installAuthorization(){effects++;throw Error("No native execution allowed");}
 };
 const nativeGateway={
  audit:{original:true},verifier:{original:true},
  policy:{original:true},executor:{original:true}
 };
 const operational={
  journalDirectory:dirs.journal,
  orchestratorTokenFile:tokenFile,
  completionObserver:observer,
  nativeEffects:effectsConfig,
  rootGateway:nativeGateway,
  rootReservation:{
   directory:dirs["status-index"],index:"19",validitySeconds:600
  },
  localWorkers:{
   directory:dirs["local-workers"],
   workers:Object.fromEntries(ROLES.map((role,i)=>[role,{
    port:9311+i,adk:{
     gatewayBaseUrl:"http://127.0.0.1:8130",
     adapterToken:"original-private-"+role
    }
   }]))
  },
  workflow:{
   adaptive:{
    nextChildParameters:noop,
    requireVerifiedRepairDiagnostic:true,
    maxSteps:25,maxVerifiedFailures:2
   },
   createBranch:{
    branch:authority.workBranch,baseBranch:"main",
    permission:{resource,operation:"create_branch"}
   },
   draftPullRequest:{
    headBranch:authority.workBranch,baseBranch:"main",
    title:"Original native proof",body:"Only with independently attested Test",
    permission:{resource,operation:"create_pull_request"}
   }
  }
 };
 return {root,dirs,secret,models,authority,operational,observer,originalStore,
  getEffects:()=>effects,getObservations:()=>observations};
}

test("one Gemini model set enters ORIGINAL typed native provision without Root, A2A, Git or provider I/O",async t=>{
 const f=await fixture(t);
 const bound=bindDisposableLiveGeminiCanonicalInputs({
  authority:f.authority,operational:f.operational,models:f.models
 });
 assert.equal(bound.authority.operationalSessionStore,f.originalStore);
 assert.equal(bound.authority.checkpoint,f.authority.checkpoint);
 assert.equal(bound.operational.completionObserver,f.observer);
 assert.equal(bound.operational.nativeEffects,f.operational.nativeEffects);
 assert.equal(bound.operational.rootGateway,f.operational.rootGateway);
 assert.equal(bound.authority.planner.model,f.models.planner.model);
 assert.ok(f.models.planner.model instanceof Gemini);
 assert.equal(bound.operational.workflow.adaptive.model,f.models.adaptive.model);
 assert.equal(bound.operational.workflow.createBranch.model,f.models.adaptive.model);
 assert.equal(bound.operational.workflow.draftPullRequest.model,f.models.adaptive.model);
 assert.deepEqual(Object.keys(bound.operational.localWorkers.workers).sort(),
  [...ROLES].sort());
 for(const role of ROLES)
  assert.equal(bound.operational.localWorkers.workers[role].adk.model,
   f.models.workers[role].model);

 // This is the ORIGINAL trusted code path, not a test double of provision.
 const provision=await createProtectedCanonicalOperationalProvision(
  bound.authority,bound.operational);
 assert.equal(typeof provision,"function");
 // Do NOT invoke provision(): doing so reserves a real Root status index
 // and constructs executable native effects; this test is pre-Root only.
 assert.deepEqual(await readdir(f.dirs["status-index"]),[]);
 assert.deepEqual(await readdir(f.dirs.sessions),[]);
 assert.equal(f.getEffects(),0);
 assert.equal(f.getObservations(),0);
 assert.throws(()=>JSON.stringify(f.models),/must not be serialized/u);
});

test("original native provision rejects injected provider callbacks and changed signed Branch even after model binding",async t=>{
 const f=await fixture(t);
 const bound=bindDisposableLiveGeminiCanonicalInputs({
  authority:f.authority,operational:f.operational,models:f.models
 });
 const bad=[
  {...bound.operational,workflow:{
   ...bound.operational.workflow,
   createBranch:{...bound.operational.workflow.createBranch,
    prepare:noop}
  }},
  {...bound.operational,workflow:{
   ...bound.operational.workflow,
   draftPullRequest:{...bound.operational.workflow.draftPullRequest,
    execute:noop}
  }},
  {...bound.operational,workflow:{
   ...bound.operational.workflow,
   createBranch:{...bound.operational.workflow.createBranch,
    branch:"feature/foreign"}
  }}
 ];
 for(const changed of bad)
  await assert.rejects(
   createProtectedCanonicalOperationalProvision(bound.authority,changed),
   /Protected canonical authority bootstrap denied/u
  );
 assert.deepEqual(await readdir(f.dirs["status-index"]),[]);
 assert.equal(f.getEffects(),0);
});

test("GitHub Actions one-use consented owner models bind every ORIGINAL typed native slot without API, Root or Docker",async t=>{
 const f=await fixture(t);
 // No real GitHub dispatch, provider credentials or Google network here:
 // only a local independent REST metadata fixture and a synthetic key.
 const checkoutSha=execFileSync("git",["rev-parse","HEAD"],{
  encoding:"utf8"
 }).trim();
 const ref="refs/heads/experiment/disposable-gemini-live-20261109";
 const repo="DarkGh0st03/delegation";
 const workflow=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
 const pins={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:repo,
  GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:repo+"/"+workflow+"@"+ref,
  GITHUB_RUN_ID:"42784699554",GITHUB_RUN_ATTEMPT:"1",GITHUB_SHA:checkoutSha,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES"
 };
 const names=[...Object.keys(pins),"GEMINI_API_KEY","GOOGLE_API_KEY",
  "OPENAI_API_KEY","GH_TOKEN","GITHUB_TOKEN","DELEGATION_LIVE_CI_PREFLIGHT_MODE"];
 const original=new Map(names.map(key=>[key,process.env[key]]));
 for(const key of names)delete process.env[key];
 Object.assign(process.env,pins);
 const previousFetch=globalThis.fetch;
 let githubReads=0;
 globalThis.fetch=async url=>{
  githubReads++;
  assert.equal(url,"https://api.github.com/repos/"+repo+"/actions/runs/"+pins.GITHUB_RUN_ID);
  return {ok:true,async json(){return {
   id:pins.GITHUB_RUN_ID,event:"workflow_dispatch",run_attempt:1,
   status:"in_progress",head_sha:checkoutSha,
   head_branch:"experiment/disposable-gemini-live-20261109",
   path:workflow,head_repository:{full_name:repo},
   created_at:new Date().toISOString()
  };}};
 };
 t.after(()=>{
  globalThis.fetch=previousFetch;
  for(const [key,value] of original){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
 const admitted=await createDisposableActionsOwnerGeminiModelsFromPrivateFile({
  keyFile:f.secret,githubApiToken:"synthetic-github-reader-token"
 });
 assert.equal(githubReads,1);
 const bound=bindDisposableLiveGeminiCanonicalInputs({
  authority:f.authority,operational:f.operational,models:admitted
 });
 assert.equal(bound.authority.planner.model,admitted.planner.model);
 assert.equal(bound.operational.workflow.adaptive.model,admitted.adaptive.model);
 assert.equal(bound.operational.workflow.createBranch.model,admitted.adaptive.model);
 assert.equal(bound.operational.workflow.draftPullRequest.model,admitted.adaptive.model);
 assert.deepEqual(Object.keys(bound.operational.localWorkers.workers).sort(),
  [...ROLES].sort());
 for(const role of ROLES){
  const model=bound.operational.localWorkers.workers[role].adk.model;
  assert.equal(model,admitted.workers[role].model);
  assert.equal(model.publicSummary().calls_started,0);
 }
 assert.equal(admitted.planner.model.publicSummary().calls_started,0);
 assert.equal(admitted.adaptive.model.publicSummary().calls_started,0);
 // Same original owner provision validates typed native dependencies. Do
 // not invoke returned function: the protected Root/VP state must stay absent.
 const provision=await createProtectedCanonicalOperationalProvision(
  bound.authority,bound.operational
 );
 assert.equal(typeof provision,"function");
 assert.deepEqual(await readdir(f.dirs["status-index"]),[]);
 assert.deepEqual(await readdir(f.dirs.sessions),[]);
 assert.equal(f.getEffects(),0);
 assert.equal(f.getObservations(),0);
});
