/**
 * Phase W test harness: REAL trusted components (Engineer session with a
 * signed Ed25519 receipt, Coordinator, native Child issuance through a
 * crypto-port fixture, Gateway admissions, durable journals, owner write-set
 * preflight, write-set executor, per-file evidence publisher/observer, the
 * real Prepare/Execute) over an in-memory Gitea (FakeGitea). Only the native
 * Rust VP verification (multi-permission verifier fixture) and OPA (allow
 * fixture) are simulated.
 */
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {mkdtemp,chmod,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SAMPLE_TEST_SOURCES} from "../../../plan-contracts/test/fixtures/test-sources.mjs";
import {FakeGitea} from "../../../../apps/gateway/test/fixtures/fake-gitea.ts";
import {RUST_OPERATIONS} from "../../../../apps/gateway/src/operation-catalog.ts";
import {TrustedOperationalSessionStore}
 from "../../../../apps/gateway/src/trusted-operational-session-store.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {GiteaClient} from "../../../../apps/gateway/src/gitea-client.ts";
import {prepareAuthorization,InMemoryRequestStore,InMemoryAuditSink}
 from "../../../../apps/gateway/src/prepare.ts";
import {executeAuthorization} from "../../../../apps/gateway/src/execute.ts";
import {DirectCoreRustVerifier} from "../../../../apps/gateway/src/direct-core-verifier.ts";
import {VerificationRejectedError} from "../../../../apps/gateway/src/errors.ts";
import {TrustedAuthorityOnlyWriteSetPreflight}
 from "../../../../apps/gateway/src/trusted-authority-only-write-set-preflight.ts";
import {DurableAuthorityOnlyWriteSetIntentJournal}
 from "../../../../apps/gateway/src/trusted-authority-only-write-set-intent-journal.ts";
import {TrustedGatewayWriteSetEvidencePublisher,AuthenticatedWriteSetCompletionObserver}
 from "../../../../apps/gateway/src/trusted-authority-only-write-set-evidence.ts";
import {TrustedAuthorityOnlyWriteSetExecutor}
 from "../../../../apps/gateway/src/trusted-authority-only-write-set-executor.ts";
import {TrustedWriteBatchStore,prepareWriteBatch,stageWriteBatch}
 from "../../../../apps/gateway/src/trusted-write-batch.ts";
import {signAuthorityOnlyGrant,selectAuthorityOnlyGrant}
 from "../../../plan-contracts/src/authority-only-approval.mjs";
import {SignedAuthorityOnlyFileStore} from "../../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal} from "../../src/authority-only-activation-journal.ts";
import {TrustedAuthorityOnlyEngineerSession} from "../../src/trusted-authority-only-engineer-session.ts";
import {DurableAuthorityTaskJournal} from "../../src/trusted-authority-task-journal.ts";
import {DurableAuthorityOnlyChildJournal} from "../../src/trusted-authority-only-child-journal.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../../src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver} from "../../src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyChildIssuer} from "../../src/trusted-authority-only-child-issuer.ts";
import type {TrustedChildCryptographyPort} from "../../src/trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyExecutionCoordinator,type AuthorityOnlyTaskProposal}
 from "../../src/trusted-authority-only-execution-coordinator.ts";
import type {EngineerCredentialPort,TrustedPlanningSnapshot,RootParameters}
 from "../../src/trusted-engineer-authority.ts";
import type {DelegatedPermission} from "../../src/delegated-permission.ts";
import type {IssuedDelegationCredential} from "../../src/trusted-credential-contracts.ts";

export const now="2026-11-05T07:10:00Z";
export let nowMs=Date.parse(now);
export const repo={authority:"gitea.local",owner:"thesis",repository:"sample-app"};
const sessionId="w-session";
const requirement="Phase W write-set Task";
const root="gitea://gitea.local/thesis/sample-app";
export const branch="feature/sample-change";
const F=root+"/branches/feature%2Fsample-change/files/";
export const A="apps/backend/a.ts",B="apps/backend/b.ts",N1="apps/backend/n1.ts",
 N2="apps/backend/n2.ts",T="tests/backend/a.test.ts";
export const p=(operation:string,path:string)=>({resource:F+path,operation});
export const initialFiles={[A]:"export const a=1;\n",[B]:"export const b=1;\n"};
const did="did:thesis:engineer",keyId="trusted-engineer-1";
const allPairs=[{resource:root,operation:"create_branch"},
 p("read_file",A),p("read_file",B),p("update_file",A),p("update_file",B),
 p("create_file",N1),p("create_file",N2),p("create_file",T)];
const keys=generateKeyPairSync("ed25519");
const privateKeyPem=keys.privateKey.export({format:"pem",type:"pkcs8"});
const trustedKeys={[keyId]:{engineer_did:did,public_key_pem:keys.publicKey.export({format:"pem",type:"spki"})}};
const operations=new Set<string>(RUST_OPERATIONS);
const params=(id:string,index:string,ttl=1800):RootParameters=>({credential_id:id,valid_from:now,
 validity_seconds:ttl,credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListCredential:"https://status.example/revocation",statusListIndex:index}});
