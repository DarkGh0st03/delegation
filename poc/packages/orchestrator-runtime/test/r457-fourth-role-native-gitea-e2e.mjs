/** R457 four-role native read on disposable Gitea + authentic Rust/EVM/OPA.
 * Role reviewer has its OWN DID, Ed25519 signing identity and one read-only
 * native Child. This proves provider read and owner-observed completion,
 * including foreign-child and revocation denial. It does NOT prove an
 * end-to-end physical A2A Worker dispatch or production human signature.
 * No paid models, production credentials, protected merge or writing.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {BaseLlm} from "@google/adk";
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";

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
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator}
 from "../../agent-runtime/src/orchestrator.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {
 TrustedEffectStagingTaskRegistry,createTrustedEffectAgentBindingServer,
 connectTrustedOwnerEffectStagingClient
} from "../../agent-runtime/src/index.ts";

import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {TrustedGatewayGiteaReadEvidencePublisher} from "../../../apps/gateway/src/trusted-authority-only-gitea-publisher.ts";
import {AuthenticatedGiteaReadCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-evidence.ts";
import {DurableAuthorityOnlyTaskFenceJournal} from "../src/trusted-authority-only-task-fence-journal.ts";

assert.equal(process.env.R233_NATIVE_EVM,"1");
assert.equal(process.env.ENGINEER_CORE_NATIVE_MODE,"1");
assert.equal(process.env.ADAPTER_TRUST_PROFILE,"evm");
assert.equal(process.env.GATEWAY_VERIFIER_MODE,"core-rust");
assert.equal(process.env.APPROVED_RUNNER_NATIVE_MCP,"1");
assert.equal(process.env.ADAPTER_ADDITIONAL_SPECIALISTS,"reviewer");
assert.equal(process.env.GEMINI_API_KEY,undefined);
assert.equal(process.env.OPENAI_API_KEY,undefined);
const requireAddon=createRequire(import.meta.url);
assert.equal(typeof requireAddon("../src/native/delegation-engineer.node")
 .issue_engineer_root,"function");
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","REVIEWER","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const reviewerDid=process.env.ADAPTER_ID_REVIEWER;
assert.match(engineerDid??"",/^did:/u);
assert.match(reviewerDid??"",/^did:/u);
const sessionId="r457-authority-native-e2e";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
const client=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only Gitea token required");
assert.notEqual(process.env.GITEA_RUNNER_TOKEN,process.env.GITEA_GATEWAY_TOKEN,
 "Gateway writer cannot impersonate independent read-only witness");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// Disposable CI owner provisioning, outside delegated execution.
const created=await client.createBranch("main","feature/account-suspension");
const baseRevision=created.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const requirement="R457 disposable EVM proof for account suspension permission";
const file="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension/files/README.md";
const grantPermission={resource:file,operation:"read_file"};
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r457-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r457-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","flights","receipts"];
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
  statusListCredential:"https://status.example/r457"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r457:preliminary",45701,360);
 const operational=params("urn:r457:operational",45702,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,[grantPermission]);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{reviewer:{
   did:reviewerDid,card_ref:"trusted:r457-reviewer",
   capabilities:["read_file"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r457-reviewer-task",runtimeTaskId="r457-reviewer-runtime";
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"reviewer",depends_on:[],permissions:[grantPermission]
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
  params("urn:r457:child:reviewer",45703,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new AuthenticatedGiteaReadCompletionObserver({
   directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
   branch,giteaClient:independentClient,nowMs
  }).toTrustedObserver(),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"reviewer");
 const enrolled=await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 assert.equal(enrolled.credential_id,child.credential_id);
 assert.equal(enrolled.gateway_execution_authorized,false);
 // R457 uses the stricter post-R296 diagnostic-read contract: ONLY the
 // trusted owner fixes current Gitea HEAD after native Child enrollment
 // and before Prepare/OPA/provider I/O. The A2A request cannot choose HEAD.
 const witnessHead=await independentClient.getBranchMetadata(branch);
 assert.equal(witnessHead.commit_sha,baseRevision);
 const pin=gate.pinTrustedSingleReadTask(taskId,runtimeTaskId,witnessHead.commit_sha);
 assert.equal(pin.status,"owner_single_read_head_pinned_only");
 assert.equal(pin.gateway_execution_authorized,false);
 const verifier=loadDirectCoreRustVerifier();
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let providerCalls=0;
 class ObservedGiteaExecutor extends GiteaExecutor {
  async execute(...args){providerCalls++;return super.execute(...args);}
 }
 const executor=new ObservedGiteaExecutor(client);
 const prepare=()=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"reviewer",tool:"read_file",
  arguments:{branch,path:"README.md"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(credential_id,prepared)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.reviewer,timeoutMs:60000
  },"create_presentation",{
   credential_id,disclosed_permissions:[grantPermission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:new TrustedGatewayGiteaReadEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,admissions:gate,
   independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  })};
 const good=prepare(),goodVp=await sign(child.credential_id,good);
 const valid=await verifier.verify({
  presenter:"reviewer",audience:good.audience,challenge:good.challenge,
  required_permission:grantPermission,signed_vp:goodVp
 });
 assert.equal(valid.presenter_id,reviewerDid);
 assert.equal(valid.credential_id,child.credential_id);
 assert.equal(valid.root_credential_id,operational.credential_id);
 assert.equal(valid.hierarchy_depth,1);
 const opa=await policy.evaluate({
  request_id:good.request_id,task_id:runtimeTaskId,
  agent_role:"reviewer",tool:"read_file",arguments:{
   branch,path:"README.md"},
  required_permission:grantPermission,repository:repo,
  verified_delegation:{presenter_id:valid.presenter_id,
   credential_id:valid.credential_id,issuer_id:valid.issuer_id,
   hierarchy_depth:valid.hierarchy_depth}
 });
 assert.equal(opa.allow,true);
 // Role identity is native-signature bound. A valid reviewer VP is not
 // automatically a Backend VP, even for the same source and root.
 await assert.rejects(verifier.verify({
  presenter:"backend",audience:good.audience,challenge:good.challenge,
  required_permission:grantPermission,signed_vp:goodVp
 }));
 // The Gateway may receive the new role only for an original signed read
 // Task. A malicious A2A tool argument cannot request file mutation.
 assert.throws(()=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"reviewer",tool:"update_file",
  arguments:{branch,path:"README.md",content:"forbidden"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs}),
 /agent_role is not supported/u);
 const rejectedPolicyWrite=await policy.evaluate({
  request_id:good.request_id,task_id:runtimeTaskId,
  agent_role:"reviewer",tool:"update_file",
  arguments:{branch,path:"README.md"},
  required_permission:{...grantPermission,operation:"update_file"},
  repository:repo,
  verified_delegation:{presenter_id:valid.presenter_id,
   credential_id:valid.credential_id,issuer_id:valid.issuer_id,
   hierarchy_depth:valid.hierarchy_depth}
 });
 assert.equal(rejectedPolicyWrite.allow,false);
 // Rust MUST refuse to sign a reviewer Child containing a write permission
 // even if the privileged native Orchestrator tries to request it.
 await assert.rejects(nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r457:child:forbidden-write",delegatee:"reviewer",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(45705),
  permissions:[{...grantPermission,operation:"update_file"}]
 }));
 await assert.rejects(()=>verifier.verify({
  presenter:"reviewer",audience:good.audience,challenge:"invalid-r457-nonce",
  required_permission:grantPermission,signed_vp:goodVp
 }));
 await gate.stageTrustedTaskFlight(store.get(good.request_id));
 await executeAuthorization({request_id:good.request_id,signed_vp:goodVp},deps);
 assert.equal(providerCalls,1);
 assert.equal(audit.events.at(-1)?.decision,"allow");
 await assert.rejects(executeAuthorization({request_id:good.request_id,signed_vp:goodVp},deps),
  error=>error?.code==="replay_detected");
 await gate.attestTrustedTaskCompletion(taskId,runtimeTaskId);
 assert.equal(gate.stagedCompletedTaskCount,1);

 // R458: the same signed, operational Root now authorizes ANOTHER exact
 // read-only specialist Task. This time the real native Child travels over
 // actual loopback A2A HTTP, with one-shot HMAC owner->agent and agent->owner
 // IPC. The deterministic handler is a CI fixture (not a Gemini/ADK model).
 // It may stage the one approved read, but only the real Rust+OPA+Gitea
 // provider and independent Gateway observer can complete the Task.
 // R461 — one continuous OFFLINE Planner choice -> real native Child/VP
 // -> signed A2A HTTP -> Rust/EVM/OPA -> Gitea -> Gateway completion.
 // The canonical GEMINI scenario STILL has precisely 3 specialists:
 // Backend, Frontend and Test. The read-only reviewer exists solely in
 // this disposable native fixture and never joins the paid Pilot manifest.
 const canonicalGeminiRoles=["backend","frontend","test"];
 assert.deepEqual(canonicalGeminiRoles,["backend","frontend","test"]);
 const a2aTaskId="r458-reviewer-a2a-task";
 const a2aRuntimeTaskId="dispatch_"+"R".repeat(22);
 const chosenNativeRead={
  task_id:a2aTaskId,agent_id:"reviewer",depends_on:[taskId],
  permissions:[grantPermission],
  instruction:"Read only the Owner-approved source at its current pinned HEAD"
 };
 class NativeScriptedTaskChoice extends BaseLlm{
  constructor(response){
   super({model:"r461-scripted-owner-planner-zero-api"});
   this.response=response;this.calls=0;
  }
  async *generateContentAsync(){
   assert.equal(++this.calls,1,"one model turn for each bounded owner choice");
   yield {content:{role:"model",parts:[{text:JSON.stringify(this.response)}]}};
  }
  connect(){throw Error("R461 cannot connect to a billable provider");}
 }
 const nativeDecisionContext={
  requirement,branch,rootPermissions:[grantPermission],
  // Only the existing trusted Coordinator reviewer pin is offered here.
  // Four HTTP A2A listeners later in this file are transport test fixtures,
  // not a fourth canonical Gemini specialist or new authority to mutate.
  agents:{reviewer:{capabilities:["read_file"]}},
  previousTasks:[{task_id:taskId,agent_id:"reviewer"}],
  nextEpoch:2,decisionKind:"adaptive",
  executionProgress:{
   current_head_sha:baseRevision,
   completed_work:[{
    task_id:taskId,agent_id:"reviewer",operation:"read_file",
    instruction:"Previous signed Rust/OPA/Gitea read independently completed"
   }]
  }
 };
 const chooseNativeRead=async response=>{
  const scripted=new NativeScriptedTaskChoice(response);
  try{
   const result=await new TrustedAuthorityOnlyAdkDecisionProposer({
    ...nativeDecisionContext,model:scripted
   }).propose();
   assert.equal(scripted.calls,1);
   return result;
  }catch(error){
   assert.equal(scripted.calls,1);
   throw error;
  }
 };
 // Fail before registration, Child issuance, A2A send, or provider effects
 // if the scripted Planner invents a role, widens the signed Root ceiling,
 // or references a Task that Gateway has never independently completed.
 const rejectedPlannerChoices=[
  {...chosenNativeRead,agent_id:"auditor"},
  {...chosenNativeRead,permissions:[{
   ...grantPermission,operation:"update_file"
  }]},
  {...chosenNativeRead,depends_on:["invented-gateway-completion"]}
 ];
 for(const forged of rejectedPlannerChoices)
  await assert.rejects(chooseNativeRead({action:"delegate",task:forged}),
   /R351 authority-only model Task choice denied/u);
 assert.equal(providerCalls,1,"rejected Planner choices cannot reach Gitea");
 assert.equal(gate.stagedCompletedTaskCount,1);
 const nativeDecision=await chooseNativeRead({
  action:"delegate",task:chosenNativeRead
 });
 assert.equal(nativeDecision.action,"delegate");
 assert.deepEqual(nativeDecision.task,chosenNativeRead);
 // The trusted Coordinator registers only the selected Task *within* the
 // originally signed Engineer permissions. The model cannot pick epoch,
 // credential IDs, signer DIDs, source SHA, or Gateway binding.
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:nativeDecision.task.task_id,epoch:2,
  agent_id:nativeDecision.task.agent_id,
  depends_on:nativeDecision.task.depends_on,
  permissions:nativeDecision.task.permissions
 });
 await gate.bindTrustedTask(nativeDecision.task.task_id,a2aRuntimeTaskId,nativeDecision.task.agent_id);
 const a2aIssuedAt=new Date().toISOString().replace(/\.\d{3}Z$/u,"Z");
 const nativeA2AChild=await issuer.issueForRegisteredTask(a2aTaskId,{
  ...params("urn:r458:child:reviewer-a2a",45706,600),
  valid_from:a2aIssuedAt
 });
 assert.equal(nativeA2AChild.agent_id,"reviewer");
 assert.equal(nativeA2AChild.agent_did,reviewerDid);
 await gate.enrollTrustedIssuedChild(a2aTaskId,a2aRuntimeTaskId,issuer);
 const liveReadHead=await independentClient.getBranchMetadata(branch);
 assert.equal(liveReadHead.commit_sha,baseRevision);
 gate.pinTrustedSingleReadTask(a2aTaskId,a2aRuntimeTaskId,liveReadHead.commit_sha);
 const a2aPrepared=prepareAuthorization({
  task_id:a2aRuntimeTaskId,agent_role:"reviewer",tool:"read_file",
  arguments:{branch,path:"README.md"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 assert.equal(store.get(a2aPrepared.request_id)?.pinned_revision,baseRevision);
 const a2aSignedVp=await sign(nativeA2AChild.credential_id,a2aPrepared);
 const channelRoles=["backend","frontend","test","reviewer"];
 const stageChannels={},agentBindingChannels={},workerRegistries={};
 const bindingServers=[],agentServers=[];
 const agentBaseUrls={};
 let a2aOwner,stagedReads=0,handlerCalls=0;
 async function chooseA2APort(){
  const listener=createServer();
  await new Promise((resolve,reject)=>{
   listener.once("error",reject);
   listener.listen(0,"127.0.0.1",resolve);
  });
  const address=listener.address();
  if(!address||typeof address==="string")throw Error("No R458 loopback port");
  await new Promise((resolve,reject)=>listener.close(error=>
   error?reject(error):resolve()));
  return address.port;
 }
 try{
  const ports=new Set();
  for(const role of channelRoles){
   const secrets=async direction=>{
    const channel={socketPath:path("r458-"+role+"-"+direction+".sock"),
     secretFile:path("r458-"+role+"-"+direction+".hex")};
    await writeFile(channel.secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
    return channel;
   };
   stageChannels[role]=await secrets("stage");
   agentBindingChannels[role]=await secrets("bind");
  }
  for(const role of channelRoles){
   const registry=new TrustedEffectStagingTaskRegistry();
   workerRegistries[role]=registry;
   const server=await createTrustedEffectAgentBindingServer({
    ...agentBindingChannels[role],registry,expectedRole:role,
    ownerStageClient:await connectTrustedOwnerEffectStagingClient(stageChannels[role])
   });
   bindingServers.push(server);
   await server.start();
  }
  for(const role of channelRoles){
   let port=await chooseA2APort();
   while(ports.has(port))port=await chooseA2APort();
   ports.add(port);
   const server=await startSpecializedAgentServer({
    role,port,host:"127.0.0.1",capabilityProfile:"approved-plan",
    delegatedAuthorization:true,
    ...(role==="reviewer"?{ownerAdditionalCardPin:{
     did:reviewerDid,name:"Owner Read-Only Reviewer",
     skillId:"source-review",capabilities:["read_file"]
    }}:{}),
    taskHandler:async context=>{
     handlerCalls++;
     if(role!=="reviewer")throw Error("reviewer A2A Task reached foreign specialist");
     assert.equal(context.role,"reviewer");
     assert.equal(context.trusted_gateway_task_id,a2aRuntimeTaskId);
     assert.equal(context.delegation_evidence.presenter_id,reviewerDid);
     const conveyed=JSON.parse(context.delegation_evidence.credential);
     assert.equal(conveyed.id,nativeA2AChild.credential_id);
     assert.equal(conveyed.credentialSubject?.sub,reviewerDid);
     assert.equal(context.subtask.subtask_id,nativeDecision.task.task_id);
     assert.equal(context.subtask.instruction,nativeDecision.task.instruction);
     assert.deepEqual(context.subtask.approved_file_permissions,
      [{path:"README.md",operation:"read_file"}]);
     assert.equal(context.subtask.approved_run_tests,false);
     const stage=workerRegistries.reviewer.selectFor(context);
     await stage.stage("req_r458_signed_read");
     return {
      role:"reviewer",summary:"Authentic signed read-only Task staged",
      files_modified:[],files_created:[],branch,
      revision:baseRevision,commit_sha:baseRevision,
      test_outcome:"not_run",errors:[]
     };
    }
   });
   agentServers.push(server);
   agentBaseUrls[role]=server.baseUrl;
  }
  // A2A metadata without an Owner-issued private bind cannot invoke
  // the native Gateway even if it advertises the correct Agent DID.
  const spoofed=new DeterministicA2AOrchestrator({
   deadlineMs:5000,initialIntervalMs:10,maxIntervalMs:40
  });
  await assert.rejects(spoofed.sendProtectedTask({
   agent_base_url:agentBaseUrls.reviewer,
   trusted_gateway_task_id:a2aRuntimeTaskId,
   delegation_evidence:{credential:"unsigned-spoof",
    credential_id:nativeA2AChild.credential_id,presenter_id:reviewerDid},
   subtask:{subtask_id:a2aTaskId,branch,
    instruction:"Unsigned source read must not reach Gateway",
    relevant_paths:["README.md"],
    approved_file_permissions:[{path:"README.md",operation:"read_file"}],
    approved_run_tests:false}
  }),/Protected A2A task ended without completion/u);
  assert.equal(providerCalls,1);
  assert.equal(stagedReads,0);
  a2aOwner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway:gate,
   stageChannels,agentBindingChannels,agentBaseUrls,
   additionalRolePins:{reviewer:{
    did:reviewerDid,name:"Owner Read-Only Reviewer",
    skillId:"source-review",capabilities:["read_file"]
   }},
   a2aPolling:{deadlineMs:5000,initialIntervalMs:10,maxIntervalMs:40}
  });
  assert.equal(a2aOwner.verifiedAgentProfiles?.reviewer?.did,reviewerDid);
  const report=await a2aOwner.dispatchIssuedTask({
   taskId:a2aTaskId,runtimeTaskId:a2aRuntimeTaskId,
   instruction:nativeDecision.task.instruction,
   effectStager:{
    stagedTool:"read_file",
    stage:async id=>{
     assert.equal(id,"req_r458_signed_read");
     assert.equal(stagedReads++,0,"A2A cannot repeat a Gateway read");
     const validated=await verifier.verify({
      presenter:"reviewer",audience:a2aPrepared.audience,
      challenge:a2aPrepared.challenge,
      required_permission:grantPermission,signed_vp:a2aSignedVp
     });
     assert.equal(validated.presenter_id,reviewerDid);
     assert.equal(validated.credential_id,nativeA2AChild.credential_id);
     await gate.stageTrustedTaskFlight(store.get(a2aPrepared.request_id));
     await executeAuthorization({
      request_id:a2aPrepared.request_id,signed_vp:a2aSignedVp
     },deps);
     assert.equal(audit.events.at(-1)?.decision,"allow");
     return {provider_write_authorized:false};
    }
   }
  });
  assert.equal(report.role,"reviewer");
  assert.equal(report.status,"a2a_report_not_gateway_completed");
  assert.equal(report.provider_completion_attested,false);
  assert.equal(report.artifact.test_outcome,"not_run");
  assert.deepEqual(report.artifact.files_modified,[]);
  assert.deepEqual(report.artifact.files_created,[]);
  assert.equal(stagedReads,1);
  assert.equal(handlerCalls,2,"unsigned spoof plus one native-bound A2A Task");
  assert.equal(providerCalls,2);
  const attested=await a2aOwner.attestIndependentGatewayCompletion(
   a2aTaskId,a2aRuntimeTaskId);
  assert.equal(attested.status,"owner_gateway_completion_independently_observed");
  assert.equal(gate.stagedCompletedTaskCount,2);
  await assert.rejects(a2aOwner.dispatchIssuedTask({
   taskId:a2aTaskId,runtimeTaskId:a2aRuntimeTaskId,
   instruction:"Replay completed native Task",
   effectStager:{stagedTool:"read_file",
    stage:async()=>{throw Error("replay");}}
  }),/closed or malformed owner-selected Task/u);
 }finally{
  const results=await Promise.allSettled([
   ...(a2aOwner?[a2aOwner.close()]:[]),
   ...agentServers.reverse().map(server=>server.close()),
   ...bindingServers.reverse().map(server=>server.close())
  ]);
  assert.equal(results.filter(r=>r.status==="rejected").length,0,
   "all R458 owner, A2A and HMAC listeners must close");
 }

 // An independently valid Child under the same root MUST NOT substitute
 // for the Child enrolled for this Task. This negative probe is test-only.
 const foreign=await nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r457:child:unbound",delegatee:"reviewer",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(45704),permissions:[grantPermission]
 });
 const other=prepare(),otherVp=await sign(foreign.id,other);
 const validOther=await verifier.verify({
  presenter:"reviewer",audience:other.audience,challenge:other.challenge,
  required_permission:grantPermission,signed_vp:otherVp
 });
 assert.equal(validOther.root_credential_id,operational.credential_id);
 assert.throws(()=>gate.assertVerifiedVpAndPolicyForExecution(
  store.get(other.request_id),validOther),/differs from enrolled Task/u);
 await assert.rejects(executeAuthorization({
  request_id:other.request_id,signed_vp:otherVp
 },deps),error=>error?.code==="authority_only_execution_not_enabled");
 assert.equal(providerCalls,2);

 // An already-prepared and signed VP MUST be denied after EVM root
 // revocation (not simply because the Task registry is still loaded).
 const pending=prepare(),pendingVp=await sign(child.credential_id,pending);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"reviewer",audience:pending.audience,challenge:pending.challenge,
  required_permission:grantPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(providerCalls,2);
 process.stdout.write(JSON.stringify({
  event:"r457_authority_only_native_evm_staged",
  native_engineer_roots:true,native_child_ipc:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  native_verified_root_provenance:true,real_opa_allow:true,
  unbound_child_denied:true,revoked_root_denied:true,
  fourth_role_native_cryptography:true,
  cross_role_vp_denied:true,
  reviewer_write_denied_at_gateway_opa_rust:true,
  r458_native_signed_child_a2a_http:true,
  r458_private_role_hmac_bind:true,
  r458_independent_gateway_read_attestation:true,
  r458_unbound_spoof_denied:true,
  r461_scripted_planner_native_task_selected:true,
  r461_unprovisioned_planner_roles_denied:true,
  r461_signed_scope_escalation_denied:true,
  r461_unverified_planner_dependency_denied:true,
  r461_canonical_gemini_three_roles_unchanged:true,
  r461_negative_planner_decisions:rejectedPlannerChoices.length,
  r461_native_selected_role:nativeDecision.task.agent_id,
  provider_calls:providerCalls,gateway_read_executed:true,completion_attested:true,
  paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
