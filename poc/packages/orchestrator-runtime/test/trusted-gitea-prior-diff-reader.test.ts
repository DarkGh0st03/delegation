import test from "node:test";
import assert from "node:assert/strict";
import {TrustedGiteaPriorDiffReader}
  from "../src/trusted-gitea-prior-diff-reader.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"invoices"};
const BASE="a".repeat(40),HEAD="b".repeat(40),INTERMEDIATE="c".repeat(40);
const input={repository:REPO,branch:"feature/invoice-sort",
  base_revision:BASE,head_revision:HEAD};
const url="http://127.0.0.1:39001";
const response=(x:unknown,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"content-type":"application/json"}
});
function fixture(opts:{
  changingHead?:boolean;duplicate?:boolean;
  omitCommitFiles?:boolean;redirect?:boolean;
}={}){
  const calls:string[]=[];
  let branchReads=0;
  const fetchFn:typeof fetch=async (path,init)=>{
    const requested=String(path);
    calls.push(requested);
    assert.equal(init?.method,"GET");
    assert.equal(init?.redirect,"error","credentials cannot follow redirects");
    const headers=new Headers(init?.headers);
    assert.equal(headers.get("authorization"),"token private-test-token");
    assert.ok(!requested.includes("private-test-token"));
    if(opts.redirect)return response({error:"redirect"},302);
    if(requested.endsWith("/branches/feature%2Finvoice-sort")){
      branchReads++;
      return response({name:input.branch,commit:{
        id:opts.changingHead&&branchReads===2?"d".repeat(40):HEAD
      }});
    }
    assert.ok(requested.endsWith(
      "/compare/"+BASE+"..."+HEAD+"?files=true&verification=false"));
    return response({
      total_commits:2,
      commits:[
        {sha:INTERMEDIATE,files:[{filename:"src/invoice.ts",status:"modified",
          patch:"DO_NOT_INCLUDE_PRIVATE_SOURCE"}]},
        {sha:HEAD,...(opts.omitCommitFiles?{}:
          {files:[{filename:opts.duplicate?"src/invoice.ts":"src/repair.spec.ts",
            status:"added"}]})}
      ]
    });
  };
  const reader=new TrustedGiteaPriorDiffReader({
    baseUrl:url,repository:REPO,token:"private-test-token",fetchFn
  });
  return {reader,calls};
}
test("R44 real Gitea comparison protocol returns metadata only after two SHA checks",async()=>{
  const {reader,calls}=fixture();
  const audit=await reader.readPinnedFeatureDiff(input);
  assert.deepEqual(audit,{
    branch:input.branch,base_revision:BASE,head_revision:HEAD,
    changes:[
      {path:"src/invoice.ts",change:"modified"},
      {path:"src/repair.spec.ts",change:"added"}
    ]
  });
  assert.equal(calls.length,3);
  assert.equal(Object.keys(audit).sort().join(","),
    "base_revision,branch,changes,head_revision");
  assert.ok(!JSON.stringify(audit).includes("DO_NOT_INCLUDE_PRIVATE_SOURCE"));
  assert.ok(!JSON.stringify(audit).includes("private-test-token"));
});
test("R44 changed branch head, duplicate file and missing commit metadata fail closed",async()=>{
  for(const [opts,pattern] of [
    [{changingHead:true},/branch changed/],
    [{duplicate:true},/conflicting, unsafe or oversized/],
    [{omitCommitFiles:true},/unverifiable comparison/],
    [{redirect:true},/HTTP read failed/]
  ] as const){
    const {reader}=fixture(opts);
    await assert.rejects(reader.readPinnedFeatureDiff(input),pattern);
  }
});
test("R44 owner configuration and repository pins cannot be model-swapped",async()=>{
  for(const changed of [
    {...input,repository:{...REPO,repository:"another"}},
    {...input,branch:"main"},
    {...input,head_revision:"invalid"},
    {...input,branch:"feature/../main"}
  ]){
    const {reader,calls}=fixture();
    await assert.rejects(reader.readPinnedFeatureDiff(changed),
      /independent repository\/branch\/revision pins required/);
    assert.deepEqual(calls,[],"invalid pins cannot access Gitea");
  }
  assert.throws(()=>new TrustedGiteaPriorDiffReader({
    baseUrl:"https://attacker.invalid",repository:REPO,token:"private"
  }),/private loopback Gitea/);
  assert.throws(()=>new TrustedGiteaPriorDiffReader({
    baseUrl:url,repository:REPO,token:""
  }),/private loopback Gitea/);
});
