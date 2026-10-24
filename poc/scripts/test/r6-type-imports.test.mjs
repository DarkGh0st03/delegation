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
