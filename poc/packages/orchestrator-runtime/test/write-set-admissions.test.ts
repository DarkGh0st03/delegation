/**
 * Phase W (W1): write-set Tasks in the REAL trusted admissions, with the real
 * Engineer session, Coordinator, native Child issuance (crypto port fixture),
 * durable journals, completion observer and owner write-set preflight over a
 * real GiteaClient (fixture HTTP). No Gateway Execute, VP verification, OPA or
 * Gitea write: those are W2. The single-write baseline is exercised by the
 * existing suites and must stay unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash} from "node:crypto";
import {mkdtemp,chmod,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SAMPLE_TEST_SOURCES} from "../../plan-contracts/test/fixtures/test-sources.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedOperationalSessionStore}
 from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {prepareAuthorization,InMemoryRequestStore,InMemoryAuditSink}
 from "../../../apps/gateway/src/prepare.ts";
import {TrustedAuthorityOnlyWriteSetPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-write-set-preflight.ts";
import {DurableAuthorityOnlyWriteSetIntentJournal}
 from "../../../apps/gateway/src/trusted-authority-only-write-set-intent-journal.ts";
import {signAuthorityOnlyGrant,selectAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {SignedAuthorityOnlyFileStore} from "../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal} from "../src/authority-only-activation-journal.ts";
import {TrustedAuthorityOnlyEngineerSession} from "../src/trusted-authority-only-engineer-session.ts";
import {DurableAuthorityTaskJournal} from "../src/trusted-authority-task-journal.ts";
import {DurableAuthorityOnlyChildJournal} from "../src/trusted-authority-only-child-journal.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyChildIssuer} from "../src/trusted-authority-only-child-issuer.ts";
import type {TrustedChildCryptographyPort} from "../src/trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyExecutionCoordinator,type AuthorityOnlyTaskProposal}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import type {EngineerCredentialPort,TrustedPlanningSnapshot,RootParameters}
 from "../src/trusted-engineer-authority.ts";
import type {DelegatedPermission} from "../src/delegated-permission.ts";
import type {IssuedDelegationCredential} from "../src/trusted-credential-contracts.ts";

const now="2026-11-05T07:10:00Z",nowMs=Date.parse(now);
const repo={authority:"gitea.local",owner:"thesis",repository:"sample-app"};
const sessionId="w1-session";
const requirement="Phase W write-set Task";
const hash="a".repeat(40);
const root="gitea://gitea.local/thesis/sample-app";
const branch="feature/sample-change";
const F=root+"/branches/feature%2Fsample-change/files/";
const A="apps/backend/a.ts",B="apps/backend/b.ts",N1="apps/backend/n1.ts",N2="apps/backend/n2.ts";
const T="tests/backend/a.test.ts";
const p=(operation:string,path:string)=>({resource:F+path,operation});
const did="did:thesis:engineer",keyId="trusted-engineer-1";
const allPairs=[{resource:root,operation:"create_branch"},
 p("read_file",A),p("read_file",B),p("update_file",A),p("update_file",B),
 p("create_file",N1),p("create_file",N2),p("create_file",T)];
const keys=generateKeyPairSync("ed25519");
const privateKeyPem=keys.privateKey.export({format:"pem",type:"pkcs8"});
const trustedKeys={[keyId]:{engineer_did:did,
 public_key_pem:keys.publicKey.export({format:"pem",type:"spki"})}};
const operations=new Set<string>(RUST_OPERATIONS);
const snapshot=():TrustedPlanningSnapshot=>({session_id:sessionId,repository:{...repo},
 base_revision:hash,directories:["","apps","apps/backend","tests","tests/backend"],files:[A,B]});
const params=(id:string,index:string,ttl=1800):RootParameters=>({credential_id:id,valid_from:now,
 validity_seconds:ttl,credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListCredential:"https://status.example/revocation",statusListIndex:index}});
const requirementHash=createHash("sha256").update(requirement,"utf8").digest("hex");
const registry={
 backend:{did:"did:thesis:backend",card_ref:"trusted:backend",capabilities:["read_file","update_file","create_file"]},
 frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend",capabilities:["read_file","update_file"]},
 test:{did:"did:thesis:test",card_ref:"trusted:test",capabilities:["read_file","update_file","create_file"]}
};
class Issuer implements EngineerCredentialPort{
 async issueScopedOrchestratorRoot(input:RootParameters&{permissions:readonly DelegatedPermission[]}){
  return {id:input.credential_id,credentialSubject:{per:structuredClone(input.permissions)}} as
   unknown as IssuedDelegationCredential;
 }
 async revokeRoot(){}
}
const childPort:TrustedChildCryptographyPort={kind:"rust-native",async issueChild(request){
 return {id:request.credential_id,issuer:"did:thesis:orchestrator",validFrom:request.valid_from,
  credentialStatus:request.credential_status,credentialSubject:{sub:"did:thesis:"+request.delegatee,
   per:structuredClone(request.permissions)}} as never;
}};

/** Gitea fixture: the pinned HEAD with A and B; N1, N2 and T absent. */
function gitea(opts:{advanceAfter?:number;existing?:Record<string,string>}={}){
 let calls=0;
 const files:Record<string,string>={[A]:"export const a=1;\n",[B]:"export const b=1;\n",...opts.existing};
 const fetchFn=async(input:string|URL)=>{
  const url=new URL(String(input));calls++;
  const head=opts.advanceAfter!==undefined&&calls>opts.advanceAfter?"b".repeat(40):hash;
  const m=/\/repos\/thesis\/sample-app\/(branches|contents)\/(.+)$/u.exec(url.pathname);
  if(m?.[1]==="branches")return Response.json({name:decodeURIComponent(m[2]!),commit:{id:head}});
  if(m?.[1]==="contents"){
   const path=decodeURIComponent(m[2]!);
   if(!(path in files))return new Response("{}",{status:404});
   const content=files[path]!;
   return Response.json({type:"file",path,encoding:"base64",content:Buffer.from(content).toString("base64"),
    sha:createHash("sha1").update(content).digest("hex"),size:content.length});
  }
  return new Response("{}",{status:500});
 };
 return new GiteaClient({baseUrl:"http://gitea.fixture.invalid",token:"fixture-token",
  owner:"thesis",repository:"sample-app",baseBranch:"main",fetchFn:fetchFn as never});
}

