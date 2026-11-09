/** R457 four-role native read on disposable Gitea + authentic Rust/EVM/OPA.
 * Role reviewer has its OWN DID, Ed25519 signing identity and one read-only
 * native Child. This proves provider read and owner-observed completion,
 * including foreign-child and revocation denial. It does NOT prove an
 * end-to-end physical A2A Worker dispatch or production human signature.
 * No paid models, production credentials, protected merge or writing.
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
   branch,giteaClient:client,nowMs
  }).toTrustedObserver(),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"reviewer");
 const enrolled=await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 assert.equal(enrolled.credential_id,child.credential_id);
 assert.equal(enrolled.gateway_execution_authorized,false);
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
 assert.equal(providerCalls,1);

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
 assert.equal(providerCalls,1);
 process.stdout.write(JSON.stringify({
  event:"r457_authority_only_native_evm_staged",
  native_engineer_roots:true,native_child_ipc:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  native_verified_root_provenance:true,real_opa_allow:true,
  unbound_child_denied:true,revoked_root_denied:true,
  fourth_role_native_cryptography:true,
  cross_role_vp_denied:true,
  reviewer_write_denied_at_gateway_opa_rust:true,
  provider_calls:providerCalls,gateway_read_executed:true,completion_attested:true,
  paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
