import test from "node:test";
import assert from "node:assert/strict";
import {analyzeR404} from "../r404-test-and-script-coverage-audit.mjs";
function fake(){
 const files={
  ".github/workflows/fast-ci.yml":
   "name: CI\non:\n  push:\njobs:\n  job:\n    steps:\n      - name: Offline\n        run: |\n          npm --prefix poc run gateway:test\n          node --check poc/apps/gateway/test/syntax.test.mjs\n          node --test --test-name-pattern='one' poc/apps/gateway/test/filtered.test.mjs\n",
  ".github/workflows/manual.yml":"jobs:\n  call:\n    uses: ./.github/workflows/fast-ci.yml\n",
  "poc/package.json":JSON.stringify({scripts:{"gateway:test":"npm run test -w @thesis/gateway"}}),
  "poc/apps/gateway/package.json":JSON.stringify({name:"@thesis/gateway",
   scripts:{test:"node --experimental-strip-types --test ./test/*.test.ts"}}),
  "poc/apps/gateway/test/a.test.ts":"import test from 'node:test';test('a',()=>{});",
  "poc/apps/gateway/test/b.test.ts":"import test from 'node:test';test('b',()=>{});",
  "poc/apps/gateway/test/syntax.test.mjs":"export const syntax=true;",
  "poc/apps/gateway/test/filtered.test.mjs":"export const filtered=true;",
  "poc/apps/gateway/test/unobserved.test.mjs":"export const unused=true;"
 };
 return {tracked:Object.keys(files),
  read:path=>{if(!Object.hasOwn(files,path))throw Error("unreadable");return files[path]}};
}
const row=(r,path)=>r.records.find(x=>x.path==="poc/apps/gateway/test/"+path);
test("R404 expands npm workspace scripts and test globs without executing tests",()=>{
 const report=analyzeR404(fake());
 for(const p of ["a.test.ts","b.test.ts"]){
  assert.equal(row(report,p).kind,"TEST_CONFIGURED");
  assert.equal(row(report,p).executionAttested,false);
  assert.ok(row(report,p).configuredTestCalls.some(x=>x.glob&&x.via.includes("@thesis/gateway")));
 }
 assert.equal(report.summary.scriptsExpanded,2);
 assert.ok(report.reusableWorkflows.some(x=>x.present&&x.to===".github/workflows/fast-ci.yml"));
 assert.equal(report.actualCIRunsCorrelated,false);
});
test("R404 distinguishes syntax-only, filtered and unobserved test sources",()=>{
 const r=analyzeR404(fake());
 assert.equal(row(r,"syntax.test.mjs").kind,"SYNTAX_ONLY");
 assert.equal(row(r,"filtered.test.mjs").kind,"FILTERED_TEST_CONFIGURED");
 assert.equal(row(r,"unobserved.test.mjs").kind,"NO_CONFIGURED_TEST_OBSERVED");
 assert.ok(r.records.every(x=>x.deletionAuthorized===false));
 assert.equal(r.automaticDeletionAuthorized,false);
});
test("R404 identical hashes only nominate review, never deletion",()=>{
 const f=fake(),load=f.read;
 const report=analyzeR404({...f,read:path=>path.endsWith("/b.test.ts")?
  load("poc/apps/gateway/test/a.test.ts"):load(path)});
 assert.equal(report.summary.identicalBytesGroups,1);
 assert.equal(report.exactDuplicateGroups[0].deletionAuthorized,false);
});
test("R404 refuses missing protected security test sources in strict mode",()=>{
 assert.throws(()=>analyzeR404({...fake(),strictWitnesses:true}),
  /R404 missing security witnesses/u);
 assert.ok(analyzeR404(fake()).summary.missingSecurityWitnessGroups.length);
});