async function setup(opts:{permissions:{resource:string;operation:string}[];agent?:string;
 batchWrites?:boolean;giteaOpts?:Parameters<typeof gitea>[0]}){
 const directory=await mkdtemp(join(tmpdir(),"w1-admissions-"));
 const d=(n:string)=>join(directory,n);
 for(const n of ["approvals","journal","tasks","gw-sessions","gw-tasks","child","gw-child","seq","ws-intents"])
  await mkdir(d(n),{mode:0o700});
 const draft={schema_version:"1.0.0",session_id:sessionId,repository:{...repo},branch,
  base_revision:hash,requirement,requested_permissions:[...allPairs]};
 const grant=selectAuthorityOnlyGrant(draft,allPairs,{allowedOperations:operations});
 const receipt=signAuthorityOnlyGrant({authorization:grant,engineerDid:did,keyId,privateKeyPem,
  issuedAt:"2026-11-05T07:00:00Z",expiresAt:"2026-11-05T09:00:00Z",allowedOperations:operations});
 await writeFile(d("approvals/"+sessionId+".json"),JSON.stringify(receipt),{mode:0o600});
 await chmod(d("approvals/"+sessionId+".json"),0o600);
 const approvals=new SignedAuthorityOnlyFileStore({directory:d("approvals"),engineerDid:did,
  trustedKeys,nowMs:()=>nowMs});
 const session=new TrustedAuthorityOnlyEngineerSession({snapshot:snapshot(),requirement,
  credentials:new Issuer(),approvals,journal:new DurableAuthorityOnlyActivationJournal(d("journal")),
  authenticatedEngineerDid:did,nowMs:()=>nowMs,planningRevisions:{
   async begin(){return {task_id:sessionId,base_revision:hash,expires_at:"2026-11-05T07:50:00Z"};},
   async end(){}}});
 await session.startPlanning(params("urn:w1:preliminary","301",600));
 await session.approveAndIssueOperationalRoot(params("urn:w1:operational","302",1800));
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({sessionId,engineer:session,
  approvals,journal:new DurableAuthorityTaskJournal(d("tasks")),trustedAgentRegistry:registry,
  nowMs:()=>nowMs});
 await coordinator.activate();
 const agent=opts.agent??"backend";
 const task:AuthorityOnlyTaskProposal={session_id:sessionId,requirement_sha256:requirementHash,
  base_revision:hash,branch,task_id:"task-ws",epoch:1,agent_id:agent as never,depends_on:[],
  permissions:opts.permissions};
 await coordinator.registerTask(task);
 const issuer=new TrustedAuthorityOnlyChildIssuer({coordinator,nativeCryptoPort:childPort,
  journal:new DurableAuthorityOnlyChildJournal(d("child")),nowMs:()=>nowMs});
 await issuer.issueForRegisteredTask("task-ws",params("urn:w1:child","303",600));
 const evidence=new Map<string,string>();
 const observer=new TrustedAuthorityOnlyCompletionObserver({async readVerifiedCompletion(expected){
  const e=evidence.get(expected.request_id);
  if(!e)throw Error("no Gateway receipt for "+expected.request_id);
  return {...expected,status:"owner_verified_provider_result" as const,evidence_sha256:e,completed_at_ms:nowMs};
 }});
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({repository:repo,engineerDid:did,coordinator,
  approvals,operationalSessionStore:new TrustedOperationalSessionStore(d("gw-sessions")),
  taskJournal:new DurableAuthorityTaskJournal(d("gw-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(d("gw-child")),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(d("seq")),
  completionObserver:observer,projectTestSourceProfile:SAMPLE_TEST_SOURCES,
  ...(opts.batchWrites===false?{}:{batchWritesEnabled:true}),nowMs:()=>nowMs});
 await gate.activate(sessionId,hash);
 await gate.bindTrustedTask("task-ws","runtime-ws",agent as never);
 await gate.enrollTrustedIssuedChild("task-ws","runtime-ws",issuer);
 const client=gitea(opts.giteaOpts);
 const preflight=new TrustedAuthorityOnlyWriteSetPreflight({admissions:gate,giteaClient:client,
  journal:new DurableAuthorityOnlyWriteSetIntentJournal(d("ws-intents")),
  repository:"thesis/sample-app",branch,nowMs:()=>nowMs});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let n=0;
 const prepare=(tool:string,path:string,content?:string,challenge="ws-challenge")=>{
  const out=prepareAuthorization({task_id:"runtime-ws",agent_role:agent as never,tool:tool as never,
   arguments:{branch,path,...(content!==undefined?{content}:{})} as never},
   {audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
   {store,audit,authorityOnlyAdmissions:gate,nowMs:()=>nowMs,requestId:()=>`req-${n++}`,
    challenge:()=>challenge});
  return store.get(out.request_id)!;
 };
 const readAll=async(paths:string[])=>{
  for(const path of paths){
   const r=prepare("read_file",path);
   await gate.stageTrustedSequentialReadEffect(r);
   evidence.set(r.request_id,createHash("sha256").update("read:"+path).digest("hex"));
   await gate.attestTrustedSequentialReadEffect("task-ws","runtime-ws");
  }
 };
 const verified=(perms:{resource:string;operation:string}[])=>({
  presenter_id:registry[agent as keyof typeof registry].did,credential_id:"urn:w1:child",
  issuer_id:"did:thesis:orchestrator",permissions:perms,hierarchy_depth:1,
  expiration:"0",root_credential_id:"urn:w1:operational"});
 const close=()=>rm(directory,{recursive:true,force:true});
 return {gate,preflight,prepare,readAll,evidence,observer,verified,store,close};
}
const writesOf=(perms:{resource:string;operation:string}[])=>perms.filter(x=>x.operation!=="read_file");

const mixed=[p("read_file",A),p("read_file",B),p("update_file",A),p("update_file",B),p("create_file",N1)];

test("W1 end-to-end: reads, ONE write-set flight, ordered item binding, publication, ordered evidence, final",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const begun=await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
  assert.deepEqual([begun.reads,begun.writes,begun.total_effects],[2,3,5]);
  await h.readAll([A,B]);
  // The model lists writes in any order; the Gateway binds canonical order.
  const records=[h.prepare("create_file",N1,"export const n=1;\n"),
   h.prepare("update_file",B,"export const b=2;\n"),h.prepare("update_file",A,"export const a=2;\n")];
  const staged=await h.preflight.stageWriteSet(records,hash);
  assert.deepEqual(staged.intent.items.map(i=>[i.operation,i.path,i.old_path_absent_at_pinned_head]),
   [["update_file",A,false],["update_file",B,false],["create_file",N1,true]]);
  assert.ok(staged.intent.items.slice(0,2).every(i=>/^[a-f0-9]{40}$/u.test(i.expected_blob_sha!)));
  const ws=await h.gate.stageTrustedWriteSet(h.preflight,records);
  assert.equal(ws.first_sequence,3);assert.equal(ws.writes,3);
  assert.match(ws.write_set_digest,/^[a-f0-9]{64}$/u);
  // No read and no second write-set after the write-set is staged.
  await assert.rejects(h.gate.stageTrustedWriteSet(h.preflight,records),/write-set lacks|no owner-reserved/u);
  // Execute (simulated consumption after Rust VP + OPA), canonical order.
  const ordered=[records[2]!,records[1]!,records[0]!];
  const vp=h.verified(writesOf(mixed));
  for(const [i,r] of ordered.entries()){
   r.consumed=true;
   const b=h.gate.assertTrustedWriteSetItemBinding(r,vp as never,ws.write_set_digest);
   assert.equal(b.sequence,3+i);assert.equal(b.validated_all,i===2);
  }
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h.observer),
   /published write-set/u);
  const pub=h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest);
  assert.equal(pub.provider_write_authorized,false);
  assert.throws(()=>h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest),/once/u);
  h.gate.assertTrustedWriteSetStillPublishable("task-ws","runtime-ws",ws.write_set_digest);
  await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  h.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",ws.write_set_digest,"c".repeat(40));
  // Evidence strictly in order: the observer needs each Gateway receipt.
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h.observer),
   /no Gateway receipt/u);
 }finally{await h.close();}
});

