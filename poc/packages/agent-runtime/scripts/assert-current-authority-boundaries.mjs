import assert from "node:assert/strict";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {GatewayControlledToolClient} from "../src/gateway-tool-client.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";
import {OrchestratorProtectedGatewayClient,OrchestratorGatewayClientError}
  from "../../orchestrator-runtime/src/orchestrator-gateway-client.ts";

// Reuse the current Coordinator's real DCs and disposable providers. These
// probes deliberately bypass model/MCP path filtering: role scope must still
// hold at the cryptographic Adapter and Gateway trust boundaries.
export async function assertCurrentAuthorityBoundaries({
  gatewayBaseUrl,adapterBaseUrl,tokens,rootCredentialId,delegatedTasks,
  giteaBaseUrl,giteaRepo,giteaAuthorization,branch,runId,runnerRequestCount
}){
  async function gitea(path){
    const response=await fetch(giteaBaseUrl+giteaRepo+path,{
      headers:{authorization:giteaAuthorization,accept:"application/json"},
      redirect:"error",signal:AbortSignal.timeout(10000)
    });
    assert.equal(response.status,200,"Authority boundary Gitea observation failed");
    return response.json();
  }
  async function head(ref=branch){
    return (await gitea("/branches/"+encodeURIComponent(ref))).commit.id;
  }
  async function file(path,ref=branch){
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const result=await gitea("/contents/"+encoded+"?ref="+encodeURIComponent(ref));
    return {sha:result.sha,content:Buffer.from(result.content,"base64").toString("utf8")};
  }
  const test=delegatedTasks.test;
  const attenuatedPermissions=test.credential.credentialSubject.per.filter(
    permission=>permission.operation!=="run_tests"
  );
  assert.equal(attenuatedPermissions.length,
    test.credential.credentialSubject.per.length-1,
    "The current Test template must include exactly one run_tests permission");
  const attenuatedId="urn:thesis:authority-boundary-test-no-runner:"+runId;
  const issued=await fetch(adapterBaseUrl+"/v1/credentials/child",{
    method:"POST",headers:{authorization:"Bearer "+tokens.orchestrator,
      "content-type":"application/json"},
    body:JSON.stringify({parent_credential_id:rootCredentialId,
      credential_id:attenuatedId,delegatee:"test",
      valid_from:new Date().toISOString(),validity_seconds:1800,
      credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
        statusListIndex:"886",statusListCredential:
          "https://status.example/lists/current-authority-boundaries-"+runId},
      permissions:attenuatedPermissions}),
    redirect:"error",signal:AbortSignal.timeout(15000)
  });
  assert.equal(issued.status,201,"Real Adapter did not issue attenuated Test DC");
  const attenuated=await issued.json();
  assert.equal(attenuated.id,attenuatedId);
  assert.equal(attenuated.credentialSubject.sub,test.credential.credentialSubject.sub);
  assert.deepEqual(attenuated.credentialSubject.per,attenuatedPermissions);
  const noRunnerEvidence={credential:JSON.stringify(attenuated),
    credential_id:attenuatedId,presenter_id:attenuated.credentialSubject.sub};
  const backend="apps/backend/src/users/user.service.ts";
  const frontend="apps/frontend/src/api/users-api.ts";
  const readOnly="apps/backend/src/users/user.model.ts";
  const cases=[
    {id:"backend-cross-role-frontend",role:"backend",path:frontend},
    {id:"backend-security",role:"backend",path:"security/src/security-config.ts"},
    {id:"frontend-cross-role-backend",role:"frontend",path:backend},
    {id:"backend-read-update-operation-mismatch",role:"backend",path:readOnly},
    {id:"test-application-source-update",role:"test",path:backend},
    {id:"test-runner-without-run-tests-authority",role:"test",path:null,
      evidence:noRunnerEvidence,credential:attenuated}
  ];
  const initialHead=await head();
  const initialRunnerCount=runnerRequestCount();
  const outcomes=[];
  for(const boundary of cases){
    const beforeHead=await head();
    const beforeFile=boundary.path===null?null:await file(boundary.path);
    const evidence=boundary.evidence??delegatedTasks[boundary.role].delegation_evidence;
    const credential=boundary.credential??delegatedTasks[boundary.role].credential;
    const allowedRead=credential.credentialSubject.per.find(p=>p.operation==="read_file");
    assert.ok(allowedRead,"Boundary probe needs an existing read permission");
    if(boundary.id==="backend-read-update-operation-mismatch"){
      assert.ok(credential.credentialSubject.per.some(p=>p.operation==="read_file"&&
        p.resource.endsWith("/"+readOnly)),"Mismatch case must have read authority");
    }
    const tool=boundary.path===null?"run_tests":"update_file";
    const args=boundary.path===null?{branch,profile:"poc-default"}:
      {branch,path:boundary.path,content:"Unauthorized authority-boundary probe\n"};
    // First use the ordinary client. Core must refuse selective disclosure of
    // missing authority. Then submit a genuinely signed VP for an allowed read
    // permission, bound to this request's fresh challenge: Gateway verification
    // must reject that unrelated permission, before OPA/provider execution.
    const probes=[];
    for(const unrelatedProof of [false,true]){
      const trace={};
      const observedFetch=async(url,options)=>{
        const response=await fetch(url,options);
        const endpoint=new URL(url).pathname;
        if(endpoint==="/v1/authorization/prepare"){
          trace.prepare=response.status;
          const prepared=await response.clone().json();
          trace.permission=prepared.required_permission;
        }else if(endpoint==="/v1/presentations")trace.presentation=response.status;
        else if(endpoint==="/v1/authorization/execute"){
          trace.execute=response.status;
          trace.gateway_error=(await response.clone().json()).error;
        }
        return response;
      };
      const handler=new DelegationEvidenceHandler({adapterBaseUrl,
        adapterToken:tokens[boundary.role],evidence,fetchFn:observedFetch});
      const client=new GatewayControlledToolClient({gatewayBaseUrl,
        agentRole:boundary.role,taskId:"current-authority-"+boundary.id+"-"+
          (unrelatedProof?"unrelated-proof":"missing-authority")+"-"+runId,
        evidenceHandler:unrelatedProof?{
          createPresentation:prepared=>handler.createPresentation({
            ...prepared,required_permission:allowedRead
          })
        }:handler,fetchFn:observedFetch});
      await assert.rejects(()=>client.invoke(tool,args),error=>
        error instanceof ControlledToolError&&error.kind==="authorization_denied",
        "Real delegated authority unexpectedly allowed "+boundary.id);
      assert.equal(trace.prepare,201,"Probe did not reach real Gateway prepare");
      assert.ok(!credential.credentialSubject.per.some(p=>
        p.operation===trace.permission.operation&&p.resource===trace.permission.resource),
        "Probe must request authority absent from the actual role DC");
      if(unrelatedProof){
        assert.equal(trace.presentation,200,"Allowed read proof was not issued by real Adapter");
        assert.equal(trace.execute,403,"Unrelated proof did not reach real Gateway denial");
        assert.equal(trace.gateway_error,"verification_rejected");
      }else{
        assert.equal(trace.presentation,400,"Core did not reject missing authority disclosure");
        assert.equal(trace.execute,undefined,"Rejected disclosure must not reach Gateway execute");
      }
      assert.equal(await head(),beforeHead,"Denied probe changed the actual Gitea branch");
      if(boundary.path!==null)assert.deepEqual(await file(boundary.path),beforeFile,
        "Denied probe changed actual Gitea file "+boundary.path);
      assert.equal(runnerRequestCount(),initialRunnerCount,
        "Denied run_tests request reached the real Runner");
      probes.push({proof:unrelatedProof?"allowed_read_without_requested_authority":"missing_authority",
        denied_at:unrelatedProof?"gateway_real_adapter_verification":"real_adapter_disclosure",
        status:unrelatedProof?trace.execute:trace.presentation});
    }
    outcomes.push({case:boundary.id,role:boundary.role,denied:true,probes,
      gitea_branch_unchanged:true,gitea_file_unchanged:boundary.path===null?null:true,
      runner_not_reached:true});
  }
  const mainBefore=await head("main");
  const currentBackend=await file(backend);
  const originalBackend=await file(backend,"main");
  assert.notEqual(originalBackend.sha,currentBackend.sha,
    "Stale SHA probe requires a genuinely outdated baseline blob");
  // update_file deliberately accepts no caller-supplied SHA: its provider
  // resolves the current blob itself. Preserve the old direct-Gitea stale
  // precondition probe explicitly, without misrepresenting it as a role call.
  const stale=await fetch(giteaBaseUrl+giteaRepo+"/contents/"+backend,{
    method:"PUT",headers:{authorization:giteaAuthorization,
      accept:"application/json","content-type":"application/json"},
    body:JSON.stringify({branch,sha:originalBackend.sha,
      content:Buffer.from("Stale overwrite must fail\n").toString("base64"),
      message:"current provider stale blob precondition probe"}),
    redirect:"error",signal:AbortSignal.timeout(10000)
  });
  assert.ok([409,422].includes(stale.status),
    "Gitea must reject the actual stale blob SHA with a conflict");
  const staleError=await stale.json();
  assert.match(staleError.message??"",/sha/iu,
    "Gitea rejected the write for a reason unrelated to the stale SHA");
  assert.deepEqual(await file(backend),currentBackend,
    "Rejected stale write changed actual Gitea backend contents");
  assert.equal(await head(),initialHead,"Rejected stale write moved the feature branch");
  assert.equal(await head("main"),mainBefore,"Rejected stale write moved protected main");
  assert.equal(runnerRequestCount(),initialRunnerCount);
  const providerConflicts=[{case:"direct_gitea_stale_blob",path:"direct_gitea_provider",
    status:stale.status,error:"stale_blob_sha",gitea_file_unchanged:true,
    gitea_branch_unchanged:true,main_unchanged:true,runner_not_reached:true}];
  // Unlike the role denials above, this request has valid delegated authority
  // and must pass verification and OPA before the live Gitea conflict is mapped.
  const pullsBefore=await gitea("/pulls?state=all");
  assert.equal(pullsBefore.length,1,"Conflict probe requires the Coordinator's sole PR");
  const snapshotPulls=pulls=>pulls.map(p=>({id:p.id,number:p.number,state:p.state,
    merged:p.merged,head:p.head?.sha,head_ref:p.head?.ref,base_ref:p.base?.ref}));
  const conflictTrace={};
  const observedConflictFetch=async(url,options)=>{
    const response=await fetch(url,options);
    const endpoint=new URL(url).pathname;
    if(endpoint==="/v1/authorization/prepare")conflictTrace.prepare=response.status;
    else if(endpoint==="/v1/presentations")conflictTrace.presentation=response.status;
    else if(endpoint==="/v1/authorization/execute"){
      conflictTrace.execute=response.status;
      conflictTrace.error=(await response.clone().json()).error;
    }
    return response;
  };
  const existingE2e="tests/e2e/account-suspension.spec.ts";
  const e2eBefore=await file(existingE2e);
  const testEvidenceHandler=new DelegationEvidenceHandler({adapterBaseUrl,
    adapterToken:tokens.test,evidence:test.delegation_evidence,
    fetchFn:observedConflictFetch});
  const testGateway=new GatewayControlledToolClient({gatewayBaseUrl,
    agentRole:"test",taskId:"current-provider-duplicate-create-"+runId,
    evidenceHandler:testEvidenceHandler,fetchFn:observedConflictFetch});
  await assert.rejects(()=>testGateway.invoke("create_file",{
    branch,path:existingE2e,content:"Duplicate create must not overwrite existing E2E\n"
  }),error=>error instanceof ControlledToolError&&
    error.kind==="authorization_denied"&&error.statusCode===409,
    "Authorized duplicate create must fail with the actual provider conflict");
  assert.deepEqual(conflictTrace,{prepare:201,presentation:200,execute:409,
    error:"provider_conflict"});
  assert.deepEqual(await file(existingE2e),e2eBefore,
    "Rejected duplicate create changed the existing E2E file");
  assert.equal(await head(),initialHead);
  assert.equal(await head("main"),mainBefore);
  assert.equal(runnerRequestCount(),initialRunnerCount);
  providerConflicts.push({case:"duplicate_create_file",
    path:"test_dc_gateway_opa_gitea",status:409,error:"provider_conflict",
    gitea_file_unchanged:true,gitea_branch_unchanged:true,main_unchanged:true,
    runner_not_reached:true});
  for(const key of Object.keys(conflictTrace))delete conflictTrace[key];
  const orchestrator=new OrchestratorProtectedGatewayClient({gatewayBaseUrl,
    adapterBaseUrl,adapterToken:tokens.orchestrator,rootCredentialId,
    fetchFn:observedConflictFetch});
  await assert.rejects(()=>orchestrator.createAccountSuspensionPullRequest(
    "current-provider-duplicate-pr-"+runId),error=>
      error instanceof OrchestratorGatewayClientError&&error.statusCode===409,
    "Authorized duplicate PR must fail with the actual provider conflict");
  assert.deepEqual(conflictTrace,{prepare:201,presentation:200,execute:409,
    error:"provider_conflict"});
  assert.deepEqual(snapshotPulls(await gitea("/pulls?state=all")),snapshotPulls(pullsBefore),
    "Rejected duplicate PR changed actual Gitea PRs");
  assert.equal(await head("main"),mainBefore,"Provider conflict moved protected main");
  assert.equal(await head(),initialHead);
  assert.equal(runnerRequestCount(),initialRunnerCount);
  providerConflicts.push({case:"duplicate_pull_request",
      path:"orchestrator_root_gateway_opa_gitea",status:409,error:"provider_conflict",
      pull_requests_unchanged:true,main_unchanged:true,
      gitea_branch_unchanged:true,runner_not_reached:true});
  return {cases:outcomes,provider_conflicts:providerConflicts,gitea_branch_unchanged:true,
    runner_requests_before:initialRunnerCount,runner_requests_after:runnerRequestCount(),
    policy_on_invalid_proof:"not_evaluated_fail_closed"};
}
