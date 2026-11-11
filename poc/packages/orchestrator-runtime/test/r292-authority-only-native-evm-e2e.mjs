/**
 * R292 (opt-in, disposable EVM CI only): full authority-only crypto chain.
 * Real Engineer Node-API -> SAME Rust child issuer -> signed Backend VP ->
 * independent Rust Core/EVM/status verifier -> independent OPA -> terminal
 * Gateway DENY, with no Gitea/Docker provider effect or paid model call.
 *
 * Ed25519 test-only approval and pinned Gitea snapshot are generated locally.
 * This does NOT represent production human approval, Gitea evidence or task
 * completion. Do not expose as a public endpoint or run with real credentials.
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
import {MockExecutor} from "../../../apps/gateway/src/mock-executor.ts";
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
import {createOwnerPrivateInterprocessMcpSession}
 from "../../../mcp-shared/src/owner-private-crypto-stdio.ts";
import {createOwnerPrivateNativeCryptoMcpSession}
 from "../../../mcp-shared/src/owner-private-native-crypto-stdio.mjs";

assert.equal(process.env.R233_NATIVE_EVM,"1");
assert.equal(process.env.ENGINEER_CORE_NATIVE_MODE,"1");
assert.equal(process.env.ADAPTER_TRUST_PROFILE,"evm");
assert.equal(process.env.GATEWAY_VERIFIER_MODE,"core-rust");
assert.equal(process.env.APPROVED_RUNNER_NATIVE_MCP,"1");
const r3812Stdio=process.env.R3812_NATIVE_MCP_STDIO==="1";
const r3813Native=process.env.R3813_NATIVE_MCP_SIGNING==="1";
assert.ok(!r3812Stdio||!r3813Native,
 "Only one MCP signing transport may be selected");
assert.ok(process.env.R3812_NATIVE_MCP_STDIO===undefined||r3812Stdio,
 "R381.2 trusted test opt-in must be exactly 1");
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
const sessionId="r292-authority-native-e2e";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const baseRevision="a".repeat(40);
const branch="feature/account-suspension";
const requirement="R292 disposable EVM proof for account suspension permission";
const file="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension/files/apps/backend/user.ts";
const grantPermission={resource:file,operation:"read_file"};
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r292-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r292-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents"];
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
  statusListCredential:"https://status.example/r292"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r292:preliminary",29101,360);
 const operational=params("urn:r292:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,[grantPermission]);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{backend:{
   did:backendDid,card_ref:"trusted:r292-backend",
   capabilities:["read_file"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r292-backend-task",runtimeTaskId="r292-backend-runtime";
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:[grantPermission]
 });
 assert.ok(socketPath.startsWith("/"));
 const nativePort=createNativeRustChildCryptographyPort({
  bearerToken:tokens.orchestrator,timeoutMs:60000
 },socketPath);
 const issuer=new TrustedAuthorityOnlyChildIssuer({
  coordinator,nativeCryptoPort:nativePort,
  journal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
  nowMs,
  ...(r3813Native?{privateMcpTransport:"native-stdio"}:
   r3812Stdio?{privateMcpTransport:"stdio"}:{})
 });
 const child=await issuer.issueForRegisteredTask(taskId,
  params("urn:r292:child:backend",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 if(r3812Stdio||r3813Native)
  assert.equal(issuer.assertTrustedIssuedChild(taskId,coordinator).credential_id,
   child.credential_id);
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"backend");
 const enrolled=await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 assert.equal(enrolled.credential_id,child.credential_id);
 assert.equal(enrolled.gateway_execution_authorized,false);
 const verifier=loadDirectCoreRustVerifier();
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const executor=new MockExecutor();
 const prepare=()=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"backend",tool:"read_file",
  arguments:{branch,path:"apps/backend/user.ts"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 // R381.2: both Child and EVERY Backend VP must pass an independent
 // one-shot MCP stdio broker before the SAME Rust CryptoRuntime is invoked.
 // Neither the broker nor ADK receives a bearer, issuer key or signed VP.
 let nativePresentationCalls=0,privatePresentationBrokers=0;
 const sign=async(credential_id,prepared)=>{
  const nativeEffect=async()=>{
   nativePresentationCalls++;
   return invokeNativeCrypto({
    socketPath,token:tokens.backend,timeoutMs:60000
   },"create_presentation",{
    credential_id,disclosed_permissions:[grantPermission],
    audience:prepared.audience,challenge:prepared.challenge
   });
  };
  let signed;
  if(r3813Native){
   // Request AND signed VP are handled through a real separate MCP process.
   // Rust's original role-authenticated native socket remains the signer.
   privatePresentationBrokers++;
   nativePresentationCalls++;
   signed=await createOwnerPrivateNativeCryptoMcpSession(
    "presentation_create",{
     socketPath,bearerToken:tokens.backend,timeoutMs:60000
    },{
     credential_id,disclosed_permissions:[grantPermission],
     audience:prepared.audience,challenge:prepared.challenge
    }).invokeOnce();
  }else if(r3812Stdio){
   privatePresentationBrokers++;
   signed=await createOwnerPrivateInterprocessMcpSession(
    "presentation_create",nativeEffect).invokeOnce();
  }else signed=await nativeEffect();
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs};
 const good=prepare(),goodVp=await sign(child.credential_id,good);
 const valid=await verifier.verify({
  presenter:"backend",audience:good.audience,challenge:good.challenge,
  required_permission:grantPermission,signed_vp:goodVp
 });
 assert.equal(valid.presenter_id,backendDid);
 assert.equal(valid.credential_id,child.credential_id);
 assert.equal(valid.root_credential_id,operational.credential_id);
 assert.equal(valid.hierarchy_depth,1);
 const opa=await policy.evaluate({
  request_id:good.request_id,task_id:runtimeTaskId,
  agent_role:"backend",tool:"read_file",arguments:{
   branch,path:"apps/backend/user.ts"},
  required_permission:grantPermission,repository:repo,
  verified_delegation:{presenter_id:valid.presenter_id,
   credential_id:valid.credential_id,issuer_id:valid.issuer_id,
   hierarchy_depth:valid.hierarchy_depth}
 });
 assert.equal(opa.allow,true);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:good.audience,challenge:"invalid-r292-nonce",
  required_permission:grantPermission,signed_vp:goodVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:good.request_id,signed_vp:goodVp
 },deps),error=>error?.code==="authority_only_execution_not_enabled");
 assert.equal(executor.callCount,0);
 assert.equal(audit.events.at(-1)?.event,"authorization_executed");
 assert.equal(audit.events.at(-1)?.decision,"deny");
 assert.equal(audit.events.at(-1)?.policy_decision,"allow");

 // An independently valid Child under the same root MUST NOT substitute
 // for the Child enrolled for this Task. This negative probe is test-only.
 const foreign=await nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r292:child:unbound",delegatee:"backend",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(29104),permissions:[grantPermission]
 });
 const other=prepare(),otherVp=await sign(foreign.id,other);
 const validOther=await verifier.verify({
  presenter:"backend",audience:other.audience,challenge:other.challenge,
  required_permission:grantPermission,signed_vp:otherVp
 });
 assert.equal(validOther.root_credential_id,operational.credential_id);
 assert.throws(()=>gate.assertVerifiedVpAndPolicyForExecution(
  store.get(other.request_id),validOther),/differs from enrolled Task/u);
 await assert.rejects(executeAuthorization({
  request_id:other.request_id,signed_vp:otherVp
 },deps),error=>error?.code==="authority_only_execution_not_enabled");
 assert.equal(executor.callCount,0);

 // An already-prepared and signed VP MUST be denied after EVM root
 // revocation (not simply because the Task registry is still loaded).
 const pending=prepare(),pendingVp=await sign(child.credential_id,pending);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:pending.audience,challenge:pending.challenge,
  required_permission:grantPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(executor.callCount,0);
 assert.equal(nativePresentationCalls,3,
  "all three original signed VP requests must reach native Rust once");
 if(r3812Stdio||r3813Native){
  assert.equal(privatePresentationBrokers,3,
   "every signed VP must first use one isolated MCP broker");
 }
 process.stdout.write(JSON.stringify({
  event:"r292_authority_only_native_evm_staged",
  native_engineer_roots:true,native_child_ipc:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  native_verified_root_provenance:true,real_opa_allow:true,
  unbound_child_denied:true,revoked_root_denied:true,
  provider_calls:executor.callCount,gateway_execution_authorized:false,
  ...(r3813Native?{
   r3813_native_rust_signing_in_private_mcp_process:true,
   child_original_root_pinned:true,
   presentation_broker_count:privatePresentationBrokers,
   native_presentation_count:nativePresentationCalls,
   native_root_revoked:true
  }:{}),
  ...(r3812Stdio?{
   r3812_native_stdio_mcp_child_and_vp:true,
   child_original_root_pinned:true,
   presentation_broker_count:privatePresentationBrokers,
   native_presentation_count:nativePresentationCalls,
   native_root_revoked:true
  }:{}),
  paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
