/** R360 disposable real Gitea + native Rust/EVM/OPA write and authenticated
 * completion. CI approval is synthetic; no Gemini or production credentials.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";

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
import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor} from "../../../apps/gateway/src/trusted-authority-only-mutation-executor.ts";
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-publisher.ts";
import {AuthenticatedGiteaReadCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";

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
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","BACKEND","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const backendDid=process.env.ADAPTER_ID_BACKEND;
assert.match(engineerDid??"",/^did:/u);
assert.match(backendDid??"",/^did:/u);
const sessionId="r360-authority-native-e2e";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
let gatewayCasWrites=0;
class ObservedGiteaClient extends GiteaClient{
 async updateFileWithHeadCas(input){gatewayCasWrites++;return super.updateFileWithHeadCas(input);}
}
const client=new ObservedGiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only token required");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// Disposable CI owner provisioning, outside delegated execution.
const created=await client.createBranch("main","feature/account-suspension");
assert.match(created.commit_sha,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const mutationPath="apps/backend/users/account.ts";
const oldContent="export const accountSuspended = false;\n";
const newContent="export const accountSuspended = true;\n";
// Owner-only disposable CI fixture, created BEFORE the Engineer root.
// No delegated write or Docker provider effect is enabled.
const seeded=await client.createFile(branch,mutationPath,oldContent,
 "R360 owner-provisioned disposable Gitea fixture");
const baseRevision=seeded.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
const requirement="R360 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermissions=["read_file","update_file"].map(operation=>({
 resource:resourcePrefix+"/directories/apps/backend",operation
}));
const readPermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"read_file"};
const updatePermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"update_file"};
const taskPermissions=[readPermission,updatePermission];
assert.equal(readPermission.resource,updatePermission.resource);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r360-disposable-ed25519";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const proposed={
 schema_version:"1.0.0",session_id:sessionId,repository:repo,branch,
 base_revision:baseRevision,requirement,
 requested_permissions:grantPermissions
};
const grant=selectAuthorityOnlyGrant(proposed,grantPermissions,{
 allowedOperations:new Set(RUST_OPERATIONS)
});
const receipt=signAuthorityOnlyGrant({
 authorization:grant,engineerDid,keyId:authKey,
 privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
 issuedAt,expiresAt:approvalExpiresAt,
 allowedOperations:new Set(RUST_OPERATIONS)
});
const parent=await mkdtemp(join(tmpdir(),"delegation-r360-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","sequences","intent","receipts"];
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
  statusListCredential:"https://status.example/r360"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r360:preliminary",29101,360);
 const operational=params("urn:r360:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grantPermissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{backend:{
   did:backendDid,card_ref:"trusted:r360-backend",
   capabilities:["read_file","update_file"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r360-backend-task",runtimeTaskId="r360-backend-runtime";
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:taskPermissions
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
  params("urn:r360:child:backend",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,taskPermissions);
 assert.deepEqual(approved.permissions,grantPermissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(path("sequences")),
  completionObserver:new AuthenticatedGiteaReadCompletionObserver({
   directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
   branch,giteaClient:independentClient,nowMs
  }).toTrustedObserver(),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"backend");
 const enrolled=await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 assert.equal(enrolled.credential_id,child.credential_id);
 assert.equal(enrolled.gateway_execution_authorized,false);
 const verifier=loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true});
 assert.equal(verifier.allowsGiteaScopeCoverage,true);
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let legacyWriteCalls=0;
 class ObservedGiteaExecutor extends GiteaExecutor {
  async execute(...args){if(args[0]?.request?.tool==="update_file")
    legacyWriteCalls++;return super.execute(...args);}
 }
 const executor=new ObservedGiteaExecutor(client);
 const journal=new DurableAuthorityOnlyGiteaMutationIntentJournal(path("intent"));
 const preflight=new TrustedAuthorityOnlyGiteaMutationPreflight({
  admissions:gate,giteaClient:client,journal,repository:"thesis/iam-console-poc",
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaMutationCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,giteaClient:independentClient,nowMs
 });
 const mutationExecutor=new TrustedAuthorityOnlyGiteaMutationExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 const readPublisher=new TrustedGatewayGiteaReadEvidencePublisher({
  directory:path("receipts"),key:evidenceKey,admissions:gate,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const native=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store,admissions:gate,mutation:preflight,mutationObserver:observer,
  planTaskId:taskId,runtimeTaskId,expectedHeadSha:baseRevision
 });
 assert.equal(native.stagedTool,"read_then_update");
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:readPublisher,
  authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor};
 const prepare=(tool)=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"backend",tool,
  arguments:{branch,path:mutationPath,
   ...(tool==="update_file"?{content:newContent}:{})}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(prepared,permission)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.backend,timeoutMs:60000
  },"create_presentation",{
   credential_id:child.credential_id,disclosed_permissions:[permission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 const read=prepare("read_file"),readVp=await sign(read,readPermission);
 const verifiedRead=await verifier.verify({
  presenter:"backend",audience:read.audience,challenge:read.challenge,
  required_permission:readPermission,signed_vp:readVp
 });
 assert.equal(verifiedRead.credential_id,child.credential_id);
 assert.equal(verifiedRead.root_credential_id,operational.credential_id);
 assert.deepEqual(verifiedRead.permissions,[readPermission]);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:read.audience,challenge:read.challenge,
  required_permission:updatePermission,signed_vp:readVp
 }));
 const first=await native.stage(read.request_id);
 assert.equal(first.sequence,1);
 assert.equal(first.gateway_execution_authorized,false);
 const readResult=await executeAuthorization({
  request_id:read.request_id,signed_vp:readVp
 },deps);
 assert.equal(readResult.decision,"allow");
 assert.equal(readResult.execution.tool,"read_file");
 assert.equal(readResult.execution.revision,baseRevision);
 assert.equal(readResult.execution.content,oldContent);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
 assert.equal(gatewayCasWrites,0);
 // A second effect cannot stage while the verified source receipt is pending.
 const write=prepare("update_file"),writeVp=await sign(write,updatePermission);
 await assert.rejects(native.stage(write.request_id),/out-of-order/u);
 await native.attest(read.request_id,"read_file");
 assert.equal(gate.stagedCompletedTaskCount,0);
 const verifiedWrite=await verifier.verify({
  presenter:"backend",audience:write.audience,challenge:write.challenge,
  required_permission:updatePermission,signed_vp:writeVp
 });
 assert.equal(verifiedWrite.credential_id,child.credential_id);
 assert.deepEqual(verifiedWrite.permissions,[updatePermission]);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:write.audience,challenge:write.challenge,
  required_permission:readPermission,signed_vp:writeVp
 }));
 const second=await native.stage(write.request_id);
 assert.equal(second.sequence,2);
 assert.equal(second.gateway_execution_authorized,false);
 const written=await executeAuthorization({
  request_id:write.request_id,signed_vp:writeVp
 },deps);
 assert.equal(written.decision,"allow");
 assert.equal(written.execution.tool,"update_file");
 assert.equal(written.execution.precondition_blob_sha,seeded.blob_sha);
 assert.equal(gatewayCasWrites,1);
 assert.equal(legacyWriteCalls,0);
 assert.notEqual(written.execution.commit_sha,baseRevision);
 assert.equal((await independentClient.readTextFile(
  branch,mutationPath,written.execution.commit_sha)).content,newContent);
 assert.throws(()=>gate.assertTrustedCompletedSequentialReadUpdateTask(
  taskId,runtimeTaskId),/mixed Task lacks independently finalized/u);
 await native.attest(write.request_id,"update_file");
 const completed=gate.assertTrustedCompletedSequentialReadUpdateTask(
  taskId,runtimeTaskId);
 assert.equal(completed.status,"sequential_read_update_task_completed_staged");
 assert.equal(completed.gateway_execution_authorized,false);
 assert.equal(gate.stagedCompletedTaskCount,1);
 await assert.rejects(native.stage(write.request_id),/out-of-order/u);
 await assert.rejects(executeAuthorization({
  request_id:write.request_id,signed_vp:writeVp
 },deps),error=>error?.code==="replay_detected");
 assert.equal(gatewayCasWrites,1);
 const pending=prepare("read_file"),pendingVp=await sign(pending,readPermission);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:pending.audience,challenge:pending.challenge,
  required_permission:readPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(gatewayCasWrites,1);
 process.stdout.write(JSON.stringify({
  event:"r360_native_read_then_atomic_update",
  engineer_directory_scopes:2,task_leaf_permissions:2,
  native_engineer_root:true,native_child_ipc:true,
  independently_verified_rust_evm:true,real_opa:true,
  read_and_cas_evidence_attested:true,task_finalized:true,
  gateway_atomic_update_calls:gatewayCasWrites,
  legacy_writes:legacyWriteCalls,paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
