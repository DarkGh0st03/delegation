import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {agentDid,createSpecializedAgentCard}
 from "../src/cards.ts";
import {startSpecializedAgentServer}
 from "../src/server.ts";

const roles=["backend","frontend","test"] as const;
const did=(i:number)=>"did:ethr:0x7a69:0x"+i.toString(16).padStart(40,"0");
function nativeEnvironment(t:import("node:test").TestContext){
 const keys=["APPROVED_RUNNER_NATIVE_MCP",
  "DELEGATION_GATEWAY_ARCHITECTURE","ADAPTER_TRUST_PROFILE",
  ...roles.map(r=>"ADAPTER_ID_"+r.toUpperCase())];
 const previous=new Map(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{
  for(const [k,v] of previous)
   if(v===undefined)delete process.env[k];
   else process.env[k]=v;
 });
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.ADAPTER_TRUST_PROFILE="evm";
 roles.forEach((r,i)=>process.env["ADAPTER_ID_"+r.toUpperCase()]=did(i+2));
}
function cardDid(role:typeof roles[number],override:string){
 const card=createSpecializedAgentCard(role,"http://127.0.0.1:1",{
  delegatedAuthorization:true,capabilityProfile:"approved-plan",
  nativeSignerDid:override
 });
 const extension=card.capabilities.extensions?.[0];
 assert.ok(extension,"delegation evidence extension required");
 return (extension.params as {agentDid?:unknown}).agentDid;
}
function signing(){
 const keys=generateKeyPairSync("ed25519");
 return {
  signingPrivateKeyPem:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
  signingPublicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString()
 };
}
test("R382.3 real Rust/ethr DID is published for each canonical agent role",t=>{
 nativeEnvironment(t);
 roles.forEach((role,i)=>{
  const native=did(i+2);
  assert.equal(cardDid(role,native),native);
  assert.notEqual(native,agentDid(role),"legacy demonstration DID must not be used");
 });
});
test("R382.3 foreign or malformed native signer DID cannot impersonate a trusted card",t=>{
 nativeEnvironment(t);
 assert.throws(()=>cardDid("backend",did(3)),
  /Trusted native A2A Agent Card signer DID mismatch/u);
 assert.throws(()=>cardDid("backend","did:thesis:backend-agent"),
  /Trusted native A2A Agent Card signer DID mismatch/u);
 assert.throws(()=>cardDid("backend","did:ethr:wrong DID"),
  /Trusted native A2A Agent Card signer DID mismatch/u);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="legacy-signed-dag";
 assert.throws(()=>cardDid("backend",did(2)),
  /Trusted native A2A Agent Card signer DID mismatch/u);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="0";
 assert.throws(()=>cardDid("backend",did(2)),
  /Trusted native A2A Agent Card signer DID mismatch/u);
});
test("R382.3 native MCP A2A server rejects missing native Card DID before listening",async t=>{
 nativeEnvironment(t);
 const base={role:"backend" as const,port:0,host:"127.0.0.1",
  mcpTaskSigning:signing(),
  adk:{model:{} as never,gatewayBaseUrl:"http://127.0.0.1:1",
   adapterToken:"ROLE_PRIVATE",
   nativePresentationTransport:"mcp-stdio" as const}};
 await assert.rejects(startSpecializedAgentServer(base),
  /private_native_mcp_requires_signer_did/u);
 await assert.rejects(startSpecializedAgentServer({...base,
  nativeSignerDid:did(3)}),
  /Trusted native A2A Agent Card signer DID mismatch/u);
 await assert.rejects(startSpecializedAgentServer({...base,
  nativeSignerDid:did(2),mcpTaskSigning:undefined}),
  /original ADK Task host/u);
});
