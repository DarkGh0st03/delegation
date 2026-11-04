import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkLocalImports } from "../check-local-imports.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "delegation-import-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

test("checks TS imports and re-exports without evaluating source or dependencies", t => {
  const root = fixture(t, {
    "entry.ts": `import { value, type Value } from "./value.ts";
      export * from "./provider.mjs";
      const typed: Value = value;
      throw new Error("entrypoint must never run");`,
    "value.ts": "export type Value = number; export const value: Value = 1;",
    "provider.mjs": "throw new Error('provider must never run');"
  });
  assert.deepEqual(checkLocalImports(root, ["entry.ts"]), {
    checkedFiles: 1, localImports: 2, missing: []
  });
});

test("rejects deleting a script fixture still imported by an offline test", t => {
  const root = fixture(t, {
    "test/errors.test.ts": "import { smoke } from '../scripts/gemini-api-health-smoke.mjs';",
    "scripts/gemini-api-health-smoke.mjs": "export const smoke = () => {};"
  });
  assert.equal(checkLocalImports(root, ["test/errors.test.ts"]).missing.length, 0);
  rmSync(join(root, "scripts/gemini-api-health-smoke.mjs"));
  assert.deepEqual(checkLocalImports(root, ["test/errors.test.ts"]).missing, [{
    source: "test/errors.test.ts",
    specifier: "../scripts/gemini-api-health-smoke.mjs",
    target: "scripts/gemini-api-health-smoke.mjs"
  }]);
});

test("ignores apparent imports in comments, generated strings and templates", t => {
  const root = fixture(t, {
    "fixture.mjs": `// import './missing-comment.ts';
      /* export * from './missing-block.ts'; */
      const generated = "import value from './missing-generated.ts';";
      const template = \`export * from './missing-template.ts';\`;
      const pattern = /import.*missing-regex/;`
  });
  assert.deepEqual(checkLocalImports(root, ["fixture.mjs"]), {
    checkedFiles: 1, localImports: 0, missing: []
  });
});

test("checks side-effect imports and rejects directory import targets", t => {
  const root = fixture(t, {
    "entry.mjs": "import './directory'; import './missing.mjs';",
    "directory/file.mjs": "export const present = true;"
  });
  assert.deepEqual(checkLocalImports(root, ["entry.mjs"]).missing.map(x => x.specifier),
    ["./directory", "./missing.mjs"]);
});

test("reports the source filename when syntax cannot be parsed", t => {
  const root = fixture(t, { "broken.mjs": "export const = ;" });
  assert.throws(() => checkLocalImports(root, ["broken.mjs"]), /Cannot parse broken\.mjs:/u);
});

test("makes its limits explicit for type-only imports, dynamic imports and resources", t => {
  const root = fixture(t, {
    "entry.ts": `import type { MissingType } from './missing-type.ts';
      const lazy = () => import('./missing-dynamic.ts');
      const resource = new URL('./missing-resource.json', import.meta.url);`
  });
  assert.deepEqual(checkLocalImports(root, ["entry.ts"]), {
    checkedFiles: 1, localImports: 0, missing: []
  });
});


test("R6 legacy reference inventory distinguishes workflow, runtime, package and prose",async t=>{
  const root=fixture(t,{
    "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts":
      "export class HistoricalCoordinator {}",
    "poc/apps/old.mjs":
      "import {HistoricalCoordinator} from '../packages/orchestrator-runtime/src/sequential-coordinator.ts';",
    ".github/workflows/old.yml":
      "run: node poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
    "poc/package.json":JSON.stringify({scripts:{old:"node sequential-coordinator.ts"}}),
    "notes.md":"historical sequential-coordinator.ts is no longer canonical",
    "some-unrelated-file.mjs":"export const ready=true;"
  });
  const {collectLegacyReferences}=await import("../r6-legacy-references.mjs");
  const result=collectLegacyReferences(root,[
    "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
    "poc/apps/old.mjs",".github/workflows/old.yml",
    "poc/package.json","notes.md","some-unrelated-file.mjs"
  ],{candidates:["poc/packages/orchestrator-runtime/src/sequential-coordinator.ts"]});
  const item=result.candidates[0];
  assert.equal(item.exists,true);
  assert.deepEqual(item.references.map(x=>x.referenceType).sort(),[
    "documentation-only","package-script-or-config",
    "runtime-or-test-source","workflow"
  ]);
  assert.ok(result.methodology.includes("not an import graph"));
});
test("R6 inventory never promotes absent textual references to deletion approval",async t=>{
  const root=fixture(t,{"unused.ts":"export const unused=1;"});
  const {collectLegacyReferences}=await import("../r6-legacy-references.mjs");
  const found=collectLegacyReferences(root,["unused.ts"],{
    candidates:["unused.ts","untracked-dependency.mjs"]
  });
  assert.equal(found.candidates[0].exists,true);
  assert.deepEqual(found.candidates[0].references,[]);
  assert.equal(found.candidates[1].exists,false);
  assert.deepEqual(found.candidates[1].references,[]);
  assert.match(found.methodology,/not an import graph or deletion proof/);
});