test("W1 evidence: per-file attestation in canonical order, then final; dependencies only after",async()=>{
 const h=await setup({permissions:mixed});
 try{
  await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
  await h.readAll([A,B]);
  const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),
   h.prepare("create_file",N1,"n1\n")];
  await h.preflight.stageWriteSet(records,hash);
  const ws=await h.gate.stageTrustedWriteSet(h.preflight,records);
  const vp=h.verified(writesOf(mixed));
  for(const r of records){r.consumed=true;h.gate.assertTrustedWriteSetItemBinding(r,vp as never,ws.write_set_digest);}
  h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest);
  h.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",ws.write_set_digest,"c".repeat(40));
  // Receipt for the SECOND file only: the first must still come first.
  h.evidence.set(records[1]!.request_id,"2".repeat(64));
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h.observer));
 }finally{await h.close();}
 const h2=await setup({permissions:mixed});
 try{
  await h2.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
  await h2.readAll([A,B]);
  const records=[h2.prepare("update_file",A,"a2\n"),h2.prepare("update_file",B,"b2\n"),
   h2.prepare("create_file",N1,"n1\n")];
  await h2.preflight.stageWriteSet(records,hash);
  const ws=await h2.gate.stageTrustedWriteSet(h2.preflight,records);
  const vp=h2.verified(writesOf(mixed));
  for(const r of records){r.consumed=true;h2.gate.assertTrustedWriteSetItemBinding(r,vp as never,ws.write_set_digest);}
  h2.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest);
  h2.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",ws.write_set_digest,"c".repeat(40));
  for(const [i,r] of records.entries()){
   h2.evidence.set(r.request_id,String(i+1).repeat(64));
   const a=await h2.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h2.observer);
   assert.equal(a.sequence,3+i);
  }
  await assert.rejects(h2.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h2.observer),
   /next item/u);
  const fin=await h2.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws");
  assert.equal(fin.total_effects,5);
  assert.equal(h2.gate.assertTrustedCompletedSequentialReadUpdateTask("task-ws","runtime-ws").status,
   "sequential_read_update_task_completed_staged");
 }finally{await h2.close();}
});

