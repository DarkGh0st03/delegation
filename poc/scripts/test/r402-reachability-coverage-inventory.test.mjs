import test from "node:test";
import assert from "node:assert/strict";
import {analyzeR402,SECURITY_WITNESSES} from "../r402-reachability-coverage-inventory.mjs";

function fixture(){
 const documents={
  ".github/workflows/fast-ci.yml":"name: CI\non:\n  push:\n    branches: [feature/a]\n",
  ".github/workflows/child.yml":"name: manual\non:\n  workflow_dispatch:\n",
  "poc/package.json":JSON.stringify({scripts:{start:"node ./src/main.mjs"}}),
  "poc/src/main.mjs":"import './helper.mjs';\nimport('./dyn.mjs');\nimport(variable);\nexport const ready=true;",
  "poc/src/helper.mjs":"export * from './leaf.mjs';",
  "poc/src/leaf.mjs":"export const leaf=1;",
  "poc/src/dyn.mjs":"export const dynamic=1;",
  "poc/src/unused.mjs":"export const unused=1;",
  "poc/src/sample.test.mjs":"import './helper.mjs';"
 };
 return {tracked:Object.keys(documents),
  read:path=>{
   if(!Object.hasOwn(documents,path))throw Error("unreadable");
   return documents[path];
  }};
}
test("R402 parses ESM+literal dynamic edges and traces script entrypoints",()=>{
 const r=analyzeR402(fixture());
 const byPath=new Map(r.files.map(f=>[f.path,f]));
 assert.equal(r.deletionAuthorized,false);
 assert.equal(r.runtimeReachabilityCertified,false);
 assert.ok(byPath.get("poc/src/main.mjs").potentiallyReachable);
 assert.ok(byPath.get("poc/src/helper.mjs").potentiallyReachable);
 assert.ok(byPath.get("poc/src/leaf.mjs").potentiallyReachable);
 assert.ok(byPath.get("poc/src/dyn.mjs").potentiallyReachable);
 assert.equal(byPath.get("poc/src/unused.mjs").potentiallyReachable,false);
 assert.ok(r.unresolved.some(x=>x.source==="poc/src/main.mjs"&&
  x.kind==="computed-dynamic-import"));
 assert.deepEqual(byPath.get("poc/src/main.mjs").outgoing.map(x=>x.kind).sort(),
  ["dynamic-import","static-esm"]);
 assert.ok(byPath.get("poc/package.json").outgoing.some(x=>
  x.to==="poc/src/main.mjs"&&x.kind==="configuration-literal-mention"));
 assert.equal(byPath.get("poc/src/unused.mjs").kind,"source");
});
test("R402 separate test reachability does not claim CI execution",()=>{
 const r=analyzeR402(fixture());
 const testFile=r.files.find(f=>f.path==="poc/src/sample.test.mjs");
 assert.equal(testFile.testGraphReachable,true);
 assert.equal(testFile.potentiallyReachable,false);
 assert.ok(r.witnesses.every(x=>x.executedInThisAudit===false));
 assert.equal(r.testCoverageAttested,false);
 assert.equal(r.paidInferenceCalls,0);
});
test("R402 unresolved relative imports cannot turn into deletion approval",()=>{
 const f=fixture();
 const old=f.read;
 const r=analyzeR402({...f,read:path=>
  path==="poc/src/main.mjs"?
   "import './missing.mjs';\nimport('./other.mjs');\n":old(path)});
 assert.ok(r.unresolved.some(x=>x.kind==="unresolved-relative-static"&&
  x.specifier==="./missing.mjs"));
 assert.ok(r.unresolved.some(x=>x.kind==="unresolved-relative-indirection"&&
  x.specifier==="./other.mjs"));
 assert.equal(r.deletionAuthorized,false);
});
test("R402 cannot certify security witnesses from a tiny synthetic repository",()=>{
 const f=fixture();
 assert.throws(()=>analyzeR402({...f,strictWitnesses:true}),
  /R402 security witnesses missing/u);
 assert.ok(Object.isFrozen(SECURITY_WITNESSES));
 assert.ok(SECURITY_WITNESSES.human_gate.length>=1);
 assert.ok(SECURITY_WITNESSES.private_crypto_mcp.length>=1);
});
