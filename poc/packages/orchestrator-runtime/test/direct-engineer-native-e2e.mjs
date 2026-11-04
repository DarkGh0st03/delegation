/**
 * R225 DIRECT Engineer -> native Core Rust in-process smoke.
 * No provider, LLM, network HTTP or Adapter process. This test only runs
 * AFTER the new Node-API addon has been compiled and packaged by CI.
 *
 * Assert that the SAME Rust CryptoRuntime answers direct Engineer calls
 * and local delegated Orchestrator/Agent commands, without permitting the
 * Engineer to issue a root through the socket.
 */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createConnection} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {setTimeout as delay} from "node:timers/promises";

const requireAddon=createRequire(import.meta.url);
const binding=requireAddon("../src/native/delegation-engineer.node");
assert.equal(typeof binding.start_engineer_core,"function");
assert.equal(typeof binding.issue_engineer_root,"function");
assert.equal(typeof binding.revoke_engineer_root,"function");

const liveEvm=process.env.R233_NATIVE_EVM==="1";
if(liveEvm&&process.env.ADAPTER_TRUST_PROFILE!=="evm")
 throw Error("R233 EVM native proof requires actual EVM issuer configuration");
const tokens=Object.freeze({
 engineer:"r225-native-engineer",
 gateway:"r225-native-gateway",
 orchestrator:"r225-native-orchestrator",
 backend:"r225-native-backend",
 frontend:"r225-native-frontend",
 test:"r225-native-test"
});
for(const [role,token] of Object.entries(tokens)){
 process.env["ADAPTER_CALLER_"+role.toUpperCase()]=token;
}
if(!liveEvm){
 process.env.ADAPTER_ID_ENGINEER="did:thesis:engineer";
 process.env.ADAPTER_ID_ORCHESTRATOR="did:thesis:orchestrator";
 process.env.ADAPTER_ID_BACKEND="did:thesis:backend";
 process.env.ADAPTER_ID_FRONTEND="did:thesis:frontend";
 process.env.ADAPTER_ID_TEST="did:thesis:test";
 process.env.ADAPTER_ID_GATEWAY="urn:thesis:service:gateway";
 process.env.ADAPTER_TRUST_PROFILE="in-memory";
}