test("R178 canonical Orchestrator barrel has no coordinator and retired scripts are absent",async()=>{
 const {existsSync,readFileSync}=await import("node:fs");
 const {R6_RETIRED_TARGETS,R6_LEGACY_CANDIDATES}=
   await import("../r6-legacy-references.mjs");
 const root=new URL("../../../",import.meta.url);
 const barrel=readFileSync(new URL(
   "poc/packages/orchestrator-runtime/src/index.ts",root),"utf8");
 assert.doesNotMatch(barrel,/sequential-coordinator|LegacySoftwareEngineer|OrchestratorProtectedGatewayClient/u);
 const candidates=new Set(R6_LEGACY_CANDIDATES);
 for(const path of R6_RETIRED_TARGETS){
   assert.equal(candidates.has(path),true,"Retired executable must be audited: "+path);
   assert.equal(existsSync(new URL(path,root)),false,
     "Physically removed code must not silently reappear: "+path);
 }
});

test("R6 AST source graph resolves verified relative static importers, not comments/dynamic imports",async t=>{
  const root=fixture(t,{
    "src/old.ts":"export const historical=true;",
    "src/index.ts":"export * from './old.ts';",
    "src/consumer.mjs":"import {historical} from './old.ts';",
    "src/dynamic.mjs":"const lazy=()=>import('./old.ts');",
    "src/comment.mjs":"// import './old.ts';\nconst text=\"import './old.ts'\";",
    ".github/workflows/history.yml":"run: node src/old.ts"
  });
  const {collectLegacyReferences}=await import("../r6-legacy-references.mjs");
  const result=collectLegacyReferences(root,[
    "src/old.ts","src/index.ts","src/consumer.mjs",
    "src/dynamic.mjs","src/comment.mjs",".github/workflows/history.yml"
  ],{candidates:["src/old.ts"]});
  assert.deepEqual(result.candidates[0].staticImporters.map(x=>x.source),
    ["src/consumer.mjs","src/index.ts"]);
  assert.equal(result.candidates[0].references.length,5);
  assert.match(result.methodology,/not a complete dependency graph/);
});
test("R6 AST graph ignores erased TS type-only imports",async t=>{
  const root=fixture(t,{
    "src/old.ts":"export type Old = {id:string};",
    "src/type-only.ts":"import type {Old} from './old.ts';\nlet x:Old;",
    "src/real.ts":"export {type Old} from './old.ts';"
  });
  const {collectLegacyReferences}=await import("../r6-legacy-references.mjs");
  const result=collectLegacyReferences(root,[
    "src/old.ts","src/type-only.ts","src/real.ts"
  ],{candidates:["src/old.ts"]});
  // Node 22 strips import type entirely, but retains an explicit
  // "export {} from" dependency when stripping export {type Old}.
  // Conservative safety: the latter must remain a static edge.
  assert.deepEqual(result.candidates[0].staticImporters.map(x=>x.source),
    ["src/real.ts"]);
  assert.equal(result.candidates[0].references.length,2);
});


