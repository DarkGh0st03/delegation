/**
 * AUD-004: privileged Gitea setup common to the full scripted and Gemini
 * coordinator workflows. The disposable Gitea container is already running.
 *
 * This function never creates/merges a PR and never fabricates a human review.
 * The optional simulated-review fixture lives ONLY in the separate free script.
 * API clients and credentials remain owned by the coordinator harness.
 */
import assert from "node:assert/strict";

export async function provisionProtectedGiteaFixture({
  url, api, basic, seedPinnedMain, tokens, id,
  adminAuth, gatewayAuth, readonlyName, reviewerName, ciName,
  auditorPassword, ciPassword, baselineSha, lastTestPath,
  fetchFn=fetch
}){
  await api(url,"/api/v1/orgs",{method:"POST",auth:adminAuth,
    label:"create private org",body:{username:"thesis",visibility:"private"}});
  await api(url,"/api/v1/orgs/thesis/repos",{
    method:"POST",auth:adminAuth,label:"create disposable repository",
    body:{name:"iam-console-poc",private:true,auto_init:false,
      default_branch:"main"}
  });
  const repo="/api/v1/repos/thesis/iam-console-poc";
  await seedPinnedMain(url,adminAuth);
  const main=await api(url,repo+"/branches/main",{auth:adminAuth});
  const mainSha=main.commit?.id;
  assert.equal(mainSha,baselineSha);
  // Main must be the pinned full application, not a minimal test double.
  const missing=await fetchFn(url+repo+"/contents/"+
    lastTestPath+"?ref=main",{
      headers:{authorization:adminAuth},signal:AbortSignal.timeout(8000)
    });
  assert.equal(missing.status,404,"E2E file must be created by Test Agent");
  const frozenMain=await api(url,repo+"/branches/main",{auth:adminAuth});
  const frozenMainSha=frozenMain.commit?.id;
  assert.equal(frozenMainSha,baselineSha);
  await api(url,repo+"/branch_protections",{method:"POST",auth:adminAuth,
    label:"protect disposable main",body:{
      branch_name:"main",enable_push:false,enable_force_push:false,
      required_approvals:1,block_admin_merge_override:true,
      dismiss_stale_approvals:true,block_on_outdated_branch:true
    }});
  await api(url,repo+"/collaborators/"+encodeURIComponent(tokens.gatewayUser),{
    method:"PUT",auth:adminAuth,expected:[204],
    body:{permission:"write"},label:"authorize isolated Gateway user"
  });
  const token=await api(url,"/api/v1/users/"+
    encodeURIComponent(tokens.gatewayUser)+"/tokens",{
    method:"POST",auth:gatewayAuth,
    label:"create scoped disposable Gitea token",
    body:{name:"a2a-mcp-multirole-"+id,scopes:["write:repository","read:user"]}
  });
  assert.ok(typeof token.sha1==="string"&&token.sha1.length>=20);
  await api(url,repo,{auth:"token "+token.sha1});

  // A separate READ-ONLY repository account queries approval/CI evidence.
  await api(url,repo+"/collaborators/"+encodeURIComponent(readonlyName),{
    method:"PUT",auth:adminAuth,expected:[204],
    body:{permission:"read"},label:"grant disposable auditor read-only"
  });
  const readCredential=await api(url,"/api/v1/users/"+
    encodeURIComponent(readonlyName)+"/tokens",{
      method:"POST",auth:basic(readonlyName,auditorPassword),
      label:"create read-only verifier token",body:{
        name:"pr-merge-readiness-"+id,scopes:["read:repository","read:user"]
      }
    });
  assert.ok(typeof readCredential.sha1==="string"&&readCredential.sha1.length>=20);
  // CI runs in the trusted harness, not the Agent/Gateway process. It has
  // independent write:repository authority for exact-SHA status publication;
  // the model only sees the ordinary Test Runner verdict, never this token.
  await api(url,repo+"/collaborators/"+encodeURIComponent(ciName),{
    method:"PUT",auth:adminAuth,expected:[204],
    body:{permission:"write"},label:"grant disposable independent CI publisher"
  });
  const ciCredential=await api(url,"/api/v1/users/"+
    encodeURIComponent(ciName)+"/tokens",{
      method:"POST",auth:basic(ciName,ciPassword),
      label:"create independent disposable trusted CI token",
      body:{name:"trusted-security-ci-"+id,
        scopes:["write:repository","read:user"]}
    });
  assert.ok(typeof ciCredential.sha1==="string"&&ciCredential.sha1.length>=20);
  const checkedCiActor=await api(url,"/api/v1/user",{
    auth:"token "+ciCredential.sha1,
    label:"verify independent status publisher identity"
  });
  assert.equal(checkedCiActor.login,ciName);
  // Gitea's rule-inspection endpoint can require an administrator account,
  // even while branch contents and PRs are visible to repo readers.
  // Obtain a SECOND read:repository-only PAT, restricted in code to exactly
  // one GET /branch_protections/main endpoint (no write/merge APIs).
  const protectionCredential=await api(url,"/api/v1/users/"+
    encodeURIComponent(tokens.adminUser)+"/tokens",{
    method:"POST",auth:adminAuth,label:"create read-scoped rule inspection token",
    body:{name:"merge-rule-read-"+id,scopes:["read:repository","read:user"]}
  });
  assert.ok(typeof protectionCredential.sha1==="string"&&
    protectionCredential.sha1.length>=20);
  const observedRule=await api(url,repo+"/branch_protections/main",{
    auth:"token "+protectionCredential.sha1,
    label:"verify read-scoped branch protection inspection"
  });
  assert.equal(observedRule.branch_name,"main");
  assert.equal(observedRule.enable_push,false);
  assert.equal(observedRule.enable_force_push,false);
  assert.ok(observedRule.required_approvals>=1);
  const seenRepo=await api(url,repo,{
    auth:"token "+readCredential.sha1,label:"check read-only auditor access"
  });
  assert.equal(seenRepo.full_name,"thesis/iam-console-poc");
  const reviewer=await api(url,"/api/v1/users/"+encodeURIComponent(reviewerName),{
    auth:adminAuth,label:"resolve synthetic reviewer identity"
  });
  const security=await api(url,"/api/v1/users/"+encodeURIComponent(ciName),{
    auth:adminAuth,label:"resolve synthetic CI identity"
  });
  for(const [actor,name] of [[reviewer,reviewerName],[security,ciName]]){
    assert.equal(actor.login,name);
    assert.ok(Number.isSafeInteger(actor.id)&&actor.id>0);
  }
  return {
    repo, mainSha:frozenMainSha, token:token.sha1,
    mergeReadToken:readCredential.sha1,
    mergeProtectionReadToken:protectionCredential.sha1,
    mergeReviewer:{id:reviewer.id,login:reviewer.login},
    mergeCI:{id:security.id,login:security.login},
    ciStatusToken:ciCredential.sha1
  };
}
