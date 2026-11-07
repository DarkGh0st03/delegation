/** R384 disposable real Gitea + authentic Rust/EVM/OPA CREATE_FILE CAS
 * with original one-shot owner preflight/Task flight and independent MAC
 * completion. CI approval is synthetic; no Gemini/production credentials.
 * The agent FunctionTool/remote A2A are intentionally NOT exercised here.
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
import {ProviderConflictError,ProviderNotFoundError}
 from "../../../apps/gateway/src/errors.ts";
import {TrustedAuthorityOnlyCreateEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight} from "../../../apps/gateway/src/trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-create-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor} from "../../../apps/gateway/src/trusted-authority-only-create-executor.ts";
import {TrustedGatewayGiteaCreateEvidencePublisher,
 AuthenticatedGiteaCreateCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {DurableAuthorityOnlyTaskFenceJournal} from "../src/trusted-authority-only-task-fence-journal.ts";

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
const sessionId="r384-authority-native-e2e";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
let gatewayCasWrites=0;
class ObservedGiteaClient extends GiteaClient{
 async createFileWithHeadCas(input){gatewayCasWrites++;return super.createFileWithHeadCas(input);}
}
const client=new ObservedGiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only token required");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// Disposable CI owner provisioning, outside delegated execution.
const mainBefore=(await client.getBranchMetadata("main")).commit_sha;
const created=await client.createBranch("main","feature/account-suspension");
assert.match(created.commit_sha,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const mutationPath="apps/backend/users/account-suspension-created.ts";
const newContent="export const accountSuspended = true;\n";
// The path MUST be absent at the signed parent's exact HEAD.
const baseRevision=created.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
await assert.rejects(
 independentClient.readTextFile(branch,mutationPath,baseRevision),
 ProviderNotFoundError
);
const requirement="R384 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermission={
 resource:resourcePrefix+"/directories/apps/backend",operation:"create_file"
};
const taskPermission={
 resource:resourcePrefix+"/files/"+mutationPath,operation:"create_file"
};
assert.notEqual(grantPermission.resource,taskPermission.resource);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r384-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r384-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","flights","intent","receipts"];
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
  statusListCredential:"https://status.example/r384"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r384:preliminary",29101,360);
 const operational=params("urn:r384:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,[grantPermission]);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{backend:{
   did:backendDid,card_ref:"trusted:r384-backend",
   capabilities:["create_file"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r384-backend-task",runtimeTaskId="dispatch_"+"C".repeat(22);
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:[taskPermission]
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
  params("urn:r384:child:backend",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,[taskPermission]);
 assert.deepEqual(approved.permissions,[grantPermission]);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new AuthenticatedGiteaCreateCompletionObserver({
   directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
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
  async execute(...args){legacyWriteCalls++;return super.execute(...args);}
 }
 const executor=new ObservedGiteaExecutor(client);
 const journal=new DurableAuthorityOnlyGiteaCreateIntentJournal(path("intent"));
 const preflight=new TrustedAuthorityOnlyGiteaCreatePreflight({
  admissions:gate,giteaClient:client,journal,repository:"thesis/iam-console-poc",
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaCreateCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,independentGiteaClient:independentClient,nowMs
 });
 const createExecutor=new TrustedAuthorityOnlyGiteaCreateExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaCreateEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 const prepare=()=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"backend",tool:"create_file",
  arguments:{branch,path:mutationPath,content:newContent}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(credential_id,prepared)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.backend,timeoutMs:60000
  },"create_presentation",{
   credential_id,disclosed_permissions:[taskPermission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,
  authorityOnlyCreateEnabled:true,
  authorityOnlyCreateExecutor:createExecutor};
 const good=prepare(),goodVp=await sign(child.credential_id,good);
 const originalRecord=store.get(good.request_id);
 assert.ok(originalRecord);
 const stager=new TrustedAuthorityOnlyCreateEffectStager({
  store,admissions:gate,preflight,giteaClient:client,
  repository:"thesis/iam-console-poc",branch,
  planTaskId:taskId,runtimeTaskId,expectedHeadSha:baseRevision
 });
 const staged=await stager.stage(good.request_id);
 assert.equal(staged.provider_write_authorized,false);
 assert.equal(staged.gateway_execution_authorized,false);
 assert.equal(staged.task_id,taskId);
 const reserved=preflight.getReservedIntent(originalRecord);
 assert.equal(reserved.expected_head_sha,baseRevision);
 assert.equal(reserved.old_path_absent_at_pinned_head,true);
 assert.equal("previous_blob_sha" in reserved,false);
 await assert.rejects(stager.stage(good.request_id),/already attempted/);
 assert.equal(gatewayCasWrites,0);
 const valid=await verifier.verify({
  presenter:"backend",audience:good.audience,challenge:good.challenge,
  required_permission:taskPermission,signed_vp:goodVp
 });
 assert.equal(valid.presenter_id,backendDid);
 assert.equal(valid.credential_id,child.credential_id);
 assert.equal(valid.root_credential_id,operational.credential_id);
 assert.equal(valid.hierarchy_depth,1);
 assert.deepEqual(valid.permissions,[taskPermission]);
 // The root's directory permission is authenticated by the accumulator
 // ancestor witness. Only the Child's leaf permission is disclosed.
 assert.equal(valid.permissions.some(p=>p.resource===grantPermission.resource),false);
 const opa=await policy.evaluate({
  request_id:good.request_id,task_id:runtimeTaskId,
  agent_role:"backend",tool:"create_file",arguments:{
   branch,path:mutationPath,content:newContent},
  required_permission:taskPermission,repository:repo,
  verified_delegation:{presenter_id:valid.presenter_id,
   credential_id:valid.credential_id,issuer_id:valid.issuer_id,
   hierarchy_depth:valid.hierarchy_depth}
 });
 assert.equal(opa.allow,true);
 // A signed VP for a leaf Child cannot authorize a sibling, branch switch,
 // operation change or traversal, even if its Engineer root is broader.
 for(const denied of [
  {...taskPermission,
   resource:resourcePrefix+"/files/apps/backend-extra/users/account.ts"},
  {...taskPermission,
   resource:resourcePrefix+"/files/apps/backend/users/other.ts"},
  {...taskPermission,
   resource:resourcePrefix.replace("feature%2Faccount-suspension","main")+
    "/files/"+mutationPath},
  {...taskPermission,operation:"read_file"},
  {...taskPermission,
   resource:resourcePrefix+"/files/apps/backend/../users/secrets.ts"}
 ]){
  await assert.rejects(()=>verifier.verify({
   presenter:"backend",audience:good.audience,challenge:good.challenge,
   required_permission:denied,signed_vp:goodVp
  }));
 }
 assert.throws(()=>gate.preflightCanonicalRequest({
  task_id:runtimeTaskId,agent_role:"backend",tool:"update_file",
  arguments:{branch,path:"apps/backend-extra/users/account.ts",content:newContent}
 }),/not in exact signed Task grant/u);
 assert.throws(()=>gate.preflightCanonicalRequest({
  task_id:runtimeTaskId,agent_role:"backend",tool:"read_file",arguments:{branch,path:mutationPath}
 }),/not in exact signed Task grant/u);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:good.audience,challenge:"invalid-r384-nonce",
  required_permission:taskPermission,signed_vp:goodVp
 }));
 // The native stager above already reserved the original signed Task flight.
 const written=await executeAuthorization({
  request_id:good.request_id,signed_vp:goodVp
 },deps);
 assert.equal(written.decision,"allow");
 assert.equal(gatewayCasWrites,1);
 assert.equal(legacyWriteCalls,0);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,
  written.execution.commit_sha);
 assert.equal((await independentClient.readTextFile(
  branch,mutationPath,written.execution.commit_sha)).content,newContent);
 await assert.rejects(
  independentClient.readTextFile(branch,mutationPath,baseRevision),
  ProviderNotFoundError
 );
 assert.equal(audit.events.at(-1)?.decision,"allow");
 const verifiedReceipt=await observer.observe(
  gate.assertTrustedCreateNativeAdmissionBinding(originalRecord,valid));
 assert.equal(verifiedReceipt.status,"owner_verified_provider_result");
 await assert.rejects(executeAuthorization({request_id:good.request_id,signed_vp:goodVp},deps),
  error=>error?.code==="replay_detected");
 await gate.attestTrustedTaskCompletion(taskId,runtimeTaskId);
 assert.equal(gate.stagedCompletedTaskCount,1);
 assert.equal(gatewayCasWrites,1);

 // An independently valid Child under the same root MUST NOT substitute
 // for the Child enrolled for this Task. This negative probe is test-only.
 const foreign=await nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r384:child:unbound",delegatee:"backend",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(29104),permissions:[taskPermission]
 });
 const other=prepare(),otherVp=await sign(foreign.id,other);
 const validOther=await verifier.verify({
  presenter:"backend",audience:other.audience,challenge:other.challenge,
  required_permission:taskPermission,signed_vp:otherVp
 });
 assert.equal(validOther.root_credential_id,operational.credential_id);
 assert.throws(()=>gate.assertVerifiedVpAndPolicyForExecution(
  store.get(other.request_id),validOther),/differs from enrolled Task/u);
 await assert.rejects(executeAuthorization({
  request_id:other.request_id,signed_vp:otherVp
 },deps),error=>error?.code==="authority_only_execution_not_enabled");
 assert.equal(gatewayCasWrites,1);

 // An already-prepared and signed VP MUST be denied after EVM root
 // revocation (not simply because the Task registry is still loaded).
 const pending=prepare(),pendingVp=await sign(child.credential_id,pending);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:pending.audience,challenge:pending.challenge,
  required_permission:taskPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(gatewayCasWrites,1);
 // Provider-only adversarial race: unrelated owner advances the EXACT
 // feature HEAD between staged CREATE commit and Gitea ref CAS. This is
 // not a delegated second Task, and must not create the target file.
 const raceBranch="feature/r384-create-race";
 await client.createBranch("main",raceBranch);
 const raceHead=(await client.getBranchMetadata(raceBranch)).commit_sha;
 let injected=false;
 const competitor=new GiteaClient({
  baseUrl:process.env.GITEA_HOST_BASE_URL,
  token:process.env.GITEA_GATEWAY_TOKEN,
  owner:repo.owner,repository:repo.repository
 });
 const contender=new GiteaClient({
  baseUrl:process.env.GITEA_HOST_BASE_URL,
  token:process.env.GITEA_GATEWAY_TOKEN,
  owner:repo.owner,repository:repo.repository,
  fetchFn:async(url,init={})=>{
   const pathname=new URL(String(url)).pathname;
   if(!injected&&init.method==="PUT"&&
      pathname.endsWith("/branches/feature%2Fr384-create-race")){
    injected=true;
    await competitor.createFile(raceBranch,
     "apps/backend/users/competing-owner.ts",
     "export const competingOwner = true;\n",
     "R384 external owner advances feature HEAD");
   }
   return fetch(url,init);
  }
 });
 const racePath="apps/backend/users/uncommitted-create.ts";
 await assert.rejects(contender.createFileWithHeadCas({
  branch:raceBranch,path:racePath,content:newContent,
  message:"R384 CAS conflict must never publish file",
  requestId:"r384-competing-race",expectedHeadSha:raceHead
 }),ProviderConflictError);
 assert.equal(injected,true);
 await assert.rejects(
  independentClient.readTextFile(raceBranch,racePath),
  ProviderNotFoundError
 );
 assert.notEqual((await client.getBranchMetadata(raceBranch)).commit_sha,raceHead);
 assert.equal((await client.getBranchMetadata("main")).commit_sha,mainBefore);
 process.stdout.write(JSON.stringify({
  event:"r384_authority_only_native_evm_atomic_create",
  engineer_directory_scope:true,child_file_scope:true,
  native_engineer_roots:true,native_child_ipc:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  native_verified_root_provenance:true,real_opa_allow:true,
  scope_expansion_denied:true,unbound_child_denied:true,revoked_root_denied:true,
  provider_calls:gatewayCasWrites,gateway_atomic_create_executed:true,
  completion_attested:true,old_head_pinned:true,old_path_absent:true,
  concurrent_head_race_denied:true,legacy_writes:legacyWriteCalls,
  paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