test("R6 resolves configured npm scripts and workflow npm -w callers without executing commands",async t=>{
 const root=fixture(t,{
   "poc/packages/agent-runtime/package.json":JSON.stringify({
     name:"@thesis/agent-runtime",scripts:{
       "history:smoke":"node ./scripts/old-coordinator.mjs"
     }
   }),
   "poc/packages/agent-runtime/scripts/old-coordinator.mjs":
     "throw Error('this file must not be executed')",
   ".github/workflows/calls.yml":[
     "name: Historical workflow",
     "on:",
     "  workflow_dispatch:",
     "jobs:",
     "  run:",
     "    steps:",
     "      - name: historical",
     "        run: |",
     "          npm --prefix poc run history:smoke -w @thesis/agent-runtime",
     "      - name: direct",
     "        run: node poc/packages/agent-runtime/scripts/old-coordinator.mjs"
   ].join("\n"),
   "notes.md":"old-coordinator.mjs is described but not invoked"
 });
 const {collectConfiguredEntrypoints}=await import("../r6-legacy-references.mjs");
 const files=[
   "poc/packages/agent-runtime/package.json",
   "poc/packages/agent-runtime/scripts/old-coordinator.mjs",
   ".github/workflows/calls.yml","notes.md"
 ];
 const [item]=collectConfiguredEntrypoints(root,files,{
   candidates:["poc/packages/agent-runtime/scripts/old-coordinator.mjs"]
 });
 assert.deepEqual(item.configuredCallers.map(x=>x.kind).sort(),[
   "github-actions-command","github-actions-via-npm-script","npm-script"
 ]);
 assert.ok(item.configuredCallers.some(x=>
   x.kind==="github-actions-via-npm-script"&&
   x.entrypoint==="@thesis/agent-runtime:history:smoke"));
});

test("R6 config scan distinguishes comments/path filters from executable workflow steps",async t=>{
 const root=fixture(t,{
   ".github/workflows/only-filters.yml":[
     "on:",
     "  push:",
     "    paths:",
     "      - 'poc/scripts/retired.mjs'",
     "jobs:",
     "  audit:",
     "    steps:",
     "      - run: echo 'no legacy invocation'"
   ].join("\n"),
   "poc/infra/docker-compose.yml":[
     "# node poc/scripts/retired.mjs",
     "services:",
     "  safe:",
     "    command: ['echo', 'no legacy']"
   ].join("\n"),
   "poc/scripts/start.sh":[
     "# node poc/scripts/retired.mjs",
     "echo safe"
   ].join("\n"),
   "poc/scripts/retired.mjs":"export const neverStarted=true"
 });
 const {collectConfiguredEntrypoints}=await import("../r6-legacy-references.mjs");
 const [item]=collectConfiguredEntrypoints(root,[
   ".github/workflows/only-filters.yml",
   "poc/infra/docker-compose.yml",
   "poc/scripts/start.sh","poc/scripts/retired.mjs"
 ],{candidates:["poc/scripts/retired.mjs"]});
 assert.deepEqual(item.configuredCallers,[]);
});


test("R6 records literal dynamic imports, require and module URLs without running source",async t=>{
  const template=String.fromCharCode(96);
  const root=fixture(t,{
    "src/old.ts":"export const old=true;",
    "src/dynamic.mjs":[
      "const f=()=>import('./old.ts');",
      "const g=()=>require('./old.ts');",
      "const h=new URL('./old.ts', import.meta.url);",
      "const unknown=()=>import('./'+name);",
      "const computed=()=>import("+template+"./"+"$"+"{name}.ts"+template+");"
    ].join("\n"),
    "src/comments.mjs":[
      "// import('./old.ts')",
      "/* require('./old.ts') */",
      "const demo=\"import('./old.ts')\";",
      "const inline="+template+"require('./old.ts')"+template+";"
    ].join("\n")
  });
  const {collectLegacyReferences}=await import("../r6-legacy-references.mjs");
  const item=collectLegacyReferences(root,[
    "src/old.ts","src/dynamic.mjs","src/comments.mjs"
  ],{candidates:["src/old.ts"]});
  assert.deepEqual(item.candidates[0].runtimeIndirectionHints.map(x=>x.kind),[
    "dynamic-import","commonjs-require","module-url"
  ]);
  assert.ok(item.candidates[0].runtimeIndirectionHints.every(x=>x.source==="src/dynamic.mjs"));
  assert.deepEqual(item.unresolvedRuntimeIndirections.map(x=>x.kind),[
    "computed-dynamic-import","computed-dynamic-import"
  ]);
  assert.equal(item.candidates[0].staticImporters.length,0);
});

test("R6 considers computed runtime references unresolved and never declares them unused",async()=>{
  const {scanRuntimeIndirections}=await import("../r6-legacy-references.mjs");
  const output=scanRuntimeIndirections([
    "import(fileName);",
    "require(variable);",
    "new URL(asset,import.meta.url);",
    "const s=\"import('./not-code.mjs')\";"
  ].join("\n"));
  assert.deepEqual(output.hints,[]);
  assert.deepEqual(output.unresolved.map(x=>x.kind),[
    "computed-dynamic-import","computed-commonjs-require",
    "unresolved-new-url"
  ]);
});


