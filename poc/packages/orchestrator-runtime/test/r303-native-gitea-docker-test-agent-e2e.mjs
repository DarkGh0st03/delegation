/** R303 disposable Gitea + real native Rust/EVM/OPA Test Child and Docker
 * Runner PASS; CI approval is synthetic, with no Gemini or production keys.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {InMemoryAuditSink,InMemoryRequestStore,prepareAuthorization}
 from "../../../apps/gateway/src/prepare.ts";
import {executeAuthorization} from "../../../apps/gateway/src/execute.ts";
import {OpaPolicyClient} from "../../../apps/gateway/src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../../../apps/gateway/src/direct-core-loader.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedOperationalSessionStore}
 from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";
import {createNativeRustChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../src/trusted-authority-only-child-journal.ts";
import {SignedAuthorityOnlyFileStore}
 from "../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal}
 from "../src/authority-only-activation-journal.ts";
import {DurableAuthorityTaskJournal}
 from "../src/trusted-authority-task-journal.ts";
import {TrustedAuthorityOnlyEngineerSession}
 from "../src/trusted-authority-only-engineer-session.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {signAuthorityOnlyGrant,selectAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {invokeNativeCrypto}
 from "../../agent-runtime/src/native-crypto-ipc.ts";

import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {DurableAuthorityOnlyTaskFenceJournal} from "../src/trusted-authority-only-task-fence-journal.ts";
import {TrustedAuthorityOnlyRunnerPreflight} from "../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor} from "../../../apps/gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-runner-evidence.ts";
import {RunnerClient} from "../../../apps/gateway/src/runner-client.ts";
import {IsolatedDockerRunnerExecutor} from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer} from "../../../apps/test-runner-controller/src/http.ts";

assert.equal(process.env.R233_NATIVE_EVM,"1");
assert.equal(process.env.ENGINEER_CORE_NATIVE_MODE,"1");
assert.equal(process.env.ADAPTER_TRUST_PROFILE,"evm");
assert.equal(process.env.GATEWAY_VERIFIER_MODE,"core-rust");
assert.equal(process.env.APPROVED_RUNNER_NATIVE_MCP,"1");
assert.equal(process.env.GEMINI_API_KEY,undefined);
assert.equal(process.env.OPENAI_API_KEY,undefined);
const requireAddon=createRequire(import.meta.url);
assert.equal(typeof requireAddon("../src/native/delegation-engineer.node")
 .issue_engineer_root,"function");
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","TEST","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const testDid=process.env.ADAPTER_ID_TEST;
assert.match(engineerDid??"",/^did:/u);
assert.match(testDid??"",/^did:/u);
const sessionId="r303-authority-native-e2e";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
const client=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only token required");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// Disposable CI owner provisioning, outside delegated execution.
const mainSha=(await client.getBranchMetadata("main")).commit_sha;
const created=await client.createBranch("main","feature/account-suspension");
assert.match(created.commit_sha,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const mutationPath="apps/backend/users/account.ts";
const oldContent="export const accountSuspended = false;\n";
// Owner-only disposable CI fixture, created BEFORE the Engineer root.
// No delegated write or Docker provider effect is enabled yet.
const seeded=await client.createFile(branch,mutationPath,oldContent,
 "R303 owner-provisioned disposable Gitea fixture");
const baseRevision=seeded.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
const requirement="R303 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermission={resource:resourcePrefix,operation:"run_tests"};
const taskPermission={resource:resourcePrefix,operation:"run_tests"};
assert.deepEqual(grantPermission,taskPermission);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r303-disposable-ed25519";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const proposed={
 schema_version:"1.0.0",session_id:sessionId,repository:repo,branch,
 base_revision:baseRevision,requirement,
 requested_permissions:[grantPermission]
};
const grant=selectAuthorityOnlyGrant(proposed,[grantPermission],{
 allowedOperations:new Set(RUST_OPERATIONS)
});
const receipt=signAuthorityOnlyGrant({
 authorization:grant,engineerDid,keyId:authKey,
 privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
 issuedAt,expiresAt:approvalExpiresAt,
 allowedOperations:new Set(RUST_OPERATIONS)
});
const parent=await mkdtemp(join(tmpdir(),"delegation-r303-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
let runnerServer;
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents",
 "flights","runner-intent","runner-receipts","runner-logs"];
try{
 for(const name of names)await mkdir(path(name),{mode:0o700});
 await writeFile(path("approvals")+"/"+sessionId+".json",
  JSON.stringify(receipt),{mode:0o600,flag:"wx"});
 const approvals=new SignedAuthorityOnlyFileStore({
  directory:path("approvals"),engineerDid,nowMs,
  trustedKeys:{[authKey]:{
   engineer_did:engineerDid,
   public_key_pem:publicKey.export({format:"pem",type:"spki"})
  }}
 });
 const credentialPort=createTrustedEngineerCredentialPort({
  bearerToken:tokens.engineer,timeoutMs:60000
 });
 const snapshot={
  session_id:sessionId,repository:repo,base_revision:baseRevision,
  directories:[""],files:[]
 };
 const session=new TrustedAuthorityOnlyEngineerSession({
  snapshot,requirement,credentials:credentialPort,approvals,
  authenticatedEngineerDid:engineerDid,
  journal:new DurableAuthorityOnlyActivationJournal(path("root-journal")),
  nowMs,
  planningRevisions:{
   async begin(taskId){return {task_id:taskId,
    base_revision:baseRevision,
    expires_at:new Date(Date.now()+8*60_000).toISOString()};},
   async end(){return;}
  }
 });
 const status=index=>({type:"BitstringStatusListEntry",
  statusPurpose:"revocation",statusListIndex:String(index),
  statusListCredential:"https://status.example/r303"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r303:preliminary",29101,360);
 const operational=params("urn:r303:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,[grantPermission]);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{test:{
   did:testDid,card_ref:"trusted:r303-test",capabilities:["run_tests"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r303-test-task",runtimeTaskId="r303-test-runtime";
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"test",depends_on:[],permissions:[taskPermission]
 });
 assert.ok(socketPath.startsWith("/"));
 const nativePort=createNativeRustChildCryptographyPort({
  bearerToken:tokens.orchestrator,timeoutMs:60000
 },socketPath);
 const issuer=new TrustedAuthorityOnlyChildIssuer({
  coordinator,nativeCryptoPort:nativePort,
  journal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
  nowMs
 });
 const child=await issuer.issueForRegisteredTask(taskId,
  params("urn:r303:child:test",29103,1200));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,[taskPermission]);
 assert.deepEqual(approved.permissions,[grantPermission]);
 const evidenceKey=randomBytes(32);
  const observer=new AuthenticatedRunnerCompletionObserver({
  directory:path("runner-receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,
  giteaClient:independentClient,nowMs
 });
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(
   path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:observer.toTrustedObserver(),nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"test");
 await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 const verifier=loadDirectCoreRustVerifier();
 const policy=new OpaPolicyClient({
  baseUrl:"http://127.0.0.1:8181",timeoutMs:6000
 });
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let legacyCalls=0;
 class ForbiddenLegacyGiteaExecutor extends GiteaExecutor {
  async execute(...args){
   legacyCalls++;
   throw Error("Authority-only Runner must not use legacy provider");
  }
 }
 const executor=new ForbiddenLegacyGiteaExecutor(client);
 const prepared=prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"}
 },{audience:"cloud-access-gateway",
    request_ttl_ms:1500000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const record=store.get(prepared.request_id);
 assert.ok(record);
 const journal=new DurableAuthorityOnlyRunnerIntentJournal(
  path("runner-intent"));
 const preflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,journal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 await assert.rejects(preflight.stageRunner(
  record,"f".repeat(40)),/Gitea Test branch changed/);
 const pinned=await preflight.stageRunner(record,baseRevision);
 assert.equal(pinned.intent.expected_head_sha,baseRevision);
 assert.equal(pinned.intent.credential_id,child.credential_id);
 assert.equal(pinned.runner_execution_authorized,false);
 await gate.stageTrustedTaskFlight(record);
 const presentation=await invokeNativeCrypto({
  socketPath,token:tokens.test,timeoutMs:60000
 },"create_presentation",{
  credential_id:child.credential_id,
  disclosed_permissions:[taskPermission],
  audience:prepared.audience,challenge:prepared.challenge
 });
 assert.equal(typeof presentation.signed_vp,"string");
 const verified=await verifier.verify({
  presenter:"test",audience:prepared.audience,
  challenge:prepared.challenge,
  required_permission:taskPermission,signed_vp:presentation.signed_vp
 });
 assert.equal(verified.presenter_id,testDid);
 assert.equal(verified.root_credential_id,operational.credential_id);
 assert.equal(verified.credential_id,child.credential_id);
 const opa=await policy.evaluate({
  request_id:prepared.request_id,task_id:runtimeTaskId,
  agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"},
  required_permission:taskPermission,repository:repo,
  verified_delegation:{presenter_id:verified.presenter_id,
   credential_id:verified.credential_id,
   issuer_id:verified.issuer_id,
   hierarchy_depth:verified.hierarchy_depth}
 });
 assert.equal(opa.allow,true);
 await assert.rejects(()=>verifier.verify({
  presenter:"test",audience:prepared.audience,
  challenge:"forged-r303-challenge",
  required_permission:taskPermission,signed_vp:presentation.signed_vp
 }));
 assert.throws(()=>gate.preflightCanonicalRequest({
  task_id:runtimeTaskId,agent_role:"test",tool:"read_file",
  arguments:{branch,path:"apps/backend/users/account.ts"}
 }),/not in exact signed Task grant/);

 // Real HTTP controller, bound strictly to localhost. It starts a real
 // disposable Docker container, not a scripted PASS or a mock Runner.
 const bearer=randomBytes(32).toString("hex");
 const controller=new IsolatedDockerRunnerExecutor({
  gitea_base_url:process.env.GITEA_RUNNER_BASE_URL,
  gitea_owner:"thesis",gitea_repository:"iam-console-poc",
  gitea_token:process.env.GITEA_RUNNER_TOKEN,
  docker_image:"node:22.15.0-bookworm",
  phase_timeout_ms:600000,total_timeout_ms:840000,
  log_dir:path("runner-logs"),acceptance_enabled:true,
  acceptance_dir:fileURLToPath(
   new URL("../../../runner/acceptance/",import.meta.url))
 });
 runnerServer=createRunnerHttpServer({
  bind_host:"127.0.0.1",bind_port:0,gateway_token:bearer,
  contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",
   branch}
 },controller);
 await new Promise((resolve,reject)=>{
  runnerServer.once("error",reject);
  runnerServer.listen(0,"127.0.0.1",resolve);
 });
 const port=runnerServer.address()?.port;
 assert.ok(port);
 let runnerCalls=0;
 class ObservedRunnerClient extends RunnerClient{
  async run(request,signal){
   runnerCalls++;
   return super.run(request,signal);
  }
 }
 const runnerClient=new ObservedRunnerClient({
  baseUrl:"http://127.0.0.1:"+port,gatewayToken:bearer,
  timeoutMs:900000
 });
 const runnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
  admissions:gate,preflight,journal,giteaClient:client,runnerClient,
  publisher:new TrustedGatewayRunnerPassEvidencePublisher({
   directory:path("runner-receipts"),key:evidenceKey,
   runnerClient,independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,
  authorityOnlyRunnerEnabled:true,
  authorityOnlyRunnerExecutor:runnerExecutor};
 const real=await executeAuthorization({
  request_id:prepared.request_id,signed_vp:presentation.signed_vp
 },deps);
 assert.equal(real.decision,"allow");
 assert.equal(real.execution.provider,"runner");
 assert.equal(real.execution.status,"pass");
 assert.equal(real.execution.tested_commit_sha,baseRevision);
 assert.equal(real.execution.project_tests.status,"pass");
 assert.equal(real.execution.researcher_acceptance.status,"pass");
 assert.equal(runnerCalls,1);
 assert.equal(legacyCalls,0);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,
  baseRevision);
 assert.equal((await client.getBranchMetadata("main")).commit_sha,
  mainSha);
 const witnessed=await observer.observe(
  gate.assertTrustedCompletedRunnerEvidenceBinding(record,verified));
 assert.equal(witnessed.status,"owner_verified_provider_result");
 await gate.attestTrustedTaskCompletion(taskId,runtimeTaskId);
 assert.equal(gate.stagedCompletedTaskCount,1);
 await assert.rejects(executeAuthorization({
  request_id:prepared.request_id,signed_vp:presentation.signed_vp
 },deps),error=>error?.code==="replay_detected");
 assert.equal(runnerCalls,1);
 assert.equal(legacyCalls,0);

 // Same-root foreign Child cannot replace the enrolled Test Agent.
 const foreign=await nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r303:child:foreign",delegatee:"test",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(29104),permissions:[taskPermission]
 });
 const other=prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const foreignVp=await invokeNativeCrypto({
  socketPath,token:tokens.test,timeoutMs:60000
 },"create_presentation",{
  credential_id:foreign.id,disclosed_permissions:[taskPermission],
  audience:other.audience,challenge:other.challenge
 });
 const foreignVerified=await verifier.verify({
  presenter:"test",audience:other.audience,
  challenge:other.challenge,required_permission:taskPermission,
  signed_vp:foreignVp.signed_vp
 });
 assert.equal(foreignVerified.root_credential_id,operational.credential_id);
 await assert.rejects(executeAuthorization({
  request_id:other.request_id,signed_vp:foreignVp.signed_vp
 },deps),e=>e?.code==="authority_only_execution_not_enabled");
 assert.equal(runnerCalls,1);
 const pending=prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const pendingVp=await invokeNativeCrypto({
  socketPath,token:tokens.test,timeoutMs:60000
 },"create_presentation",{
  credential_id:child.credential_id,
  disclosed_permissions:[taskPermission],
  audience:pending.audience,challenge:pending.challenge
 });
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp.signed_vp
 },deps),e=>e?.code==="verification_rejected");
 assert.equal(runnerCalls,1);
 process.stdout.write(JSON.stringify({
  event:"r303_authority_only_native_evm_real_docker_test_agent",
  signed_engineer_root:true,native_test_child:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  real_opa_allow:true,exact_pinned_gitea_sha:true,
  project_tests_pass:true,researcher_acceptance_pass:true,
  runner_calls:runnerCalls,legacy_calls:legacyCalls,
  completion_attested:true,unbound_child_denied:true,
  revoked_root_denied:true,paid_model_calls:0
 })+"\n");
}finally{
 if(runnerServer)await new Promise(resolve=>runnerServer.close(resolve));
 await rm(parent,{recursive:true,force:true});
}