test("W1 binding: out-of-order, foreign VP or partial VP terminate the write-set",async()=>{
 for(const fault of ["order","presenter","partial_vp","digest","challenge"] as const){
  const h=await setup({permissions:mixed});
  try{
   await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
   await h.readAll([A,B]);
   const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),
    fault==="challenge"?h.prepare("create_file",N1,"n1\n","other-challenge"):h.prepare("create_file",N1,"n1\n")];
   if(fault==="challenge"){
    // A record with another challenge cannot even enter the write-set.
    await assert.rejects(h.preflight.stageWriteSet(records,hash),/does not match/u);
    continue;
   }
   await h.preflight.stageWriteSet(records,hash);
   const ws=await h.gate.stageTrustedWriteSet(h.preflight,records);
   const vp=h.verified(writesOf(mixed));
   for(const r of records)r.consumed=true;
   if(fault==="order")
    assert.throws(()=>h.gate.assertTrustedWriteSetItemBinding(records[1]!,vp as never,ws.write_set_digest),/out of order/u);
   if(fault==="presenter")
    assert.throws(()=>h.gate.assertTrustedWriteSetItemBinding(records[0]!,
     {...vp,presenter_id:"did:thesis:frontend"} as never,ws.write_set_digest),/enrolled Child/u);
   if(fault==="partial_vp")
    assert.throws(()=>h.gate.assertTrustedWriteSetItemBinding(records[0]!,
     {...vp,permissions:writesOf(mixed).slice(0,2)} as never,ws.write_set_digest),/exactly the signed writes/u);
   if(fault==="digest"){
    assert.throws(()=>h.gate.assertTrustedWriteSetItemBinding(records[0]!,vp as never,"0".repeat(64)),/no matching/u);
    continue;
   }
   assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
   // Terminal: neither a correct item nor a publication can follow.
   assert.throws(()=>h.gate.assertTrustedWriteSetItemBinding(records[0]!,vp as never,ws.write_set_digest),/not accepting/u);
   assert.throws(()=>h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest),/validated/u);
   await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  }finally{await h.close();}
 }
});

