import test from "node:test";
import assert from "node:assert/strict";
import {TrustedEngineerAuthoritySession}
  from "../src/trusted-engineer-authority.ts";

const SHA="a".repeat(40);
const snapshot={
  session_id:"r5-remote-async-retirement",
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console"},
  base_revision:SHA,directories:[""],files:[]
};
function root(){
  return {credential_id:"urn:r5:preliminary",valid_from:new Date().toISOString(),
    validity_seconds:300,credential_status:{
      type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,
      statusListIndex:"199",statusListCredential:"https://status.example/revocation"
    }};
}
function deferred<T=void>(){
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}
function setup(){
  const closing=deferred<void>();
  const seen:string[]=[];
  const credentials={
    async issueScopedOrchestratorRoot(x:any){
      seen.push("issue:"+x.credential_id);
      return {id:x.credential_id,
        credentialSubject:{per:structuredClone(x.permissions)}};
    },
    async revokeRoot(id:string){seen.push("revoke:"+id);}
  };
  const revisions={
    async begin(taskId:string){
      seen.push("remote-begin:"+taskId);
      return {task_id:taskId,base_revision:SHA,
        expires_at:new Date(Date.now()+300_000).toISOString()};
    },
    async end(taskId:string){
      seen.push("remote-end:"+taskId);
      await closing.promise;
      seen.push("remote-end-confirmed");
    }
  };
  const authority=new TrustedEngineerAuthoritySession({
    snapshot,credentials,planningRevisions:revisions,
    authenticatedEngineerDid:"did:thesis:engineer",
    approvals:{async loadAuthenticatedApproval(){
      throw Error("no Engineer signature available");
    }}
  });
  return {closing,seen,authority};
}
test("R5 async Gateway Planning retirement must be confirmed before native root revocation",async()=>{
  const f=setup();
  await f.authority.startPlanning(root());
  const close=f.authority.cancelPlanning();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.seen,[
    "remote-begin:"+snapshot.session_id,"issue:urn:r5:preliminary",
    "remote-end:"+snapshot.session_id
  ]);
  f.closing.resolve();
  await close;
  assert.deepEqual(f.seen.slice(-2),[
    "remote-end-confirmed","revoke:urn:r5:preliminary"
  ]);
  assert.equal(f.authority.phase,"revoked");
});
test("R5 failed remote Planning retirement cannot be reported as a clean root closure",async()=>{
  const f=setup();
  await f.authority.startPlanning(root());
  const close=f.authority.cancelPlanning();
  f.closing.reject(Error("Gateway retirement could not be confirmed"));
  await assert.rejects(close,
    /Planning root cancellation not confirmed; manual reconciliation required/);
  // Native revocation is still attempted as defence in depth, but the
  // authenticated Gateway fence remains unconfirmed, so this is NO-GO.
  assert.equal(f.seen.includes("revoke:urn:r5:preliminary"),true);
  assert.equal(f.authority.phase,"failed_closed");
  await assert.rejects(f.authority.cancelPlanning(),/manual reconciliation/);
});
