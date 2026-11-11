import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {checkR6TypeImports} from "../r6-type-imports.mjs";
const BASE="poc/packages/orchestrator-runtime/src/";
function fixture(t,entries){
  const root=mkdtempSync(join(tmpdir(),"r6-types-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const [name,source] of Object.entries(entries)){
    mkdirSync(dirname(join(root,BASE+name)),{recursive:true});
    writeFileSync(join(root,BASE+name),source);
  }
  return {root,files:Object.keys(entries).map(x=>BASE+x)};
}
test("R6 checks direct, aliased, inline and transitively re-exported type names",t=>{
  const x=fixture(t,{
    "types.ts":"export interface Permission{}; export class Role{};",
    "barrel.ts":"export type {Permission as Scoped} from './types.ts'; export * from './types.ts';",
    "task.ts":"import type {Scoped,Role} from './barrel.ts';\nimport {type Permission as P} from './types.ts';\nexport type {Role as PublicRole} from './types.ts';"
  });
  assert.deepEqual(checkR6TypeImports(x.root,x.files).errors,[]);
});
test("R6 rejects imports of moved types and deleted local modules",t=>{
  const x=fixture(t,{
    "read.ts":"export interface PlanningRead{};",
    "old.ts":"import type {HistoricalBranch} from './read.ts';\nimport type {Missing} from './deleted.ts';"
  });
  assert.deepEqual(checkR6TypeImports(x.root,x.files).errors.map(e=>({
    symbol:e.symbol,reason:e.reason
  })),[
    {symbol:"HistoricalBranch",reason:"missing named export"},
    {symbol:"Missing",reason:"missing module"}
  ]);
});
test("R6 skips comments, templates and quoted fake import statements",t=>{
  const x=fixture(t,{
    "types.ts":"export interface Good{};",
    "task.ts":"// import type {Bad} from './missing.ts';\n/* import type {Fake} from './missing.ts'; */\nconst text=\"import type {Bad} from './missing.ts'\";\nconst tpl="+String.fromCharCode(96)+"import type {Bad} from './missing.ts'"+String.fromCharCode(96)+";\nimport type {Good} from './types.ts';"
  });
  const result=checkR6TypeImports(x.root,x.files);
  assert.equal(result.checkedImports,1);
  assert.deepEqual(result.errors,[]);
});


test("R6 includes Agent Runtime and A2A while excluding unrelated workspaces",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-cross-workspace-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/packages/agent-runtime/src/contracts.ts":
      "export interface AgentContext{}; export type TaskKind=string;",
    "poc/packages/agent-runtime/src/index.ts":
      "export type {AgentContext,TaskKind} from './contracts.ts';",
    "poc/packages/agent-runtime/test/context.test.ts":
      "import type {AgentContext,TaskKind} from '../src/index.ts';",
    "poc/apps/a2a-agent/src/main.ts":
      "import type {AgentContext} from '../../../packages/agent-runtime/src/index.ts';",
    "poc/apps/a2a-agent/test/bootstrap.test.ts":
      "import type {TaskKind} from '../../../packages/agent-runtime/src/contracts.ts';",
    "poc/apps/unrelated-workspace/src/unrelated.ts":
      "import type {Missing} from './not-yet-checked.ts';"
  };
  for(const [file,text] of Object.entries(entries)){
    const target=join(root,file);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,text);
  }
  const report=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(report.checkedFiles,5);
  // Four imported type names plus two named types re-exported by the Agent
  // Runtime barrel: all six named edges must be resolved successfully.
  assert.equal(report.checkedImports,6);
  assert.deepEqual(report.errors,[]);
});

test("R6 expanded audit rejects cross-workspace moved types",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-agent-type-drift-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/packages/agent-runtime/src/contracts.ts":"export interface RealTask{};",
    "poc/packages/agent-runtime/src/runner.ts":
      "import type {LegacyTask} from './contracts.ts';",
    "poc/apps/a2a-agent/src/main.ts":
      "import type {LegacyTask} from '../../../packages/agent-runtime/src/contracts.ts';"
  };
  for(const [file,source] of Object.entries(entries)){
    mkdirSync(dirname(join(root,file)),{recursive:true});
    writeFileSync(join(root,file),source);
  }
  const report=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(report.checkedImports,2);
  assert.deepEqual(report.errors.map(x=>x.reason),
    ["missing named export","missing named export"]);
});


