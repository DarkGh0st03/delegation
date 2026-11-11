import assert from "node:assert/strict";
import {test} from "node:test";
import {TrustedBackendDiscoveryChildPresenter} from
 "../src/trusted-backend-discovery-presenter.ts";
import {isTrustedDiscoveryChallenge} from
 "../src/trusted-discovery-challenge.ts";

const credential="urn:r151:backend-discovery-child";
const resource="gitea://gitea.local/acme/service/branches/fix/files/src/app.ts";
const audience="urn:thesis:gateway:r151:discovery";
const challenge="a".repeat(64);
const grant={resource,operation:"read_file" as const};
const proof=(nonce=challenge)=>({
 credential_id:credential,audience,challenge:nonce,
 disclosed_permissions:[grant]
});

function setup(options?:{
 status?:number;body?:unknown;
 fetchFn?:typeof fetch;expectedChallenge?:string;
}){
 let active=true,seen:unknown[]=[];
 const signer=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090/",
  backendToken:"private-backend-holder-token",
  childCredentialId:credential,resource,audience,
  isTaskActive:()=>active,
  fetchFn:options?.fetchFn??(async(url:unknown,init?:RequestInit)=>{
   seen.push({url,init});
   assert.equal(String(url),"http://adapter.internal:8090/v1/presentations");
   assert.equal(init?.method,"POST");
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer private-backend-holder-token");
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(body,{
    credential_id:credential,disclosed_permissions:[grant],
    audience,challenge:options?.expectedChallenge??challenge
   });
   return new Response(JSON.stringify(
    options?.body??{signed_vp:"signed-backend-vp:from-rust"}
   ),{status:options?.status??200});
  }) as typeof fetch
 });
 return {signer,seen,close(){active=false;}};
}

test("R151.28 private Backend holder signs only the pinned Child read via Rust",async()=>{
 const f=setup();
 assert.equal(await f.signer.present(proof()),"signed-backend-vp:from-rust");
 assert.equal(f.seen.length,1);
 assert.equal(JSON.stringify(f.seen.map(x=>
  JSON.parse(String((x as {init:RequestInit}).init.body))
 )).includes("private-backend-holder-token"),false);
});

test("R151.28 denies forged Child, audience, grant escalation and invalid challenge before network",async()=>{
 const f=setup();
 for(const input of [
  {...proof(),credential_id:"urn:foreign-child"},
  {...proof(),audience:"urn:thesis:gateway:wrong"},
  {...proof(),challenge:"untrusted-nonce"},
  {...proof(),disclosed_permissions:[]},
  {...proof(),disclosed_permissions:[grant,grant]},
  {...proof(),disclosed_permissions:[{resource,operation:"update_file" as const}]},
  {...proof(),disclosed_permissions:[{...grant,resource:resource+"-other"}]},
  {...proof(),disclosed_permissions:[{...grant,extra:true}]}
 ]){
  await assert.rejects(f.signer.present(input),
   /Trusted Backend discovery presenter NO-GO/);
 }
 assert.equal(f.seen.length,0);
});

test("R151.28 denies reused challenge and fenced or cancelled signing",async()=>{
 const f=setup();
 await f.signer.present(proof());
 await assert.rejects(f.signer.present(proof()),/replayed challenge/);
 f.close();
 await assert.rejects(f.signer.present(proof("b".repeat(64))),
  /closed or cancelled/);
 f.signer.fence();
 await assert.rejects(f.signer.present(proof("c".repeat(64))),
  /closed or cancelled/);
 assert.equal(f.seen.length,1);
});

test("R151.28 rejects unavailable, unauthorized and malformed Rust VP",async()=>{
 for(const options of [
  {status:403,body:{error:"not backend"}},
  {body:{signed_vp:""}},
  {body:{signed_vp:"signed-vp",unexpected:true}},
  {body:{something_else:"signed-vp"}},
  {fetchFn:(async()=>{throw Error("adapter unreachable");}) as typeof fetch}
 ]){
  const f=setup(options);
  await assert.rejects(f.signer.present(proof()),
   /Trusted Backend discovery presenter NO-GO/);
 }
});

test("R151.28 cancellation during asynchronous Rust signing never returns VP",async()=>{
 let unblock!:()=>void;
 let entered!:()=>void;
 const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
 const hold=new Promise<void>(resolve=>{unblock=resolve;});
 let active=true;
 const signer=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090/",
  backendToken:"private-backend-holder-token",
  childCredentialId:credential,resource,audience,
  isTaskActive:()=>active,
  fetchFn:(async()=>{
   entered();
   await hold;
   return new Response(JSON.stringify({signed_vp:"signed-vp-from-rust"}));
  }) as typeof fetch
 });
 const pending=signer.present(proof());
 await enteredPromise;
 active=false;
 unblock();
 await assert.rejects(pending,/closed or cancelled/);
});

test("R151.28 validates fixed trusted configuration before signing",()=>{
 const fixed={
  adapterBaseUrl:"http://adapter.internal:8090/",
  backendToken:"private-backend-holder-token",
  childCredentialId:credential,resource,audience,
  isTaskActive:()=>true
 };
 for(const changes of [
  {backendToken:""},
  {adapterBaseUrl:"http://user:password@adapter.internal:8090/"},
  {childCredentialId:""},
  {resource:"gitea://"},
  {audience:"bad"},
  {isTaskActive:null}
 ]){
  // Even a valid file URI grants nothing before Gateway R151.27 verification.
  assert.throws(()=>new TrustedBackendDiscoveryChildPresenter({
   ...fixed,...changes
  } as typeof fixed),/Trusted Backend discovery presenter NO-GO/);
 }
});

test("R151.34 canonical 256-bit Gateway Prepare nonce is signed for exact child and cannot replay",async()=>{
 const gatewayNonce=Buffer.alloc(32,0x91).toString("base64url");
 assert.equal(gatewayNonce.length,43);
 assert.equal(isTrustedDiscoveryChallenge(gatewayNonce),true);
 const f=setup({expectedChallenge:gatewayNonce});
 assert.equal(await f.signer.present(proof(gatewayNonce)),
  "signed-backend-vp:from-rust");
 assert.equal(f.seen.length,1);
 await assert.rejects(f.signer.present(proof(gatewayNonce)),/replayed challenge/);
 assert.equal(f.seen.length,1);
});
test("R151.34 nonce parser refuses noncanonical base64url and non-256-bit inputs",()=>{
 const nonce=Buffer.alloc(32,0x91).toString("base64url");
 const malformed=[
  nonce+"=", nonce.slice(0,-1), nonce+"A", nonce.replace(/.$/u,"B"),
  "123456789012345678901234567890123456789012",
  "A".repeat(64), "f".repeat(65),
  "g".repeat(64), undefined, {}, null
 ];
 for(const value of malformed){
  assert.equal(isTrustedDiscoveryChallenge(value),false,JSON.stringify(value));
 }
 assert.equal(isTrustedDiscoveryChallenge("a".repeat(64)),true);
});
