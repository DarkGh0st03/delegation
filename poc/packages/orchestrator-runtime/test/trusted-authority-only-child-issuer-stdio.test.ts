/**
 * R381.1: original Task/Child issuer uses a separate private MCP process
 * with one-use ACK, while the exact signed Child remains owner-local.
 * Rust cryptography is a controlled offline port fixture here; live EVM,
 * Gateway and OPA are NOT exercised in this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../src/trusted-authority-only-child-journal.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";

const uri="gitea://gitea.local/thesis/iam-console-poc/"+
 "branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.ts";
const permission={resource:uri,operation:"update_file"} as const;
const taskId="r381-verified-child";
const childId="urn:delegation:r381:child";
const status={
 type:"BitstringStatusListEntry" as const,
 statusPurpose:"revocation" as const,
 statusListIndex:"81",statusListCredential:"https://issuer.example/status"
};

function fixture(transport:"stdio"|"in-process"|"native-stdio"="stdio",badChild=false){
 const now=Date.now(),start=new Date(now).toISOString();
 const root={
   session_id:"r381-native-session",
   root_credential_id:"r381-original-root",
   authority_digest:"a".repeat(64),
   root_permissions:[permission],
   root_expires_at:new Date(now+120_000).toISOString(),
   expires_at:new Date(now+120_000).toISOString()
 };
 const row={
   status:"task_registered_preflight_only",
   session_id:root.session_id,task_id:taskId,epoch:1,
   agent_id:"backend",agent_did:"did:thesis:backend-agent",
   permissions:[permission],
   root_credential_id:root.root_credential_id,
   authority_digest:root.authority_digest,
   execution_authorized:false,child_credential_issued:false,
   gateway_registered:false
 };
 const coordinator=Object.assign(
   Object.create(TrustedAuthorityOnlyExecutionCoordinator.prototype),
   {
     assertTrustedGatewayRegisteredTask(id:string){
       assert.equal(id,taskId);return row;
     },
     assertTrustedGatewayAuthorityBinding(){return root;}
   }
 ) as TrustedAuthorityOnlyExecutionCoordinator;
 let reservations=0,issues=0,nativeMcpInvocations=0;
 const journal=Object.assign(
   Object.create(DurableAuthorityOnlyChildJournal.prototype),
   {async reserveChild(input:Record<string,unknown>){
     assert.equal(input.task_id,taskId);
     assert.equal(input.parent_credential_id,root.root_credential_id);
     reservations++;
   }}
 ) as DurableAuthorityOnlyChildJournal;
 const signer={
   kind:"rust-native" as const,
   async issueChild(input:{
     credential_id:string;valid_from:string;credential_status:typeof status;
     permissions:readonly typeof permission[];
   }){
     issues++;
     assert.equal(reservations,1,"journal must be durable before native signing");
     assert.equal(input.credential_id,childId);
     return {
       id:badChild?"urn:unexpected:child":input.credential_id,
       validFrom:input.valid_from,
       credentialStatus:input.credential_status,
       credentialSubject:{
         sub:row.agent_did,per:input.permissions
       },
       proof:{type:"fixture-only-no-real-signature"}
     };
   }
 };
 const port={...signer,
   async issueChildViaPrivateMcp(input:Parameters<typeof signer.issueChild>[0]){
     nativeMcpInvocations++;
     return signer.issueChild(input);
   }
 };
 const issuer=new TrustedAuthorityOnlyChildIssuer({
   coordinator,nativeCryptoPort:port as never,journal,
   privateMcpTransport:transport,nowMs:()=>now
 });
 const parameters={
   credential_id:childId,valid_from:start,
   validity_seconds:60,credential_status:status
 };
 return {coordinator,issuer,parameters,root,row,
   get issues(){return issues;},
   get nativeMcpInvocations(){return nativeMcpInvocations;},
   get reservations(){return reservations;}
 };
}

test("R381.1 original Child issuer can opt in to real-process MCP broker without extra authority",async()=>{
 const f=fixture();
 const issued=await f.issuer.issueForRegisteredTask(taskId,f.parameters);
 assert.equal(issued.status,"native_child_response_verified_staged");
 assert.equal(issued.credential_id,childId);
 assert.deepEqual(issued.permissions,[permission]);
 assert.equal(issued.gateway_execution_authorized,false);
 assert.equal(f.issues,1);
 assert.equal(f.reservations,1);
 assert.equal(f.issuer.assertTrustedIssuedChild(taskId,f.coordinator).task_id,taskId);
 const privateCredential=f.issuer.takeTrustedIssuedChildCredential(
   taskId,f.coordinator);
 assert.equal(privateCredential.id,childId);
 assert.deepEqual(privateCredential.credentialSubject.per,[permission]);
 await assert.rejects(
   Promise.resolve().then(()=>f.issuer.takeTrustedIssuedChildCredential(
     taskId,f.coordinator)),/already transferred/u);
 await assert.rejects(f.issuer.issueForRegisteredTask(taskId,f.parameters),
   /replayed Task issuance/u);
 assert.equal(f.issues,1);
});

test("R381.1 original Child issuer preserves in-process path by default",async()=>{
 const f=fixture("in-process");
 const issued=await f.issuer.issueForRegisteredTask(taskId,f.parameters);
 assert.equal(issued.credential_id,childId);
 assert.equal(f.issues,1);
});

test("R381.1 malformed returned Child after stdio ACK fails closed with no retry",async()=>{
 const f=fixture("stdio",true);
 await assert.rejects(f.issuer.issueForRegisteredTask(taskId,f.parameters),
   /native Child credential differs/u);
 assert.equal(f.issues,1);
 await assert.rejects(f.issuer.issueForRegisteredTask(taskId,f.parameters),
   /ambiguous or concurrent issuance denied/u);
 assert.equal(f.issues,1);
 assert.equal(f.reservations,1);
});


test("R381.3 original trusted issuer selects native MCP service without ACK-only callback",async()=>{
 const f=fixture("native-stdio");
 const signed=await f.issuer.issueForRegisteredTask(taskId,f.parameters);
 assert.equal(signed.credential_id,childId);
 assert.equal(f.nativeMcpInvocations,1);
 assert.equal(f.issues,1);
 assert.equal(f.reservations,1);
 await assert.rejects(f.issuer.issueForRegisteredTask(taskId,f.parameters),
  /replayed Task issuance/u);
 assert.equal(f.nativeMcpInvocations,1);
});

test("R381.3 rejects native MCP opt-in when port lacks service capability",()=>{
 const f=fixture("in-process");
 assert.throws(()=>new TrustedAuthorityOnlyChildIssuer({
  coordinator:f.coordinator,nativeCryptoPort:{
   kind:"rust-native",
   async issueChild(){throw Error("MUST_NOT_BE_CALLED");}
  } as never,
  journal:Object.assign(Object.create(DurableAuthorityOnlyChildJournal.prototype),
   {async reserveChild(){throw Error("MUST_NOT_BE_CALLED");}}),
  privateMcpTransport:"native-stdio"
 }),/trusted Coordinator, native Rust issuer and private journal required/u);
});
