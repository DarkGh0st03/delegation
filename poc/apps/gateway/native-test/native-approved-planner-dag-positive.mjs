/**
 * One native, signed four-task DAG over the disposable Gitea repository:
 *   branch -> Backend -> Frontend -> Test
 * Real Rust/EVM task-scoped children, native VP, OPA, Gateway provider effects,
 * HTTP A2A SDK, and exact-SHA Docker Runner with independent acceptance.
 * All 11 reference changes are named in the signed plan, not applied by an
 * out-of-band bootstrap. This is deterministic test code, NOT Gemini output.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt,generateKeyPairSync,createHash} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {GatewayRuntime} from "../src/runtime.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {GiteaExecutor} from "../src/gitea-executor.ts";
import {RunnerClient} from "../src/runner-client.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {IsolatedDockerRunnerExecutor} from
  "../../test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer} from
  "../../test-runner-controller/src/http.ts";

import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";
import {SIGNED_GEMINI_PILOT}
  from "../../../scripts/signed-gemini-pilot-consent.mjs";
import {SourceWitnessedOfflineAdkModel}
  from "./source-witnessed-offline-adk-model.mjs";
import {SourceDerivedRouteOfflineAdkModel}
  from "./source-derived-route-offline-adk-model.mjs";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";
import {bindModelsToApprovedRoleTasks}
  from "./approved-plan-agent-model-binding.mjs";
import {assertApprovedPlanScope,planDigest as hashApprovedPlan} from
  "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {canonicalRepositoryUri,canonicalBranchUri,canonicalFileUri}
  from "../src/canonical.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {analyzeApprovedTestEdits} from "./approved-test-edits.mjs";
import {preflightApprovedPilotDag} from "./approved-dag-preflight.mjs";
import {classifyApprovedDagFailure} from "./native-approved-dag-failure-category.mjs";
import {verifyPilotRunnerOutcome} from "./verified-pilot-runner-outcome.mjs";
import {compareTrustedTypecheckRevisions}
  from "../../test-runner-controller/scripts/typecheck-revision-comparison.mjs";
import {auditTrustedTypecheckPermissionScope}
  from "../../test-runner-controller/scripts/typecheck-permission-scope-audit.mjs";
import {sanitizeTypecheckLocations,sanitizeTypecheckErrorCodes} from
  "../../test-runner-controller/src/typecheck-diagnostics.ts";
import {createSharedMcpHttpServer}
  from "../../../mcp-shared/src/http-server.ts";

const adapterUrl="http://127.0.0.1:8090";
const EDIT_ROLES=["backend","frontend"];
const ROLES=[...EDIT_ROLES,"test"];
const SHA=/^[0-9a-f]{40}$/u;
async function signedVp(credentialId,challenge,token){
  const response=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",headers:{authorization:"Bearer "+token,
      "content-type":"application/json"},
    body:JSON.stringify({
      credential_id:credentialId,
      disclosed_permissions:[challenge.required_permission],
      audience:challenge.audience,challenge:challenge.challenge
    })
  });
  assert.equal(response.status,200,"Native Adapter must sign exact permission");
  const signed_vp=(await response.json()).signed_vp;
  assert.ok(typeof signed_vp==="string"&&signed_vp.length>100);
  return signed_vp;
}
async function freePort(){
  const listener=createServer();
  await new Promise((resolve,reject)=>{
    listener.once("error",reject);listener.listen(0,"127.0.0.1",resolve);
  });
  const number=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return number;
}
export async function runNativePositiveApprovedDag({
  coordinator,reviewGate,approvedPlans,sessionId,planDigest,baseSha,
  operationalRootId,branch,planningFiles,
  referenceFiles,scenarioId,repo,giteaBase,
  readerToken,writerToken,opaUrl,engineerDid,orchestratorToken,agentTokens,
  /** Trusted owner-only factory for non-fixture ADK models; never CLI/env. */
  approvedAgentModelFactory,realGeminiPilot=false,offlineRecovery=false,
  offlineTypecheckProbe=false,
  offlineMultiTest=false,onPilotPhase,onPilotError
}){
  if(offlineRecovery&&(realGeminiPilot||
     typeof approvedAgentModelFactory!=="function"))
    throw Error("Signed-DAG recovery is a host-selected offline fixture only");
  if(offlineMultiTest&&(!offlineRecovery||realGeminiPilot||
     typeof approvedAgentModelFactory!=="function"))
    throw Error("Multiple Test A2A Tasks require signed offline recovery fixture");
  if(offlineTypecheckProbe&&(realGeminiPilot||offlineRecovery||offlineMultiTest||
     typeof approvedAgentModelFactory!=="function"))
    throw Error("Typecheck fault probe requires a scripted nonbillable signed DAG");
  if((realGeminiPilot&&typeof approvedAgentModelFactory!=="function")||
     (approvedAgentModelFactory!==undefined&&
      typeof approvedAgentModelFactory!=="function"))
    throw Error("Approved model factory must be host-owned");
  assert.match(giteaBase,/^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.match(baseSha,SHA);
  for(const token of [readerToken,writerToken,orchestratorToken,
    ...ROLES.map(role=>agentTokens[role])])
    assert.ok(typeof token==="string"&&token.length>10);
  assert.equal(coordinator.phase,"execution");
  assert.match(scenarioId,/^[a-z][a-z0-9-]{0,63}$/u);
  if(!approvedAgentModelFactory&&
     (!["account-suspension","department-directory"].includes(scenarioId)||
     !referenceFiles||typeof referenceFiles!=="object"||
     Array.isArray(referenceFiles)))
    throw Error("Invalid offline implementation fixture");
  // The signed, authenticated Engineer receipt determines every file/operation.
  // Reference payloads remain scripted test inputs, NEVER a grant of authority.
  const signed=await reviewGate.loadAuthenticatedApproval(sessionId);
  assert.equal(hashApprovedPlan(signed.plan),planDigest);
  const grants=assertApprovedPlanScope(signed.plan,signed.approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:engineerDid
  });
  // A single generic compiler selects tool calls from the AUTHENTICATED
  // Engineer-signed plan. Only the resulting code bytes remain test fixtures.
  // No reference fixture chooses the resources, roles or permissions.
  if(realGeminiPilot)onPilotPhase?.("model_binding");
  const hostModels=approvedAgentModelFactory
    ? bindModelsToApprovedRoleTasks({
        plan:signed.plan,approvedRows:grants,
        modelFactory:approvedAgentModelFactory
      })
    : null;
  // In the zero-billing CI, script contents are supplied by independent
  // offline acceptance fixtures. With host-selected ADK models, NO fixture
  // payload is supplied to the model factory or the ADK worker.
  const offlineScripts=hostModels?null:buildOfflineAdkScriptsFromApprovedPlan({
    plan:signed.plan,approvedRows:grants,repo,branch,
    implementationContents:referenceFiles
  });
  if(hostModels)
    assert.deepEqual(hostModels.selected_roles,[...ROLES],
      "This existing three-role native acceptance harness requires all roles");
  if(realGeminiPilot)onPilotPhase?.("dag_preflight");
  const ready=preflightApprovedPilotDag({plan:signed.plan,grants,repo,branch});
  const {taskIdsByRole,branchTaskId,reviewTaskId}=ready;
  const allSpecialistTaskIds=ROLES.flatMap(role=>taskIdsByRole[role]);
  const root=canonicalRepositoryUri(repo);
  const scopedBranch=canonicalBranchUri(repo,branch);
  const filePrefix=scopedBranch+"/files/";
  const approvedFiles=(role,operation)=>grants.filter(g=>
    g.agent_id===role&&g.operation===operation).map(g=>{
    assert.ok(g.resource.startsWith(filePrefix),"Wrong approved file branch");
    const encoded=g.resource.slice(filePrefix.length);
    const parts=encoded.split("/");
    assert.ok(parts.length>0&&parts.every(x=>x.length>0));
    const decoded=parts.map(decodeURIComponent);
    assert.ok(decoded.every(x=>x&&x!=="."&&x!==".."&&
      !x.includes("/")&&!x.includes("\\")&&!/[\x00-\x1f\x7f]/u.test(x)),
      "Invalid approved file path");
    const path=decoded.join("/");
    assert.equal(canonicalFileUri(repo,branch,path),g.resource);
    return path;
  });
  const files={},readableFiles={};
  let implementationGrantCount=0;
  for(const role of EDIT_ROLES){
    const writes=approvedFiles(role,"update_file");
    const reads=approvedFiles(role,"read_file");
    // Approved edits are capabilities, not mandatory model actions.
    // Genuine read-only work is confirmed through Gateway snapshot evidence.
    // A Planner may grant extra read-only source context. Every writable
    // file still needs an approved read in its own Task, verified separately
    // by the per-dispatch source-read guard below.
    const grantsByTask=grants.filter(g=>g.agent_id===role);
    for(const write of grantsByTask.filter(g=>g.operation==="update_file")){
      assert.ok(grantsByTask.some(read=>
        read.task_id===write.task_id&&read.operation==="read_file"&&
        read.resource===write.resource),
      "Every signed implementation edit requires same-Task read authority");
    }
    implementationGrantCount+=writes.length+reads.length;
    files[role]=[...new Set(writes)];
    readableFiles[role]=[...new Set(reads)];
  }
  const approvedTestCreates=approvedFiles("test","create_file");
  const approvedTestUpdates=approvedFiles("test","update_file");
  const approvedTestReads=approvedFiles("test","read_file");
  // Test is allowed zero, one or many edits, all derived from signed
  // permission rows. The controlled Runner remains mandatory.
  const testGrants=grants.filter(g=>g.agent_id==="test");
  const {createdTestFiles,updatedTestFiles,readableTestFiles,
    expectedWriteKeys:expectedTestWriteKeys}=analyzeApprovedTestEdits({
      creates:approvedTestCreates,updates:approvedTestUpdates,
      reads:approvedTestReads,testGrants
    });
  const allowedNonFile=[
    ["orchestrator","create_branch",root],
    ["orchestrator","create_pull_request",root],
    ["test","run_tests",scopedBranch]
  ];
  for(const [role,operation,resource] of allowedNonFile){
    assert.equal(grants.filter(g=>g.agent_id===role&&
      g.operation===operation&&g.resource===resource).length,1);
  }
  const approvedCount=implementationGrantCount+
    approvedTestCreates.length+approvedTestUpdates.length+
    approvedTestReads.length+allowedNonFile.length;
  assert.equal(grants.length,approvedCount,
    "Signed plan contains unexpected extra tool grants");
  const implementationFiles=[...files.backend,...files.frontend];
  const expectedImplementationWriteKeys=new Set(grants.filter(g=>
    EDIT_ROLES.includes(g.agent_id)&&g.operation==="update_file").map(g=>
    g.task_id+"\0"+g.operation+"\0"+g.resource));
  // A later approved Test Task may read the regression source written by
  // an earlier Test Task. That new path is NOT present on main and must not
  // be fetched during baseline capture; the Gateway still enforces each
  // task's actual signed read and checks Gitea state when invoked.
  const expectedExisting=[...new Set([
    ...implementationFiles,...readableFiles.backend,
    ...readableFiles.frontend,...approvedTestReads
  ])].filter(path=>!createdTestFiles.includes(path));
  // Task-level permissions determine who may edit a file. An approved
  // Test Task can legitimately update a source file previously edited by
  // Backend when the DAG orders the two writes. The shared plan compiler
  // and pilot preflight reject unordered competing writers.
  for(const path of createdTestFiles)
    assert.ok(!expectedExisting.includes(path),
      "New Test files must not be read from main");
  if(!hostModels)assert.deepEqual(
    [...implementationFiles,...approvedTestCreates].sort(),
    Object.keys(referenceFiles).sort());
  const reader=new GiteaClient({
    baseUrl:giteaBase,token:readerToken,owner:repo.owner,
    repository:repo.repository,timeoutMs:20000
  });
  const writer=new GiteaClient({
    baseUrl:giteaBase,token:writerToken,owner:repo.owner,
    repository:repo.repository,timeoutMs:20000
  });
  if(realGeminiPilot)onPilotPhase?.("baseline_reads");
  const originals={};
  for(const path of expectedExisting){
    const result=await reader.readTextFile("main",path,baseSha);
    assert.equal(result.revision,baseSha);
    originals[path]=result.content;
    if(!hostModels)assert.notEqual(result.content,referenceFiles[path],
      "Native offline fixture must actually change approved baseline");
  }
  await assert.rejects(()=>reader.getBranchMetadata(branch));
  const repositoryUri="gitea://"+repo.authority+"/"+repo.owner+"/"+repo.repository;
  const runnerToken=randomBytes(32).toString("hex");
  const runLogs=await mkdtemp(join(tmpdir(),"native-approved-dag-runner-"));
  const executor=new IsolatedDockerRunnerExecutor({
    gitea_base_url:giteaBase,gitea_owner:repo.owner,
    gitea_repository:repo.repository,gitea_token:readerToken,
    docker_image:process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm",
    phase_timeout_ms:300000,total_timeout_ms:840000,
    log_dir:runLogs,acceptance_enabled:true,
    acceptance_dir:fileURLToPath(new URL("../../../runner/acceptance/",import.meta.url))
  });
  const runnerServer=createRunnerHttpServer({
    bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerToken,
    contract:{repository:repositoryUri,branch}
  },executor);
  await new Promise((resolve,reject)=>{
    runnerServer.once("error",reject);
    runnerServer.listen(0,"127.0.0.1",resolve);
  });
  const runnerClient=new RunnerClient({
    baseUrl:"http://127.0.0.1:"+runnerServer.address().port,
    gatewayToken:runnerToken,timeoutMs:845000
  });
  const gateway=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",
      request_ttl_ms:120000,repository:repo},
    opa_url:opaUrl,opa_timeout_ms:15000,
    provider_mode:"mock",gitea_timeout_ms:15000
  },{
    approvedPlans,verifier:loadDirectCoreRustVerifier(),
    policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
    executor:new GiteaExecutor(writer,runnerClient,repositoryUri)
  });
  const reads={backend:0,frontend:0},
    writes={backend:0,frontend:0};
  let testCalls=0,testCreates=0,testUpdates=0,testReads=0,
    runnerRuns=0,runnerOutcome=null,latestSha=baseSha;
  const runnerHistory=[];
  let createdPr=null;
  const childIds={},activeChildByRole={},activeTaskByRole={},
    servers=[],urls={},models={};
  // Explicit opt-in makes the SAME real-provider test exercise the
  // production shared MCP and private A2A worker rather than FunctionTool
  // transport. Agent model instructions and signed plan are unchanged.
  const sharedMcpEnabled=process.env.APPROVED_RUNNER_NATIVE_MCP==="1";
  let normalMcpCalls=0,privateCryptoMcpCalls=0;
  let signedTestOutOfScopeDenied=false;
  let observedTypecheckProbe=null;
  let deniedCrossRoleTestProbes=0;
  const mcpServers=[];
  const roleMcpKeys={},rolePorts={};
  let mcpSharedUrl,mcpCryptoUrl;
  const readPaths={backend:new Set(),frontend:new Set(),test:new Set()};
  const readPathsPerTask=new Map();
  const writePaths={backend:new Set(),frontend:new Set(),test:new Set()};
  // A create grant is not proof of a created file: record only successful
  // Gateway-corrobated create_file effects, not merely approved candidates.
  const observedCreatedPaths=new Set();
  const observedTestWriteKeys=new Set();
  const observedImplementationWriteKeys=new Set();
  const writeKey=(taskId,operation,path)=>
    taskId+"\0"+operation+"\0"+canonicalFileUri(repo,branch,path);
  const adkGatewayBase="http://approved-native-gateway.invalid";
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
  // ADK makes real controlled FunctionTool calls; this small in-process
  // transport only avoids opening an unauthenticated public Gateway port.
  // The Gateway itself still validates signed plans, live Rust VPs, OPA
  // and Gitea/Docker provider effects for EVERY operation.
  const adkFetchFor=role=>async(url,options)=>{
    const target=String(url);
    if(target.startsWith(adapterUrl+"/"))
      return fetch(url,options);
    if(!target.startsWith(adkGatewayBase+"/v1/authorization/"))
      throw Error("ADK attempted unknown transport");
    try{
      const request=JSON.parse(String(options?.body));
      if(target===adkGatewayBase+"/v1/authorization/prepare"){
        assert.equal(request.agent_role,role);
        assert.match(request.task_id,/^dispatch_[A-Za-z0-9_-]{22}$/u);
        if(role==="test"&&offlineRecovery&&!signedTestOutOfScopeDenied){
          // Genuine live Gateway denial with the active signed Test Task
          // binding. Frontend source remains writable only by its own role,
          // regardless of the Test Task's valid DC or model instructions.
          const foreignPath=files.frontend[0];
          assert.ok(foreignPath&&!approvedTestUpdates.includes(foreignPath),
            "Recovery fixture must test a genuinely unapproved Test resource");
          const headBefore=await reader.getBranchMetadata(branch);
          assert.throws(()=>gateway.prepare({
            task_id:request.task_id,agent_role:"test",
            tool:"update_file",arguments:{
              branch,path:foreignPath,content:"// forbidden Test role update"
            }
          }),e=>e?.code==="approved_plan_denied",
          "A signed Test Task must not expand its repair permission scope");
          const headAfter=await reader.getBranchMetadata(branch);
          assert.equal(headAfter.commit_sha,headBefore.commit_sha,
            "Denied cross-role repair must leave the Gitea branch unchanged");
          signedTestOutOfScopeDenied=true;
        }
        if(role==="test"){
          const op=request.tool;
          assert.ok(["create_file","read_file","update_file","run_tests"].includes(op));
          if(op==="create_file"){
            assert.ok(createdTestFiles.includes(request.arguments.path));
            assert.equal(request.arguments.branch,branch);
          }else if(op==="read_file"){
            assert.ok(approvedTestReads.includes(request.arguments.path));
            assert.equal(request.arguments.branch,branch);
          }else if(op==="update_file"){
            assert.ok(updatedTestFiles.includes(request.arguments.path));
            assert.equal(request.arguments.branch,branch);
            assert.ok(readPathsPerTask.get(activeTaskByRole.test)
              ?.has(request.arguments.path),
              "Test edit must read its approved source in this same Task");
            assert.equal(typeof request.arguments.content,"string");
            assert.ok(request.arguments.content.length>0&&
              request.arguments.content.length<=250000);
          }else{
            assert.equal(request.arguments.branch,branch);
            assert.equal(request.arguments.profile,"poc-default");
            // This Task may run tests without consuming every granted edit.
            // Functional acceptance, not authorization cardinality, decides success.
          }
        }else{
          assert.ok(["read_file","update_file"].includes(request.tool));
          assert.ok((request.tool==="read_file"
            ?readableFiles[role]:files[role]).includes(request.arguments.path),
            "Task request must stay inside signed read/write resource scope");
          assert.equal(request.arguments.branch,branch);
          if(request.tool==="update_file"){
            // A previous Task's read cannot satisfy this independently
            // delegated Task's source-witness requirement.
            assert.ok(readPathsPerTask.get(activeTaskByRole[role])
              ?.has(request.arguments.path),
              "Each approved implementation Task must read before its write");
            if(hostModels){
              assert.equal(typeof request.arguments.content,"string");
              assert.ok(request.arguments.content.length>0&&
                request.arguments.content.length<=250000,
                "Host-selected model must supply bounded complete file text");
            }else{
              assert.equal(request.arguments.content,
                referenceFiles[request.arguments.path]);
            }
          }
        }
        return reply(gateway.prepare(request),201);
      }
      if(target===adkGatewayBase+"/v1/authorization/execute"){
        const executed=await gateway.execute(request);
        assert.equal(executed.policy.allow,true);
        assert.equal(executed.policy.policy_version,"phase6-approved-branch-v2");
        assert.equal(executed.verified_delegation.presenter_id,
          process.env["ADAPTER_ID_"+role.toUpperCase()]);
        assert.equal(executed.verified_delegation.credential_id,
          activeChildByRole[role]);
        const effect=executed.execution;
        if(role!=="test"){
          assert.equal(effect.provider,"gitea");
          assert.ok((effect.tool==="read_file"
            ?readableFiles[role]:files[role]).includes(effect.path),
            "Verified provider effect must stay within approved operation scope");
          if(effect.tool==="read_file"){
            // Agents may legitimately re-read after updating a source file.
            // Compare to the actual signed-branch provider state, not the
            // historical baseline fixture.
            const current=await reader.readTextFile(branch,effect.path);
            assert.equal(effect.content,current.content);
            const roleTaskId=activeTaskByRole[role];
            assert.ok(taskIdsByRole[role].includes(roleTaskId));
            if(!readPathsPerTask.has(roleTaskId))
              readPathsPerTask.set(roleTaskId,new Set());
            readPathsPerTask.get(roleTaskId).add(effect.path);
            if(!readPaths[role].has(effect.path)){
              readPaths[role].add(effect.path);
              reads[role]++;
            }
          }else if(effect.tool==="update_file"){
            assert.ok(readPathsPerTask.get(activeTaskByRole[role])
              ?.has(effect.path),
              "A signed Task may not reuse another Task's prior read");
            assert.match(effect.commit_sha,SHA);
            const key=writeKey(activeTaskByRole[role],"update_file",effect.path);
            assert.ok(expectedImplementationWriteKeys.has(key),
              "Implementation effect must match the same signed Task grant");
            observedImplementationWriteKeys.add(key);
            if(!writePaths[role].has(effect.path)){
              writePaths[role].add(effect.path);
              writes[role]++;
              // Only observed, approved mutations count toward the result.
            }
            latestSha=effect.commit_sha;
          }else throw Error("ADK attempted unexpected approved provider operation");
        }else if(effect.tool==="read_file"&&role==="test"){
          assert.equal(effect.provider,"gitea");
          assert.ok(approvedTestReads.includes(effect.path));
          const current=await reader.readTextFile(branch,effect.path);
          assert.equal(effect.content,current.content);
          const activeTestTask=activeTaskByRole.test;
          assert.ok(taskIdsByRole.test.includes(activeTestTask));
          if(!readPathsPerTask.has(activeTestTask))
            readPathsPerTask.set(activeTestTask,new Set());
          readPathsPerTask.get(activeTestTask).add(effect.path);
          if(!readPaths.test.has(effect.path)){
            readPaths.test.add(effect.path);
            testReads++;
          }
        }else if(effect.tool==="update_file"&&role==="test"){
          assert.equal(effect.provider,"gitea");
          assert.ok(updatedTestFiles.includes(effect.path));
          assert.ok(readPathsPerTask.get(activeTaskByRole.test)
            ?.has(effect.path),
            "A Test edit cannot reuse a separate Task's prior source read");
          assert.match(effect.commit_sha,SHA);
          const key=writeKey(activeTaskByRole.test,"update_file",effect.path);
          assert.ok(expectedTestWriteKeys.has(key),
            "Test update must belong to the active signed Task");
          // Rewriting after a repair attempt is allowed; each granted edit
          // must still be observed at least once.
          if(!observedTestWriteKeys.has(key)){
            observedTestWriteKeys.add(key);
            testCalls++;testUpdates++;
          }
          writePaths.test.add(effect.path);
          const head=await reader.getBranchMetadata(branch);
          assert.equal(head.commit_sha,effect.commit_sha);
        }else if(effect.tool==="create_file"){
          assert.equal(effect.provider,"gitea");
          assert.ok(createdTestFiles.includes(effect.path));
          assert.match(effect.commit_sha,SHA);
          const key=writeKey(activeTaskByRole.test,"create_file",effect.path);
          assert.ok(expectedTestWriteKeys.has(key),
            "Test creation must belong to the active signed Task");
          assert.ok(!observedTestWriteKeys.has(key),
            "The same signed Task cannot create a file twice");
          observedTestWriteKeys.add(key);
          writePaths.test.add(effect.path);
          observedCreatedPaths.add(effect.path);
          const head=await reader.getBranchMetadata(branch);
          assert.equal(head.commit_sha,effect.commit_sha);
          testCalls++;testCreates++;
        }else if(effect.tool==="run_tests"){
          // The approved DAG controls task order. A permission is a ceiling,
          // never an obligation to invoke that tool. The Docker Runner
          // independently determines whether the scenario actually works.
          const pinned=await reader.getBranchMetadata(branch);
          assert.equal(effect.provider,"runner");
          assert.equal(effect.tested_commit_sha,pinned.commit_sha);
          // Preserve only independently sanitized TypeScript error codes,
          // never compiler messages, source snippets, or unapproved paths.
          const typecheckCodes=effect.status==="fail"&&
            effect.phases?.some(x=>x.phase==="typecheck"&&x.status==="fail")
            ?(effect.typecheck_error_codes!==undefined
              ?sanitizeTypecheckErrorCodes(effect.typecheck_error_codes)
              :[...new Set(sanitizeTypecheckLocations(
                effect.typecheck_diagnostics).map(x=>x.code))].sort()):[];
          const scopeAudit=effect.status==="fail"&&
            effect.phases?.some(x=>x.phase==="typecheck"&&x.status==="fail")
            ?auditTrustedTypecheckPermissionScope({
              diagnostics:sanitizeTypecheckLocations(effect.typecheck_diagnostics),
              planningFiles,approvedRows:grants,
              operationalPermissions:coordinator.trustedOperationalAuthority().permissions,
              repo,branch
            }):null;
          const revisionComparison=effect.status==="fail"&&
            effect.phases?.some(x=>x.phase==="typecheck"&&x.status==="fail")
            ?await compareTrustedTypecheckRevisions({
              diagnostics:sanitizeTypecheckLocations(effect.typecheck_diagnostics),
              planningFiles,createdPaths:[...observedCreatedPaths],
              observedWrites:writePaths,
              reader,branch,baseSha,testedSha:pinned.commit_sha
            }):null;
          if(offlineTypecheckProbe){
            assert.equal(effect.status,"fail");
            assert.deepEqual(typecheckCodes,["TS2820"]);
            assert.ok(scopeAudit&&revisionComparison,
              "Signed-root coverage and pinned-revision evidence required");
            assert.equal(scopeAudit.outside_planning_snapshot,0);
            assert.equal(scopeAudit.outside_signed_plan_write,0);
            assert.equal(scopeAudit.outside_operational_root_write,0);
            assert.equal(scopeAudit.within_operational_root_write,1);
            assert.equal(scopeAudit.within_test_task_write,0);
            assert.equal(scopeAudit.covered_by_backend_write,1);
            assert.equal(scopeAudit.covered_by_frontend_write,0);
            assert.equal(revisionComparison.diagnostic_files,1);
            assert.equal(revisionComparison.different_blob_from_base,1);
            assert.equal(revisionComparison.backend_writes_observed,1);
            assert.equal(revisionComparison.test_writes_observed,0);
            assert.equal(revisionComparison.unverifiable_files,0);
            // R91: even a hostile Test Agent with its own valid signed Task
            // and live child DC cannot transform Runner diagnostics into new
            // file capabilities. Exercise the ACTUAL Gateway prepare boundary,
            // not a mock classifier, while the Test Task is still active.
            const [diagnostic]=sanitizeTypecheckLocations(
              effect.typecheck_diagnostics);
            assert.ok(diagnostic&&files.backend.includes(diagnostic.path),
              "Compiler diagnostic must name an approved Backend file");
            assert.ok(!approvedTestReads.includes(diagnostic.path)&&
              !approvedTestUpdates.includes(diagnostic.path),
              "Cross-role target must genuinely be outside signed Test scope");
            assert.ok(taskIdsByRole.test.includes(activeTaskByRole.test),
              "Denied request must use the currently signed Test Task");
            const beforeDenied=await reader.getBranchMetadata(branch);
            assert.equal(beforeDenied.commit_sha,pinned.commit_sha);
            for(const tool of ["read_file","update_file"]){
              assert.throws(()=>gateway.prepare({
                task_id:activeTaskByRole.test,agent_role:"test",tool,
                arguments:{
                  branch,path:diagnostic.path,
                  ...(tool==="update_file"?{content:"FORBIDDEN_UNAPPROVED_WRITE"}:{})
                }
              }),e=>e?.code==="approved_plan_denied",
              "Runner evidence cannot expand an already signed Test Task");
              deniedCrossRoleTestProbes++;
            }
            const afterDenied=await reader.getBranchMetadata(branch);
            assert.equal(afterDenied.commit_sha,beforeDenied.commit_sha,
              "Denied cross-role requests must not mutate Gitea");
            observedTypecheckProbe=Object.freeze({
              codes:typecheckCodes,scope:scopeAudit,revision:revisionComparison
            });
          }
          process.stderr.write("[native-dag-adk] docker_phase_status "+
            JSON.stringify({
              status:effect.status,
              phases:effect.phases?.map(x=>({phase:x.phase,status:x.status})),
              project_tests:effect.project_tests?.status,
              researcher_acceptance:effect.researcher_acceptance?.status,
              ...(typecheckCodes.length?
                {typecheck_error_codes:typecheckCodes}:{}),
              ...(scopeAudit?{typecheck_permission_scope_audit:scopeAudit}:{}),
              ...(revisionComparison?{typecheck_revision_comparison:revisionComparison}:{})
            })+"\n");
          // A completed provider operation can legitimately report FAIL.
          // Return its real result to the controlled Test tool, which reports
          // tests_failed. Do not convert a functional failure to HTTP 403.
          // No A2A completion, trusted PASS, or PR is possible on failure.
          const verdict=verifyPilotRunnerOutcome(effect,pinned.commit_sha);
          runnerRuns++;runnerOutcome=effect;
          runnerHistory.push(effect);
          if(!verdict.passed){
            process.stderr.write("[native-dag-adk] runner_failed "+
              JSON.stringify({category:"functional_acceptance_failure"})+"\n");
          }
        }else throw Error("ADK Test Agent attempted unexpected operation");
        return reply(executed);
      }
      throw Error("Unsupported trusted Gateway route");
    }catch(error){
      // The model sees a generic denied result, never raw provider exceptions,
      // confidential request arguments, VP, source data or service tokens.
      process.stderr.write("[native-dag-adk] controlled_denial "+
        JSON.stringify({role,kind:error?.constructor?.name??"Error",
          code:error?.code??"unknown"})+"\n");
      return reply({error:"trusted_operation_denied"},403);
    }
  };
  if(realGeminiPilot)onPilotPhase?.("agent_bootstrap");
  try{
    if(sharedMcpEnabled){
      // All ports and public keys are created by the trusted offline host.
      // No MCP server receives an Adapter caller token or credential bytes.
      for(const role of ROLES){
        const keys=generateKeyPairSync("ed25519");
        roleMcpKeys[role]={
          signingPrivateKeyPem:keys.privateKey.export({
            type:"pkcs8",format:"pem"
          }).toString(),
          signingPublicKeyPem:keys.publicKey.export({
            type:"spki",format:"pem"
          }).toString()
        };
        rolePorts[role]=await freePort();
      }
      const verificationKeys=Object.fromEntries(
        ROLES.map(role=>[role,roleMcpKeys[role].signingPublicKeyPem])
      );
      const router=new TaskRouter(Object.fromEntries(
        ROLES.map(role=>[role,{
          baseUrl:"http://127.0.0.1:"+rolePorts[role]
        }])
      ));
      for(const profile of ["legacy","crypto"]){
        const server=createSharedMcpHttpServer({
          verificationKeys,router,
          ...(profile==="crypto"?{profile:"crypto"}:{})
        });
        server.on("request",req=>{
          if(req.method==="POST"&&req.url==="/mcp"){
            if(profile==="crypto")privateCryptoMcpCalls++;
            else normalMcpCalls++;
          }
        });
        await new Promise((resolve,reject)=>{
          server.once("error",reject);
          server.listen(0,"127.0.0.1",resolve);
        });
        mcpServers.push(server);
        const endpoint="http://127.0.0.1:"+server.address().port+"/mcp";
        if(profile==="crypto")mcpCryptoUrl=endpoint;
        else mcpSharedUrl=endpoint;
      }
      assert.ok(mcpSharedUrl&&mcpCryptoUrl);
    }
    for(const role of EDIT_ROLES){
      const targets=files[role];
      const scripted=offlineScripts?.[role];
      if(scripted)assert.deepEqual(scripted.flatMap(c=>
        c.name==="update_file"?[c.args.path]:[]).sort(),[...targets].sort(),
        "Signed plan must determine all scripted ADK writes");
      const model=hostModels?.models[role]??new OfflineApprovedAdkModel(role,scripted);
      models[role]=model;
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",
        port:sharedMcpEnabled?rolePorts[role]:await freePort(),
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        ...(sharedMcpEnabled?{mcpTaskSigning:roleMcpKeys[role]}:{}),
        adk:{
          model,gatewayBaseUrl:adkGatewayBase,adapterBaseUrl:adapterUrl,
          adapterToken:agentTokens[role],fetchFn:adkFetchFor(role),
          ...(sharedMcpEnabled?{
            mcpSharedUrl,mcpCryptoUrl,mcpUpdateFile:true
          }:{}),
          maxModelTurns:realGeminiPilot
            ?SIGNED_GEMINI_PILOT.maxTurnsPerTask[role]
            :scripted?scripted.length+2:24,
          maxModelCallMs:realGeminiPilot
            ?SIGNED_GEMINI_PILOT.maxModelCallMs:hostModels?90000:30000,
          ...(realGeminiPilot?{generateContentConfig:{
            maxOutputTokens:SIGNED_GEMINI_PILOT.maxOutputTokensPerRole[role],
            thinkingConfig:{thinkingLevel:SIGNED_GEMINI_PILOT.thinkingLevel}
          }}:{}),
          gatewayTimeoutMs:30000
        }
      });
      servers.push(server);urls[role]=server.baseUrl;
    }
    const testScript=offlineScripts?.test;
    if(testScript){
      assert.deepEqual(testScript.map(c=>c.name),
        ["create_file","run_tests"],
        "Offline test fixture must keep its one scripted create and final Runner");
      assert.equal(testScript[0].args.path,createdTestFiles[0]);
    }
    const testModel=hostModels?.models.test??
      new OfflineApprovedAdkModel("test",testScript);
    models.test=testModel;
    const testAgent=await startSpecializedAgentServer({
      role:"test",host:"127.0.0.1",
      port:sharedMcpEnabled?rolePorts.test:await freePort(),
      delegatedAuthorization:true,capabilityProfile:"approved-plan",
      ...(sharedMcpEnabled?{mcpTaskSigning:roleMcpKeys.test}:{}),
      adk:{
        model:testModel,gatewayBaseUrl:adkGatewayBase,adapterBaseUrl:adapterUrl,
        adapterToken:agentTokens.test,fetchFn:adkFetchFor("test"),
        ...(sharedMcpEnabled?{
          mcpSharedUrl,mcpCryptoUrl,
          mcpUpdateFile:updatedTestFiles.length>0,
          mcpCreateFile:createdTestFiles.length>0,mcpRunTests:true
        }:{}),
        maxModelTurns:realGeminiPilot
          ?SIGNED_GEMINI_PILOT.maxTurnsPerTask.test:hostModels?24:4,
        maxModelCallMs:realGeminiPilot
          ?SIGNED_GEMINI_PILOT.maxModelCallMs:hostModels?90000:30000,
        ...(realGeminiPilot?{generateContentConfig:{
          maxOutputTokens:SIGNED_GEMINI_PILOT.maxOutputTokensPerRole.test,
          thinkingConfig:{thinkingLevel:SIGNED_GEMINI_PILOT.thinkingLevel}
        }}:{}),
        gatewayTimeoutMs:30000
      }
    });
    servers.push(testAgent);urls.test=testAgent.baseUrl;
    if(realGeminiPilot)onPilotPhase?.("dispatcher_setup");
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId,
      expectedPlanDigest:planDigest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,agentBaseUrls:urls,
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:realGeminiPilot
          ?SIGNED_GEMINI_PILOT.maxA2aTaskMs:500000,
        initialIntervalMs:50,maxIntervalMs:250
      }),
      adapter:{adapterBaseUrl:adapterUrl,
        bearerToken:orchestratorToken,timeoutMs:30000},
      async authorityForTask(taskId,role){
        assert.ok(ROLES.includes(role));
        assert.ok(taskIdsByRole[role].includes(taskId),
          "Child authority must belong to a signed role Task");
        assert.equal(childIds[taskId],undefined,
          "Each approved Task receives exactly one fresh child DC");
        const credentialId="urn:native:approved-dag-"+role+"-"+
          randomBytes(8).toString("hex");
        childIds[taskId]=credentialId;
        activeChildByRole[role]=credentialId;
        activeTaskByRole[role]=taskId;
        return {
          parent_credential_id:operationalRootId,
          credential_id:credentialId,
          valid_from:new Date(Date.now()-1000).toISOString(),
          validity_seconds:realGeminiPilot
            ?SIGNED_GEMINI_PILOT.childCredentialValiditySeconds:300,
          credential_status:{type:"BitstringStatusListEntry",
            statusPurpose:"revocation",
            statusListIndex:String(randomInt(66001,69000)),
            statusListCredential:"https://status.example/lists/approved-dag"}
        };
      }
    });
    for(const taskId of allSpecialistTaskIds)await assert.rejects(
      dispatcher.dispatch(taskId),/dependencies/);
    assert.equal(observedImplementationWriteKeys.size,0);
    if(realGeminiPilot)onPilotPhase?.("a2a_dispatch");
    const result=await dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(planId,runtimeTaskId){
        if(planId===reviewTaskId){
          // Approval of the repository operation is a separate signed Task.
          // It may run only after the Test Agent's provider-corroborated
          // exact-SHA Docker and independent researcher acceptance.
          if(realGeminiPilot){
            // Gemini may recover from a real Docker FAIL under the same signed grants.
            // Final provider-corroborated PASS and exact SHA checks remain mandatory.
            assert.ok(Number.isSafeInteger(runnerRuns)&&
              runnerRuns>=1&&runnerRuns<=6,
              "Live signed Test Tasks require bounded Docker runs");
          }else assert.equal(runnerRuns,offlineRecovery?2:1);
          assert.equal(runnerOutcome?.status,"pass");
          assert.equal(runnerOutcome?.project_tests?.status,"pass");
          assert.equal(runnerOutcome?.researcher_acceptance?.status,"pass");
          assert.equal((await reader.getBranchMetadata(branch)).commit_sha,
            runnerOutcome.tested_commit_sha);
          assert.throws(()=>gateway.prepare({
            task_id:runtimeTaskId,agent_role:"orchestrator",
            tool:"create_pull_request",arguments:{
              head_branch:"main",base_branch:"main",title:"Unapproved main PR"
            }
          }),e=>e?.code==="approved_plan_denied");
          const prepared=gateway.prepare({
            task_id:runtimeTaskId,agent_role:"orchestrator",
            tool:"create_pull_request",arguments:{
              head_branch:branch,base_branch:"main",
              title:"Reviewed "+scenarioId+" changes",
              body:"Engineer-signed plan digest: "+planDigest+
                "\nExact tested feature SHA: "+runnerOutcome.tested_commit_sha+
                "\nHuman approval and merge are NOT performed by this run."
            }
          });
          const vp=await signedVp(
            operationalRootId,prepared,orchestratorToken);
          const executed=await gateway.execute({
            request_id:prepared.request_id,signed_vp:vp
          });
          assert.equal(executed.execution.provider,"gitea");
          assert.equal(executed.execution.tool,"create_pull_request");
          assert.equal(executed.execution.head_branch,branch);
          assert.equal(executed.execution.base_branch,"main");
          assert.equal(executed.execution.revision,
            runnerOutcome.tested_commit_sha);
          assert.ok(Number.isSafeInteger(
            executed.execution.pull_request_number));
          createdPr=executed.execution;
          return;
        }
        assert.equal(planId,branchTaskId);
        assert.throws(()=>gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:"feature/not-approved"}
        }),/approved plan/i);
        const prep=gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{base_branch:"main",branch}
        });
        const jwt=await signedVp(
          operationalRootId,prep,orchestratorToken);
        const created=await gateway.execute({
          request_id:prep.request_id,signed_vp:jwt
        });
        assert.equal(created.execution.tool,"create_branch");
        assert.equal(created.execution.commit_sha,baseSha);
        assert.equal((await reader.getBranchMetadata(branch)).commit_sha,baseSha);
      }
    }).catch(error=>{
      if(realGeminiPilot){
        onPilotError?.(classifyApprovedDagFailure(error));
      }
      if(offlineTypecheckProbe){
        // Real Docker FAIL and trusted provider observations must precede
        // any expected-failure classification: agent prose cannot supply them.
        assert.ok(observedTypecheckProbe);
        assert.equal(deniedCrossRoleTestProbes,2,
          "Both malicious signed Test read and write must be denied");
        assert.equal(runnerRuns,1);
        assert.equal(runnerOutcome?.status,"fail");
        assert.equal(runnerOutcome?.project_tests?.status,"fail");
        assert.equal(runnerOutcome?.researcher_acceptance?.status,"skipped");
        assert.equal(runnerOutcome?.phases.find(p=>p.status==="fail")?.phase,
          "typecheck");
        assert.equal(createdPr,null);
        assert.ok(!dispatcher.completedTaskIds.includes(reviewTaskId));
        assert.equal(coordinator.phase,"closed",
          "Failing DAG must retire its issued operational root");
        return null;
      }
      if(offlineMultiTest){
        // Only plan-generated Task IDs and fixed diagnostic categories enter
        // logs. NEVER publish exception text, provider payloads, DCs or VPs.
        const classify=classifyApprovedDagFailure;
        process.stderr.write("[native-dag-adk] multi_test_safe_diagnostic "+
          JSON.stringify({
            completed_task_ids:dispatcher.completedTaskIds.filter(id=>
              signed.plan.tasks.some(task=>task.id===id)),
            issued_task_ids:Object.keys(childIds).filter(id=>
              signed.plan.tasks.some(task=>task.id===id)),
            category:classify(error),
            cause_category:classify(error?.cause),
            runner_runs:runnerRuns,
            signed_test_write_count:testCalls
          })+"\n");
      }
      throw error;
    });
    if(offlineTypecheckProbe){
      assert.equal(result,null,"Failed DAG must not be accepted");
      assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
      assert.equal((await reader.getBranchMetadata(branch)).commit_sha,
        runnerOutcome.tested_commit_sha);
      assert.throws(()=>gateway.prepare({
        task_id:"after_expected_typecheck_failure",agent_role:"backend",
        tool:"update_file",arguments:{
          branch,path:files.backend[0],content:"forbidden"
        }
      }),e=>e?.code==="approved_plan_denied");
      return Object.freeze({
        status:"expected_typecheck_failure",typecheck_probe_verified:true,
        signed_test_cross_role_gateway_denials:deniedCrossRoleTestProbes,
        signed_dag_completed:false,scenario_id:scenarioId,
        approved_work_branch:branch,real_a2a_sdk:true,
        a2a_tasks_dispatched:dispatcher.completedTaskIds.length,
        native_rust_child_credentials:Object.keys(childIds).length,
        real_gitea:true,live_opa:true,main_unchanged:true,
        operational_root_revoked:true,pr_created:false,merge_calls:0,
        source_writes:observedImplementationWriteKeys.size,
        created_test_files:testCreates,runner_runs:runnerRuns,
        test_runner_runs:runnerRuns,
        project_tests:"fail",researcher_acceptance:"skipped",
        first_failed_phase:"typecheck",
        typecheck_error_codes:observedTypecheckProbe.codes,
        typecheck_permission_scope_audit:observedTypecheckProbe.scope,
        typecheck_revision_comparison:observedTypecheckProbe.revision
      });
    }
    if(realGeminiPilot)onPilotPhase?.("result_verification");
    assert.equal(coordinator.phase,"closed");
    assert.equal(result.plan_digest,planDigest);
    assert.deepEqual(
      new Set(result.completed_task_ids),
      new Set(signed.plan.tasks.map(t=>t.id))
    );
    assert.ok(createdPr,"A signed, provider-confirmed PR must be opened");
    if(realGeminiPilot){
      assert.deepEqual(
        new Set(result.specialized_results.map(x=>x.role)),new Set(ROLES));
    }else assert.deepEqual(result.specialized_results.map(x=>x.role),
      offlineMultiTest?["backend","frontend","test","test"]:ROLES);
    if(offlineMultiTest){
      const signedTests=result.specialized_results.filter(x=>x.role==="test");
      assert.equal(signedTests.length,2);
      assert.equal(signedTests[0].artifact.test_outcome,"not_run",
        "Test preparation must not borrow the later Runner permission");
      assert.equal(signedTests[1].artifact.test_outcome,"pass");
      assert.ok(childIds["test-preparation"]&&childIds.test);
      assert.notEqual(childIds["test-preparation"],childIds.test,
        "Independent signed Test A2A Tasks require distinct Rust child DCs");
      assert.equal(runnerRuns,2,
        "Only final Test Task may invoke failed and repaired Docker runs");
    }
    for(const role of EDIT_ROLES){
      // Any actual write must have its own approved source read. A resource
      // granted for writing may remain untouched by the model.
      assert.ok([...writePaths[role]].every(path=>readPaths[role].has(path)));
      assert.ok(reads[role]<=readableFiles[role].length);
      assert.ok(writes[role]<=files[role].length);
    }
    assert.ok(testCalls<=expectedTestWriteKeys.size);
    assert.ok(observedTestWriteKeys.size<=expectedTestWriteKeys.size);
    assert.ok(observedImplementationWriteKeys.size<=
      expectedImplementationWriteKeys.size);
    assert.ok(testCreates<=approvedTestCreates.length);
    assert.ok(testUpdates<=approvedTestUpdates.length);
    assert.ok(testReads<=readableTestFiles.length);
    if(realGeminiPilot){
      // Gemini may recover from a real Docker FAIL under the same signed grants.
      // Final provider-corroborated PASS and exact SHA checks remain mandatory.
      assert.ok(Number.isSafeInteger(runnerRuns)&&
        runnerRuns>=1&&runnerRuns<=6,
        "Live signed Test Tasks require bounded Docker runs");
    }else assert.equal(runnerRuns,offlineRecovery?2:1);
    assert.equal(runnerHistory.length,runnerRuns);
    let failedTestSha=null;
    if(offlineRecovery){
      assert.equal(signedTestOutOfScopeDenied,true,
        "Signed recovery must prove a cross-role repair is refused by Gateway");
      const [failed,recovered]=runnerHistory;
      assert.equal(failed.status,"fail",
        "First signed-DAG run must fail in actual isolated Docker");
      assert.equal(failed.project_tests?.status,"fail");
      assert.equal(failed.researcher_acceptance?.status,"skipped");
      assert.equal(failed.phases.find(p=>p.status==="fail")?.phase,"backend_tests");
      assert.match(failed.tested_commit_sha,SHA);
      assert.equal(recovered.status,"pass");
      assert.equal(recovered.project_tests?.status,"pass");
      assert.equal(recovered.researcher_acceptance?.status,"pass");
      assert.notEqual(failed.tested_commit_sha,recovered.tested_commit_sha,
        "Signed Test repair must produce a new commit before retesting");
      assert.equal(runnerOutcome.tested_commit_sha,recovered.tested_commit_sha);
      failedTestSha=failed.tested_commit_sha;
    }
    if(!hostModels){
      assert.equal(models.backend.calls,2*files.backend.length+1);
      assert.equal(models.frontend.calls,2*files.frontend.length+1);
      assert.equal(models.test.calls,3);
    }
    // This is the proof that the same signed DAG actually used both the
    // normal shared MCP and separate private cryptographic MCP. A green
    // FunctionTool fallback alone cannot satisfy this gate.
    if(sharedMcpEnabled){
      // Optional read-only context is not guaranteed to be visited by a
      // model. Count mandatory source reads + the Test edit/Runner sequence.
      // Count the actual mandatory operations, not a fixed one-file Test
      // edit; a Test Runner-only DAG still has one mandatory MCP call.
      const minMcpRequests=reads.backend+reads.frontend+
        writes.backend+writes.frontend+testReads+testCalls+runnerRuns;
      assert.ok(normalMcpCalls>=minMcpRequests,
        "Approved ADK tools must traverse real shared MCP HTTP");
      assert.ok(privateCryptoMcpCalls>=minMcpRequests,
        "Adapter VP generation must traverse the crypto MCP boundary");
    }
    if(!hostModels)assert.ok(result.specialized_results.every(x=>
      x.artifact.model_id?.startsWith("offline-signed-approved-plan-")));
    assert.equal(Object.keys(childIds).length,allSpecialistTaskIds.length);
    assert.equal(new Set(Object.values(childIds)).size,
      allSpecialistTaskIds.length,
      "Every signed specialist Task must receive an independent child DC");
    const finalTestResult=result.specialized_results.find(x=>
      x.role==="test"&&x.artifact.test_outcome==="pass");
    assert.ok(finalTestResult,"Approved final Test Task was not dispatched");
    assert.equal(finalTestResult.artifact.test_outcome,"pass");
    assert.equal(finalTestResult.artifact.tested_commit_sha,
      runnerOutcome.tested_commit_sha);
    for(const path of expectedExisting){
      const updated=await reader.readTextFile(branch,path);
      if(!hostModels){
        assert.equal(updated.content,referenceFiles[path]);
      }else{
        const actuallyWritten=writePaths.backend.has(path)||
          writePaths.frontend.has(path)||writePaths.test.has(path);
        if(!actuallyWritten)assert.equal(updated.content,originals[path],
          "A resource not actually written must remain unchanged");
        assert.ok(updated.content.length>0);
      }
      const unchanged=await reader.readTextFile("main",path,baseSha);
      assert.equal(unchanged.content,originals[path]);
    }
    for(const path of writePaths.test){
      const savedTest=await reader.readTextFile(branch,path);
      if(!hostModels)
        assert.equal(savedTest.content,referenceFiles[path]);
      else{
        assert.ok(savedTest.content.length>0);
        // Commit receipts rather than an assumed textual difference prove
        // the operation; independent acceptance checks intended behavior.
      }
    }
    const witnessModel=models.frontend instanceof SourceWitnessedOfflineAdkModel
      ? models.frontend : null;
    if(witnessModel){
      const witness=witnessModel.sourceWitness;
      assert.ok(witness,"Model must have read actual Gitea source before update");
      assert.equal(witness.branch,branch);
      assert.ok(files.frontend.includes(witness.path));
      const sourceDigest=createHash("sha256")
        .update(originals[witness.path],"utf8").digest("hex");
      assert.equal(witness.source_sha256,sourceDigest);
      const stored=await reader.readTextFile(branch,witness.path);
      assert.ok(stored.content.endsWith(
        "// block-b-source-read-sha256:"+sourceDigest+"\n"
      ),"Signed, VP-authorized Gitea update must preserve source witness");
      assert.ok(readPaths.frontend.has(witness.path));
      assert.ok(writePaths.frontend.has(witness.path));
      const api=witnessModel.derivedApiProof;
      if(api){
        assert.equal(api.branch,branch);
        assert.ok(files.frontend.includes(api.path));
        assert.equal(api.source_sha256,createHash("sha256")
          .update(originals[api.path],"utf8").digest("hex"));
        const updated=await reader.readTextFile(branch,api.path);
        assert.ok(updated.content.includes(
          "export async function suspendUser(id: string)"));
        assert.ok(updated.content.includes(
          "export async function reactivateUser(id: string)"));
        assert.ok(readPaths.frontend.has(api.path));
        assert.ok(writePaths.frontend.has(api.path));
        assert.equal(api.action_count,2);
      }
    }
    const derivedRoutes=models.backend instanceof SourceDerivedRouteOfflineAdkModel
      ? models.backend : null;
    if(derivedRoutes){
      const proof=derivedRoutes.derivedRouteProof;
      assert.ok(proof,"Route change must originate from a real ADK read");
      assert.equal(proof.branch,branch);
      assert.ok(files.backend.includes(proof.path));
      assert.equal(proof.source_sha256,createHash("sha256")
        .update(originals[proof.path],"utf8").digest("hex"));
      const committed=await reader.readTextFile(branch,proof.path);
      assert.ok(committed.content!==originals[proof.path]);
      assert.ok(readPaths.backend.has(proof.path));
      assert.ok(writePaths.backend.has(proof.path));
      assert.ok(proof.directive_count>=1);
      const ctrl=derivedRoutes.derivedControllerProof;
      if(ctrl){
        assert.equal(ctrl.branch,branch);
        assert.ok(files.backend.includes(ctrl.path));
        assert.equal(ctrl.source_sha256,createHash("sha256")
          .update(originals[ctrl.path],"utf8").digest("hex"));
        const saved=await reader.readTextFile(branch,ctrl.path);
        assert.ok(saved.content.includes(
          "response.json(service.suspendUser(String(request.params.id)))"));
        assert.ok(saved.content.includes(
          "response.json(service.reactivateUser(String(request.params.id)))"));
        assert.ok(saved.content.includes("AccountStatusConflictError"));
        assert.ok(saved.content.includes('code: "ACCOUNT_STATUS_CONFLICT"'));
        assert.ok(readPaths.backend.has(ctrl.path));
        assert.ok(writePaths.backend.has(ctrl.path));
      }
      const status=derivedRoutes.derivedStatusProof;
      if(status){
        assert.equal(status.branch,branch);
        assert.ok(files.backend.includes(status.path));
        assert.equal(status.source_sha256,createHash("sha256")
          .update(originals[status.path],"utf8").digest("hex"));
        const actual=await reader.readTextFile(branch,status.path);
        assert.ok(actual.content.includes(
          'export type AccountStatus = "ACTIVE" | "SUSPENDED";'));
        assert.ok(actual.content.includes('  SUSPENDED: "SUSPENDED"'));
        assert.ok(readPaths.backend.has(status.path));
        assert.ok(writePaths.backend.has(status.path));
      }
    }
    const head=await reader.getBranchMetadata(branch);
    assert.equal(head.commit_sha,runnerOutcome.tested_commit_sha);
    assert.equal(createdPr.revision,head.commit_sha);
    assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
    assert.throws(()=>gateway.prepare({
      task_id:"after_closed",agent_role:"backend",
      tool:"update_file",arguments:{
        branch,path:files.backend[0],content:"unapproved"
      }
    }),e=>e?.code==="approved_plan_denied");
    return {
      status:"pass",signed_dag_completed:true,
      scenario_id:scenarioId,approved_work_branch:branch,
      completed_task_ids:result.completed_task_ids,
      real_a2a_sdk:true,
      a2a_tasks_dispatched:result.specialized_results.length,
      native_rust_child_credentials:allSpecialistTaskIds.length,
      native_verifier:true,live_opa:true,real_gitea:true,
      source_reads:reads.backend+reads.frontend+testReads,
      source_writes:observedImplementationWriteKeys.size+testUpdates,
      created_test_files:testCreates,
      manifest_source:"engineer_signed_approved_plan",
      test_runner_runs:runnerRuns,
      recovery_verified:offlineRecovery,
      multi_test_a2a_independent_authority_verified:offlineMultiTest,
      test_cross_role_repair_denied:signedTestOutOfScopeDenied,
      ...(offlineRecovery?{failed_test_sha:failedTestSha}:{}),
      test_runner_phases:runnerOutcome.phases.map(x=>x.phase),
      project_tests:runnerOutcome.project_tests.status,
      researcher_acceptance:runnerOutcome.researcher_acceptance.status,
      tested_commit_sha:runnerOutcome.tested_commit_sha,
      main_unchanged:true,operational_root_revoked:true,
      approved_branch_sha:head.commit_sha,
      pr_created:true,pull_request_number:createdPr.pull_request_number,
      pull_request_url:createdPr.url??null,merge_calls:0,
      adk_agents_executed:3,
      // Model injection alone does not establish independent code generation.
      // Scripted ADK instances carry source bytes in their tool-call payloads,
      // even when the native runner did not receive a referenceFiles argument.
      scripted_adk_no_paid_model:Object.values(models).every(
        model=>model instanceof OfflineApprovedAdkModel||
          model instanceof SourceWitnessedOfflineAdkModel||
          model instanceof SourceDerivedRouteOfflineAdkModel),
      model_source:realGeminiPilot
        ? "real_gemini_four_models_signed_test_approval"
        : derivedRoutes
          ? "host_supplied_source_derived_routes_with_remaining_fixtures"
        : witnessModel
          ? "host_supplied_hybrid_source_witness_and_fixture"
        : hostModels
          ? (Object.values(models).every(model=>
              model instanceof OfflineApprovedAdkModel)
              ? "host_supplied_scripted_tool_calls"
              : "host_supplied_unclassified_adk_models")
          : "inline_scripted_tool_calls",
      source_derived_functional_route_verified:derivedRoutes!==null,
      source_derived_frontend_api_verified:
        witnessModel?.derivedApiProof!==null&&
        witnessModel?.derivedApiProof!==undefined,
      source_derived_controller_verified:derivedRoutes?.derivedControllerProof!==null&&
        derivedRoutes?.derivedControllerProof!==undefined,
      source_derived_status_verified:derivedRoutes?.derivedStatusProof!==null&&
        derivedRoutes?.derivedStatusProof!==undefined,
      source_derived_functional_file_count:
        (derivedRoutes?.derivedFileCount??0)+
        Number(witnessModel?.derivedApiProof!==null&&
          witnessModel?.derivedApiProof!==undefined),
      remaining_prepackaged_application_file_count:
        11-(derivedRoutes?.derivedFileCount??0)-
          Number(witnessModel?.derivedApiProof!==null&&
            witnessModel?.derivedApiProof!==undefined),
      source_witnessed_native_dag_verified:witnessModel!==null,
      source_witnessed_model_still_uses_fixture_code:witnessModel!==null,
      fixture_scripted_payloads_reach_adk_runner:Object.values(models).some(
        model=>model instanceof OfflineApprovedAdkModel),
      independent_model_software_output_verified:realGeminiPilot,
      real_gemini_pilot:realGeminiPilot,
      engineer_review_type:realGeminiPilot
        ? "signed_test_fixture_not_human":"offline_fixture",
      approved_shared_mcp_enabled:sharedMcpEnabled,
      shared_mcp_http_requests:normalMcpCalls,
      private_crypto_mcp_http_requests:privateCryptoMcpCalls,
      adk_model_turns:{
        backend:models.backend instanceof OfflineApprovedAdkModel||
          models.backend instanceof SourceDerivedRouteOfflineAdkModel
          ?models.backend.calls:null,
        frontend:models.frontend instanceof OfflineApprovedAdkModel||
          models.frontend instanceof SourceWitnessedOfflineAdkModel
          ?models.frontend.calls:null,
        test:models.test instanceof OfflineApprovedAdkModel
          ?models.test.calls:null
      }
    };
  }finally{
    try{
      for(const server of servers.reverse())await server.close();
    }finally{
      for(const server of mcpServers.reverse()){
        await new Promise((resolve,reject)=>
          server.close(error=>error?reject(error):resolve())
        );
      }
      await new Promise(resolve=>runnerServer.close(resolve));
      await rm(runLogs,{recursive:true,force:true});
    }
  }
}
