import assert from "node:assert/strict";
import {TrustedGatewayNativeRootStatusReader}
 from "../src/trusted-gateway-native-root-status.ts";

const adapter="http://127.0.0.1:8090";
const gateway="http://127.0.0.1:8080";
const engineer=process.env.ADAPTER_CALLER_ENGINEER;
const orchestrator=process.env.ADAPTER_CALLER_ORCHESTRATOR;
const gatewayCaller=process.env.ADAPTER_CALLER_GATEWAY;
for(const [name,v] of Object.entries({engineer,orchestrator,gatewayCaller})){
  if(!v)throw new Error("Missing trusted E2E caller: "+name);
}
const rootId="urn:core-rust-native:readonly-e2e-root";
const operation={
  resource:"gitea://gitea.local/thesis/iam-console-poc",
  operation:"create_branch"
};

async function post(base,path,body,secret){
  const res=await fetch(base+path,{
    method:"POST",
    headers:{
      "content-type":"application/json",
      ...(secret?{authorization:"Bearer "+secret}:{})
    },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(90_000)
  });
  const text=await res.text();
  let json;try{json=JSON.parse(text);}catch{throw new Error("Invalid JSON response at "+path);}
  return {status:res.status,body:json};
}
async function wait(base,label){
  for(let attempt=0;attempt<100;attempt++){
    try{
      const res=await fetch(base+"/health",{signal:AbortSignal.timeout(2_000)});
      if(res.ok)return await res.json();
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(label+" never became ready");
}
async function prepare(){
  const res=await post(gateway,"/v1/authorization/prepare",{
    task_id:"native-e2e-bootstrap",
    agent_role:"orchestrator",
    tool:"create_branch",
    arguments:{base_branch:"main",branch:"feature/account-suspension"}
  });
  assert.equal(res.status,201,JSON.stringify(res.body));
  assert.deepEqual(res.body.required_permission,operation);
  return res.body;
}
async function presentation(challenge,audience="cloud-access-gateway"){
  const res=await post(adapter,"/v1/presentations",{
    credential_id:rootId,
    disclosed_permissions:[operation],
    audience,
    challenge
  },orchestrator);
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(typeof res.body.signed_vp,"string");
  return res.body.signed_vp;
}
async function execute(prepared,signed_vp){
  return post(gateway,"/v1/authorization/execute",{
    request_id:prepared.request_id,signed_vp
  });
}

const adapterHealth=await wait(adapter,"Rust Adapter");
assert.equal(adapterHealth.trust_profile,"evm");
const gatewayHealth=await wait(gateway,"Native Gateway");
assert.equal(gatewayHealth.provider,"mock");

const root=await post(adapter,"/v1/credentials/root",{
  credential_id:rootId,
  delegatee:"orchestrator",
  valid_from:new Date(Date.now()-1000).toISOString(),
  validity_seconds:3600,
  credential_status:{
    type:"BitstringStatusListEntry",
    statusPurpose:"revocation",
    statusListIndex:"14200",
    statusListCredential:"https://status.example/lists/native-core-e2e-root"
  },
  permissions:[operation]
},engineer);
assert.equal(root.status,201,JSON.stringify(root.body));
assert.equal(root.body.id,rootId);

// R144 real Adapter/EVM status: the same Gateway-only class exercised by
// R142 tests, not an equivalent mock JSON validator. This status reader
// receives the private GATEWAY caller token, never the Engineer bearer.
const rootStatus=new TrustedGatewayNativeRootStatusReader({
  baseUrl:adapter,gatewayToken:gatewayCaller,timeoutMs:5000
});
const active=await rootStatus.readActiveRoot(rootId);
assert.equal(active.root_credential_id,rootId);
assert.equal(active.native_source,"evm_anchored_signed_jwt");
assert.equal(active.execution_authorized,false);
await assert.rejects(
  rootStatus.readRevokedRoot(rootId),
  /Native Rust root status NO-GO/,
  "A genuine nonrevoked EVM root MUST NOT count as retired");
const issuedRoot=await rootStatus.readIssuedRoot(rootId);
assert.equal(issuedRoot.credential_id,rootId);
assert.equal(issuedRoot.execution_authorized,false);
assert.deepEqual(issuedRoot.permissions,[operation]);
assert.equal(issuedRoot.anchor_version,active.anchor_version);

// Real Anvil + issuer-backed material + signed JWT VP + native Rust Core +
 // independently evaluated OPA + non-mutating Gateway mock provider.
const allowed=await prepare();
const signed=await presentation(allowed.challenge,allowed.audience);
const result=await execute(allowed,signed);
assert.equal(result.status,200,JSON.stringify(result.body));
assert.equal(result.body.execution.provider,"mock");
assert.equal(result.body.execution.tool,"create_branch");
assert.equal(result.body.execution.performed,false);

const replay=await execute(allowed,signed);
assert.equal(replay.status,409,JSON.stringify(replay.body));
assert.equal(replay.body.error,"replay_detected");

// A correctly signed VP with a different challenge must not be valid for
// a new Gateway request, even with the same issuer, holder and operation.
const preparedBad=await prepare();
const staleNonceVp=await presentation("wrong-"+preparedBad.challenge,preparedBad.audience);
const wrongChallenge=await execute(preparedBad,staleNonceVp);
assert.equal(wrongChallenge.status,403,JSON.stringify(wrongChallenge.body));
assert.equal(wrongChallenge.body.error,"verification_rejected");

// After creating a valid VP, revoke the actual root credential on-chain.
// The EVM Adapter publishes the newest status JWT to the shared directory;
// the native verifier cannot accept the earlier signed presentation.
const preparedRevoked=await prepare();
const beforeRevocation=await presentation(preparedRevoked.challenge);
const revocation=await post(adapter,"/v1/credentials/status",{
  credential_id:rootId,status_set:true
},engineer);
assert.equal(revocation.status,200,JSON.stringify(revocation.body));
assert.equal(revocation.body.status_set,true);
// R144: read REAL signed EVM-anchored status through the exact R142 Gateway
// code path, after the actual Rust-issued root was revoked by Engineer.
const revoked=await rootStatus.readRevokedRoot(rootId);
assert.equal(revoked.root_credential_id,rootId);
assert.equal(revoked.status,
  "native_adapter_original_root_revoked_evm_anchored");
assert.equal(revoked.native_source,"evm_anchored_signed_jwt");
assert.equal(revoked.execution_authorized,false);
assert.ok(revoked.anchor_version>=active.anchor_version);
await assert.rejects(rootStatus.readActiveRoot(rootId),
  /Native Rust root status NO-GO/,
  "An EVM-revoked root may not regain nonrevoked status");
await assert.rejects(rootStatus.readIssuedRoot(rootId),
  /Native Rust root status NO-GO/,
  "A revoked root cannot be seen as valid issued scope");
await assert.rejects(rootStatus.readRevokedRoot("urn:r144:nonexistent-root"),
  /Native Rust root status NO-GO/,
  "Unissued credential ID may not impersonate EVM revocation");
const denied=await execute(preparedRevoked,beforeRevocation);
assert.equal(denied.status,403,JSON.stringify(denied.body));
assert.equal(denied.body.error,"verification_rejected");

process.stdout.write(JSON.stringify({
  result:"native-core-rust-evm-e2e-pass",
  trust_profile:"evm",native_verifier:true,
  signed_vp_accepted:true,
  opa_accepted:true,
  provider_calls_to_real_gitea:0,
  replay_denied:true,
  wrong_challenge_denied:true,
  revoked_credential_denied:true,
  r144_gateway_reader_real_adapter_evm_root_active_verified:true,
  r144_gateway_reader_real_adapter_evm_root_revoked_verified:true,
  r144_gateway_reader_real_issued_root_scope_verified:true,
  original_root_issuer_credential_id:rootId,
  accepted_EVM_anchor_version:revoked.anchor_version,
  r144_gateway_session_retired_in_this_test:false,
  r144_real_docker_repair_in_this_test:false,
  gemini_api_calls:0
},null,2)+"\n");
