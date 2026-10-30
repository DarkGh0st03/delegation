import assert from "node:assert/strict";
import {test} from "node:test";
import {TrustedOrchestratorRootPresenter} from
 "../src/trusted-orchestrator-root-presenter.ts";

const id="urn:r129:operational-root";
const grant={resource:"gitea://gitea.local/sample/invoice-service",
 operation:"read_file" as const};
const challenge="f".repeat(64),audience="urn:thesis:gateway:r129";
function setup(response?:{status?:number;body?:unknown}){
 let calls=0;
 const signer=new TrustedOrchestratorRootPresenter({
  adapterBaseUrl:"http://adapter.internal:8090",
  orchestratorToken:"private-orchestrator-token",
  rootCredentialId:id,rootPermissions:[grant],
  fetchFn:(async (url:unknown,init?:RequestInit)=>{
   calls++;
   assert.equal(String(url),"http://adapter.internal:8090/v1/presentations");
   assert.equal(init?.method,"POST");
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer private-orchestrator-token");
   const request=JSON.parse(String(init?.body));
   assert.deepEqual(request,{
    credential_id:id,disclosed_permissions:[grant],audience,challenge
   });
   return new Response(JSON.stringify(
    response?.body??{signed_vp:"signed-root-vp:crypto-evidence"}
   ),{status:response?.status??200});
  }) as typeof fetch
 });
 return {signer,get calls(){return calls;}};
}
test("R129.3 owner-only signer calls real Adapter presentation endpoint without exposing its bearer",async()=>{
 const f=setup();
 const vp=await f.signer.present({
  credential_id:id,disclosed_permissions:[grant],audience,challenge
 });
 assert.equal(vp,"signed-root-vp:crypto-evidence");
 assert.equal(f.calls,1);
});
test("R129.3 signer rejects model-selected root, missing nonce or out-of-root grants before network",async()=>{
 const f=setup();
 for(const modified of [
  {credential_id:"urn:outside"},
  {challenge:"model-selected-challenge"},
  {disclosed_permissions:[]},
  {disclosed_permissions:[grant,grant]},
  {disclosed_permissions:[{...grant,operation:"create_pull_request"}]}
 ]){
  await assert.rejects(f.signer.present({
   credential_id:id,disclosed_permissions:[grant],audience,challenge,
   ...modified
  }),/Trusted root presenter NO-GO/);
 }
 assert.equal(f.calls,0);
});
test("R129.3 native signer fails closed on unauthorized or malformed Adapter response",async()=>{
 for(const r of [
  {status:403,body:{error:"not orchestrator"}},
  {body:{signed_vp:""}},
  {body:{signed_vp:"signed",unexpected:true}},
  {body:{not_signed:"oops"}}
 ]){
  const f=setup(r);
  await assert.rejects(f.signer.present({
   credential_id:id,disclosed_permissions:[grant],audience,challenge
  }),/Trusted root presenter NO-GO/);
  assert.equal(f.calls,1);
 }
});
