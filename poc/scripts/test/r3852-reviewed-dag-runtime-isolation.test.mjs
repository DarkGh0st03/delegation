/**
 * R385.2: free offline regression of the historical signed-DAG boundaries.
 * No provider key, model inference, A2A request, signed Root or HTTP call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pinTrustedReviewedAgentEndpoints as purePins}
 from "../../packages/orchestrator-runtime/src/trusted-reviewed-agent-endpoint-pins.ts";
import {pinTrustedReviewedAgentEndpoints as compatibilityPins}
 from "../../packages/orchestrator-runtime/src/trusted-reviewed-approved-dag.ts";

const root=new URL("../../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const pkg="poc/packages/orchestrator-runtime/src/";

test("R385.2 pure endpoint preflight preserves strict duplicate, loopback and immutable-copy checks",()=>{
 assert.equal(compatibilityPins,purePins,
  "Old direct DAG callers must retain identical admission semantics");
 const input={backend:"http://127.0.0.1:45101",
  frontend:"http://127.0.0.1:45102",test:"http://127.0.0.1:45103"};
 const pinned=purePins(input);
 assert.deepEqual(pinned,input);
 assert.notEqual(pinned,input);
 assert.equal(Object.isFrozen(pinned),true);
 input.backend="http://127.0.0.1:45104";
 assert.equal(pinned.backend,"http://127.0.0.1:45101");
 for(const invalid of [
  {...input,frontend:input.backend},
  {...input,backend:"http://localhost:45101"},
  {...input,test:"https://127.0.0.1:45103"},
  {...input,test:"http://0.0.0.0:45103"},
  {...input,frontend:"http://127.0.0.1:0"},
  {...input,test:"http://127.0.0.1:65536"},
  {...input,frontend:"http://127.0.0.1:45102/path"},
  {...input,test:undefined}
 ])assert.throws(()=>purePins(invalid),
  /Reviewed Gemini DAG bridge: Gemini A2A endpoints must be three distinct localhost servers/u);
});

test("R385.2 only direct legacy invocation loads the reviewed DAG in each handoff",()=>{
 const fresh=read(pkg+"trusted-fresh-repair-reviewed-dag.ts");
 const scripted=read(pkg+"trusted-admitted-scripted-handoff.ts");
 const github=read(pkg+"trusted-admitted-github-handoff.ts");
 const pins=read(pkg+"trusted-reviewed-agent-endpoint-pins.ts");
 for(const [name,src] of [["fresh",fresh],["scripted",scripted],["github",github]]){
  assert.match(src,/await import\(\s*"\.\/trusted-reviewed-approved-dag\.ts"\s*\)/u,
   name+" must lazy-load the historical dispatcher at the owner handoff");
  assert.doesNotMatch(src,/^import \{createReviewedApprovedDagExecution/u,
   name+" must never eagerly load the legacy controller");
 }
 assert.match(fresh,/import type \{createReviewedApprovedDagExecution\}/u);
 assert.match(fresh,/from "\.\/trusted-reviewed-agent-endpoint-pins\.ts"/u);
 assert.match(fresh,/const pinnedEndpoints=pinTrustedReviewedAgentEndpoints\(input\.endpoints\)/u);
 assert.ok(fresh.indexOf("const pinnedEndpoints=")<
  fresh.indexOf("const active=await beginTrustedFreshRepairApprovedExecution"),
  "Bad A2A endpoint may never reach irreversible fresh Root issuance");
 assert.doesNotMatch(pins,
  /trusted-reviewed-approved-dag|createReviewedApprovedDagExecution|TrustedApprovedA2ADispatcher|@google\/adk/u,
  "Pure preflight cannot import the controller, A2A dispatcher or LLM");
});

test("R385.2 every lazy import is covered by fail-closed liveness and root retirement",()=>{
 const scripted=read(pkg+"trusted-admitted-scripted-handoff.ts");
 const github=read(pkg+"trusted-admitted-github-handoff.ts");
 const fresh=read(pkg+"trusted-fresh-repair-reviewed-dag.ts");
 assert.match(scripted,
  /await import\(\s*"\.\/trusted-reviewed-approved-dag\.ts"\s*\);\s*await checkNow\(\)/u);
 assert.match(github,
  /await import\(\s*"\.\/trusted-reviewed-approved-dag\.ts"\s*\);\s*await checkNow\(\)/u);
 assert.match(fresh,
  /await import\(\s*"\.\/trusted-reviewed-approved-dag\.ts"\s*\);\s*await input\.verifyLiveRun\(\)/u);
 assert.match(scripted,/\}catch\(error\)\{\s*await stop\(\)/u);
 assert.match(github,/\}catch\(error\)\{\s*await stop\(\)/u);
 assert.match(fresh,/if\(activated\)\{\s*try\{await shutdown\(\)/u);
});