test("R6 retired unsigned root bootstrap cannot be invoked through public npm scripts",async()=>{
  const {existsSync,readFileSync}=await import("node:fs");
  const repoRoot=new URL("../../../",import.meta.url);
  const workspace=JSON.parse(readFileSync(
    new URL("poc/apps/orchestrator/package.json",repoRoot),"utf8"));
  const root=JSON.parse(readFileSync(
    new URL("poc/package.json",repoRoot),"utf8"));
  assert.equal(Object.hasOwn(workspace.scripts,"bootstrap"),false);
  assert.equal(Object.hasOwn(root.scripts,"orchestrator:bootstrap"),false);
  assert.equal(existsSync(new URL(
    "poc/apps/orchestrator/src/bootstrap-engineer.ts",repoRoot)),false);
  assert.ok(workspace.scripts["engineer:service"]?.includes(
    "start-trusted-engineer-service.mjs"));
});

test("R178 old ADK entrypoint removed; Scenario preflight stays outside signed Planner",async()=>{
 const {readFileSync,existsSync}=await import("node:fs");
 const root=new URL("../../../",import.meta.url);
 const index=readFileSync(new URL(
   "poc/packages/orchestrator-runtime/src/index.ts",root),"utf8");
 assert.doesNotMatch(index,/adk-orchestrator\.ts|account-suspension-preflight\.ts/u);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/src/adk-orchestrator.ts",root)),false);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/test/adk-orchestrator.test.ts",root)),false);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts",root)),true);
 const planner=readFileSync(new URL(
   "poc/packages/orchestrator-runtime/src/trusted-adk-planner.ts",root),"utf8");
 assert.doesNotMatch(planner,/from\s+["'][^"']*account-suspension-preflight/u);
});

test("R6 blocks an unauthorized static legacy import but not historical imports or prose",async t=>{
  const historical="poc/packages/orchestrator-runtime/src/sequential-coordinator.ts";
  const root=fixture(t,{
    [historical]:"export const legacy=true;",
    "src/old.mjs":
      "import {legacy} from '../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts';",
    "src/new.ts":
      "export {legacy} from '../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts';",
    "src/comment.mjs":
      "// import '../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts';\nexport const good=true;",
    "notes.md":"the sequential-coordinator.ts is mentioned historically"
  });
  const {collectLegacyReferences,unexpectedSequentialImporters}=
    await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,[
    historical,"src/old.mjs","src/new.ts","src/comment.mjs","notes.md"
  ],{candidates:[historical]});
  assert.deepEqual(
    unexpectedSequentialImporters(inventory,["src/old.mjs"]).map(x=>x.source),
    ["src/new.ts"]
  );
  assert.deepEqual(
    unexpectedSequentialImporters(inventory,["src/old.mjs","src/new.ts"]),[]
  );
});

test("R6 checkout has no forbidden direct sequential-coordinator import",async()=>{
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedSequentialImporters}=
    await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  assert.deepEqual(
    unexpectedSequentialImporters(
      collectLegacyReferences(root,gitTrackedFiles(root))),[],
    "Unexpected caller must migrate to TrustedApprovedA2ADispatcher"
  );
});


test("R6 blocks new dynamic and configured legacy coordinator entrypoints",async t=>{
  const target="poc/packages/orchestrator-runtime/src/sequential-coordinator.ts";
  const files={
    [target]:"export const legacy=true;",
    "src/history.mjs":
      "const f=()=>import('../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts');",
    "src/dynamic.mjs":
      "const f=()=>import('../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts');",
    "src/commonjs.mjs":
      "const f=()=>require('../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts');",
    "src/resource.mjs":
      "const p=new URL('../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts',import.meta.url);",
    "src/comment.mjs":
      "// import('../poc/packages/orchestrator-runtime/src/sequential-coordinator.ts')\nexport const safe=1;",
    ".github/workflows/unapproved.yml":
      "name: forbidden\njobs:\n  test:\n    steps:\n      - run: node poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
    "notes.md":"sequential-coordinator.ts was used in the previous experiment"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedSequentialRuntimeReferences}=
    await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  const forbidden=unexpectedSequentialRuntimeReferences(inventory,["src/history.mjs"]);
  assert.deepEqual(forbidden.map(x=>x.source).sort(),[
    ".github/workflows/unapproved.yml","src/commonjs.mjs",
    "src/dynamic.mjs","src/resource.mjs"
  ]);
  assert.deepEqual(forbidden.map(x=>x.edgeType).sort(),[
    "commonjs-require","dynamic-import","github-actions-command","module-url"
  ]);
  assert.equal(inventory.unresolvedRuntimeIndirections.length,0);
});

