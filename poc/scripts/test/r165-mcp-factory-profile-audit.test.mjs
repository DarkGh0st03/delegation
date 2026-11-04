import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {inspectMcpFactoryCalls} from "../r165-mcp-factory-profile-audit.mjs";

test("R222 tracked legacy crypto factories stay isolated and the Shared MCP launcher is retired",()=>{
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const report=inspectMcpFactoryCalls(root);
 assert.deepEqual(report.errors,[]);
 // The canonical DAG no longer contributes a Shared HTTP factory call.
 assert.ok(report.calls.length>=1,"Historical SDK compatibility tests retain bounded crypto factories");
 assert.ok(report.calls.every(c=>c.profile==="crypto"));
 assert.ok(report.calls.every(c=>c.file!=="poc/mcp-shared/src/main.ts"));
 assert.ok(report.calls.some(c=>c.profile==="crypto"));
 assert.deepEqual(report.calls.filter(c=>
  c.file==="poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"
 ).map(c=>c.profile),[]);
 assert.ok(report.errors.every(error=>!error.includes("task-local crypto MCP")));
});
