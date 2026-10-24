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