test("R6 checks Gateway source, tests and cross-workspace named types without widening to native-test",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-gateway-imports-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/apps/gateway/src/types.ts":
      "export interface Permission{}; export type AgentRole=string;",
    "poc/apps/gateway/src/barrel.ts":
      "export type {Permission as ScopedPermission} from './types.ts';",
    "poc/apps/gateway/src/prepare.ts":
      "import type {Permission} from './types.ts';",
    "poc/apps/gateway/test/prepare.test.ts":
      "import type {ScopedPermission} from '../src/barrel.ts';",
    "poc/packages/orchestrator-runtime/src/port.ts":
      "import type {AgentRole} from '../../../apps/gateway/src/types.ts';",
    "poc/apps/gateway/native-test/ignored.ts":
      "import type {Unresolved} from '../src/missing.ts';",
    "poc/apps/unrelated-workspace/src/ignored.ts":
      "import type {Unresolved} from './missing.ts';"
  };
  for(const [path,text] of Object.entries(entries)){
    const target=join(root,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,text);
  }
  const report=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(report.checkedFiles,5);
  // Re-export alias + Gateway source + Gateway test + cross-workspace port.
  assert.equal(report.checkedImports,4);
  assert.deepEqual(report.errors,[]);
});

test("R6 Gateway cohort rejects missing named and missing module type imports",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-gateway-moved-types-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/apps/gateway/src/types.ts":"export interface Permission{};",
    "poc/apps/gateway/src/loader.ts":
      "import type {OldBranchResult} from './types.ts';",
    "poc/apps/gateway/test/loader.test.ts":
      "import type {Gone} from '../src/deleted.ts';"
  };
  for(const [path,text] of Object.entries(entries)){
    const target=join(root,path);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,text);
  }
  const report=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(report.checkedFiles,3);
  assert.equal(report.checkedImports,2);
  assert.deepEqual(report.errors.map(x=>({
    source:x.source,symbol:x.symbol,reason:x.reason
  })),[
    {
      source:"poc/apps/gateway/src/loader.ts",
      symbol:"OldBranchResult",reason:"missing named export"
    },
    {
      source:"poc/apps/gateway/test/loader.test.ts",
      symbol:"Gone",reason:"missing module"
    }
  ]);
});


test("R6 Runner source, tests and Gateway consumers resolve moved named types",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-runner-types-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/apps/test-runner-controller/src/types.ts":
      "export interface RunnerRunRequest{}; export interface RunnerRunResult{};",
    "poc/apps/test-runner-controller/src/barrel.ts":
      "export type {RunnerRunRequest as ApprovedRunnerRequest} from './types.ts';",
    "poc/apps/test-runner-controller/src/executor.ts":
      "import type {ApprovedRunnerRequest} from './barrel.ts';",
    "poc/apps/test-runner-controller/src/validation.ts":
      "import {type RunnerRunResult} from './types.ts';",
    "poc/apps/test-runner-controller/test/runner.test.ts":
      "import type {RunnerRunRequest} from '../src/types.ts';",
    "poc/apps/gateway/src/runner-client.ts":
      "import type {RunnerRunResult} from '../../test-runner-controller/src/types.ts';",
    "poc/apps/unrelated-workspace/src/ignored.ts":
      "import type {Unresolved} from './not-in-scope.ts';"
  };
  for(const [path,source] of Object.entries(entries)){
    mkdirSync(dirname(join(root,path)),{recursive:true});
    writeFileSync(join(root,path),source);
  }
  const result=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(result.checkedFiles,6);
  assert.equal(result.checkedImports,5);
  assert.deepEqual(result.errors,[]);
});

test("R6 Runner cohort rejects removed named interfaces and local modules",t=>{
  const root=mkdtempSync(join(tmpdir(),"r6-runner-missing-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const entries={
    "poc/apps/test-runner-controller/src/types.ts":
      "export interface RunnerRunRequest{};",
    "poc/apps/test-runner-controller/src/executor.ts":
      "import type {LegacyRunnerExecution} from './types.ts';",
    "poc/apps/test-runner-controller/test/executor.test.ts":
      "import type {RemovedRunnerConfig} from '../src/deleted.ts';"
  };
  for(const [path,source] of Object.entries(entries)){
    mkdirSync(dirname(join(root,path)),{recursive:true});
    writeFileSync(join(root,path),source);
  }
  const result=checkR6TypeImports(root,Object.keys(entries));
  assert.equal(result.checkedFiles,3);
  assert.equal(result.checkedImports,2);
  assert.deepEqual(result.errors.map(x=>({
    source:x.source,symbol:x.symbol,reason:x.reason
  })),[
    {source:"poc/apps/test-runner-controller/src/executor.ts",
     symbol:"LegacyRunnerExecution",reason:"missing named export"},
    {source:"poc/apps/test-runner-controller/test/executor.test.ts",
     symbol:"RemovedRunnerConfig",reason:"missing module"}
  ]);
});
