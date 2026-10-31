import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {buildNativePreliminaryEnvironment} from "../scripts/native-preliminary-environment.mjs";
const fixtures={opaUrl:"http://127.0.0.1:8181",giteaUrl:"http://127.0.0.1:3000",
 readToken:"disposable-read-fixture",mainSha:"a".repeat(40)};
const parent={ADAPTER_TRUST_PROFILE:"evm",GATEWAY_VERIFIER_MODE:"core-rust",
 ADAPTER_CALLER_ORCHESTRATOR:"local-native-orchestrator-ci",
 ADAPTER_CALLER_ENGINEER:"local-native-engineer-ci",ADAPTER_ID_ENGINEER:"did:example:engineer",
 DELEGATION_SIGNED_GEMINI_PILOT:"1",DELEGATION_SIGNED_GEMINI_REPAIR_D1:"1",
 DELEGATION_GEMINI_REPAIR_CHARGE_CONFIRMATION:"I AUTHORIZE ONE ADDITIONAL GEMINI REPAIR EPOCH",
 DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
 GEMINI_API_KEY:"fixture-key-not-for-provider-use",APPROVED_RUNNER_SCENARIO:"account-suspension"};

test("R151.81 reproduce the exact old inherited-repair guard without API access",()=>{
 const script=fileURLToPath(new URL("../../gateway/native-test/native-planning-read-core-evm-e2e.mjs",import.meta.url));
 const oldChild={...process.env,...parent,DELEGATION_SIGNED_GEMINI_PILOT:"0",GEMINI_API_KEY:"",
  APPROVED_RUNNER_NATIVE_OWNER_REPAIR_D1:"0",APPROVED_RUNNER_SIGNED_DAG_TYPECHECK_PROBE:"0",
  APPROVED_RUNNER_SIGNED_DAG_ACCEPTANCE_PROBE:"0",APPROVED_RUNNER_NATIVE_D1_MULTI_TYPECHECK_PROBE:"0"};
 const child=spawnSync(process.execPath,["--experimental-strip-types",script],{
  env:oldChild,encoding:"utf8",timeout:15000,maxBuffer:1024*1024});
 assert.equal(child.status,1);
 assert.match(child.stderr,/R151\.12 paid repair epoch requires separate explicit billing consent/u);
 assert.equal(oldChild.GEMINI_API_KEY,"");
});

test("R151.81 preliminary child clears both paid switches, acknowledgements and key while preserving native fixtures",()=>{
 const child=buildNativePreliminaryEnvironment(parent,fixtures);
 assert.equal(child.DELEGATION_SIGNED_GEMINI_PILOT,"0");
 assert.equal(child.DELEGATION_SIGNED_GEMINI_REPAIR_D1,"0");
 assert.equal(child.DELEGATION_GEMINI_REPAIR_CHARGE_CONFIRMATION,"NO ADDITIONAL REPAIR AUTHORIZED");
 assert.equal(child.GEMINI_API_KEY,"");
 assert.notEqual(child.DELEGATION_GEMINI_CHARGE_CONFIRMATION,parent.DELEGATION_GEMINI_CHARGE_CONFIRMATION);
 assert.equal(child.ADAPTER_TRUST_PROFILE,"evm");assert.equal(child.GATEWAY_VERIFIER_MODE,"core-rust");
 assert.equal(child.PLANNING_DISPOSABLE_GITEA_READ_TOKEN,fixtures.readToken);
 assert.equal(child.PLANNING_DISPOSABLE_GITEA_MAIN_SHA,fixtures.mainSha);
 assert.equal(child.PLANNING_NATIVE_SIGNED_HANDOFF,"1");
 assert.equal(child.PLANNING_NATIVE_POSITIVE_DAG,"0");
});

test("R151.81 rehearsal does not disable the later explicitly authorized parent pilot/repair",()=>{
 const before=structuredClone(parent);
 buildNativePreliminaryEnvironment(parent,fixtures);
 assert.deepEqual(parent,before);
 const laterOperationalChild={...parent,PLANNING_NATIVE_POSITIVE_DAG:"1"};
 assert.equal(laterOperationalChild.DELEGATION_SIGNED_GEMINI_PILOT,"1");
 assert.equal(laterOperationalChild.DELEGATION_SIGNED_GEMINI_REPAIR_D1,"1");
 assert.equal(laterOperationalChild.DELEGATION_GEMINI_REPAIR_CHARGE_CONFIRMATION,
  "I AUTHORIZE ONE ADDITIONAL GEMINI REPAIR EPOCH");
 assert.equal(laterOperationalChild.GEMINI_API_KEY,parent.GEMINI_API_KEY);
});
