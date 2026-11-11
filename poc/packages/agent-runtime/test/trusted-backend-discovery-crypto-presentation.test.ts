import assert from "node:assert/strict";
import {test} from "node:test";
import {randomBytes} from "node:crypto";
import {TrustedBackendDiscoveryChildPresenter} from
 "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryCryptoPresentation} from
 "../src/trusted-backend-discovery-crypto-presentation.ts";
import {GatewayControlledToolClient} from
 "../src/gateway-tool-client.ts";
import {DelegationEvidenceHandler} from
 "../src/delegation-evidence-handler.ts";

const credential="urn:child:r151-remote-discovery";
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const audience="cloud-access-gateway";
const branch="feature/invoice-approval";
const path="src/invoices.ts";
const grant={resource,operation:"read_file"};
const prepared=(challenge=randomBytes(32).toString("base64url"))=>({
 request_id:"req-r15135",audience,challenge,
 expires_at:new Date(Date.now()+30000).toISOString(),
 required_permission:grant
});
function setup(config:{defer?:boolean}={}){
 let active=true,issued=0,enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(ok=>{enter=ok;});
 const held=new Promise<void>(ok=>{release=ok;});
 const holder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090/",
  backendToken:"private-backend-only-secret",
  childCredentialId:credential,resource,audience,
  isTaskActive:()=>active,
  fetchFn:(async (_url:unknown,request?:RequestInit)=>{
   issued++;
   assert.equal(new Headers(request?.headers).get("authorization"),
    "Bearer private-backend-only-secret");
   const p=JSON.parse(String(request?.body));
   assert.equal(p.credential_id,credential);
   assert.deepEqual(p.disclosed_permissions,[grant]);
   assert.equal(p.audience,audience);
   assert.equal(Buffer.from(p.challenge,"base64url").length,32);
   if(config.defer){enter();await held;}
   return new Response(JSON.stringify({
    signed_vp:"native-backend-child:"+p.challenge
   }));
  }) as typeof fetch
 });
 const port=new TrustedBackendDiscoveryCryptoPresentation({
  holder,childCredentialId:credential,resource,audience,
  isTaskActive:()=>active
 });
 return {port,holder,get issued(){return issued;},close(){active=false;},
  entered,release};
}

test("R151.35 trusted Backend signs exact Gateway Prepare, never exposes Adapter bearer to model",async()=>{
 const fixture=setup();
 const challenge=randomBytes(32).toString("base64url");
 let executed=0;
 const evidenceHandler=new DelegationEvidenceHandler({
  adapterBaseUrl:"http://unused",adapterToken:"unused",
  evidence:{credential:"private",credential_id:credential,
   presenter_id:"did:example:backend"},
  fetchFn:(async()=>{throw Error("fallback signer must not run");}) as typeof fetch
 });
 const client=new GatewayControlledToolClient({
  gatewayBaseUrl:"http://gateway.internal",agentRole:"backend",
  taskId:"trusted-r151-discovery-runtime",evidenceHandler,
  cryptoPresentation:fixture.port,
  approvedDiagnosticReadPaths:[path],
  fetchFn:(async (url:unknown,opts?:RequestInit)=>{
   const p=JSON.parse(String(opts?.body));
   if(String(url).endsWith("/prepare")){
    assert.deepEqual(p,{task_id:"trusted-r151-discovery-runtime",
     agent_role:"backend",tool:"read_file",
     arguments:{branch,path}});
    return new Response(JSON.stringify(prepared(challenge)),{status:201});
   }
   executed++;
   assert.equal(p.request_id,"req-r15135");
   assert.equal(p.signed_vp,"native-backend-child:"+challenge);
   assert.equal(JSON.stringify(p).includes("private-backend-only-secret"),false);
   return new Response(JSON.stringify({decision:"allow",execution:{
    provider:"gitea",performed:true,tool:"read_file",
    branch,path,revision:"a".repeat(40),
    content:"export function invoice(){return 42;}"
   }}));
  }) as typeof fetch
 });
 const result=await client.invoke("read_file",{branch,path}) as Record<string,unknown>;
 assert.equal(result.tool,"read_file");
 assert.equal(String(result.content).includes("invoice"),true);
 assert.equal(fixture.issued,1);
 assert.equal(executed,1);
 assert.equal(JSON.stringify(result).includes("private-backend-only-secret"),false);
 await assert.rejects(fixture.port.createSignedPresentation(prepared(challenge)),
  /replayed Gateway request/);
 assert.equal(fixture.issued,1);
});

test("R151.35 foreign grant, write operation, audience or challenge never reaches native Adapter",async()=>{
 const f=setup();
 const proof=prepared();
 for(const invalid of [
  {...proof,required_permission:{...grant,resource:resource+"-foreign"}},
  {...proof,required_permission:{...grant,operation:"update_file"}},
  {...proof,audience:"another-gateway"},
  {...proof,challenge:"short"},
  {...proof,challenge:proof.challenge+"="},
  {...proof,expires_at:new Date(Date.now()-1000).toISOString()},
  {...proof,expires_at:new Date(Date.now()+200000).toISOString()},
  {...proof,request_id:""},
  {...proof,extra:"untrusted"}
 ]){
  await assert.rejects(
   f.port.createSignedPresentation(invalid),
   /Trusted Backend discovery crypto NO-GO/);
 }
 assert.equal(f.issued,0);
});

test("R151.35 one-use signing, cancellation mid-sign and exact bounded budget",async()=>{
 const f=setup({defer:true});
 const start=f.port.createSignedPresentation(prepared());
 await f.entered;
 await assert.rejects(f.port.createSignedPresentation({
  ...prepared(),request_id:"another-request"
 }),/concurrent challenge/);
 f.close();f.release();
 await assert.rejects(start,/closed or cancelled/);
 await assert.rejects(f.port.createSignedPresentation({
  ...prepared(),request_id:"third-request"
 }),/closed or cancelled/);
 assert.equal(f.issued,1);
});

test("R151.35 non-Backend MCP operations cannot make discovery holder sign",async()=>{
 const f=setup();
 const e=new DelegationEvidenceHandler({
  adapterBaseUrl:"http://unused",adapterToken:"unused",
  evidence:{credential:"private",credential_id:credential,
   presenter_id:"did:example:backend"}
 });
 let execution=0;
 const client=new GatewayControlledToolClient({
  gatewayBaseUrl:"http://gateway.internal",agentRole:"backend",
  taskId:"trusted-discovery",evidenceHandler:e,
  cryptoPresentation:f.port,
  fetchFn:(async(input:unknown)=>{
   if(String(input).endsWith("/prepare"))
    return new Response(JSON.stringify({
     ...prepared(),required_permission:{resource,operation:"update_file"}
    }),{status:201});
   execution++;
   return new Response(JSON.stringify({execution:{}}));
  }) as typeof fetch
 });
 await assert.rejects(client.invoke("update_file",{
  branch,path,content:"bad"
 }),/Trusted Backend discovery crypto NO-GO/);
 assert.equal(f.issued,0);
 assert.equal(execution,0);
});
