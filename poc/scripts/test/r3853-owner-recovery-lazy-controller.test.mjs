/**
 * R385.3: no historical signed-DAG repair controller at owner module load.
 * These are offline source and interface boundary tests: no model, credentials,
 * GitHub dispatch, A2A Task, Gateway request or native Rust side effects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const path="poc/packages/orchestrator-runtime/src/";
const owner=read(path+"trusted-owner-operational-repair-handoff.ts");

test("R385.3 owner imports repair planner and DAG controller only as erased TypeScript types",()=>{
 const names=[
  ["TrustedOperationalRepairPlanner","trusted-operational-repair-planner.ts"],
  ["executeTrustedAdmittedRepairDag","trusted-repair-dag-controller.ts"]
 ];
 for(const [symbol,filename] of names){
  assert.doesNotMatch(owner,new RegExp(
   String.raw`import\\s*\\{\\s*`+symbol+String.raw`\\b[\\s\\S]*?from\\s*["']\\./`+filename.replaceAll(".",String.raw`\.`)),
   symbol+" must not be imported as runtime eager code");
  assert.match(owner,new RegExp(String.raw`import type \\{`+
   (symbol==="TrustedOperationalRepairPlanner"?"TrustedRepairModelInput":symbol)+
   String.raw`\\}\\s*from ["']\\./`+filename.replaceAll(".",String.raw`\.`)),
   symbol+" must retain exact compile-time contracts");
  assert.match(owner,new RegExp(String.raw`await import\\(\\s*["']\\./`+
   filename.replaceAll(".",String.raw`\.`)+String.raw`["']\\s*\\)`),
   symbol+" must be loaded only within the owner callback");
 }
});

test("R385.3 planner is reachable only after independently verified finalized Test FAIL",()=>{
 const proof=owner.indexOf("const proof=await prepareTrustedRemoteRepairFeedback(");
 const confirmed=owner.indexOf('if(JSON.stringify(proof)!==JSON.stringify(signal))');
 const structured=owner.indexOf("if(structured){",confirmed);
 const history=owner.indexOf('observe("d1_history_verification")',structured);
 const moduleLoad=owner.indexOf('const {TrustedOperationalRepairPlanner}=await import(');
 const planner=owner.indexOf("const planner=new TrustedOperationalRepairPlanner(",moduleLoad);
 assert.ok(proof>=0&&confirmed>proof&&structured>confirmed&&history>structured&&
  moduleLoad>history&&planner>moduleLoad,
  "No repair planner before authentic Gateway Test FAIL and original signed epoch history");
 const gap=owner.slice(moduleLoad,planner);
 assert.match(gap,/await config\.verifyLiveRun\?\.\(\)/u);
 assert.match(gap,/trustedOperationalAuthority\(\)/u);
 assert.match(gap,/beforePlanner\.credential_id!==root\.credential_id/u);
 assert.match(gap,/beforePlanner\.plan_digest!==r\.plan_digest/u);
});

test("R385.3 repair DAG controller loads only after independent Gateway epoch admission",()=>{
 const admission=owner.indexOf("const admission=await config.gateway.admitVerifiedOperationalEpoch(");
 const admissionCheck=owner.indexOf('fail("Gateway epoch admission did not match reserved signed DAG")',admission);
 const guarded=owner.indexOf("if(config.planRepairEpoch!.executeAdmittedRepairDag)",admissionCheck);
 const moduleLoad=owner.indexOf('const {executeTrustedAdmittedRepairDag}=await import(');
 const dispatch=owner.indexOf("const report=await executeTrustedAdmittedRepairDag(",moduleLoad);
 assert.ok(admission>=0&&admissionCheck>admission&&guarded>admissionCheck&&
  moduleLoad>guarded&&dispatch>moduleLoad,
  "No DAG controller before signed epoch admitted and owner explicitly opts into D1 execution");
 const gap=owner.slice(moduleLoad,dispatch);
 assert.match(gap,/await config\.verifyLiveRun!\(\)/u);
 assert.match(gap,/trustedOperationalAuthority\(\)/u);
 assert.match(gap,/beforeDispatch\.credential_id!==root\.credential_id/u);
 assert.match(gap,/beforeDispatch\.plan_digest!==r\.plan_digest/u);
 assert.match(owner.slice(dispatch),/if\(report\.status!==[\s\S]*?report\.docker_pass_verified!==false[\s\S]*?report\.pull_request_created!==false/u,
  "A2A repair report cannot self-certify Docker PASS or PR creation");
});
