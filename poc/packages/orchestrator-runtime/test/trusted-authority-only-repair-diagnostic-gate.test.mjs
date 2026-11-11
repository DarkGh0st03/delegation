import test from "node:test";
import assert from "node:assert/strict";
import {selectTrustedRepairDiagnosticRead as select}
 from "../src/trusted-authority-only-repair-diagnostic-gate.mjs";
const branch="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const file=branch+"/files/apps/backend.ts",testFile=branch+"/files/tests/backend/generated.test.ts";
const sha="a".repeat(40),digest="c".repeat(64);
const fixture=(role="backend",resource=file)=>({
 repairTask:{task_id:"fresh-repair",agent_id:role,
  permissions:["read_file","update_file"].map(operation=>({operation,resource}))},
 failedEpoch:2,currentHead:sha,
 readRecords:[{task_id:"independent-read",agent_id:role,epoch:3,
  revision:sha,resource,
  signed_permissions:[{operation:"read_file",resource}],
  gateway_task_completed:true,evidence_sha256:digest,gateway_evidence_sha256:digest}]
});
test("R385.6 independent after-failure source read authorizes only same-role current-HEAD UPDATE",()=>{
 const f=fixture();
 const result=select(f);
 assert.deepEqual(result,{status:"owner_verified_signed_diagnostic_read_for_repair",
  repair_task_id:"fresh-repair",read_task_id:"independent-read",
  agent_id:"backend",resource:file,revision:sha,evidence_sha256:digest});
 assert.equal(Object.isFrozen(result),true);
 // Test Agent is not a Backend replacement: its exact test source is allowed.
 assert.equal(select(fixture("test",testFile)).agent_id,"test");
});
test("R385.6 no read, wrong read time, stale HEAD, or unconfirmed Gateway fails closed",()=>{
 for(const mutate of [
  x=>{x.readRecords=[];},
  x=>{x.readRecords[0].epoch=2;},
  x=>{x.readRecords[0].epoch=1;},
  x=>{x.readRecords[0].revision="b".repeat(40);},
  x=>{x.readRecords[0].gateway_task_completed=false;},
  x=>{x.readRecords[0].gateway_evidence_sha256="d".repeat(64);},
  x=>{x.readRecords[0].evidence_sha256="bad";},
  x=>{x.readRecords[0].signed_permissions=[];},
  x=>{x.readRecords[0].signed_permissions[0].operation="update_file";},
  x=>{x.readRecords[0].signed_permissions[0].resource=testFile;},
  x=>{x.readRecords[0].agent_id="frontend";},
  x=>{x.readRecords[0].resource=testFile;},
  x=>{x.readRecords[0].task_id="fresh-repair";},
  x=>{x.readRecords.push(structuredClone(x.readRecords[0]));}
 ]){const x=fixture();mutate(x);
  assert.throws(()=>select(x),/R385\.6 signed diagnostic repair NO-GO/u);}
});
test("R385.6 original Engineer Root cannot be expanded by a read candidate",()=>{
 for(const mutate of [
  x=>{x.repairTask.agent_id="orchestrator";},
  x=>{x.repairTask.permissions=[{operation:"create_file",resource:file}];},
  x=>{x.repairTask.permissions=[{operation:"run_tests",resource:branch}];},
  x=>{x.repairTask.permissions.push({operation:"read_file",resource:testFile});},
  x=>{x.repairTask.permissions.push({operation:"create_file",resource:file});},
  x=>{x.failedEpoch=0;},
  x=>{x.currentHead="invalid";},
  x=>{x.readRecords[0].signed_permissions.push({operation:"update_file",resource:file});}
 ]){const x=fixture();mutate(x);
  assert.throws(()=>select(x),/R385\.6 signed diagnostic repair NO-GO/u);}
});
test("R385.6 signed Test repair cannot borrow earlier Backend source read",()=>{
 const x=fixture("test",testFile);
 x.readRecords[0].agent_id="backend";
 assert.throws(()=>select(x),/R385\.6 signed diagnostic repair NO-GO/u);
});
