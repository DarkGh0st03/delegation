import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditR38516HumanGate,PRIVATE_MCP_KEEP,r38516Scan}
 from "../r38516-human-gate-and-legacy-reachability.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=path=>readFileSync(resolve(root,path),"utf8");
const original=Object.freeze({
 workflow:read(".github/workflows/human-approved-gitea-merge.yml"),
 cli:read("poc/packages/orchestrator-runtime/scripts/human-merge.mjs"),
 executor:read("poc/packages/orchestrator-runtime/src/trusted-merge.ts"),
 legacyWorkflow:read(".github/workflows/phase11-security.yml")
});
const audit=(patch={})=>auditR38516HumanGate({...original,...patch});
const denied=(patch,reason)=>{
 const r=audit(patch);
 assert.equal(r.status,"HUMAN_GATE_FAIL");
 assert.ok(r.issues.some(x=>x.includes(reason)),JSON.stringify(r.issues));
 assert.equal(r.manualMergeExecuted,false);
};
test("R385.16 Human Gate remains manual, exact and requires external reviewers",()=>{
 const r=audit();
 assert.equal(r.status,"HUMAN_GATE_STATIC_OK");
 assert.deepEqual(r.issues,[]);
 assert.equal(r.protectedEnvironmentReviewersVerified,false);
 assert.equal(r.protectedMainBranchConfigurationVerified,false);
 assert.equal(r.manualMergeExecuted,false);
 assert.equal(r.legacyMainPushAdapterWorkflowObserved,true,
  "historical phase11 main-push HTTP Adapter still requires migration review");
});
test("R385.16 cannot enable push, PR, timers or secondary triggers",()=>{
 for(const event of ["push","pull_request","schedule","workflow_run","workflow_call"]){
  denied({workflow:original.workflow.replace(
   "on:\n  workflow_dispatch:","on:\n  "+event+":\n  workflow_dispatch:")},
   "dispatch-only");
 }
 denied({workflow:original.workflow.replace("on:\n  workflow_dispatch:",
  "on:\n  push:")},"dispatch-only");
});
test("R385.16 protected main, operator identity and environment approval are mandatory",()=>{
 for(const key of [
  "github.ref == 'refs/heads/main'",
  "github.actor == vars.THESIS_MERGE_GITHUB_OPERATOR",
  "github.triggering_actor == github.actor",
  "name: protected-gitea-merge",
  "persist-credentials: false"
 ]){
  denied({workflow:original.workflow.replace(key,"REMOVED_SECURITY_GUARD")},
   "human merge workflow missing");
 }
 for(const key of ["pr_number","expected_head_sha","confirmation"]){
  const changed=original.workflow.replace(
   new RegExp("(      "+key+":\\n[\\s\\S]*?required: )true","u"),
   "$1false");
  assert.notEqual(changed,original.workflow);
  denied({workflow:changed},"human merge input missing or optional: "+key);
 }
});
test("R385.16 validate intent before reading tokens; paid keys never enter merge",()=>{
 denied({cli:original.cli.replace("const intent=validateManualMergeIntent(",
  "const intent=skipValidation(")},
  "human intent must be validated before privileged secrets");
 denied({cli:original.cli.replace('process.argv[2]!=="--execute"',
  'process.argv[2]==="--execute"')},
  "manual CLI must require exact execute flag");
 denied({workflow:original.workflow+"\n  GEMINI_API_KEY: paid-key-not-allowed\n"},
  "human merge cannot read paid model credentials");
});
test("R385.16 Gitea rechecks exact head; no force or deferred merge",()=>{
 denied({executor:original.executor.replace(
  "const final=await this.#verifier.verify(input)",
  "const final=first")},"merge must reverify");
 denied({executor:original.executor.replace("force_merge:false","force_merge:true")},
  "merge transaction missing: force_merge:false");
 denied({executor:original.executor.replace(
  "head_commit_id:final.head_sha","head_commit_id:input.expectedHeadSha")},
  "merge transaction missing: head_commit_id:final.head_sha");
});
test("R385.16 live source inventory cannot authorize physical deletion",()=>{
 const report=r38516Scan(root);
 assert.equal(report.status,"R38516_STATIC_GATE_PASS",
  JSON.stringify([...report.human.issues,...report.legacy.dagIssues]));
 assert.equal(report.legacy.historicalDagClosureStatus,"BOUNDARY_PROVENANCE_OK");
 assert.equal(report.legacy.deletionAuthorized,false);
 assert.equal(report.legacy.externalConsumersVerified,false);
 assert.equal(report.legacy.protectedModules.length,PRIVATE_MCP_KEEP.length);
 assert.ok(report.legacy.protectedModules.every(x=>x.present&&
  x.disposition==="RETAIN_PRIVATE_CRYPTO_MCP"));
 assert.ok(report.legacy.legacyModules.every(x=>
  x.disposition==="MIGRATION_REVIEW_NOT_DELETION_APPROVAL"));
});
