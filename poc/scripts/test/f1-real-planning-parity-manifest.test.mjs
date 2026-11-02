import test from "node:test";
import assert from "node:assert/strict";
import {realPlanningParityManifest} from "../f1-real-planning-parity-manifest.mjs";
import {accountSuspensionPlanningConfig} from "../account-suspension-planning-config.mjs";
function fixture(){
 return {snapshot:{
   repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
   base_revision:"a".repeat(40),
   files:["apps/a.ts","apps/b.ts"],directories:["apps",""]
 },requirement:"Account suspension",workBranch:"feature/native-planning-read",
 planId:"native-planning-proposal"};
}
test("real-planning-only and pilot have identical trusted planning budgets",()=>{
 assert.deepEqual(accountSuspensionPlanningConfig("real-planning-only"),
   accountSuspensionPlanningConfig("pilot"));
});
test("reordered inventories do not alter the manifest",()=>{
 const a=fixture(),b=fixture();
 b.snapshot.files.reverse();b.snapshot.directories.reverse();
 assert.deepEqual(realPlanningParityManifest(a),realPlanningParityManifest(b));
 assert.equal(realPlanningParityManifest(a).manifest_digest.length,64);
});
test("manifest changes for requirement, pinned SHA, inventory, branch and plan id",()=>{
 const expected=realPlanningParityManifest(fixture()).manifest_digest;
 const changes=[
  x=>{x.requirement="other";},
  x=>{x.snapshot.base_revision="b".repeat(40);},
  x=>{x.snapshot.files.push("apps/other.ts");},
  x=>{x.snapshot.directories.push("new");},
  x=>{x.workBranch="feature/different";},
  x=>{x.planId="different-plan";}
 ];
 for(const change of changes){
  const sample=fixture();change(sample);
  assert.notEqual(realPlanningParityManifest(sample).manifest_digest,expected);
 }
});
test("invalid or duplicate trust pins fail closed",()=>{
 const a=fixture();a.snapshot.files.push("apps/a.ts");
 assert.throws(()=>realPlanningParityManifest(a));
 const b=fixture();b.snapshot.base_revision="bogus";
 assert.throws(()=>realPlanningParityManifest(b));
 const c=fixture();c.requirement="";
 assert.throws(()=>realPlanningParityManifest(c));
});