test("R6 checkout has no unexpected indirect sequential coordinator callers",async()=>{
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedSequentialRuntimeReferences}=
    await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  assert.deepEqual(
    unexpectedSequentialRuntimeReferences(
      collectLegacyReferences(root,gitTrackedFiles(root))),[],
    "Historical coordinator must not gain new dynamic or configured entrypoints"
  );
});



/**
 * R178 replaces obsolete "the old file must still exist" assumptions with
 * behaviorally relevant boundary tests. Earlier tests in this file still
 * exercise static/dynamic/configured-import analysis using synthetic repos.
 */
test("R178 retired static issuer, fixed workflow, and write-Gateway code remain absent",async()=>{
 const {existsSync,readFileSync}=await import("node:fs");
 const {R6_RETIRED_TARGETS}=await import("../r6-legacy-references.mjs");
 const root=new URL("../../../",import.meta.url);
 for(const suffix of [
  "src/sequential-coordinator.ts",
  "src/workflow.ts",
  "src/legacy-authority-client.ts",
  "src/legacy-orchestrator-gateway-client.ts",
  "src/permission-templates.ts"
 ]){
  const path="poc/packages/orchestrator-runtime/"+suffix;
  assert.ok(R6_RETIRED_TARGETS.includes(path),"Untracked retired target "+path);
  assert.equal(existsSync(new URL(path,root)),false);
 }
 const index=readFileSync(new URL("poc/packages/orchestrator-runtime/src/index.ts",root),"utf8");
 assert.match(index,/delegated-permission\.ts/u);
 assert.doesNotMatch(index,/sequential-coordinator|permission-templates|legacy-authority-client|legacy-orchestrator-gateway-client/u);
});

