import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PREFIX,readNativePhaseFailure}
 from "./native-signed-dag-phase-diagnostic.mjs";
import {runGuardedNativePlanning}
 from "./native-planning-guarded-entrypoint.mjs";

async function preservingDiagnosticState(check){
 const oldEmission=globalThis.__nativeDagPhaseReported;
 const oldStage=globalThis.__nativeDagBootstrapStage;
 try{await check();}
 finally{
  if(oldEmission===undefined)delete globalThis.__nativeDagPhaseReported;
  else globalThis.__nativeDagPhaseReported=oldEmission;
  if(oldStage===undefined)delete globalThis.__nativeDagBootstrapStage;
  else globalThis.__nativeDagBootstrapStage=oldStage;
 }
}
test("R248 pre-try native issuer errors are reported without raw text",()=>preservingDiagnosticState(async()=>{
 delete globalThis.__nativeDagPhaseReported;
 globalThis.__nativeDagBootstrapStage="native_issuer_initialization";
 let output="";
 const ok=await runGuardedNativePlanning({
  load:async()=>{throw Object.assign(new TypeError("UNTRUSTED_DIAGNOSTIC_TEXT"),{
   code:"ERR_INVALID_ARG_TYPE"
  });},
  emit:line=>{output+=line;}
 });
 assert.equal(ok,false);
 assert.ok(output.startsWith(PREFIX));
 assert.doesNotMatch(output,/UNTRUSTED_DIAGNOSTIC_TEXT/u);
 const report=readNativePhaseFailure(output);
 assert.equal(report.stage,"native_issuer_initialization");
 assert.equal(report.kind,"TypeError");
 assert.equal(report.code,"ERR_INVALID_ARG_TYPE");
}));
test("R248 failed ESM module evaluation returns entrypoint_bootstrap",()=>preservingDiagnosticState(async()=>{
 delete globalThis.__nativeDagPhaseReported;
 delete globalThis.__nativeDagBootstrapStage;
 let output="";
 const ok=await runGuardedNativePlanning({
  load:async()=>{throw new SyntaxError("UNTRUSTED_PARSER_MESSAGE");},
  emit:line=>{output+=line;}
 });
 assert.equal(ok,false);
 const report=readNativePhaseFailure(output);
 assert.equal(report.stage,"entrypoint_bootstrap");
 assert.equal(report.kind,"SyntaxError");
 assert.doesNotMatch(output,/UNTRUSTED_PARSER_MESSAGE/u);
}));
test("R248 internal signed DAG phase is not overwritten",()=>preservingDiagnosticState(async()=>{
 globalThis.__nativeDagPhaseReported=true;
 let count=0;
 const ok=await runGuardedNativePlanning({
  load:async()=>{throw Error("UNTRUSTED");},
  emit:()=>{count++;}
 });
 assert.equal(ok,false);
 assert.equal(count,0);
}));
test("R248 successful module evaluation is unchanged",()=>preservingDiagnosticState(async()=>{
 delete globalThis.__nativeDagPhaseReported;
 const ok=await runGuardedNativePlanning({
  load:async()=>true,
  emit:()=>assert.fail("success cannot emit diagnostic")
 });
 assert.equal(ok,true);
}));
test("R248 wrapper is selected only for unbilled direct-Rust subprocess",()=>{
 const script=readFileSync(new URL(
  "../../test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs",
  import.meta.url),"utf8");
 assert.match(script,/ENGINEER_CORE_NATIVE_MODE==="1"&&\s*!realGeminiPilot/u);
 assert.match(script,/native-planning-guarded-entrypoint\.mjs/u);
 assert.match(script,/positiveOutput=execFileSync\(process\.execPath,\[\s*"--experimental-strip-types",signedNativeScript/u);
});
