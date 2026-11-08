import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
 auditR38517WorkflowRoutes,auditR38517CallerInventory,
 R38518_ALLOWED_NONTEST_LEGACY_CALLERS,
 classifyCaller,configuredWorkflowEvents,scanR38517
} from "../r38517-canonical-route-closure.mjs";
import {r38516LegacyInventory,PRIVATE_MCP_KEEP}
 from "../r38516-human-gate-and-legacy-reachability.mjs";
import {gitTrackedFiles} from "../r6-legacy-references.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=path=>readFileSync(resolve(root,path),"utf8");
const base=Object.freeze({
 phase11:read(".github/workflows/phase11-security.yml"),
 positive:read(".github/workflows/isolated-positive-security-ci.yml"),
 native:read(".github/workflows/r38513-native-strict-full-recovery.yml"),
 bootstrap:read("poc/apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs")
});
function reject(patch,message){
 const x=auditR38517WorkflowRoutes({...base,...patch});
 assert.equal(x.status,"ROUTES_FAIL");
 assert.match(x.issues.join("\n"),message);
 assert.equal(x.deletionAuthorized,false);
}
test("R385.17 no automatic legacy Adapter on main; positive CI follows active branch",()=>{
 const r=auditR38517WorkflowRoutes(base);
 assert.equal(r.status,"ROUTES_STATIC_OK",r.issues.join("\n"));
 assert.deepEqual(r.phase11Events,["workflow_dispatch"]);
 assert.deepEqual(r.positiveEvents,["push","workflow_dispatch"]);
 assert.deepEqual(r.nativeEvents,["workflow_call","workflow_dispatch","push"]);
 assert.equal(r.positiveSecurityCiNoAi,true);
 assert.equal(r.deploymentConfigurationsVerified,false);
 assert.equal(r.deletionAuthorized,false);
});
test("R385.17 reject any automatic old Phase11 Adapter startup",()=>{
 for(const trigger of ["push","schedule","workflow_run","pull_request","repository_dispatch"]){
  reject({phase11:base.phase11.replace("on:\n  workflow_dispatch:",
   "on:\n  "+trigger+":\n  workflow_dispatch:")},
   /Phase11 legacy HTTP Adapter must be manual-only/u);
 }
 reject({phase11:base.phase11.replace("on:\n  workflow_dispatch:",
  "on:\n  push:")},/Phase11 legacy HTTP Adapter must be manual-only/u);
});
test("R385.17 positive Security CI must not regress to historic branch or paid inference",()=>{
 reject({positive:base.positive.replace(
  "branches: [refactor/post-prof-plan-contracts-20261021]",
  "branches: [feat/shared-mcp-spike]")},
  /positive Security CI must target the active authority-only branch/u);
 reject({positive:base.positive.replace(
  "security-ci:isolated-positive-smoke","security-ci:disabled")},
  /positive Security CI lost its disposable independent Runner test/u);
 reject({positive:base.positive+"\n# GOOGLE_API_KEY: untrusted\n"},
  /positive Security CI cannot have paid-model credentials/u);
});
test("R385.18 positive Security CI cannot omit canonical Rust/Child/VP reuse",()=>{
 reject({positive:base.positive.replace(
  "uses: ./.github/workflows/r38513-native-strict-full-recovery.yml",
  "uses: ./.github/workflows/retired-shared-mcp.yml")},
  /positive Security CI must invoke canonical no-AI Rust\/Child\/VP full E2E/u);
 reject({positive:base.positive.replace(
  "'"+".github/workflows/r38513-native-strict-full-recovery.yml"+"'",
  "'"+".github/workflows/retired-workflow.yml"+"'")},
  /native reusable workflow changes must trigger positive Security CI/u);
 reject({native:base.native.replace("  workflow_call:","  # workflow_call retired:")},
  /canonical native E2E must be reusable/u);
});
test("R385.17 native Rust/MCP route must never fall back to HTTP Adapter",()=>{
 reject({native:base.native.replace(
  'R3818_CANONICAL_NATIVE_MCP: "1"',
  'R3818_CANONICAL_NATIVE_MCP: "0"')},
  /native E2E must retain trusted Rust\/MCP strict recovery route/u);
 reject({native:base.native.replace(
  "if cargo run --quiet","cargo run --quiet")},
  /native E2E legacy Adapter must be only an expected-failure guard/u);
 reject({native:base.native+"\n        run: cargo run --features legacy-http\n"},
  /native E2E legacy Adapter must be only an expected-failure guard/u);
 reject({bootstrap:base.bootstrap.replaceAll(
  "createNativeRustChildCryptographyPort","removedNativeRustPort")},
  /canonical owner must directly compose native Rust Child/u);
});
test("R385.17 caller classifier preserves unknown/canonical cases for review",()=>{
 assert.equal(classifyCaller(".github/workflows/old.yml"),"workflow-entrypoint-review");
 assert.equal(classifyCaller("poc/apps/gateway/test/unit.test.ts"),
  "historical-or-regression-test");
 assert.equal(classifyCaller("poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs"),
  "canonical-owner-review-required");
 assert.equal(classifyCaller("poc/apps/orchestrator/src/old.mjs"),
  "historical-runtime-import-review");
 assert.equal(classifyCaller("poc/packages/agent-runtime/scripts/legacy.mjs"),
  "script-entrypoint-review");
 assert.equal(classifyCaller(null),"unknown-caller-review");
 assert.deepEqual(configuredWorkflowEvents("on:\n  workflow_dispatch:\npermissions:\n  contents: read"),
  ["workflow_dispatch"]);
});
test("R385.17 canonical owner importing legacy creates an explicit migration blocker",()=>{
 const fake={
  status:"INVENTORY_PROVENANCE_OK",
  legacyModules:Array.from({length:5},(_,i)=>({
   path:"legacy-"+i,present:true,
   staticImporters:i===0?[
    "poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs"
   ]:[],runtimeHints:[],configuredCallers:[]
  })),
  protectedModules:PRIVATE_MCP_KEEP.map(path=>({path,present:true})),
  unresolvedRuntimeIndirections:117
 };
 const report=auditR38517CallerInventory(fake);
 assert.equal(report.status,"CALLER_INVENTORY_FAIL");
 assert.match(report.issues.join("\n"),/Canonical owner still references legacy module/u);
 assert.equal(report.deletionAuthorized,false);
 fake.legacyModules[0].staticImporters=[];
 fake.protectedModules[0].present=false;
 const missing=auditR38517CallerInventory(fake);
 assert.equal(missing.status,"CALLER_INVENTORY_FAIL");
 assert.match(missing.issues.join("\n"),/Native private crypto MCP source must not be removed/u);
});
test("R385.17 real tracked graph retains every private MCP module; not deletion approval",()=>{
 const tracked=gitTrackedFiles(root);
 const r=scanR38517(root,tracked);
 assert.equal(r.status,"R38517_MIGRATION_GATE_PASS",
  JSON.stringify([...r.routes.issues,...r.callers.issues]));
 assert.equal(r.callers.modules.length,5);
 assert.equal(r.callers.privateMcp.length,4);
 assert.ok(r.callers.privateMcp.every(m=>m.present));
 assert.ok(r.callers.modules.filter(m=>/trusted-(?:reviewed-approved-dag|operational-repair-planner|repair-dag-controller)\.ts$/u.test(m.path)).every(m=>!m.present));
 assert.ok(r.callers.modules.filter(m=>!/trusted-(?:reviewed-approved-dag|operational-repair-planner|repair-dag-controller)\.ts$/u.test(m.path)).every(m=>m.present));
 assert.equal(r.callers.deletionAuthorized,false);
 assert.equal(r.callers.externalConsumersVerified,false);
 assert.ok(r.callers.unresolvedIndirections>0);
 const direct=r38516LegacyInventory(root,tracked);
 assert.equal(direct.status,"INVENTORY_PROVENANCE_OK");
});

