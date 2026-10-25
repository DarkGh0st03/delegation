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


test("R6 canonical Orchestrator public barrel no longer exports the historical coordinator",async()=>{
  const {readFileSync}=await import("node:fs");
  const barrel=readFileSync(new URL("../../packages/orchestrator-runtime/src/index.ts",
    import.meta.url),"utf8");
  assert.doesNotMatch(barrel,/sequential-coordinator\.ts/u);
  const historic=[
    "a2a-production-coordinator-mcp-gemini-live.mjs",
    "a2a-production-coordinator-mcp-isolated-real-positive.mjs",
    "a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
    "a2a-production-coordinator-mcp-isolated-smoke.mjs"
  ];
  for(const name of historic){
    const script=readFileSync(new URL(
      "../../packages/agent-runtime/scripts/"+name,import.meta.url),"utf8");
    assert.match(script,/from\s*"..\/..\/orchestrator-runtime\/src\/sequential-coordinator\.ts"/u,
      "historical workflow must explicitly select the historical coordinator: "+name);
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

test("R6 removes superseded Phase 6 ADK Orchestrator and isolates historic IAM preflight",async()=>{
 const {readFileSync,existsSync}=await import("node:fs");
 const root=new URL("../../../",import.meta.url);
 const barrel=readFileSync(new URL(
   "poc/packages/orchestrator-runtime/src/index.ts",root),"utf8");
 assert.doesNotMatch(barrel,/adk-orchestrator\.ts|account-suspension-preflight\.ts/u);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/src/adk-orchestrator.ts",root)),false);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/test/adk-orchestrator.test.ts",root)),false);
 const historical=readFileSync(new URL(
   "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",root),"utf8");
 assert.match(historical,
   /from\s+"\.\.\/\.\.\/orchestrator-runtime\/src\/account-suspension-preflight\.ts"/u);
 assert.equal(existsSync(new URL(
   "poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts",root)),true);
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


test("R6 fixed Account Suspension workflow must not become canonical public API",async t=>{
  const target="poc/packages/orchestrator-runtime/src/workflow.ts";
  const files={
    [target]:"export const historical=true;",
    "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts":
      "import {historical} from './workflow.ts';",
    "poc/packages/orchestrator-runtime/test/workflow.test.ts":
      "import {historical} from '../src/workflow.ts';",
    "poc/packages/orchestrator-runtime/src/index.ts":
      "export * from './workflow.ts';",
    "poc/packages/orchestrator-runtime/src/unapproved.ts":
      "const late=()=>import('./workflow.ts');",
    "poc/packages/orchestrator-runtime/src/comment.ts":
      "// export * from './workflow.ts';\nexport const safe=true;",
    "notes.md":"Historical workflow.ts remains as experimental evidence"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedHistoricalWorkflowCallers}=
    await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  assert.deepEqual(
    unexpectedHistoricalWorkflowCallers(inventory).map(x=>x.source),[
      "poc/packages/orchestrator-runtime/src/index.ts",
      "poc/packages/orchestrator-runtime/src/unapproved.ts"
    ]);
  assert.deepEqual(
    unexpectedHistoricalWorkflowCallers(inventory,[
      "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
      "poc/packages/orchestrator-runtime/test/workflow.test.ts",
      "poc/packages/orchestrator-runtime/src/index.ts",
      "poc/packages/orchestrator-runtime/src/unapproved.ts"
    ]),[]
  );
});

test("R6 current checkout exposes no historical workflow through canonical barrel",async()=>{
  const {readFileSync,existsSync}=await import("node:fs");
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedHistoricalWorkflowCallers}=
    await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const barrel=readFileSync(new URL(
    "poc/packages/orchestrator-runtime/src/index.ts",new URL("../../../",import.meta.url)
  ),"utf8");
  assert.doesNotMatch(barrel,/["']\.\/workflow\.ts["']/u);
  assert.equal(existsSync(new URL(
    "poc/packages/orchestrator-runtime/src/workflow.ts",new URL("../../../",import.meta.url)
  )),true);
  assert.deepEqual(
    unexpectedHistoricalWorkflowCallers(
      collectLegacyReferences(root,gitTrackedFiles(root))),[],
    "Only the sequential coordinator and focused test may consume workflow.ts"
  );
});


test("R6 separates generic permission types from frozen Account Suspension templates",async()=>{
  const {readFileSync,existsSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const get=p=>readFileSync(new URL(p,root),"utf8");
  const dir="poc/packages/orchestrator-runtime/src/";
  const entry=get(dir+"index.ts");
  assert.match(entry,/export \* from "\.\/delegated-permission\.ts"/u);
  assert.doesNotMatch(entry,/export \* from "\.\/permission-templates\.ts"/u);
  assert.ok(existsSync(new URL(dir+"delegated-permission.ts",root)));
  const legacy=get(dir+"permission-templates.ts");
  assert.match(legacy,/from "\.\/delegated-permission\.ts"/u);
  assert.match(legacy,/export type \{DelegatedPermission,TemplateOperation\}/u);
  for(const path of [
    "authority-client.ts",
    "trusted-engineer-authority.ts",
    "trusted-approved-child-issuer.ts"
  ]){
    const code=get(dir+path);
    assert.match(code,/import type \{DelegatedPermission\} from "\.\/delegated-permission\.ts"/u);
  }
  const legacyTest=get("poc/packages/orchestrator-runtime/test/permission-templates.test.ts");
  assert.match(legacyTest,/from "\.\.\/src\/permission-templates\.ts"/u);
  // No executable module needs to be loaded for this API boundary assertion.
});


test("R6 historical authority fixtures import templates directly, never through public runtime",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const legacy=readFileSync(new URL(
    "poc/packages/orchestrator-runtime/test/authority-client.test.ts",root),"utf8");
  assert.match(legacy,/from "\.\.\/src\/permission-templates\.ts"/u);
  const barrel=readFileSync(new URL(
    "poc/packages/orchestrator-runtime/src/index.ts",root),"utf8");
  assert.doesNotMatch(barrel,/export \* from "\.\/permission-templates\.ts"/u);
  // Preserve legacy issuance tests; importing from a frozen fixture is not
  // permission to expose or invoke broad root issuance in signed Execution.
});

test("R6 protects historical frozen-template issuer against canonical callers",async t=>{
  const target="poc/packages/orchestrator-runtime/src/legacy-authority-client.ts";
  const old="poc/packages/orchestrator-runtime/test/authority-client.test.ts";
  const fresh="poc/packages/orchestrator-runtime/src/trusted-unsafe.ts";
  const files={
    [target]:"export const issuer=1;",
    [old]:"import {issuer} from '../src/legacy-authority-client.ts';",
    [fresh]:"export {issuer} from './legacy-authority-client.ts';",
    "comment.md":"Historical legacy-authority-client.ts is not a trusted runtime"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedHistoricalAuthorityCallers}
    =await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  assert.deepEqual(unexpectedHistoricalAuthorityCallers(inventory).map(x=>x.source),[fresh]);
  assert.deepEqual(unexpectedHistoricalAuthorityCallers(inventory,[old,fresh]),[]);
});

test("R6 historical static issuer is not part of canonical exports or trusted consumers",async()=>{
  const {readFileSync}=await import("node:fs");
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedHistoricalAuthorityCallers}
    =await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const get=p=>readFileSync(new URL(p,new URL("../../../",import.meta.url)),"utf8");
  const canonical=get("poc/packages/orchestrator-runtime/src/index.ts");
  assert.doesNotMatch(canonical,/export \* from ["']\.\/authority-client\.ts["']/u);
  assert.match(canonical,/export \{SoftwareEngineerAuthorityBootstrap\}/u);
  assert.doesNotMatch(canonical,/DeterministicOrchestratorAuthorityIssuer/u);
  const historical=get("poc/packages/orchestrator-runtime/src/legacy-authority-client.ts");
  // Both historical exports must remain present after introducing the
  // independently named fixed-root bootstrap; ESM formatting is irrelevant.
  assert.match(historical,/export class LegacySoftwareEngineerAuthorityBootstrap/u);
  assert.match(historical,/export class DeterministicOrchestratorAuthorityIssuer/u);
  assert.doesNotMatch(
    get("poc/packages/orchestrator-runtime/src/authority-client.ts"),
    /LegacySoftwareEngineerAuthorityBootstrap|DeterministicOrchestratorAuthorityIssuer/u
  );
  for(const name of ["a2a-production-coordinator-mcp-gemini-live.mjs","a2a-production-coordinator-mcp-isolated-real-positive.mjs","a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs","a2a-production-coordinator-mcp-isolated-smoke.mjs"]){
    const src=get("poc/packages/agent-runtime/scripts/"+name);
    assert.match(src,/from ["']\.\.\/\.\.\/orchestrator-runtime\/src\/legacy-authority-client\.ts["']/u);
  }
  assert.deepEqual(unexpectedHistoricalAuthorityCallers(
    collectLegacyReferences(root,gitTrackedFiles(root))),[],
    "No new runtime may depend on the frozen historical child issuer"
  );
});


test("R6 fixed-root method exists only on historical Engineer subclass",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const read=p=>readFileSync(new URL(p,root),"utf8");
  const code=read("poc/packages/orchestrator-runtime/src/authority-client.ts");
  const old=read("poc/packages/orchestrator-runtime/src/legacy-authority-client.ts");
  const transport=read("poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts");
  assert.equal(code.includes("export class SoftwareEngineerAuthorityBootstrap"),true);
  assert.equal(code.includes("issueOrchestratorRoot("),false);
  assert.equal(code.includes("issueScopedOrchestratorRoot("),true);
  assert.equal(code.includes("revokeRoot("),true);
  assert.equal(code.includes("rootAuthorityPermissions"),false);
  assert.equal(old.includes("export class LegacySoftwareEngineerAuthorityBootstrap"),true);
  assert.equal(old.includes("async issueOrchestratorRoot("),true);
  assert.equal(old.includes("export class DeterministicOrchestratorAuthorityIssuer"),true);
  assert.equal(transport.includes("export async function postCredential("),true);
  assert.equal(transport.includes("rootAuthorityPermissions"),false);
  assert.equal(read("poc/packages/orchestrator-runtime/src/index.ts")
    .includes("LegacySoftwareEngineerAuthorityBootstrap"),false);
  assert.equal(read("poc/packages/orchestrator-runtime/src/legacy-authority-client.ts")
    .includes("LegacySoftwareEngineerAuthorityBootstrap"),true);
  for(const name of ["a2a-production-coordinator-mcp-gemini-live.mjs","a2a-production-coordinator-mcp-isolated-real-positive.mjs","a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs","a2a-production-coordinator-mcp-isolated-smoke.mjs"]){
    assert.equal(read("poc/packages/agent-runtime/scripts/"+name)
      .includes("LegacySoftwareEngineerAuthorityBootstrap as SoftwareEngineerAuthorityBootstrap"),true);
  }
});

test("R6 canonical root issuance has no runtime dependency on fixed Account Suspension templates",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const read=p=>readFileSync(new URL(p,root),"utf8");
  const dir="poc/packages/orchestrator-runtime/src/";
  const canonical=read(dir+"authority-client.ts");
  const internal=read(dir+"authority-adapter-transport.ts");
  const legacy=read(dir+"legacy-authority-client.ts");
  const barrel=read(dir+"index.ts");
  assert.equal(canonical.includes("permission-templates.ts"),false);
  assert.equal(canonical.includes("legacy-authority-client.ts"),false);
  assert.equal(internal.includes("permission-templates.ts"),false);
  assert.equal(canonical.includes("authority-adapter-transport.ts"),true);
  assert.equal(legacy.includes("permission-templates.ts"),true);
  assert.equal(legacy.includes("authority-adapter-transport.ts"),true);
  assert.equal(barrel.includes("legacy-authority-client.ts"),false);
  assert.equal(barrel.includes("authority-adapter-transport.ts"),false);
  assert.equal(canonical.includes("DeterministicOrchestratorAuthorityIssuer"),false);
});


test("R6 frozen template graph blocks runtime imports and re-exports",async t=>{
  const target="poc/packages/orchestrator-runtime/src/permission-templates.ts";
  const src="poc/packages/orchestrator-runtime/src/";
  const files={
    [target]:"export const FROZEN=1; export type DelegatedPermission=string;",
    [src+"legacy-authority-client.ts"]:
      "import {FROZEN} from './permission-templates.ts';",
    [src+"trusted-dag.ts"]:
      "import type {DelegatedPermission} from './permission-templates.ts';",
    [src+"trusted-dynamic.ts"]:
      "const f=()=>import('./permission-templates.ts');",
    [src+"authority-client.ts"]:
      "export {FROZEN} from './permission-templates.ts';",
    [src+"authority-adapter-transport.ts"]:
      "const m=require('./permission-templates.ts');",
    [src+"trusted-comment.ts"]:
      "// import './permission-templates.ts';\nexport const safe=1;",
    "notes.md":"permission-templates.ts is historical documentation"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedTrustedTemplateCallers}
    =await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  const found=unexpectedTrustedTemplateCallers(inventory);
  // Type-only imports vanish under Node stripTypeScriptTypes before
  // SourceTextModule parsing; a separate tracked-text check below covers them.
  assert.deepEqual(found.map(x=>x.source).sort(),[
    src+"trusted-dynamic.ts",
    src+"authority-client.ts",
    src+"authority-adapter-transport.ts"
  ].sort());
  assert.equal(found.some(x=>x.source===src+"trusted-dag.ts"),false);
  assert.equal(found.some(x=>x.source===src+"legacy-authority-client.ts"),false);
  assert.equal(found.some(x=>x.source===src+"trusted-comment.ts"),false);
  assert.equal(found.some(x=>x.source==="notes.md"),false);
});

test("R6 signed Execution imports neutral permission type without frozen IAM matrix",async()=>{
  const {readFileSync}=await import("node:fs");
  const {fileURLToPath}=await import("node:url");
  const {join}=await import("node:path");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedTrustedTemplateCallers}
    =await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const tracked=gitTrackedFiles(root);
  // SourceTextModule sees runtime dependencies, not TS type-only imports.
  // Fail closed on any textual mention in trusted/canonical source files:
  // comments would also require a deliberate review rather than silently
  // permitting a new type import through to frozen IAM authorization types.
  const dir="poc/packages/orchestrator-runtime/src/";
  const named=new Set([
    dir+"index.ts",
    dir+"authority-client.ts",
    dir+"authority-adapter-transport.ts"
  ]);
  for(const path of tracked.filter(p=>named.has(p)||
    (p.startsWith(dir+"trusted-")&&p.endsWith(".ts")))){
    assert.doesNotMatch(
      readFileSync(join(root,path),"utf8"),
      /permission-templates\.ts/u,
      "Canonical source contains a frozen IAM template reference: "+path
    );
  }
  const source=readFileSync(new URL(
    "poc/packages/orchestrator-runtime/src/trusted-execution-coordinator.ts",
    new URL("../../../",import.meta.url)),"utf8");
  assert.match(source,/import type \{DelegatedPermission\} from "\.\/delegated-permission\.ts"/u);
  assert.doesNotMatch(source,/from "\.\/permission-templates\.ts"/u);
  assert.deepEqual(
    unexpectedTrustedTemplateCallers(
      collectLegacyReferences(root,tracked)),[],
    "Trusted approved-plan code must not import Account Suspension templates"
  );
});

test("R6 rejects new direct or dynamically loaded historical Gateway writer",async t=>{
  const target="poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts";
  const srcDir="poc/packages/orchestrator-runtime/src/";
  const historical="poc/packages/orchestrator-runtime/test/orchestrator-gateway-client.test.ts";
  const files={
    [target]:"export const writer=true;",
    [historical]:"import {writer} from '../src/legacy-orchestrator-gateway-client.ts';",
    [srcDir+"index.ts"]:
      "export * from './legacy-orchestrator-gateway-client.ts';",
    [srcDir+"trusted-route.ts"]:
      "const f=()=>import('./legacy-orchestrator-gateway-client.ts');",
    [srcDir+"trusted-comment.ts"]:
      "// import './legacy-orchestrator-gateway-client.ts';\nexport const safe=1;",
    "docs/historical.md":"legacy-orchestrator-gateway-client.ts is old"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedHistoricalGatewayCallers}
    =await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  assert.deepEqual(
    unexpectedHistoricalGatewayCallers(inventory).map(x=>x.source),
    [srcDir+"index.ts",srcDir+"trusted-route.ts"]
  );
  assert.deepEqual(
    unexpectedHistoricalGatewayCallers(inventory,[
      historical,srcDir+"index.ts",srcDir+"trusted-route.ts"
    ]),[]
  );
});

test("R6 old Gateway write convenience stays behind historical opt-in import",async()=>{
  const {readFileSync}=await import("node:fs");
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedHistoricalGatewayCallers}
    =await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const read=p=>readFileSync(new URL(p,new URL("../../../",import.meta.url)),"utf8");
  const publicApi=read("poc/packages/orchestrator-runtime/src/index.ts");
  assert.equal(publicApi.includes("export * from \"./orchestrator-gateway-client.ts\""),false);
  assert.equal(publicApi.includes("OrchestratorProtectedGatewayClient"),false);
  assert.equal(publicApi.includes("OrchestratorGatewayClientError"),true);
  const optIn=read("poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts");
  assert.equal(optIn.includes("OrchestratorProtectedGatewayClient"),true);
  const planner=read("poc/packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts");
  assert.equal(planner.includes("from \"./orchestrator-gateway-client.ts\""),true);
  const scripts=["a2a-production-coordinator-mcp-gemini-live.mjs","a2a-production-coordinator-mcp-isolated-real-positive.mjs","a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs","a2a-production-coordinator-mcp-isolated-smoke.mjs"];
  for(const name of scripts){
    const script=read("poc/packages/agent-runtime/scripts/"+name);
    assert.equal(script.includes("legacy-orchestrator-gateway-client.ts"),true);
  }
  assert.deepEqual(
    unexpectedHistoricalGatewayCallers(
      collectLegacyReferences(root,gitTrackedFiles(root))),[],
    "Only the historical scripts and Gateway regression may import old writer"
  );
});

test("R6 Gateway read/write source boundary excludes historical write methods from Planning",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const src=p=>readFileSync(new URL(p,root),"utf8");
  const d="poc/packages/orchestrator-runtime/src/";
  const read=src(d+"orchestrator-gateway-client.ts");
  const wire=src(d+"orchestrator-gateway-transport.ts");
  const old=src(d+"legacy-orchestrator-gateway-client.ts");
  const planning=src(d+"trusted-planning-gateway-port.ts");
  const barrel=src(d+"index.ts");
  for(const text of [read,wire]){
    assert.equal(text.includes("createFeatureBranch("),false);
    assert.equal(text.includes("createAccountSuspensionPullRequest("),false);
    assert.equal(text.includes("feature/account-suspension"),false);
  }
  assert.equal(read.includes("async readPlanningResource("),true);
  assert.equal(read.includes("async invoke("),false);
  assert.equal(wire.includes("async invoke("),true);
  assert.equal(old.includes("async createFeatureBranch("),true);
  assert.equal(old.includes("async createAccountSuspensionPullRequest("),true);
  assert.equal(old.includes("feature/account-suspension"),true);
  assert.equal(planning.includes("new OrchestratorPlanningGatewayReadClient({"),true);
  assert.equal(planning.includes("OrchestratorProtectedGatewayClient"),false);
  assert.equal(barrel.includes("OrchestratorPlanningGatewayReadClient"),true);
  assert.equal(barrel.includes("OrchestratorGatewayTransport"),false);
  assert.equal(barrel.includes("OrchestratorProtectedGatewayClient"),false);
});

test("R6 private Gateway transport rejects public re-exports and new trusted direct loads",async t=>{
  const target="poc/packages/orchestrator-runtime/src/orchestrator-gateway-transport.ts";
  const base="poc/packages/orchestrator-runtime/src/";
  const reader=base+"orchestrator-gateway-client.ts";
  const writer=base+"legacy-orchestrator-gateway-client.ts";
  const files={
    [target]:"export const transport=true;",
    [reader]:"import {transport} from './orchestrator-gateway-transport.ts';",
    [writer]:"import {transport} from './orchestrator-gateway-transport.ts';",
    [base+"index.ts"]:"export {transport} from './orchestrator-gateway-transport.ts';",
    [base+"trusted-unsafe.ts"]:
      "const module=()=>import('./orchestrator-gateway-transport.ts');",
    [base+"comment.ts"]:
      "// import './orchestrator-gateway-transport.ts';\nexport const safe=true;",
    "docs/history.md":"orchestrator-gateway-transport.ts is an internal source"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedPrivateGatewayTransportCallers}
    =await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  assert.deepEqual(unexpectedPrivateGatewayTransportCallers(inventory)
    .map(x=>x.source).sort(),[
      base+"index.ts",base+"trusted-unsafe.ts"
    ].sort());
  assert.deepEqual(unexpectedPrivateGatewayTransportCallers(inventory,[
    reader,writer,base+"index.ts",base+"trusted-unsafe.ts"
  ]),[]);
});

test("R6 private Gateway transport has exactly three reviewed callers, never models",async()=>{
  const {readFileSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {fileURLToPath}=await import("node:url");
  const {
    collectLegacyReferences,gitTrackedFiles,
    unexpectedPrivateGatewayTransportCallers
  }=await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const tracked=gitTrackedFiles(root);
  const base="poc/packages/orchestrator-runtime/src/";
  // Only these three narrowly reviewed trusted runtime ports can hold
  // the private VP/Adapter transport. In particular, do not extend to
  // Agent runtimes, ADK tools, MCP or dynamic/indirect importers.
  const allowed=new Set([
    base+"orchestrator-gateway-client.ts",
    base+"legacy-orchestrator-gateway-client.ts",
    base+"trusted-approved-branch-gateway.ts"
  ]);
  const sensitive="orchestrator-gateway-transport.ts";
  // Type-only imports disappear from the runtime ESM import graph.
  // Cover them too, in the production source trees, without mistakenly
  // treating source-code strings in the audit's own tests as consumers.
  for(const path of tracked.filter(p=>
    p.startsWith(base)&&p.endsWith(".ts")&&
    p!==base+sensitive&&!allowed.has(p)
  )){
    assert.equal(readFileSync(join(root,path),"utf8").includes(sensitive),false,
      "Unexpected private Gateway transport reference: "+path);
  }
  for(const path of allowed){
    assert.equal(readFileSync(join(root,path),"utf8").includes(sensitive),true);
  }
  const exported=readFileSync(join(root,base+"index.ts"),"utf8");
  assert.equal(exported.includes("OrchestratorGatewayTransport"),false);
  assert.deepEqual(unexpectedPrivateGatewayTransportCallers(
    collectLegacyReferences(root,tracked)),[],
    "Private Adapter VP transport cannot become a new runtime dependency"
  );
});


test("R6 historical sequential Gateway result types resolve only from legacy writer",async()=>{
  // Node's TS stripping deliberately skips type checking: a stale import
  // would make all runtime tests green despite invalid TypeScript contracts.
  const {readFileSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {fileURLToPath}=await import("node:url");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const base="poc/packages/orchestrator-runtime/src/";
  const read=p=>readFileSync(join(root,base+p),"utf8");
  const sequential=read("sequential-coordinator.ts");
  const writer=read("legacy-orchestrator-gateway-client.ts");
  const canonical=read("orchestrator-gateway-client.ts");
  const publicApi=read("index.ts");
  assert.match(sequential,
    /import type\s*\{\s*OrchestratorCreateBranchResult\s*,\s*OrchestratorCreatePullRequestResult\s*\}\s*from\s*["']\.\/legacy-orchestrator-gateway-client\.ts["']/u);
  for(const name of [
    "OrchestratorCreateBranchResult",
    "OrchestratorCreatePullRequestResult"
  ]){
    assert.ok(writer.includes("export interface "+name+" {"),
      "Historical writer must actually declare exported "+name);
    assert.equal(canonical.includes(name),false,
      "Canonical read client must not declare historical "+name);
    assert.equal(publicApi.includes(name),false,
      "Historical branch/PR result type must not re-enter public API");
  }
  assert.equal(sequential.includes('from "./orchestrator-gateway-client.ts"'),false);
  assert.equal(sequential.includes('from "./legacy-orchestrator-gateway-client.ts"'),true);
});


test("R6 human-only protected Gitea merge modules are absent from canonical runtime API",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const load=p=>readFileSync(new URL(p,root),"utf8");
  const directory="poc/packages/orchestrator-runtime/";
  const publicIndex=load(directory+"src/index.ts");
  const verifier=load(directory+"src/merge-readiness.ts");
  const merger=load(directory+"src/trusted-merge.ts");
  const intent=load(directory+"src/manual-merge-intent.ts");
  const cli=load(directory+"scripts/human-merge.mjs");
  const workflow=load(".github/workflows/human-approved-gitea-merge.yml");
  for(const moduleName of ["merge-readiness.ts","trusted-merge.ts",
                            "manual-merge-intent.ts"]){
    assert.equal(publicIndex.includes('from "./'+moduleName+'"'),false,
      "Agent-facing index must not re-export manual-merge module "+moduleName);
  }
  for(const forbiddenName of [
    "GiteaMergeReadinessVerifier","TrustedGiteaMergeExecutor",
    "validateManualMergeIntent","MergeReadinessDenied"
  ]){
    assert.equal(publicIndex.includes(forbiddenName),false,
      "Canonical runtime index leaked human-only merge symbol "+forbiddenName);
  }
  assert.equal(verifier.includes("export class GiteaMergeReadinessVerifier"),true);
  assert.equal(merger.includes('from "./merge-readiness.ts"'),true);
  assert.equal(intent.includes("export function validateManualMergeIntent"),true);
  assert.equal(cli.includes('from "../src/merge-readiness.ts"'),true);
  assert.equal(cli.includes('from "../src/trusted-merge.ts"'),true);
  assert.equal(cli.includes('from "../src/manual-merge-intent.ts"'),true);
  assert.equal(cli.includes('process.argv[2]!=="--execute"'),true);
  assert.equal(workflow.includes("workflow_dispatch:"),true);
  assert.equal(workflow.includes("name: protected-gitea-merge"),true);
  assert.equal(workflow.includes("environment:"),true);
  // Do not mistake hiding exports for a permission mechanism: the protected
  // human workflow and native provider checks remain authoritative.
});


test("R6 only historical Gemini experiment and focused test may load Account Suspension preflight",async t=>{
  const target="poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts";
  const dir="poc/packages/orchestrator-runtime/src/";
  const historical="poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs";
  const regression="poc/packages/orchestrator-runtime/test/account-suspension-preflight.test.ts";
  const files={
    [target]:"export const checkAccountSuspensionPreflight=()=>true;",
    [historical]:
      "import {checkAccountSuspensionPreflight} from '../../orchestrator-runtime/src/account-suspension-preflight.ts';",
    [regression]:
      "import {checkAccountSuspensionPreflight} from '../src/account-suspension-preflight.ts';",
    [dir+"index.ts"]:
      "export * from './account-suspension-preflight.ts';",
    [dir+"trusted-plan.ts"]:
      "const probe=()=>import('./account-suspension-preflight.ts');",
    [dir+"trusted-comment.ts"]:
      "// import './account-suspension-preflight.ts';\nexport const safe=true;",
    "notes.md":"account-suspension-preflight.ts is an old experiment"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedHistoricalPreflightCallers}
    =await import("../r6-legacy-references.mjs");
  const result=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  assert.deepEqual(
    unexpectedHistoricalPreflightCallers(result).map(x=>x.source).sort(),
    [dir+"index.ts",dir+"trusted-plan.ts"].sort()
  );
  assert.deepEqual(
    unexpectedHistoricalPreflightCallers(result,[
      historical,regression,dir+"index.ts",dir+"trusted-plan.ts"
    ]),[]
  );
});

test("R6 historical preflight remains tested but excluded from approved-plan API",async()=>{
  const {readFileSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {fileURLToPath}=await import("node:url");
  const {collectLegacyReferences,gitTrackedFiles,unexpectedHistoricalPreflightCallers}
    =await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const tracked=gitTrackedFiles(root);
  const path="poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts";
  const publicIndex=readFileSync(join(root,
    "poc/packages/orchestrator-runtime/src/index.ts"),"utf8");
  const preflight=readFileSync(join(root,path),"utf8");
  const historic=readFileSync(join(root,
    "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs"),"utf8");
  const oldTest=readFileSync(join(root,
    "poc/packages/orchestrator-runtime/test/account-suspension-preflight.test.ts"),"utf8");
  assert.equal(publicIndex.includes("account-suspension-preflight.ts"),false);
  assert.match(preflight,/export function checkAccountSuspensionPreflight/u);
  assert.match(historic,/from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/account-suspension-preflight\.ts["']/u);
  assert.match(oldTest,/from\s*["']\.\.\/src\/account-suspension-preflight\.ts["']/u);
  // AST runtime graphs strip type-only imports. Protect canonical TS source
  // against adding an Account Suspension-only import type as well.
  for(const file of tracked.filter(x=>
    x.startsWith("poc/packages/orchestrator-runtime/src/")&&
    (x.endsWith("/index.ts")||/\/trusted-[^/]+\.ts$/u.test(x))
  )){
    const source=readFileSync(join(root,file),"utf8");
    assert.equal(source.includes("account-suspension-preflight.ts"),false,
      "Trusted source must not link legacy preflight: "+file);
  }
  assert.deepEqual(unexpectedHistoricalPreflightCallers(
    collectLegacyReferences(root,tracked)),[],
    "Do not enable new historical preflight consumers"
  );
});


test("R6 Account Suspension 11-file scope checker rejects new launchers or source imports",async t=>{
  const target="poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs";
  const files={
    [target]:"throw Error('historical checker must never be imported by this audit');",
    ".github/workflows/cumulative-refactoring-offline.yml":
      "jobs:\n  safe:\n    steps:\n      - run: node poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs",
    ".github/workflows/new-canonical-run.yml":
      "jobs:\n  unsafe:\n    steps:\n      - run: node poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs",
    "poc/packages/agent-runtime/src/bad.ts":
      "import '../../orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs';",
    "poc/packages/agent-runtime/src/dynamic.ts":
      "const run=()=>import('../../orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs');",
    "poc/packages/agent-runtime/src/comment.ts":
      "// import '../../orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs';\nexport const safe=true;",
    "notes.md":"check-account-suspension-reference-scope.mjs is a historical file"
  };
  const root=fixture(t,files);
  const {collectLegacyReferences,unexpectedHistoricalReferenceScopeCallers}
    =await import("../r6-legacy-references.mjs");
  const inventory=collectLegacyReferences(root,Object.keys(files),{candidates:[target]});
  const unsafe=unexpectedHistoricalReferenceScopeCallers(inventory);
  assert.deepEqual(unsafe.map(x=>x.source).sort(),[
    ".github/workflows/new-canonical-run.yml",
    "poc/packages/agent-runtime/src/bad.ts",
    "poc/packages/agent-runtime/src/dynamic.ts"
  ].sort());
  assert.equal(unsafe.some(x=>x.source==="notes.md"),false);
  assert.equal(unsafe.some(x=>x.source==="poc/packages/agent-runtime/src/comment.ts"),false);
  assert.deepEqual(unsafe.map(x=>x.edgeType).sort(),[
    "github-actions-command","static-import-or-reexport","dynamic-import"
  ].sort());
});

test("R6 11-file historical reference checker retains its six audited CI callers",async()=>{
  const {readFileSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {fileURLToPath}=await import("node:url");
  const {
    collectLegacyReferences,gitTrackedFiles,
    R6_ALLOWED_REFERENCE_SCOPE_WORKFLOWS,unexpectedHistoricalReferenceScopeCallers
  }=await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const tracked=gitTrackedFiles(root);
  const target="poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs";
  const checker=readFileSync(join(root,target),"utf8");
  assert.ok(checker.includes("assert.equal(expectedPaths.length,11)"));
  assert.ok(checker.includes("new Set(Object.keys(files))"));
  assert.ok(checker.includes("DELEGATION_TEMPLATES[role]"));
  assert.ok(checker.includes("ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY"));
  assert.ok(checker.includes("verified,11"));
  const expected=[...R6_ALLOWED_REFERENCE_SCOPE_WORKFLOWS].sort();
  assert.equal(expected.length,6);
  for(const workflow of expected){
    const content=readFileSync(join(root,workflow),"utf8");
    assert.ok(content.includes(target),
      "Preserve reference-scope check in known workflow "+workflow);
  }
  const inventory=collectLegacyReferences(root,tracked);
  const observed=inventory.candidates.find(c=>c.target===target);
  assert.ok(observed);
  assert.deepEqual([...new Set(observed.configuredCallers.map(x=>x.source))].sort(),
    expected,"Scope check is limited to previously reviewed workflow commands");
  assert.deepEqual(unexpectedHistoricalReferenceScopeCallers(inventory),[],
    "Historical 11-file scope checker must not migrate to approved DAG/ADK code");
});


test("R6 historical PR/CI scripts import protected merge readiness directly, not from agent API",async()=>{
  const {readFileSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {fileURLToPath}=await import("node:url");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const read=p=>readFileSync(join(root,p),"utf8");
  const dir="poc/packages/agent-runtime/scripts/";
  const names=[
    "a2a-production-coordinator-mcp-gemini-live.mjs",
    "a2a-production-coordinator-mcp-isolated-real-positive.mjs",
    "a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs"
  ];
  const barrel=read("poc/packages/orchestrator-runtime/src/index.ts");
  const module=read("poc/packages/orchestrator-runtime/src/merge-readiness.ts");
  for(const name of ["GiteaMergeReadinessVerifier","MergeReadinessDenied"]){
    assert.equal(barrel.includes(name),false,
      "The privileged manual readiness checker must not be exported to ADK");
    assert.ok(module.includes("export class "+name),
      "Historical protected merge module must define "+name);
  }
  for(const name of names){
    const script=read(dir+name);
    assert.match(script,
      /import\s*\{\s*GiteaMergeReadinessVerifier\s*,\s*MergeReadinessDenied\s*\}\s*from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/merge-readiness\.ts["']/u,
      "Historic script lost its explicit merge-readiness verification: "+name);
    const agentBarrel=/import\s*\{([^{}]*)\}\s*from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/index\.ts["']/gu;
    for(const match of script.matchAll(agentBarrel)){
      assert.doesNotMatch(match[1],
        /GiteaMergeReadinessVerifier|MergeReadinessDenied/u,
        "Historic script still tries to import removed named exports: "+name);
    }
  }
  // The simple scripted negative case has no merge-readiness client.
  const negative=read(dir+"a2a-production-coordinator-mcp-isolated-smoke.mjs");
  assert.doesNotMatch(negative,/GiteaMergeReadinessVerifier|MergeReadinessDenied/u);
});


test("R6 real authority-boundary regression imports only the historical Gateway writer",async()=>{
  const {readFileSync}=await import("node:fs");
  const root=new URL("../../../",import.meta.url);
  const get=p=>readFileSync(new URL(p,root),"utf8");
  const base="poc/packages/orchestrator-runtime/src/";
  const script=get("poc/packages/agent-runtime/scripts/assert-current-authority-boundaries.mjs");
  const writer=get(base+"legacy-orchestrator-gateway-client.ts");
  const trusted=get(base+"orchestrator-gateway-client.ts");
  const index=get(base+"index.ts");
  assert.match(script,
    /import\s*\{\s*OrchestratorProtectedGatewayClient\s*\}\s*from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/legacy-orchestrator-gateway-client\.ts["']/u);
  assert.match(script,
    /import\s*\{\s*OrchestratorGatewayClientError\s*\}\s*from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/orchestrator-gateway-client\.ts["']/u);
  assert.match(writer,/export class OrchestratorProtectedGatewayClient/u);
  assert.equal(trusted.includes("OrchestratorProtectedGatewayClient"),false);
  assert.equal(index.includes("OrchestratorProtectedGatewayClient"),false);
  assert.match(script,/async function assertCurrentAuthorityBoundaries/u);
});


test("R6 named historical authority-boundary helper is a permitted Gateway-writer consumer",async()=>{
  const {readFileSync}=await import("node:fs");
  const {fileURLToPath}=await import("node:url");
  const {
    R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS,
    R6_ALLOWED_HISTORICAL_AUTHORITY_IMPORTERS,
    unexpectedHistoricalGatewayCallers,gitTrackedFiles,collectLegacyReferences
  }=await import("../r6-legacy-references.mjs");
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const source="poc/packages/agent-runtime/scripts/assert-current-authority-boundaries.mjs";
  const content=readFileSync(new URL(source,new URL("../../../",import.meta.url)),"utf8");
  assert.equal(R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS.includes(source),true);
  assert.equal(R6_ALLOWED_HISTORICAL_AUTHORITY_IMPORTERS.includes(source),false,
    "Source is a historical Gateway writer caller, not a credential issuer");
  assert.match(content,/import\s*\{\s*OrchestratorProtectedGatewayClient\s*\}\s*from\s*["']\.\.\/\.\.\/orchestrator-runtime\/src\/legacy-orchestrator-gateway-client\.ts["']/u);
  const inventory=collectLegacyReferences(root,gitTrackedFiles(root));
  const target="poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  assert.ok(entry);
  assert.equal(entry.staticImporters.some(x=>x.source===source),true,
    "Real negative boundary probe must be retained as a historical writer consumer");
  assert.deepEqual(unexpectedHistoricalGatewayCallers(inventory),[]);
  const restricted=R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS.filter(x=>x!==source);
  assert.equal(unexpectedHistoricalGatewayCallers(inventory,restricted).some(x=>x.source===source),true,
    "Dropping the helper from the exact allowlist must fail audit");
});