test("W1 terminal states: failure before the CAS vs ambiguous after the CAS request; no finalization",async()=>{
 for(const sent of [false,true]){
  const h=await setup({permissions:mixed});
  try{
   await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
   await h.readAll([A,B]);
   const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),h.prepare("create_file",N1,"n1\n")];
   await h.preflight.stageWriteSet(records,hash);
   const ws=await h.gate.stageTrustedWriteSet(h.preflight,records);
   const vp=h.verified(writesOf(mixed));
   for(const r of records){r.consumed=true;h.gate.assertTrustedWriteSetItemBinding(r,vp as never,ws.write_set_digest);}
   h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest);
   h.gate.failTrustedWriteSet("task-ws","runtime-ws",ws.write_set_digest,sent);
   assert.equal(h.gate.writeSetPhase("task-ws"),sent?"ambiguous":"failed");
   assert.throws(()=>h.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",ws.write_set_digest,"c".repeat(40)),/not publishing/u);
   assert.throws(()=>h.gate.assertTrustedWriteSetStillPublishable("task-ws","runtime-ws",ws.write_set_digest),/no longer/u);
   assert.throws(()=>h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest),/validated/u);
   await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  }finally{await h.close();}
 }
});

test("W1 create-only write-set (no reads) and Test-agent write-set of project test sources",async()=>{
 const createOnly=[p("create_file",N1),p("create_file",N2)];
 const h=await setup({permissions:createOnly});
 try{
  const begun=await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
  assert.deepEqual([begun.reads,begun.writes],[0,2]);
  const records=[h.prepare("create_file",N2,"n2\n"),h.prepare("create_file",N1,"n1\n")];
  await h.preflight.stageWriteSet(records,hash);
  const ws=await h.gate.stageTrustedWriteSet(h.preflight,records);
  assert.equal(ws.first_sequence,1);
 }finally{await h.close();}
 // Test agent: may write only project test sources.
 const t=await setup({agent:"test",permissions:[p("read_file",A),p("create_file",T),p("create_file",N1)]});
 try{
  await assert.rejects(t.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash),/exact native Child write-set/u);
 }finally{await t.close();}
});

