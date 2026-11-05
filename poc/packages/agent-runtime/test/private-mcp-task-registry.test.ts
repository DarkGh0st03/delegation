import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {issueTaskToken} from "../../../mcp-shared/src/task-token.ts";

function keys(){
 const kp=generateKeyPairSync("ed25519");
 return {priv:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  pub:kp.publicKey.export({format:"pem",type:"spki"}).toString()};
}

test("R190 private registry contains no repository or Runner invoker",()=>{
 const k=keys(),reg=new PrivateMcpTaskRegistry({
  role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 assert.equal("invoke" in reg,false);
 assert.equal(typeof reg.invokeCrypto,"function");
 assert.equal(typeof reg.takeSignedPresentation,"function");
});

test("R190 forged role/task bearer cannot trigger crypto signing",async()=>{
 const k=keys(),attacker=keys(),reg=new PrivateMcpTaskRegistry({
  role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 let signingCalls=0;
 reg.begin("signed-1",{invoke:async()=>{throw Error("Gateway should not run");}},
  undefined,{evidenceHandler:{
   credentialId:"urn:trusted:backend",presenterId:"did:thesis:backend",
   async createPresentation(){signingCalls++;return "private.jwt";}
  }});
 const prepared={
  request_id:"req-1",audience:"cloud-access-gateway",
  challenge:"trusted-gateway-nonce",
  expires_at:new Date(Date.now()+60000).toISOString(),
  required_permission:{resource:"gitea://gitea.local/thesis/example/branches/main/files/app.ts",
   operation:"read_file"}
 };
 reg.stageGatewayChallenge("signed-1",prepared);
 const args={tool:"delegation_create_presentation",
  arguments:{request_id:"req-1"}};
 await assert.rejects(reg.invokeCrypto(
  "Bearer "+issueTaskToken(attacker.priv,"frontend","signed-1"),args),
  /unauthorized/);
 await assert.rejects(reg.invokeCrypto(
  "Bearer "+issueTaskToken(k.priv,"backend","signed-2"),args),
  /inactive_task/);
 await assert.rejects(reg.invokeCrypto("Bearer "+reg.bearerFor("signed-1"),{
  ...args,credential_id:"attacker"
 }),/invalid_tool_call/);
 assert.equal(signingCalls,0);
 reg.end("signed-1");
 await assert.rejects(reg.invokeCrypto("Bearer "+issueTaskToken(
  k.priv,"backend","signed-1"),args),/inactive_task/);
});

test("R190 cancelled Task cannot retain authority to retrieve a VP",async()=>{
 const k=keys(),controller=new AbortController();
 const reg=new PrivateMcpTaskRegistry({
  role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 reg.begin("cancellable",{invoke:async()=>({})},controller.signal,{
  evidenceHandler:{credentialId:"urn:dc:backend",
   presenterId:"did:thesis:backend",async createPresentation(){return "private.jwt";}}
 });
 const token="Bearer "+reg.bearerFor("cancellable");
 controller.abort();
 await assert.rejects(reg.invokeCrypto(token,{
  tool:"delegation_create_presentation",arguments:{request_id:"req-X"}
 }),/inactive_task/);
 assert.throws(()=>reg.bearerFor("cancellable"),/inactive_task/);
});

test("crypto challenge concurrency budget permits 12 sequential proofs but never replays",async()=>{
 const k=keys(),reg=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 let signatures=0;
 reg.begin("bounded-crypto",{invoke:async()=>({})},undefined,{
   evidenceHandler:{
     credentialId:"urn:scoped:backend",presenterId:"did:thesis:backend",
     async createPresentation(input){
       signatures++;
       return "test-signed-vp-"+input.request_id;
     }
   }
 });
 const auth="Bearer "+reg.bearerFor("bounded-crypto");
 const prepared=(id:string)=>({
   request_id:id,audience:"cloud-access-gateway",
   challenge:"distinct-nonce-for-"+id,
   expires_at:new Date(Date.now()+60_000).toISOString(),
   required_permission:{
     operation:"read_file",
     resource:"gitea://gitea.local/thesis/example/branches/feature%2Finvoice-sort/files/src/invoice.ts"
   }
 });
 const sign=async(id:string)=>{
   const outcome=await reg.invokeCrypto(auth,{
     tool:"delegation_create_presentation",arguments:{request_id:id}
   }) as {proof_ref:string;request_id:string};
   assert.equal(outcome.request_id,id);
   assert.equal(reg.takeSignedPresentation("bounded-crypto",outcome.proof_ref),
     "test-signed-vp-"+id);
   await assert.rejects(reg.invokeCrypto(auth,{
     tool:"delegation_create_presentation",arguments:{request_id:id}
   }),/invalid_tool_call/);
   assert.throws(()=>reg.stageGatewayChallenge("bounded-crypto",prepared(id)),
     /invalid_tool_call/);
 };
 try{
   for(let i=0;i<12;i++){
     const id="req_sequential_"+i;
     reg.stageGatewayChallenge("bounded-crypto",prepared(id));
     await sign(id);
   }
   assert.equal(signatures,12);
   for(let i=0;i<8;i++)
     reg.stageGatewayChallenge("bounded-crypto",prepared("req_parallel_"+i));
   assert.throws(()=>reg.stageGatewayChallenge("bounded-crypto",
     prepared("req_over_limit")),
     /invalid_tool_call/);
   await sign("req_parallel_0");
   reg.stageGatewayChallenge("bounded-crypto",prepared("req_over_limit"));
   await sign("req_over_limit");
   for(let i=1;i<8;i++)await sign("req_parallel_"+i);
   assert.equal(signatures,21);
   reg.end("bounded-crypto");
   await assert.rejects(reg.invokeCrypto(auth,{
     tool:"delegation_create_presentation",
     arguments:{request_id:"req_sequential_1"}
   }),/inactive_task/);
 }finally{reg.end("bounded-crypto");}
});


test("R329.2 native owner 20-minute Gateway challenge is signed exactly once (no token or VP exposed to model)",async()=>{
 const k=keys(),reg=new PrivateMcpTaskRegistry({
  role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const requestId="req_12345678-1234-4123-8123-1234567890ab";
 let actualSigns=0;
 const evidenceHandler={
  credentialId:"urn:trusted:r329:child",
  presenterId:"did:thesis:backend",
  async createPresentation(input:{request_id:string}){
   assert.equal(input.request_id,requestId);
   actualSigns++;
   return "PRIVATE_R329_TEST_NATIVE_SIGNED_VP";
  }
 };
 reg.begin("r329-native-crypto",{async invoke(){throw Error("No Gateway calls");}},
  undefined,{evidenceHandler});
 try{
  const prepared={
   request_id:requestId,
   audience:"cloud-access-gateway",
   challenge:"r329-20minute-native-gateway-challenge",
   expires_at:new Date(Date.now()+1_200_000).toISOString(),
   required_permission:{
    resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/users/account.ts",
    operation:"update_file"
   }
  };
  assert.doesNotThrow(()=>reg.stageGatewayChallenge("r329-native-crypto",prepared));
  const auth="Bearer "+reg.bearerFor("r329-native-crypto");
  const proof=await reg.invokeCrypto(auth,{
   tool:"delegation_create_presentation",arguments:{request_id:requestId}
  }) as {request_id:string;proof_ref:string;prepared:boolean};
  assert.equal(proof.request_id,requestId);
  assert.equal(proof.prepared,true);
  assert.equal(actualSigns,1);
  assert.equal(reg.takeSignedPresentation("r329-native-crypto",proof.proof_ref),
   "PRIVATE_R329_TEST_NATIVE_SIGNED_VP");
  await assert.rejects(reg.invokeCrypto(auth,{
   tool:"delegation_create_presentation",arguments:{request_id:requestId}
  }),/invalid_tool_call/u);
  assert.equal(actualSigns,1);
  assert.throws(()=>reg.stageGatewayChallenge("r329-native-crypto",{
   ...prepared,request_id:"req_far_future",
   expires_at:new Date(Date.now()+1_200_001+20_000).toISOString()
  }),/invalid_tool_call/u);
  assert.throws(()=>reg.stageGatewayChallenge("r329-native-crypto",{
   ...prepared,request_id:"req_expired",
   expires_at:new Date(Date.now()-1_000).toISOString()
  }),/invalid_tool_call/u);
 }finally{reg.end("r329-native-crypto");}
});
