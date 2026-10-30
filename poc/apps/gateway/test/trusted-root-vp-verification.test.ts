import assert from "node:assert/strict";
import {test} from "node:test";
import type {Permission,VerifierPort,VerifiedDelegation} from "../src/types.ts";
import {TrustedGatewayRootVpVerifier} from
 "../src/trusted-root-vp-verification.ts";

const root="urn:thesis:r129:root",engineer="did:thesis:engineer",
 orchestrator="did:thesis:orchestrator",
 perm:Permission={resource:"gitea://gitea.local/thesis/example",
  operation:"read_file"};
function fixture(mod?:{
 result?:(r:VerifiedDelegation)=>VerifiedDelegation;
 signer?:(challenge:string)=>string|Promise<string>;
 failVerifier?:boolean;
}){
 const challenges:string[]=[];
 const presented:string[]=[];
 let verifiedCalls=0;
 const signer={
  async present(p:{credential_id:string;audience:string;challenge:string;
   disclosed_permissions:ReadonlyArray<Permission>}){
   assert.equal(p.credential_id,root);
   assert.equal(p.audience,"urn:thesis:gateway:r129");
   assert.deepEqual(p.disclosed_permissions,[perm]);
   challenges.push(p.challenge);
   assert.match(p.challenge,/^[a-f0-9]{64}$/);
   return mod?.signer?await mod.signer(p.challenge):
    "signed-root-vp:"+p.challenge;
  }
 };
 const verifier:VerifierPort={
  async verify(){throw Error("single-grant verifier forbidden");},
  async verifyMultiple(p){
   verifiedCalls++;
   assert.equal(p.presenter,"orchestrator");
   assert.equal(p.audience,"urn:thesis:gateway:r129");
   assert.deepEqual(p.required_permissions,[perm]);
   presented.push(p.challenge);
   if(mod?.failVerifier)throw Error("Rust verification rejected");
   assert.equal(p.signed_vp,"signed-root-vp:"+p.challenge);
   const v:VerifiedDelegation={
    presenter_id:orchestrator,credential_id:root,issuer_id:engineer,
    hierarchy_depth:0,permissions:[perm],
    expiration:(BigInt(Date.now())*1_000_000n+6_000_000_000n).toString()
   };
   return mod?.result?mod.result(v):v;
  }
 };
 return {
  proof:new TrustedGatewayRootVpVerifier({verifier,signer,
   audience:"urn:thesis:gateway:r129"}),
  input:{credential_id:root,engineer_did:engineer,
   orchestrator_did:orchestrator,required_permissions:[perm]},
  challenges,presented,get verifiedCalls(){return verifiedCalls;}
 };
}
test("R129 fresh root VP verifies exact Rust permissions and never admits work",async()=>{
 const f=fixture();
 const result=await f.proof.verifyRoot(f.input);
 assert.equal(result.cryptographic_presentation_verified,true);
 assert.equal(result.proof_challenge_verified,true);
 assert.equal(result.gateway_epoch_admitted,false);
 assert.equal(result.child_credential_issued,false);
 assert.equal(result.execution_authorized,false);
 assert.equal(result.verified_permission_count,1);
 await f.proof.verifyRoot(f.input);
 assert.equal(f.verifiedCalls,2);
 assert.equal(new Set(f.challenges).size,2,"never repeat a Gateway nonce");
 assert.deepEqual(f.challenges,f.presented);
});
test("R129 denies wrong root, presenter, issuer, hierarchy, extra or missing grants",async()=>{
 const cases:Array<(v:VerifiedDelegation)=>VerifiedDelegation>=[
  v=>({...v,credential_id:"urn:other-root"}),
  v=>({...v,presenter_id:"did:thesis:backend"}),
  v=>({...v,issuer_id:"did:thesis:other"}),
  v=>({...v,hierarchy_depth:1}),
  v=>({...v,permissions:[]}),
  v=>({...v,permissions:[perm,perm]}),
  v=>({...v,permissions:[{...perm,operation:"update_file"}]})
 ];
 for(const alter of cases){
  const f=fixture({result:alter});
  await assert.rejects(f.proof.verifyRoot(f.input),/Trusted root VP NO-GO/);
  assert.equal(f.verifiedCalls,1);
 }
});
test("R129 cannot convert an invalid signature, blank VP or expired proof to authority",async()=>{
 const f=fixture({failVerifier:true});
 await assert.rejects(f.proof.verifyRoot(f.input),/Rust verification rejected/);
 const empty=fixture({signer:()=>""});
 await assert.rejects(empty.proof.verifyRoot(empty.input),
  /missing or oversized signed root VP/);
 assert.equal(empty.verifiedCalls,0);
 const expired=fixture({result:r=>({...r,expiration:"1"})});
 await assert.rejects(expired.proof.verifyRoot(expired.input),/expired/);
});
test("R129 invalid grants and nonce-dependent signature fail closed",async()=>{
 const f=fixture();
 for(const perms of [[],[perm,perm],[{...perm,operation:"bogus"}]]){
  await assert.rejects(f.proof.verifyRoot({
   ...f.input,required_permissions:perms as Permission[]
  }),/Trusted root VP NO-GO/);
 }
 assert.equal(f.challenges.length,0);
 const replay=fixture({signer:()=>"signed-root-vp:"+("0".repeat(64))});
 await assert.rejects(replay.proof.verifyRoot(replay.input),
  /signed-root-vp/);
});
