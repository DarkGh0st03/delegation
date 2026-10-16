import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {provisionProtectedGiteaFixture} from "../../packages/agent-runtime/scripts/protected-gitea-bootstrap.mjs";

const BASE_SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const repo="/api/v1/repos/thesis/iam-console-poc";

function harness({approvals=1}={}){
  const calls=[];
  let seeded=0,checkedMissing=0;
  const tokens={adminUser:"fixture-admin",gatewayUser:"fixture-gateway"};
  const makeToken=uri=>"test-token-"+uri.split("/").at(-2);
  const api=async(_url,uri,options={})=>{
    calls.push({uri,options});
    if(uri===repo+"/branches/main")return {commit:{id:BASE_SHA}};
    if(uri===repo+"/branch_protections/main"){
      return {branch_name:"main",enable_push:false,
        enable_force_push:false,required_approvals:approvals};
    }
    if(uri==="/api/v1/user")return {login:"fixture-security"};
    if(uri==="/api/v1/users/fixture-reviewer")return {id:21,login:"fixture-reviewer"};
    if(uri==="/api/v1/users/fixture-security")return {id:22,login:"fixture-security"};
    if(uri===repo)return {full_name:"thesis/iam-console-poc"};
    if(uri.endsWith("/tokens"))return {sha1:makeToken(uri)};
    return {};
  };
  const values={
    url:"http://127.0.0.1:3000",api,
    basic:(username,password)=>"test-basic:"+username+":"+password,
    seedPinnedMain:async(url,auth)=>{
      seeded++;
      assert.equal(url,"http://127.0.0.1:3000");
      assert.equal(auth,"test-admin-auth");
    },
    tokens,id:"fixed-fixture",adminAuth:"test-admin-auth",
    gatewayAuth:"test-gateway-auth",readonlyName:"fixture-auditor",
    reviewerName:"fixture-reviewer",ciName:"fixture-security",
    auditorPassword:"auditor-pw",ciPassword:"ci-pw",
    baselineSha:BASE_SHA,lastTestPath:"tests/e2e/account-suspension.spec.ts",
    fetchFn:async url=>{
      checkedMissing++;
      assert.match(url,/tests\/e2e\/account-suspension\.spec\.ts\?ref=main$/);
      return {status:404};
    }
  };
  return {calls,values,metrics:()=>({seeded,checkedMissing})};
}

test("AUD-004: shared bootstrap preserves immutable baseline, exact protection and distinct scopes",async()=>{
  const {values,calls,metrics}=harness();
  const result=await provisionProtectedGiteaFixture(values);
  assert.equal(result.repo,repo);
  assert.equal(result.mainSha,BASE_SHA);
  assert.equal(result.mergeReviewer.login,"fixture-reviewer");
  assert.equal(result.mergeCI.login,"fixture-security");
  assert.equal(result.token,"test-token-fixture-gateway");
  assert.equal(result.ciStatusToken,"test-token-fixture-security");
  assert.equal(result.mergeReadToken,"test-token-fixture-auditor");
  assert.equal(result.mergeProtectionReadToken,"test-token-fixture-admin");
  assert.equal("positiveMergeFixture" in result,false);
  assert.deepEqual(metrics(),{seeded:1,checkedMissing:1});
  const protection=calls.find(x=>x.uri===repo+"/branch_protections"&&x.options.method==="POST");
  assert.deepEqual(
    ["enable_push","enable_force_push","required_approvals","block_admin_merge_override",
      "dismiss_stale_approvals","block_on_outdated_branch"].map(k=>protection.options.body[k]),
    [false,false,1,true,true,true]
  );
  const credentialCalls=calls.filter(x=>x.uri.endsWith("/tokens"));
  assert.equal(credentialCalls.length,4);
  const scopes=Object.fromEntries(credentialCalls.map(x=>[
    x.uri.split("/").at(-2),x.options.body.scopes]));
  assert.deepEqual(scopes["fixture-gateway"],["write:repository","read:user"]);
  assert.deepEqual(scopes["fixture-security"],["write:repository","read:user"]);
  assert.deepEqual(scopes["fixture-auditor"],["read:repository","read:user"]);
  assert.deepEqual(scopes["fixture-admin"],["read:repository","read:user"]);
  assert.equal(calls.some(x=>/merge-operator|synthetic-review/.test(x.uri)),false);
});

test("AUD-004: fails closed if the existing Gitea branch rule allows zero approvals",async()=>{
  const h=harness({approvals:0});
  await assert.rejects(provisionProtectedGiteaFixture(h.values),assert.AssertionError);
});

test("AUD-004: live and scripted full E2E use one shared provisioner, free synthetic fixture remains separate",async()=>{
  const scriptRoot=new URL("../../packages/agent-runtime/scripts/",import.meta.url);
  const scripts=["a2a-production-coordinator-mcp-isolated-real-positive.mjs",
    "a2a-production-coordinator-mcp-gemini-live.mjs"];
  const [free,live]=await Promise.all(scripts.map(name=>
    readFile(new URL(name,scriptRoot),"utf8")));
  for(const source of [free,live]){
    assert.match(source,/provisionProtectedGiteaFixture\(/);
    assert.doesNotMatch(source,/create read-scoped rule inspection token/);
    assert.doesNotMatch(source,/branch_protections",\{method:"POST"/);
  }
  assert.match(free,/positiveMergeFixture/);
  assert.doesNotMatch(live,/positiveMergeFixture|simulatedPositiveMerge/);
  assert.match(live,/Live Gemini cannot create a synthetic approval or merge/);
});
