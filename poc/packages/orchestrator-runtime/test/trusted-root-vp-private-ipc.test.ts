import assert from "node:assert/strict";
import {test} from "node:test";
import {request as httpRequest} from "node:http";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {Permission,VerifierPort,VerifiedDelegation} from
 "../../../apps/gateway/src/types.ts";
import {TrustedGatewayRootVpVerifier} from
 "../../../apps/gateway/src/trusted-root-vp-verification.ts";
import {TrustedOrchestratorRootPresenter} from
 "../src/trusted-orchestrator-root-presenter.ts";
import {createTrustedRootVpSignerServer,TrustedRootVpSocketClient} from
 "../src/trusted-root-vp-private-ipc.ts";

const credential="urn:credential:r130-verified-root",
 engineer="did:thesis:engineer",orchestrator="did:thesis:orchestrator",
 audience="urn:thesis:gateway:root-r130";
const perm:Permission={
 resource:"gitea://gitea.local/sample/invoice-service",
 operation:"read_file"
};
async function setup(t:import("node:test").TestContext,options:{
 liveRoot?:boolean;deferredSigner?:boolean;
}={}){
 let phase:"execution"|"closed"="execution";
 let resume:undefined|(()=>void);
 let entered:undefined|(()=>void);
 const signerEntered=new Promise<void>(resolve=>{entered=resolve;});
 const releaseSigner=()=>resume?.();
 const home=await mkdtemp(join(tmpdir(),"r130-private-"));
 const privateDir=join(home,"private");
 await mkdir(privateDir,{mode:0o700});
 const socketPath=join(privateDir,"root-vp.sock"),
  secretFile=join(privateDir,"root-vp.hex"),
  wrongSecret=join(privateDir,"wrong.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 await writeFile(wrongSecret,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const called:{challenge:string;permissions:Permission[]}[]=[];
 const presenter=new TrustedOrchestratorRootPresenter({
  adapterBaseUrl:"http://adapter.internal:8090",
  orchestratorToken:"private-only-orchestrator-bearer",
  rootCredentialId:credential,rootPermissions:[perm],
  fetchFn:(async(url:unknown,init?:RequestInit)=>{
   assert.equal(String(url),"http://adapter.internal:8090/v1/presentations");
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer private-only-orchestrator-bearer");
   const body=JSON.parse(String(init?.body));
   assert.equal(body.credential_id,credential);
   assert.equal(body.audience,audience);
   assert.deepEqual(body.disclosed_permissions,[perm]);
   assert.match(body.challenge,/^[a-f0-9]{64}$/);
   called.push({challenge:body.challenge,permissions:body.disclosed_permissions});
   if(options.deferredSigner){
    entered?.();
    await new Promise<void>(resolve=>{resume=resolve;});
   }
   return new Response(JSON.stringify({
    signed_vp:"signed-root-vp:"+body.challenge
   }),{status:200,headers:{"content-type":"application/json"}});
  }) as typeof fetch
 });
 const server=await createTrustedRootVpSignerServer({
  socketPath,secretFile,presenter,
  rootCredentialId:credential,rootPermissions:[perm],audience,
  liveRoot:{
   coordinator:{
    get phase(){return phase;},
    trustedOperationalAuthority(){
     if(phase!=="execution")throw Error("root closed");
     return {credential_id:credential,plan_digest:"a".repeat(64),
      permissions:[perm]};
    }
   },
   originalPlanDigest:"a".repeat(64),
   ownerRunActive:()=>phase==="execution"
  }
 });
 await server.start();
 t.after(async()=>{
  await server.close();
  await rm(home,{recursive:true,force:true});
 });
 const client=await TrustedRootVpSocketClient.connect({socketPath,secretFile});
 const input=(challenge:string)=>({
  credential_id:credential,audience,
  challenge,disclosed_permissions:[perm]
 });
 return {client,input,called,socketPath,secretFile,wrongSecret,server,
  signerEntered,releaseSigner,closeRoot(){phase="closed";}};
}
test("R130 IPC: Gateway nonce -> private Orchestrator bearer -> Rust VP verification, no epoch authority",async t=>{
 const f=await setup(t);
 const seen:string[]=[];
 const verifier:VerifierPort={
  async verify(){throw Error("single-grant verification must not be used");},
  async verifyMultiple(request){
   assert.equal(request.presenter,"orchestrator");
   assert.equal(request.audience,audience);
   assert.deepEqual(request.required_permissions,[perm]);
   assert.equal(request.signed_vp,"signed-root-vp:"+request.challenge);
   seen.push(request.challenge);
   const result:VerifiedDelegation={
    credential_id:credential,issuer_id:engineer,presenter_id:orchestrator,
    hierarchy_depth:0,permissions:[perm],
    expiration:(BigInt(Date.now())*1_000_000n+30_000_000_000n).toString()
   };
   return result;
  }
 };
 const proof=new TrustedGatewayRootVpVerifier({
  verifier,signer:f.client,audience
 });
 const options={credential_id:credential,engineer_did:engineer,
  orchestrator_did:orchestrator,required_permissions:[perm]};
 for(let i=0;i<2;i++){
  const result=await proof.verifyRoot(options);
  assert.equal(result.cryptographic_presentation_verified,true);
  assert.equal(result.gateway_epoch_admitted,false);
  assert.equal(result.child_credential_issued,false);
  assert.equal(result.execution_authorized,false);
 }
 assert.equal(new Set(seen).size,2,"Gateway nonces must never repeat");
 assert.deepEqual(f.called.map(x=>x.challenge),seen);
 assert.equal(JSON.stringify(f.called).includes("private-only-orchestrator-bearer"),false);
});
test("R130 signing server denies root escalation, audience changes and reused signed challenge",async t=>{
 const f=await setup(t),nonce="a".repeat(64);
 const signed=await f.client.present(f.input(nonce));
 assert.equal(signed,"signed-root-vp:"+nonce);
 for(const data of [
  f.input(nonce),
  {...f.input("b".repeat(64)),credential_id:"urn:credential:forged"},
  {...f.input("c".repeat(64)),audience:"urn:thesis:gateway:other"},
  {...f.input("d".repeat(64)),disclosed_permissions:[{
   resource:perm.resource,operation:"create_pull_request" as const
  }]}
 ]){
  await assert.rejects(f.client.present(data),/Private root VP signing denied/);
 }
 assert.equal(f.called.length,1,"Only first authorized challenge signs");
});
test("R130 socket denies missing HMAC and an independently wrong secret",async t=>{
 const f=await setup(t);
 const response=await new Promise<number>((resolve,reject)=>{
  const req=httpRequest({
   socketPath:f.socketPath,method:"POST",
   path:"/v1/private-root-vp",headers:{"content-type":"application/json"}
  },res=>{res.resume();res.on("end",()=>resolve(res.statusCode??0));});
  req.on("error",reject);
  req.end(JSON.stringify(f.input("e".repeat(64))));
 });
 assert.equal(response,403);
 const bad=await TrustedRootVpSocketClient.connect({
  socketPath:f.socketPath,secretFile:f.wrongSecret
 });
 await assert.rejects(bad.present(f.input("f".repeat(64))),
  /Private root VP signing denied/);
 assert.equal(f.called.length,0);
});
test("R130 owner-only server does not replace existing Unix listener",async t=>{
 const f=await setup(t);
 await assert.rejects(f.server.start(),/already started/);
 assert.equal(f.called.length,0);
});

test("R131 active signed Coordinator root permits nonce-bound VP and rejects revoked root",async t=>{
 const f=await setup(t,{liveRoot:true});
 assert.equal(await f.client.present(f.input("1".repeat(64))),
  "signed-root-vp:"+("1".repeat(64)));
 f.closeRoot();
 await assert.rejects(f.client.present(f.input("2".repeat(64))),
  /Private root VP signing denied/);
 assert.equal(f.called.length,1,"closed root cannot reach Rust Adapter");
});
test("R131 independent owner shutdown fence stops signing before Rust revocation",async t=>{
 const f=await setup(t,{liveRoot:true});
 f.server.fence();
 await assert.rejects(f.client.present(f.input("3".repeat(64))),
  /Private root VP signing denied/);
 assert.equal(f.called.length,0);
});
test("R131 revocation DURING native signing cannot return stale signed VP",async t=>{
 const f=await setup(t,{liveRoot:true,deferredSigner:true});
 const promise=f.client.present(f.input("4".repeat(64)));
 await f.signerEntered;
 f.closeRoot();
 f.releaseSigner();
 await assert.rejects(promise,/Private root VP signing denied/);
 assert.equal(f.called.length,1);
 await assert.rejects(f.client.present(f.input("5".repeat(64))),
  /Private root VP signing denied/);
});
