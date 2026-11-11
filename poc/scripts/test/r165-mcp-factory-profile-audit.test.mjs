import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {inspectMcpFactoryCalls} from "../r165-mcp-factory-profile-audit.mjs";

test("R264 no Shared MCP HTTP factory callers survive in tracked code",()=>{
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const report=inspectMcpFactoryCalls(root);
 assert.deepEqual(report.errors,[]);
 assert.ok(report.tracked>100);
 assert.deepEqual(report.calls,[]);
});