const requirementHash=createHash("sha256").update(requirement,"utf8").digest("hex");
export const registry={
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

/** Native multi-permission verifier fixture with a revocation switch. */
export function verifierFixture(agent:string){
 const v=Object.create(DirectCoreRustVerifier.prototype) as DirectCoreRustVerifier&{
  calls:number;revoked:boolean;revokeAfter?:number};
 Object.defineProperty(v,"allowsGiteaScopeCoverage",{value:true});
 Object.assign(v,{calls:0,revoked:false,
  async verify(){throw Error("single verification must not be used for a write batch");},
  async verifyMultiple(r:{required_permissions:unknown[]}){
   v.calls++;
   if(v.revoked||(v.revokeAfter!==undefined&&v.calls>v.revokeAfter))
    throw new VerificationRejectedError("Child revoked on-chain");
   return {presenter_id:registry[agent as keyof typeof registry].did,credential_id:"urn:w:child",
    issuer_id:"did:thesis:orchestrator",permissions:r.required_permissions,hierarchy_depth:1,
    expiration:"0",root_credential_id:"urn:w:operational"};
  }});
 return v;
}

export async function setup(opts:{permissions:{resource:string;operation:string}[];agent?:string;
 batchWrites?:boolean;strict?:boolean;files?:Record<string,string>;modes?:Record<string,string>}){
 const fake=new FakeGitea(opts.files??initialFiles,{modes:opts.modes});
 const hash=fake.head("main")!;
 fake.createBranch(branch,"main");
 const directory=await mkdtemp(join(tmpdir(),"w-harness-"));
 const d=(n:string)=>join(directory,n);
 for(const n of ["approvals","journal","tasks","gw-sessions","gw-tasks","child","gw-child","seq",
   "ws-intents","ws-evidence"])
  await mkdir(d(n),{mode:0o700});
 const draft={schema_version:"1.0.0",session_id:sessionId,repository:{...repo},branch,
  base_revision:hash,requirement,requested_permissions:[...allPairs]};
 const grant=selectAuthorityOnlyGrant(draft,allPairs,{allowedOperations:operations});
 const receipt=signAuthorityOnlyGrant({authorization:grant,engineerDid:did,keyId,privateKeyPem,
  issuedAt:"2026-11-05T07:00:00Z",expiresAt:"2026-11-05T09:00:00Z",allowedOperations:operations});
 await writeFile(d("approvals/"+sessionId+".json"),JSON.stringify(receipt),{mode:0o600});
 await chmod(d("approvals/"+sessionId+".json"),0o600);
 const clock={now:Date.parse(now)};
 const nowFn=()=>clock.now;
 const approvals=new SignedAuthorityOnlyFileStore({directory:d("approvals"),engineerDid:did,trustedKeys,nowMs:nowFn});
 const snapshot:TrustedPlanningSnapshot={session_id:sessionId,repository:{...repo},base_revision:hash,
  directories:["","apps","apps/backend","tests","tests/backend"],files:Object.keys(opts.files??initialFiles)};
 const session=new TrustedAuthorityOnlyEngineerSession({snapshot,requirement,credentials:new Issuer(),
  approvals,journal:new DurableAuthorityOnlyActivationJournal(d("journal")),authenticatedEngineerDid:did,
  nowMs:nowFn,planningRevisions:{
   async begin(){return {task_id:sessionId,base_revision:hash,expires_at:"2026-11-05T07:50:00Z"};},
   async end(){}}});
 await session.startPlanning(params("urn:w:preliminary","301",600));
 await session.approveAndIssueOperationalRoot(params("urn:w:operational","302",1800));
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(d("tasks")),trustedAgentRegistry:registry,nowMs:nowFn});
 await coordinator.activate();
 const agent=opts.agent??"backend";
 const task:AuthorityOnlyTaskProposal={session_id:sessionId,requirement_sha256:requirementHash,
  base_revision:hash,branch,task_id:"task-ws",epoch:1,agent_id:agent as never,depends_on:[],
  permissions:opts.permissions};
 await coordinator.registerTask(task);
 const issuer=new TrustedAuthorityOnlyChildIssuer({coordinator,nativeCryptoPort:childPort,
  journal:new DurableAuthorityOnlyChildJournal(d("child")),nowMs:nowFn});
 await issuer.issueForRegisteredTask("task-ws",params("urn:w:child","303",600));
 const readEvidence=new Map<string,string>();
 const observer=new TrustedAuthorityOnlyCompletionObserver({async readVerifiedCompletion(expected){
  const e=readEvidence.get(expected.request_id);
  if(!e)throw Error("no Gateway receipt for "+expected.request_id);
  return {...expected,status:"owner_verified_provider_result" as const,evidence_sha256:e,completed_at_ms:clock.now};
 }});
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({repository:repo,engineerDid:did,coordinator,
  approvals,operationalSessionStore:new TrustedOperationalSessionStore(d("gw-sessions")),
  taskJournal:new DurableAuthorityTaskJournal(d("gw-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(d("gw-child")),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(d("seq")),
  completionObserver:observer,projectTestSourceProfile:SAMPLE_TEST_SOURCES,
  ...(opts.batchWrites===false?{}:{batchWritesEnabled:true}),nowMs:nowFn});
 await gate.activate(sessionId,hash);
 await gate.bindTrustedTask("task-ws","runtime-ws",agent as never);
 await gate.enrollTrustedIssuedChild("task-ws","runtime-ws",issuer);
 const client=()=>new GiteaClient({baseUrl:"http://gitea.fixture.invalid",token:"fixture-token",
  owner:"thesis",repository:"sample-app",baseBranch:"main",fetchFn:fake.fetch as never});
 const intentJournal=new DurableAuthorityOnlyWriteSetIntentJournal(d("ws-intents"));
 const preflight=new TrustedAuthorityOnlyWriteSetPreflight({admissions:gate,giteaClient:client(),
  journal:intentJournal,repository:"thesis/sample-app",branch,nowMs:nowFn});
 const key=randomBytes(32);
 const publisher=new TrustedGatewayWriteSetEvidencePublisher({directory:d("ws-evidence"),key,
  repository:"thesis/sample-app",branch,independentGiteaClient:client(),nowMs:nowFn});
 const wsObserver=new AuthenticatedWriteSetCompletionObserver({directory:d("ws-evidence"),key,
  repository:"thesis/sample-app",branch,giteaClient:client(),nowMs:nowFn});
 const verifier=verifierFixture(agent);
 const executor=new TrustedAuthorityOnlyWriteSetExecutor({admissions:gate,giteaClient:client(),
  journal:intentJournal,publisher,verifier,strictReverification:opts.strict!==false,
  repository:"thesis/sample-app",branch,nowMs:nowFn});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const writeBatches=new TrustedWriteBatchStore();
 let n=0;
 const config={audience:"cloud-access-gateway",request_ttl_ms:1_200_000,repository:repo};
 const prepDeps=()=>({store,audit,authorityOnlyAdmissions:gate,nowMs:nowFn,requestId:()=>`req-${n++}`});
 const prepare=(tool:string,path:string,content?:string,challenge="ws-challenge")=>{
  const out=prepareAuthorization({task_id:"runtime-ws",agent_role:agent as never,tool:tool as never,
   arguments:{branch,path,...(content!==undefined?{content}:{})} as never},config,
   {...prepDeps(),challenge:()=>challenge});
  return store.get(out.request_id)!;
 };
 const readAll=async(paths:string[])=>{
  for(const path of paths){
   const r=prepare("read_file",path);
   await gate.stageTrustedSequentialReadEffect(r);
   readEvidence.set(r.request_id,createHash("sha256").update("read:"+path).digest("hex"));
   await gate.attestTrustedSequentialReadEffect("task-ws","runtime-ws");
  }
 };
 const prepareBatch=(changes:{path:string;operation:string;content:string}[])=>prepareWriteBatch(
  {task_id:"runtime-ws",agent_role:agent,tool:"write_files",arguments:{branch,changes}},config,
  {...prepDeps(),batches:writeBatches});
 const stageBatch=(batchId:string)=>stageWriteBatch(batchId,{batches:writeBatches,store,admissions:gate,
  preflight,nowMs:nowFn});
 const policy={async evaluate(){return {allow:true,policy_version:"fixture-opa"};}};
 const execDeps={store,audit,verifier,policy,repository:repo,
  executor:{provider:"gitea" as const,async execute(){throw Error("legacy executor must not run");}},
  authorityOnlyAdmissions:gate,writeBatches,authorityOnlyWriteSetExecutor:executor,nowMs:nowFn};
 const execute=(request_id:string,signed_vp="SIGNED_WRITE_VP")=>
  executeAuthorization({request_id,signed_vp},execDeps as never);
 const verified=(perms:{resource:string;operation:string}[])=>({
  presenter_id:registry[agent as keyof typeof registry].did,credential_id:"urn:w:child",
  issuer_id:"did:thesis:orchestrator",permissions:perms,hierarchy_depth:1,
  expiration:"0",root_credential_id:"urn:w:operational"});
 const close=()=>rm(directory,{recursive:true,force:true});
 return {gate,preflight,publisher,wsObserver,executor,verifier,store,audit,writeBatches,fake,hash,clock,
  client,intentJournal,prepare,readAll,prepareBatch,stageBatch,execute,verified,close};
}
export const writesOf=(perms:{resource:string;operation:string}[])=>perms.filter(x=>x.operation!=="read_file");
export const mixed=[p("read_file",A),p("read_file",B),p("update_file",A),p("update_file",B),p("create_file",N1)];
void nowMs;
