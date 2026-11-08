/**
 * R407 offline tests. No Gitea, OPA, Docker, HTTP, tokens or paid models.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {SourceTextModule} from "node:vm";
import {scanRuntimeIndirections} from "../r6-legacy-references.mjs";
import {assertHistoricalRunnerEvmIssuerAllowed} from
 "../../apps/test-runner-controller/scripts/approved-runner-historical-issuer-gate.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const file="poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs";
const content=()=>readFileSync(resolve(root,file),"utf8");
const old="../..";
test("R407 legacy issuer absent from static Runner load graph",()=>{
 const src=content(),parsed=new SourceTextModule(src,{identifier:file});
 const path="../../../packages/orchestrator-runtime/src/authority-client.ts";
 assert.ok(!parsed.dependencySpecifiers.includes(path),
  "normal fixture import must not initialize HTTP Adapter issuer");
 const hints=scanRuntimeIndirections(src).hints.filter(x=>
  x.kind==="dynamic-import"&&x.specifier===path);
 assert.equal(hints.length,1,"one reviewable legacy dynamic edge remains");
 const entry=src.indexOf("    if(native){");
 const gated=src.indexOf("assertHistoricalRunnerEvmIssuerAllowed();",entry);
 const load=src.indexOf('const {SoftwareEngineerAuthorityBootstrap}=await import(',gated);
 const construct=src.indexOf("new SoftwareEngineerAuthorityBootstrap(",load);
 assert.ok(entry>=0&&gated>entry&&load>gated&&construct>load,
  "gate and dynamic load must remain inside explicit native EVM fixture");
 assert.equal(src.includes("DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE"),false,
  "Runner has its own legacy EVM fixture selector, not Engineer MCP escape hatch");
});
test("R407 fixture gate requires explicit historical EVM selection",()=>{
 for(const env of [{}, {APPROVED_RUNNER_NATIVE_EVM:"0"},
  {APPROVED_RUNNER_NATIVE_EVM:"true"}]){
  assert.throws(()=>assertHistoricalRunnerEvmIssuerAllowed(env),
   /explicit EVM fixture mode/u);
 }
 assert.doesNotThrow(()=>assertHistoricalRunnerEvmIssuerAllowed(
  {APPROVED_RUNNER_NATIVE_EVM:"1"}));
});
test("R407 canonical Rust flags override historical Runner EVM fixture",()=>{
 for(const flags of [
  {DELEGATION_GATEWAY_ARCHITECTURE:"authority-only"},
  {ENGINEER_CORE_NATIVE_MODE:"1"},
  {ADAPTER_ENGINEER_NATIVE_SOCKET:"/tmp/rust.sock"},
  {ADAPTER_ENGINEER_NATIVE_SOCKET:""},
  {R38513_NATIVE_STRICT_FULL_RECOVERY:"1"},
  {R3818_CANONICAL_NATIVE_MCP:"1"}
 ]){
  assert.throws(()=>assertHistoricalRunnerEvmIssuerAllowed({
   APPROVED_RUNNER_NATIVE_EVM:"1",...flags
  }),/forbidden in canonical native authority-only mode/u,
   "historical EVM fixture must never bypass a native mode: "+JSON.stringify(flags));
 }
});
test("R407 guard is pure and cannot import any issuer or provider",()=>{
 const gate=readFileSync(resolve(root,
  "poc/apps/test-runner-controller/scripts/approved-runner-historical-issuer-gate.mjs"),"utf8");
 const m=new SourceTextModule(gate,{identifier:"runner-fixture-gate"});
 assert.deepEqual(m.dependencySpecifiers,[]);
 assert.doesNotMatch(gate,/\b(?:fetch|import|require)\s*\(|@google\/adk/u);
 assert.match(gate,/APPROVED_RUNNER_NATIVE_EVM/u);
});
