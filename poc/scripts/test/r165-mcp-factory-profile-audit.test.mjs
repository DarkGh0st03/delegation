import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {inspectMcpFactoryCalls} from "../r165-mcp-factory-profile-audit.mjs";

test("R188 all tracked factory calls use crypto-only",()=>{
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const report=inspectMcpFactoryCalls(root);
 assert.deepEqual(report.errors,[]);
 assert.ok(report.calls.length>=4);
 assert.ok(report.calls.every(c=>c.profile!=="legacy"));
 assert.ok(report.calls.some(c=>c.profile==="crypto"));
 assert.deepEqual(report.calls.filter(c=>
  c.file==="poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"
 ).map(c=>c.profile),["crypto"]);
});