test("W1 owner preflight: blob SHAs and absence only from owner Gitea reads",async()=>{
 for(const [label,giteaOpts,content,pattern] of [
  ["create of an existing file",{existing:{[N1]:"already\n"}},undefined,/already exists/u],
  ["no-op update",{},"export const a=1;\n",/no-op update/u],
  ["HEAD moved during preflight",{advanceAfter:2},undefined,/HEAD changed/u]
 ] as const){
  const h=await setup({permissions:mixed,giteaOpts:giteaOpts as never});
  try{
   await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
   await h.readAll([A,B]);
   const records=[h.prepare("update_file",A,content??"a2\n"),h.prepare("update_file",B,"b2\n"),
    h.prepare("create_file",N1,"n1\n")];
   await assert.rejects(h.preflight.stageWriteSet(records,hash),pattern,label);
   await assert.rejects(h.gate.stageTrustedWriteSet(h.preflight,records),/no owner-reserved/u,label);
  }finally{await h.close();}
 }
});

test("W1 admission: exact signed write set, attested reads first, genuine owner preflight",async()=>{
 const h=await setup({permissions:mixed});
 try{
  await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash);
  const early=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),h.prepare("create_file",N1,"n1\n")];
  // Before the signed reads are attested.
  assert.throws(()=>h.gate.assertTrustedWriteSetIntentBinding(early),/attested reads/u);
  await h.readAll([A,B]);
  // Partial set, and a set with a request outside the signed plan.
  assert.throws(()=>h.gate.assertTrustedWriteSetIntentBinding(early.slice(0,2)),/attested reads|signed write plan/u);
  const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),h.prepare("create_file",N1,"n1\n")];
  // A forged preflight object cannot supply intents.
  const forged=Object.create(TrustedAuthorityOnlyWriteSetPreflight.prototype);
  await assert.rejects(h.gate.stageTrustedWriteSet(forged,records),/owner preflight/u);
  // The single-write paths never apply to a write-set Task.
  await assert.rejects(h.gate.stageTrustedSequentialMutationEffect(records[0]!),
   /update preflight has no exact signed Task/u);
  assert.throws(()=>h.gate.assertTrustedGiteaUpdateIntentBinding(records[0]!),
   /update preflight has no exact signed Task/u);
  assert.throws(()=>h.gate.assertTrustedGiteaCreateIntentBinding(records[2]!),
   /create preflight lacks original single-effect/u);
  await h.preflight.stageWriteSet(records,hash);
  await h.gate.stageTrustedWriteSet(h.preflight,records);
  // No further read once the write-set is staged.
  await assert.rejects(h.gate.stageTrustedSequentialReadEffect(h.prepare("read_file",A)),
   /sequential read lacks trusted/u);
 }finally{await h.close();}
});

test("W1 disabled (default) or single-write grant: the write-set path is never available",async()=>{
 const off=await setup({permissions:mixed,batchWrites:false});
 try{
  assert.equal(off.gate.batchWritesEnabled,false);
  await assert.rejects(off.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash),/not enabled/u);
 }finally{await off.close();}
 const single=await setup({permissions:[p("read_file",A),p("update_file",A)]});
 try{
  await assert.rejects(single.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",hash),/write-set grant/u);
  // ... while the baseline single-write manifest is still admitted.
  const base=await single.gate.beginTrustedSequentialReadUpdateTask("task-ws","runtime-ws",hash);
  assert.equal(base.write_operation,"update_file");
 }finally{await single.close();}
});