const folder=mkdtempSync(join(tmpdir(),"eng-r225-"));
const socketPath=join(folder,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;

async function invokeSocket(token,operation,body){
 return new Promise((resolve,reject)=>{
  const socket=createConnection({path:socketPath,allowHalfOpen:true});
  let raw="";
  // EVM-anchored Status List publication can require multiple disposable
  // local chain transactions; keep a bounded but realistic smoke timeout.
  socket.setTimeout(liveEvm?60_000:15_000,
   ()=>socket.destroy(Error("socket timeout")));
  socket.on("connect",()=>socket.end(JSON.stringify({token,operation,body})));
  socket.on("data",chunk=>raw+=chunk.toString("utf8"));
  socket.once("error",reject);
  socket.once("end",()=>{
   try{resolve(JSON.parse(raw));}catch(e){reject(e);}
  });
 });
}
const status=index=>({
 type:"BitstringStatusListEntry",statusPurpose:"revocation",
 statusListIndex:String(index),statusListCredential:"https://status.example/r225"
});
const now="2026-01-01T00:00:00Z",lifetime=94608000;
const permission={operation:"read_file",
 resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fnative/files/apps/backend/user.ts"};
const root={
 credential_id:"urn:r225:root:single-owner",
 delegatee:"orchestrator",
 valid_from:now,validity_seconds:lifetime,
 credential_status:status(1915),permissions:[permission]
};
try{
 // The live EVM proof goes through the SAME production selector used by
 // TrustedEngineerAuthoritySession, rather than calling the addon only as
 // a raw test fixture. This also checks native-mode bootstrapping.
 let engineerPort;
 if(liveEvm){
  const {createTrustedEngineerCredentialPort}=await import(
   "../src/trusted-engineer-crypto-port.ts");
  engineerPort=createTrustedEngineerCredentialPort({
   adapterBaseUrl:"http://127.0.0.1:1",
   bearerToken:tokens.engineer
  });
 }else{
  binding.start_engineer_core();
 }
 await delay(20);
 const rootIssued=liveEvm
  ? await engineerPort.issueScopedOrchestratorRoot(root)
  : JSON.parse(await binding.issue_engineer_root(
     tokens.engineer,JSON.stringify(root)));
 assert.equal(rootIssued.id,root.credential_id);

 const inspected=await invokeSocket(tokens.gateway,"read_issued_root",{
  credential_id:root.credential_id
 });
 assert.equal(inspected.ok,true,"Gateway must inspect the SAME Rust owner");
 assert.equal(inspected.result.credential_id,root.credential_id);
 assert.equal(inspected.result.issuer_id,process.env.ADAPTER_ID_ENGINEER);
 assert.equal(inspected.result.delegatee_id,process.env.ADAPTER_ID_ORCHESTRATOR);
 assert.deepEqual(inspected.result.permissions,[permission]);
 assert.equal(inspected.result.status.status_set,false);
 assert.equal(inspected.result.status.source,
  liveEvm?"evm_anchored_signed_jwt":"adapter_memory_only");
 if(liveEvm){
  assert.ok(Number.isSafeInteger(inspected.result.status.anchor_version));
  assert.ok(inspected.result.status.anchor_version>=0);
 }
 const forbiddenInspector=await invokeSocket(tokens.backend,"read_issued_root",{
  credential_id:root.credential_id
 });
 assert.equal(forbiddenInspector.ok,false,"Only Gateway may inspect issuer inventory");

 // If this root were registered in a second private CryptoRuntime,
 // the next Child issuance would fail: the signer needs its parent.
 const child={
  parent_credential_id:root.credential_id,
  credential_id:"urn:r225:child:shared-runtime",
  delegatee:"backend",
  valid_from:now,validity_seconds:lifetime,
  credential_status:status(1916),permissions:[permission]
 };
 const issuedChild=await invokeSocket(tokens.orchestrator,"issue_child",child);
 assert.equal(issuedChild.ok,true,"Child must resolve direct Engineer root");
 assert.equal(issuedChild.result.id,child.credential_id);

 const proof=await invokeSocket(tokens.backend,"create_presentation",{
  credential_id:child.credential_id,disclosed_permissions:[permission],
  audience:"cloud-access-gateway",challenge:"r225-native-gateway-challenge"
 });
 assert.equal(proof.ok,true,"Agent VP must use the SAME single issuer");
 assert.equal(typeof proof.result.signed_vp,"string");
 assert.ok(proof.result.signed_vp.length>16);

 // Live mode uses the independently loaded PUBLIC-only Gateway Core Rust
 // verifier to check signed VP, EVM trust, DID, accumulator and Status List.
 // No JS verification, mock proof, HTTP Adapter or privileged issuer key.
 let verifier;
 let rootReader;
 const challenge="r225-native-gateway-challenge";
 if(liveEvm){
  // Exercise the actual Gateway's issuer-observation class, not only raw
  // socket RPC, with no historical Adapter HTTP address configured.
  const {TrustedGatewayNativeRootStatusReader}=await import(
   "../../../apps/gateway/src/trusted-gateway-native-root-status.ts");
  rootReader=new TrustedGatewayNativeRootStatusReader({
   gatewayToken:tokens.gateway,nativeSocketPath:socketPath
  });
  const observed=await rootReader.readIssuedRoot(root.credential_id);
  assert.equal(observed.credential_id,root.credential_id);
  assert.equal(observed.issuer_id,process.env.ADAPTER_ID_ENGINEER);
  assert.deepEqual(observed.permissions,[permission]);
  assert.ok(Number.isSafeInteger(observed.anchor_version));

  const {loadDirectCoreRustVerifier}=await import(
   "../../../apps/gateway/src/direct-core-loader.ts");
  verifier=loadDirectCoreRustVerifier();
  const checked=await verifier.verify({
   presenter:"backend",audience:"cloud-access-gateway",challenge,
   required_permission:permission,signed_vp:proof.result.signed_vp
  });
  assert.equal(checked.presenter_id,process.env.ADAPTER_ID_BACKEND);
  assert.equal(checked.credential_id,child.credential_id);
  await assert.rejects(()=>verifier.verify({
   presenter:"backend",audience:"cloud-access-gateway",
   challenge:"r233-invalid-challenge",
   required_permission:permission,signed_vp:proof.result.signed_vp
  }),/Rust Core rejected|VerificationRejected|rejected/u);
 }

 // Ownership must not accidentally be re-exposed to the private socket.
 const forbidden=await invokeSocket(tokens.engineer,"issue_root",{
  ...root,credential_id:"urn:r225:illicit-socket-root",
  credential_status:status(1917)
 });
 assert.equal(forbidden.ok,false,"Only direct Engineer API may issue root");
 if(liveEvm){
  // Trusted Engineer credential port validates the Rust revocation receipt.
  await engineerPort.revokeRoot(root.credential_id);
 }else{
  const revoked=JSON.parse(await binding.revoke_engineer_root(
   tokens.engineer,JSON.stringify({credential_id:root.credential_id,status_set:true})));
  assert.equal(revoked.credential_id,root.credential_id);
  assert.equal(revoked.status_set,true);
  assert.equal(revoked.status_purpose,"revocation");
 }
 const observedRevocation=await invokeSocket(tokens.gateway,
  "read_credential_status",{credential_id:root.credential_id});
 assert.equal(observedRevocation.ok,true);
 assert.equal(observedRevocation.result.status_set,true);
 assert.equal(observedRevocation.result.status_purpose,"revocation");
 assert.equal(observedRevocation.result.source,
  liveEvm?"evm_anchored_signed_jwt":"adapter_memory_only");
 if(liveEvm){
  assert.ok(Number.isSafeInteger(observedRevocation.result.anchor_version));
  const rootObservedRevoked=await rootReader.readRevokedRoot(root.credential_id);
  assert.equal(rootObservedRevoked.root_credential_id,root.credential_id);
  assert.equal(rootObservedRevoked.execution_authorized,false);
  await assert.rejects(()=>rootReader.readActiveRoot(root.credential_id),
   /Native Rust root status NO-GO/u);
  await assert.rejects(()=>verifier.verify({
   presenter:"backend",audience:"cloud-access-gateway",challenge,
   required_permission:permission,signed_vp:proof.result.signed_vp
  }),/Rust Core rejected|VerificationRejected|rejected/u);
 }

 await assert.rejects(()=>binding.issue_engineer_root(
  tokens.backend,JSON.stringify({...root,credential_id:"urn:r225:wrong-role",
   credential_status:status(1918)})),/Native Engineer Core operation denied/u);

 process.stdout.write(JSON.stringify({
  event:"r225_direct_engineer_single_rust_owner",
  root_direct:true,child_native:true,signed_vp:true,root_socket_denied:true,
  root_revoked:true,cross_role_denied:true,no_http_adapter:true,
  same_issuer_gateway_inspected:true,gateway_status_revocation:true,
  unauthorized_inspector_denied:true,
  mode:liveEvm?"live-evm":"in-memory",
  evm_anchored_status:liveEvm,
  independent_native_gateway_verification:liveEvm,
  native_gateway_issued_root_reader:liveEvm,
  native_gateway_live_revocation_reader:liveEvm,
  production_engineer_core_selector:liveEvm
 })+"\n");
}finally{
 // The private Rust runtime belongs to this Node process, not to an HTTP
 // Adapter service. On exit the socket is destroyed by the Rust Drop impl.
 rmSync(folder,{recursive:true,force:true});
}
