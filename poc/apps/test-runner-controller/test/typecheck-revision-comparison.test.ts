import test from "node:test";
import assert from "node:assert/strict";
import {compareTrustedTypecheckRevisions as compare,
  safeTypecheckRevisionComparison as safe}
  from "../scripts/typecheck-revision-comparison.mjs";
const baseSha="a".repeat(40), testedSha="b".repeat(40);
const backend="apps/backend/a.ts",frontend="apps/frontend/b.tsx";
const created="tests/e2e/extra.spec.ts",unknown="unrelated/never-authorized.ts";
const d=path=>({path,line:3,column:4,code:"TS2820"});
function fixture(){
  const seen=[],old=new Map([[backend,"1".repeat(40)],
    [frontend,"2".repeat(40)]]);
  const next=new Map([[backend,"1".repeat(40)],
    [frontend,"3".repeat(40)],[created,"4".repeat(40)]]);
  let head=testedSha;
  const reader={
    async getBranchMetadata(branch){
      assert.equal(branch,"feature/reviewed");
      return {commit_sha:head};
    },
    async readTextFile(branch,path,sha){
      seen.push([branch,path,sha]);
      const hash=(sha===baseSha?old:next).get(path);
      if(!hash)throw Error("private source read must not leak");
      return {path,branch,revision:sha,blob_sha:hash,
        content:"PRIVATE_SOURCE_MUST_NOT_LEAK"};
    }
  };
  return {seen,reader,setHead(x){head=x}};
}
function opts(f){
  return {
    reader:f.reader,
    diagnostics:[d(backend),d(frontend),d(created),d(unknown)],
    planningFiles:[backend,frontend],
    createdPaths:[created],
    observedWrites:{
      backend:new Set([backend]),
      frontend:new Set([frontend]),
      test:new Set([created])},
    baseSha,testedSha,branch:"feature/reviewed"
  };
}
test("R82 exact SHA: unchanged, changed, created and unverified are separate",async()=>{
  const f=fixture(),r=await compare(opts(f));
  assert.deepEqual(r,{
    schema:"typecheck-revision-comparison-v1",status:"observed",
    diagnostic_files:4,same_blob_as_base:1,
    different_blob_from_base:1,verified_new_files:1,
    unverifiable_files:1,backend_writes_observed:1,
    frontend_writes_observed:1,test_writes_observed:1,
    without_observed_writes:1
  });
  assert.deepEqual(f.seen,[
    ["feature/reviewed",backend,testedSha],["main",backend,baseSha],
    ["feature/reviewed",frontend,testedSha],["main",frontend,baseSha],
    ["feature/reviewed",created,testedSha]
  ]);
  assert.doesNotMatch(JSON.stringify(r),/apps\/|PRIVATE_SOURCE|gitea:\/\//u);
});
test("R82 compiler location is not a trusted grant for new reads",async()=>{
  const f=fixture(),o=opts(f);
  o.planningFiles=[];
  o.createdPaths=[];
  const x=await compare(o);
  assert.equal(x.unverifiable_files,4);
  assert.equal(f.seen.length,0);
});
test("R82 repeated diagnostics deduplicate locations by file",async()=>{
  const f=fixture(),o=opts(f);
  o.diagnostics=[d(backend),{...d(backend),line:12}];
  const x=await compare(o);
  assert.equal(x.diagnostic_files,1);
  assert.equal(x.same_blob_as_base,1);
});
test("R82 revision races or invalid evidence never become attribution",async()=>{
  const f=fixture(),o=opts(f);
  f.setHead(baseSha);
  assert.equal(await compare(o),null);
  assert.equal(f.seen.length,0);
  f.setHead(testedSha);
  assert.equal(await compare({...o,testedSha:"no"}),null);
  assert.equal(await compare({...o,diagnostics:[{...d(backend),secret:"TOKEN"}]}),null);
});
test("R82 double whitelist refuses source, inconsistent counts and forged new file",async()=>{
  const f=fixture(),r=await compare(opts(f));
  assert.deepEqual(safe(r),r);
  assert.equal(safe({...r,path:backend}),null);
  assert.equal(safe({...r,different_blob_from_base:4}),null);
  assert.equal(safe({...r,verified_new_files:-1}),null);
  assert.equal(safe({...r,diagnostic_files:0}),null);
});
