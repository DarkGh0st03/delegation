import assert from "node:assert/strict";

const adapter="http://127.0.0.1:8090";
const gateway="http://127.0.0.1:8080";
const engineer=process.env.ADAPTER_CALLER_ENGINEER;
const orchestrator=process.env.ADAPTER_CALLER_ORCHESTRATOR;
for(const [name,v] of Object.entries({engineer,orchestrator})){
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
  gemini_api_calls:0
},null,2)+"\n");
