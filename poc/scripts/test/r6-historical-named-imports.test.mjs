import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {
  checkHistoricalRuntimeNamedImports,HISTORICAL_RUNTIME_ENTRYPOINTS
} from "../r6-historical-named-imports.mjs";
const dir="poc/packages/agent-runtime/scripts/";
const entry=dir+"historical.mjs";
function fixture(t,entries){
  const root=mkdtempSync(join(tmpdir(),"r6-legacy-values-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const [path,source] of Object.entries(entries)){
    mkdirSync(dirname(join(root,path)),{recursive:true});
    writeFileSync(join(root,path),source);
  }
  return {root,paths:Object.keys(entries)};
}

test("R6 runtime aliases, direct values and recursive star barrels resolve",t=>{
  const f=fixture(t,{
    [entry]:
      "import {Allowed as Alias,AlsoAllowed} from '../src/index.ts';\n"+
      "import {Ready} from './ready.mjs';",
    "poc/packages/agent-runtime/src/index.ts":
      "export * from './other.ts';\nexport {Actual as Allowed} from './aliased.ts';",
    "poc/packages/agent-runtime/src/other.ts":
      "export async function AlsoAllowed(){}",
    "poc/packages/agent-runtime/src/aliased.ts":"export class Actual {}",
    [dir+"ready.mjs"]:"export const Ready=true;"
  });
  const out=checkHistoricalRuntimeNamedImports(f.root,f.paths,[entry]);
  assert.equal(out.checkedImports,3);
  assert.deepEqual(out.errors,[]);
});

test("R6 detects runtime names that disappeared from an otherwise valid barrel",t=>{
  const f=fixture(t,{
    [entry]:"import {GiteaMergeReadinessVerifier} from '../src/index.ts';",
    "poc/packages/agent-runtime/src/index.ts":"export const Unrelated=1;"
  });
  const out=checkHistoricalRuntimeNamedImports(f.root,f.paths,[entry]);
  assert.deepEqual(out.errors.map(x=>({
    symbol:x.symbol,reason:x.reason
  })),[{
    symbol:"GiteaMergeReadinessVerifier",reason:"missing runtime named export"
  }]);
});

test("R6 runtime named exports cannot resolve to stripped TS types",t=>{
  const f=fixture(t,{
    [entry]:"import {Contract} from '../src/model.ts';",
    "poc/packages/agent-runtime/src/model.ts":
      "export interface Contract {name:string}\nexport type Alias=Contract;"
  });
  assert.equal(checkHistoricalRuntimeNamedImports(f.root,f.paths,[entry])
    .errors[0].reason,"missing runtime named export");
});

test("R6 comment and quoted import examples are not executable imports",t=>{
  const f=fixture(t,{
    [entry]:
      "// import {Bad} from './missing.mjs';\n"+
      "/* import {Wrong} from './missing.mjs'; */\n"+
      "const example=\"import {Bad} from './missing.mjs'\";\n"+
      "import {Valid} from './valid.mjs';",
    [dir+"valid.mjs"]:"export const Valid=1;"
  });
  const out=checkHistoricalRuntimeNamedImports(f.root,f.paths,[entry]);
  assert.equal(out.checkedImports,1);
  assert.deepEqual(out.errors,[]);
});

test("R6 catches deleted local files and missing checked entrypoints",t=>{
  const f=fixture(t,{
    [entry]:"import {Gone} from './deleted.mjs';",
    [dir+"ok.mjs"]:"export const Good=1;"
  });
  const out=checkHistoricalRuntimeNamedImports(
    f.root,f.paths,[entry,dir+"not-tracked.mjs"]);
  assert.deepEqual(out.errors.map(x=>x.reason),
    ["missing local module","missing audited script"]);
});

test("R6 historical audit pins four A2A cohorts and manual merge",()=>{
  assert.equal(HISTORICAL_RUNTIME_ENTRYPOINTS.length,6);
  assert.equal(new Set(HISTORICAL_RUNTIME_ENTRYPOINTS).size,5);
  assert.ok(HISTORICAL_RUNTIME_ENTRYPOINTS.some(x=>
    x.endsWith("/a2a-production-coordinator-mcp-gemini-live.mjs")));
  assert.ok(HISTORICAL_RUNTIME_ENTRYPOINTS.some(x=>
    x.endsWith("/scripts/human-merge.mjs")));
  assert.ok(HISTORICAL_RUNTIME_ENTRYPOINTS.some(x=>
    x.endsWith("/scripts/assert-current-authority-boundaries.mjs")));
});


test("R6 finds a legitimate export after regex with quotes and template delimiter",t=>{
  const f=fixture(t,{
    [entry]:"import {checkPreflight} from '../src/preflight.ts';",
    "poc/packages/agent-runtime/src/preflight.ts":
      "const path=String.raw"+String.fromCharCode(96)+"hello"+String.fromCharCode(96)+";\n"+
      "const match=/[\"'"+String.fromCharCode(96)+"]route/gu;\n"+
      "export function checkPreflight() {return path.length>0&&match.test('route');}"
  });
  assert.deepEqual(checkHistoricalRuntimeNamedImports(
    f.root,f.paths,[entry]).errors,[]);
});

test("R6 runtime exports must not match non-statement quoted examples",t=>{
  const f=fixture(t,{
    [entry]:"import {Phantom} from '../src/example.ts';",
    "poc/packages/agent-runtime/src/example.ts":
      "const note=\"example: export class Phantom {}\";\nexport const Valid=1;"
  });
  assert.equal(checkHistoricalRuntimeNamedImports(f.root,f.paths,[entry])
    .errors[0].reason,"missing runtime named export");
});


test("R6 detects the pre-split historical Gateway class import in an authority probe",t=>{
  const entry="poc/packages/agent-runtime/scripts/assert-current-authority-boundaries.mjs";
  const from="poc/packages/orchestrator-runtime/src/orchestrator-gateway-client.ts";
  const legacy="poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts";
  const old=fixture(t,{
    [entry]:
      "import {OrchestratorProtectedGatewayClient} from '../../orchestrator-runtime/src/orchestrator-gateway-client.ts';",
    [from]:
      "export class OrchestratorPlanningGatewayReadClient {}",
    [legacy]:
      "export class OrchestratorProtectedGatewayClient {}"
  });
  const bad=checkHistoricalRuntimeNamedImports(old.root,old.paths,[entry]);
  assert.deepEqual(bad.errors.map(e=>({symbol:e.symbol,reason:e.reason})),[
    {symbol:"OrchestratorProtectedGatewayClient",reason:"missing runtime named export"}
  ]);
  // Validate the corrected, explicit historical path in a new fixture,
  // rather than importing an effectful script that requires real Gitea.
  const good=fixture(t,{
    [entry]:
      "import {OrchestratorProtectedGatewayClient} from '../../orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts';",
    [from]:
      "export class OrchestratorPlanningGatewayReadClient {}",
    [legacy]:
      "export class OrchestratorProtectedGatewayClient {}"
  });
  assert.deepEqual(checkHistoricalRuntimeNamedImports(
    good.root,good.paths,[entry]).errors,[]);
});