test("R385.18/R409 owner repair DAG core retains neutral credential types, never HTTP issuer",()=>{
 assert.equal(existsSync(resolve(root,"poc/packages/orchestrator-runtime/src/trusted-repair-dag-controller.ts")),false,
  "retired DAG wrapper must stay absent");
 const controller=read("poc/packages/orchestrator-runtime/src/trusted-owner-repair-dag-execution.ts");
 const neutral=read("poc/packages/orchestrator-runtime/src/trusted-credential-contracts.ts");
 assert.match(controller,
  /import type \{ChildIssuanceInput\} from "\.\/trusted-credential-contracts\.ts";/u);
 assert.doesNotMatch(controller,/from "\.\/authority-client\.ts"/u,
  "repair DAG data type must not depend on HTTP Engineer client");
 assert.doesNotMatch(controller,/from "\.\/authority-adapter-transport\.ts"/u,
  "Owner repair DAG must not import HTTP Adapter transport");
 assert.match(neutral,/export interface ChildIssuanceInput/u);
 assert.doesNotMatch(neutral,/authority-adapter-transport|postCredential|fetch\(/u,
  "neutral credential shapes are not an HTTP authority transport");
 // The actual Owner DAG remains protected; its historical wrapper is retired.
 const observed=r38516LegacyInventory(root,gitTrackedFiles(root));
 const issuer=observed.legacyModules.find(x=>
  x.path==="poc/packages/orchestrator-runtime/src/authority-client.ts");
 assert.ok(issuer);
 assert.ok(!issuer.staticImporters.includes(
  "poc/packages/orchestrator-runtime/src/trusted-repair-dag-controller.ts"));
});

test("R385.18 deny any new runtime or script importer of a historical HTTP/DAG module",()=>{
 const rows=Object.entries(R38518_ALLOWED_NONTEST_LEGACY_CALLERS);
 assert.equal(rows.length,5,"exact known historical migration targets");
 const fake={
  status:"INVENTORY_PROVENANCE_OK",
  legacyModules:rows.map(([path,allowed])=>({
   path,present:!/(?:trusted-reviewed-approved-dag|trusted-operational-repair-planner|trusted-repair-dag-controller)\.ts$/u.test(path),
   staticImporters:[],
   runtimeHints:allowed.map(source=>({source,kind:"dynamic-import"})),
   configuredCallers:[]
  })),
  protectedModules:PRIVATE_MCP_KEEP.map(path=>({path,present:true})),
  unresolvedRuntimeIndirections:117
 };
 const accepted=auditR38517CallerInventory(fake);
 assert.equal(accepted.status,"CALLER_INVENTORY_OK",accepted.issues.join("\n"));
 assert.equal(accepted.deletionAuthorized,false);
 const suspicious="poc/packages/orchestrator-runtime/src/unreviewed-new-issuer.ts";
 fake.legacyModules[0].staticImporters.push(suspicious);
 const denied=auditR38517CallerInventory(fake);
 assert.equal(denied.status,"CALLER_INVENTORY_FAIL");
 assert.match(denied.issues.join("\n"),
  /Unexpected new non-test legacy caller: .*authority-client\.ts/u);
 assert.ok(denied.issues.some(x=>x.includes(suspicious)));
 assert.equal(denied.deletionAuthorized,false);
});