test("R178 generic signed authority imports neutral DelegatedPermission, not IAM templates",async()=>{
 const {readFileSync}=await import("node:fs");
 const root=new URL("../../../",import.meta.url);
 const dir="poc/packages/orchestrator-runtime/src/";
 for(const file of ["authority-client.ts","trusted-engineer-authority.ts",
  "trusted-approved-child-issuer.ts"]){
  const source=readFileSync(new URL(dir+file,root),"utf8");
  assert.match(source,/from\s+["']\.\/delegated-permission\.ts["']/u);
  assert.doesNotMatch(source,/from\s+["']\.\/permission-templates\.ts["']/u);
 }
 const plain=readFileSync(new URL(dir+"delegated-permission.ts",root),"utf8");
 assert.match(plain,/export interface DelegatedPermission/u);
 assert.doesNotMatch(plain,/DC_BACKEND|DC_FRONTEND|DC_TEST/u);
});

test("R178 future static/dynamic imports of deleted root issuer and branch writer are caught",async t=>{
 const {collectLegacyReferences,unexpectedHistoricalAuthorityCallers,
  unexpectedHistoricalGatewayCallers}=await import("../r6-legacy-references.mjs");
 const base="poc/packages/orchestrator-runtime/src/";
 const files={
  [base+"legacy-authority-client.ts"]:"export const danger=true;",
  [base+"legacy-orchestrator-gateway-client.ts"]:"export const danger=true;",
  [base+"trusted-bad.ts"]:
   "export * from './legacy-authority-client.ts';\n"+
   "const surprise=()=>import('./legacy-orchestrator-gateway-client.ts');",
  [base+"index.ts"]:"export const ok=true;",
  "notes.md":"legacy-authority-client.ts is archived"
 };
 const root=fixture(t,files),audit=collectLegacyReferences(root,
  Object.keys(files),{candidates:[
   base+"legacy-authority-client.ts",
   base+"legacy-orchestrator-gateway-client.ts"
  ]});
 assert.deepEqual(unexpectedHistoricalAuthorityCallers(audit)
  .map(x=>x.source),[base+"trusted-bad.ts"]);
 assert.deepEqual(unexpectedHistoricalGatewayCallers(audit)
  .map(x=>x.source),[base+"trusted-bad.ts"]);
});

test("R178 retired fixed workflow cannot re-enter public API through static or dynamic imports",async t=>{
 const {collectLegacyReferences,unexpectedHistoricalWorkflowCallers}=
   await import("../r6-legacy-references.mjs");
 const prefix="poc/packages/orchestrator-runtime/src/";
 const files={
  [prefix+"workflow.ts"]:"export const legacy=true;",
  [prefix+"index.ts"]:"export * from './workflow.ts';",
  [prefix+"trusted-run.ts"]:"const load=()=>import('./workflow.ts');",
  [prefix+"comment.ts"]:"// import './workflow.ts';",
  "notes.md":"archived workflow.ts"
 };
 const dir=fixture(t,files),r=collectLegacyReferences(dir,Object.keys(files),
  {candidates:[prefix+"workflow.ts"]});
 assert.deepEqual(unexpectedHistoricalWorkflowCallers(r).map(x=>x.source),
  [prefix+"index.ts",prefix+"trusted-run.ts"]);
});

test("R178 approved Gateway permits Planning reads, never fixed root PR shortcuts",async()=>{
 const {readFileSync}=await import("node:fs");
 const root=new URL("../../../",import.meta.url);
 const base="poc/packages/orchestrator-runtime/src/";
 const planning=readFileSync(new URL(base+"orchestrator-gateway-client.ts",root),"utf8");
 const port=readFileSync(new URL(base+"trusted-planning-gateway-port.ts",root),"utf8");
 const index=readFileSync(new URL(base+"index.ts",root),"utf8");
 assert.match(planning,/OrchestratorPlanningGatewayReadClient/u);
 assert.match(port,/TrustedPlanningGatewayReadPort/u);
 for(const content of [planning,port,index])
  assert.doesNotMatch(content,/createAccountSuspensionPullRequest|OrchestratorProtectedGatewayClient/u);
});

test("R178 private Gateway transport stays hidden from ADK and the public barrel",async()=>{
 const {readFileSync}=await import("node:fs");
 const {collectLegacyReferences,gitTrackedFiles,
  unexpectedPrivateGatewayTransportCallers}=
  await import("../r6-legacy-references.mjs");
 const {fileURLToPath}=await import("node:url");
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const src=readFileSync(new URL(
  "poc/packages/orchestrator-runtime/src/index.ts",import.meta.url),"utf8");
 assert.doesNotMatch(src,/OrchestratorGatewayTransport/u);
 const inventory=collectLegacyReferences(root,gitTrackedFiles(root));
 assert.deepEqual(unexpectedPrivateGatewayTransportCallers(inventory),[]);
});

test("R178 remaining scenario fixture is only a focused regression, not signed Plan authorization",async()=>{
 const {readFileSync}=await import("node:fs");
 const {collectLegacyReferences,gitTrackedFiles,unexpectedHistoricalPreflightCallers}
   =await import("../r6-legacy-references.mjs");
 const {fileURLToPath}=await import("node:url");
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const audit=collectLegacyReferences(root,gitTrackedFiles(root));
 assert.deepEqual(unexpectedHistoricalPreflightCallers(audit),[]);
 const preflight=readFileSync(new URL(
   "poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts",import.meta.url),"utf8");
 assert.match(preflight,/checkAccountSuspensionPreflight/u);
});

test("R178 protected human merge is never a model-exposed Orchestrator capability",async()=>{
 const {readFileSync}=await import("node:fs");
 const base=new URL("../../../",import.meta.url);
 const index=readFileSync(new URL(
  "poc/packages/orchestrator-runtime/src/index.ts",base),"utf8");
 const readiness=readFileSync(new URL(
  "poc/packages/orchestrator-runtime/src/merge-readiness.ts",base),"utf8");
 const workflow=readFileSync(new URL(
  ".github/workflows/protected-gitea-merge.yml",base),"utf8");
 assert.doesNotMatch(index,/GiteaMergeReadinessVerifier|MergeReadinessDenied/u);
 assert.match(readiness,/export class GiteaMergeReadinessVerifier/u);
 assert.match(workflow,/workflow_dispatch:/u);
 assert.match(workflow,/environment:/u);
});

test("R178 obsolete sequential files are not executable GitHub Actions entrypoints",async()=>{
 const {collectLegacyReferences,gitTrackedFiles,R6_RETIRED_TARGETS}=
   await import("../r6-legacy-references.mjs");
 const {fileURLToPath}=await import("node:url");
 const {existsSync}=await import("node:fs");
 const root=fileURLToPath(new URL("../../../",import.meta.url));
 const inventory=collectLegacyReferences(root,gitTrackedFiles(root));
 for(const retired of R6_RETIRED_TARGETS){
  const item=inventory.candidates.find(x=>x.target===retired);
  assert.ok(item,"Retired target must be audited: "+retired);
  assert.equal(item.exists,false);
  assert.equal(item.staticImporters.length,0);
  assert.equal(item.configuredCallers.length,0);
  assert.equal(item.runtimeIndirectionHints.length,0);
 }
});
