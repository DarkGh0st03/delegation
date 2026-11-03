import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {inspectMcpFactoryCalls} from "../r165-mcp-factory-profile-audit.mjs";

test("R165 every tracked factory call selects crypto or explicit historical legacy",()=>{
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const report=inspectMcpFactoryCalls(root);
 assert.deepEqual(report.errors,[]);
 assert.ok(report.calls.length>=10);
 assert.ok(report.calls.some(c=>c.profile==="legacy"));
 assert.ok(report.calls.some(c=>c.profile==="crypto"));
 assert.deepEqual(report.calls.filter(c=>
  c.file==="poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"
 ).map(c=>c.profile),["crypto"]);
});
