import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
 assertDisposableCiSource,simulateDisposableEngineerDecision,
 scriptedResearchProposal
} from "../src/run-disposable-gemini-ci-pilot.mjs";

const check=proposal=>simulateDisposableEngineerDecision({proposal});
test("disposable scripted Engineer uses genuine signed/verified Ed25519 and exactly three specialists",()=>{
 const proof=check(scriptedResearchProposal());
 assert.equal(proof.status,"disposable_ci_engineer_decision_simulated_and_signed");
 assert.equal(proof.engineer_review,"SIMULATED_NOT_HUMAN");
 assert.equal(proof.signed_authority_verified,true);
 assert.match(proof.authority_digest,/^[a-f0-9]{64}$/u);
 assert.equal(proof.permission_count,23);
 assert.deepEqual(proof.canonical_specialists,["backend","frontend","test"]);
 assert.equal(proof.native_rust_roots_in_this_step,0);
 assert.equal(proof.child_credentials_in_this_step,0);
 assert.equal(proof.model_calls,0);
 assert.equal(proof.model_generativity_proven,false);
 assert.equal(proof.full_pilot_proven,false);
 assert.equal(Object.isFrozen(proof),true);
 for(const needle of ["BEGIN PRIVATE KEY","BEGIN PUBLIC KEY",
  "signature","geminiApiKey","signed_vp"])
  assert.equal(JSON.stringify(proof).includes(needle),false,needle);
});

test("standalone grant covers all ten original R375 native source files without widening roles",()=>{
 const proposal=scriptedResearchProposal();
 assert.equal(proposal.requirement,
  "R375 original protected-main Account Suspension signed functional integration proof");
 assert.equal(proposal.requested_permissions.length,23);
 const files=proposal.requested_permissions.filter(p=>
  p.operation==="read_file").map(p=>p.resource.split("/files/")[1]);
 assert.equal(files.length,10);
 assert.equal(new Set(files).size,10);
 for(const path of [
  "packages/shared/src/account-status.ts",
  "apps/frontend/src/styles.css",
  "apps/backend/src/users/user.service.ts",
  "tests/frontend/UserDetailPage.test.tsx"
 ])assert.ok(files.includes(path),path);
 assert.deepEqual(proposal.requested_permissions.filter(p=>p.operation==="run_tests")
  .map(p=>p.resource),[
   "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension"
  ]);
});

test("CI Engineer simulation refuses every permission ceiling expansion",()=>{
 const mutations=[
  p=>p.requested_permissions.push({
   resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/.github/workflows/evil.yml",
   operation:"update_file"
  }),
  p=>p.requested_permissions[0].operation="merge_pull_request",
  p=>p.requested_permissions[0].resource=
   "gitea://gitea.local/unrelated/repo",
  p=>p.requested_permissions.push({
   resource:"gitea://gitea.local/thesis/iam-console-poc",operation:"delete_repository"
  }),
  p=>p.requested_permissions=[
   p.requested_permissions[0],p.requested_permissions[0]
  ],
  p=>p.requested_permissions=[],
  p=>p.requested_permissions[0]={resource:"gitea://other-host/test/repo",
   operation:"create_branch"}
 ];
 for(const mutate of mutations){
  const proposal=structuredClone(scriptedResearchProposal());
  mutate(proposal);
  assert.throws(()=>check(proposal),
   /Disposable authority-only CI pilot NO-GO|Authority-only approval/u);
 }
});

test("CI simulation refuses forged session context, role and requirement",()=>{
 const mutations=[
  p=>p.base_revision="bad",
  p=>p.requirement="Deploy arbitrary model service",
  p=>p.repository.owner="attacker",
  p=>p.branch="main",
  p=>p.schema_version="2.0.0",
  p=>p.session_id="",
  p=>p.requested_permissions.push({resource:"",operation:"read_file"})
 ];
 for(const change of mutations){
  const proposal=structuredClone(scriptedResearchProposal());change(proposal);
  assert.throws(()=>check(proposal),
   /Disposable authority-only CI pilot NO-GO|Authority-only approval/u);
 }
 for(const roles of [
  ["backend","frontend","test","reviewer"],
  ["backend","frontend"],
  ["backend","test","frontend"],
  ["reviewer","frontend","test"]
 ]){
  assert.throws(()=>simulateDisposableEngineerDecision({
   proposal:scriptedResearchProposal(),roles
  }),/Disposable authority-only CI pilot NO-GO/u);
 }
});

test("manual-only GitHub Actions contract refuses paid mode, push and replay before any git work",()=>{
 const valid={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_WORKFLOW_REF:"DarkGh0st03/delegation/.github/workflows/gemini-authority-only-ci-pilot.yml@refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"12345",
  GITHUB_SHA:"a".repeat(40),
  DELEGATION_DISPOSABLE_CI_MODE:"scripted-offline"
 };
 for(const [k,v] of [
  ["GITHUB_ACTIONS","false"],
  ["GITHUB_REPOSITORY","someone/else"],
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_EVENT_NAME","push"],
  ["GITHUB_WORKFLOW_REF","someone/other.yml@main"],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_RUN_ID","0"],
  ["GITHUB_SHA","short"],
  ["DELEGATION_DISPOSABLE_CI_MODE","gemini-real"],
  ["GEMINI_API_KEY","fake-key"],
  ["GOOGLE_API_KEY","fake-key"],
  ["OPENAI_API_KEY","fake-key"],
  ["DELEGATION_SIGNED_GEMINI_PILOT","1"]
 ]){
  assert.throws(()=>assertDisposableCiSource({...valid,[k]:v}),
   /Disposable authority-only CI pilot NO-GO/u,k);
 }
});

test("disposable CI CLI fails closed outside exact authorized GitHub job",()=>{
 const p=spawnSync(process.execPath,[
  "--experimental-strip-types",
  new URL("../src/run-disposable-gemini-ci-pilot.mjs",import.meta.url).pathname
 ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
 assert.equal(p.status,1);
 assert.equal(p.stdout,"");
 assert.match(p.stderr,/Disposable authority-only CI pilot NO-GO/u);
});
