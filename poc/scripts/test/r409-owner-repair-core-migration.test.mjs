/**
 * R409 — Owner recovery executable migration provenance.
 * This is intentionally read-only: no privileged issuer, signed Root,
 * remote Gateway call, real A2A dispatch, Docker or paid AI inference.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {stripTypeScriptTypes} from "node:module";
import {SourceTextModule} from "node:vm";
import {fileURLToPath} from "node:url";
import {collectLegacyReferences,gitTrackedFiles}
 from "../r6-legacy-references.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const p="poc/packages/orchestrator-runtime/src/";
const oldPlanner=p+"trusted-operational-repair-planner.ts";
const oldDag=p+"trusted-repair-dag-controller.ts";
const newPlanner=p+"trusted-owner-repair-planning-core.ts";
const newDag=p+"trusted-owner-repair-dag-execution.ts";
const owner=p+"trusted-owner-operational-repair-handoff.ts";
const read=path=>readFileSync(resolve(root,path),"utf8");
const parse=path=>new SourceTextModule(
 stripTypeScriptTypes(read(path)),{identifier:path});

test("R413 old Planner and DAG wrappers are physically retired",()=>{
 assert.equal(existsSync(resolve(root,oldPlanner)),false);
 assert.equal(existsSync(resolve(root,oldDag)),false);
 assert.equal(existsSync(resolve(root,newPlanner)),true);
 assert.equal(existsSync(resolve(root,newDag)),true);
});
test("R409 extracted Owner cores retain fail-closed Gateway and signed Root checks",()=>{
 const planner=read(newPlanner),dag=read(newDag);
 const parsedPlanner=parse(newPlanner),parsedDag=parse(newDag);
 assert.ok(!parsedPlanner.dependencySpecifiers.includes("./trusted-operational-repair-planner.ts"));
 assert.ok(!parsedDag.dependencySpecifiers.includes("./trusted-repair-dag-controller.ts"));
 for(const guard of [
  "export class TrustedOperationalRepairPlanner",
  "boundedTrustedRepairDiscoveryObservation",
  "verifyTrustedRepairDiscoverySource",
  "prepareTrustedRemoteRepairFeedback",
  "RUST_OPERATIONS",
  "repair_epoch_reserved_no_execution_authority",
  "featureHeadReader"
 ])assert.ok(planner.includes(guard),"planner guard missing: "+guard);
 for(const guard of [
  "export async function executeTrustedAdmittedRepairDag",
  "original Rust root retired or replaced",
  "operationalLeaseConfigured()",
  "operationalSessionDurableConfigured()",
  "new WeakMap<object,Set<string>>()",
  "same owner cannot replay a repair DAG",
  "dispatchTrustedAdmittedRepairA2A",
  "confirmTrustedAdmittedRepairA2A",
  "Gateway did not confirm exact signed predecessor",
  "await config.verifyLiveRun?.()",
  "docker_pass_verified:false",
  "pull_request_created:false"
 ])assert.ok(dag.includes(guard),"DAG guard missing: "+guard);
});

test("R409 Owner only lazy-loads planning AFTER Test FAIL and DAG AFTER Gateway epoch",()=>{
 const host=read(owner),loadPlanner='const {TrustedOperationalRepairPlanner}=await import(',
  loadDag='const {executeTrustedAdmittedRepairDag}=await import(';
 const proof=host.indexOf("const proof=await prepareTrustedRemoteRepairFeedback(");
 const checked=host.indexOf('if(JSON.stringify(proof)!==JSON.stringify(signal))');
 const history=host.indexOf('observe("d1_history_verification")');
 const planning=host.indexOf(loadPlanner);
 const admitted=host.indexOf("const admission=await config.gateway.admitVerifiedOperationalEpoch(");
 const condition=host.indexOf("if(config.planRepairEpoch!.executeAdmittedRepairDag)",admitted);
 const dispatch=host.indexOf(loadDag);
 assert.ok(proof>=0&&checked>proof&&history>checked&&planning>history);
 assert.ok(admitted>planning&&condition>admitted&&dispatch>condition);
 assert.match(host,/await import\(\s*"\.\/trusted-owner-repair-planning-core\.ts"\s*\);\s*await config\.verifyLiveRun\?\.\(\)/u);
 assert.match(host,/await import\(\s*"\.\/trusted-owner-repair-dag-execution\.ts"\s*\);\s*await config\.verifyLiveRun!\(\)/u);
 assert.doesNotMatch(host,/await import\(\s*"\.\/trusted-(?:operational-repair-planner|repair-dag-controller)\.ts"\s*\)/u);
 assert.match(host,/beforePlanner\.credential_id!==root\.credential_id/u);
 assert.match(host,/beforePlanner\.plan_digest!==r\.plan_digest/u);
 assert.match(host,/beforeDispatch\.credential_id!==root\.credential_id/u);
 assert.match(host,/beforeDispatch\.plan_digest!==r\.plan_digest/u);
 assert.match(host,/report\.docker_pass_verified!==false/u);
 assert.match(host,/report\.pull_request_created!==false/u);
});

test("R413 source graph proves old repair wrappers absent and no executable callers",()=>{
 const refs=collectLegacyReferences(root,gitTrackedFiles(root),{
  candidates:[oldPlanner,oldDag,newPlanner,newDag]
 });
 const oldRows=refs.candidates.filter(x=>x.target===oldPlanner||x.target===oldDag);
 const newRows=refs.candidates.filter(x=>x.target===newPlanner||x.target===newDag);
 assert.equal(oldRows.length,2);
 for(const old of oldRows){
  assert.equal(old.exists,false);
  assert.deepEqual(old.staticImporters,[]);
  assert.deepEqual(old.runtimeIndirectionHints,[]);
  assert.deepEqual(old.configuredCallers,[]);
 }
 for(const row of newRows){
  assert.equal(row.exists,true);
  assert.deepEqual(row.runtimeIndirectionHints.map(x=>x.source),[owner],
   "exactly one guarded Owner runtime loader remains");
  assert.deepEqual(row.configuredCallers,[]);
  assert.ok(!row.staticImporters.some(edge=>
   edge.source===oldPlanner||edge.source===oldDag));
 }
 assert.ok(refs.unresolvedRuntimeIndirections.length>0,
  "computed/external import uncertainties remain explicitly unproven");
});
test("R410 no-AI positive Security CI watches migrated owner runtime boundaries",()=>{
 const wf=read(".github/workflows/isolated-positive-security-ci.yml");
 const paths=[
  "poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs",
  "poc/packages/orchestrator-runtime/src/trusted-owner-reviewed-dag-execution.ts",
  "poc/packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts",
  "poc/packages/orchestrator-runtime/src/trusted-owner-repair-planning-core.ts",
  "poc/packages/orchestrator-runtime/src/trusted-owner-repair-dag-execution.ts",
  "poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs"
 ];
 for(const file of paths)assert.ok(wf.includes("      - '"+file+"'"),
  "positive native Security CI must trigger on: "+file);
 assert.match(wf,/uses: \.\/\.github\/workflows\/r38513-native-strict-full-recovery\.yml/u,
  "native Rust/OPA/private MCP/Docker full recovery must remain reusable");
 assert.match(wf,/node --experimental-vm-modules --experimental-strip-types --test poc\/scripts\/test\/r409-owner-repair-core-migration\.test\.mjs/u,
  "Security CI must run R409 no-AI Owner gate before Docker");
 assert.doesNotMatch(wf,/^\s+(?:GEMINI_API_KEY|OPENAI_API_KEY):/mu,
  "positive no-AI workflow must never accept model secrets");
});
