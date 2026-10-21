import assert from "node:assert/strict";
import test from "node:test";
import {makeApproval} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {
  TrustedEngineerAuthoritySession, preliminaryReadPermissions,
  type EngineerCredentialPort, type TrustedApprovalRecord
} from "../src/trusted-engineer-authority.ts";
import type {
  IssuedDelegationCredential
} from "../src/authority-client.ts";
import type {DelegatedPermission} from "../src/permission-templates.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const rootUri="gitea://gitea.local/thesis/iam-console-poc";
const featureFile=rootUri+"/branches/feature%2Faccount-suspension/files/apps/backend/user.ts";
const MAIN_FILE="apps/backend/user.ts";
const PREP_ID="urn:stage9:preliminary";
const OPER_ID="urn:stage9:operational";
const did="did:thesis:engineer";
const catalogue=new Set(RUST_OPERATIONS);

function snapshot(){
  return {
    session_id:"session-s1",repository:repo,base_revision:"a".repeat(40),
    directories:["","apps","apps/backend"],files:[MAIN_FILE]
  };
}
function status(index:string) {
  return {
    type:"BitstringStatusListEntry" as const,
    statusPurpose:"revocation" as const,
    statusListIndex:index,
    statusListCredential:"https://status.example/lists/phase9"
  };
}
const time="2026-10-21T09:00:00Z";
function root(credential_id:string,index:string,ttl:number){
  return {credential_id,valid_from:time,validity_seconds:ttl,
    credential_status:status(index)};
}
function plan(){
  return {
    schema_version:"1.0.0",plan_id:"plan-1",
    session_id:"session-s1",version:1,
    repository:repo,base_revision:"a".repeat(40),
    requirement:"Implement bounded backend operation",
    candidate_agents:[{
      agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
    }],
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Create branch",
       description:"Create an approved working branch",depends_on:[],
       resources:[rootUri]},
      {id:"backend",agent_id:"backend",title:"Edit implementation",
       description:"Update one approved file",depends_on:["branch"],
       resources:[featureFile]},
      {id:"pr",agent_id:"orchestrator",title:"Review",
       description:"Raise a protected PR",depends_on:["backend"],
       resources:[rootUri]}
    ],
    requested_permissions:[
      {id:"p-branch",task_id:"branch",agent_id:"orchestrator",
       operation:"create_branch",resource:rootUri,reason:"Create feature branch"},
      {id:"p-backend",task_id:"backend",agent_id:"backend",
       operation:"update_file",resource:featureFile,reason:"Edit approved file"},
      {id:"p-pr",task_id:"pr",agent_id:"orchestrator",
       operation:"create_pull_request",resource:rootUri,reason:"Review only"}
    ],
    assumptions:[],uncertainties:[]
  };
}
function trustedApproval(planValue:ReturnType<typeof plan>=plan(), ids=["p-branch","p-backend"]):TrustedApprovalRecord{
  return {
    plan:structuredClone(planValue),
    approval:makeApproval(planValue,{
      allowedOperations:catalogue,decision_id:"decision-s1",
      approved_by:did,approved_at:time,approved_permission_ids:ids
    }),
    authenticated_engineer_did:did
  };
}
class Adapter implements EngineerCredentialPort {
  readonly calls:{operation:string;id:string;permissions?:readonly DelegatedPermission[]}[]=[];
  failRevoke=false;
  async issueScopedOrchestratorRoot(request:{
    credential_id:string;permissions:readonly DelegatedPermission[]
  }):Promise<IssuedDelegationCredential>{
    this.calls.push({operation:"issue",id:request.credential_id,
      permissions:structuredClone(request.permissions)});
    return {
      "@context":["https://www.w3.org/ns/credentials/v2"],
      type:["VerifiableCredential","DelegationCredential"],
      id:request.credential_id,issuer:did,validFrom:time,
      credentialSubject:{sub:"did:thesis:orchestrator",per:
        request.permissions.map(x=>({...x}))}
    };
  }
  async revokeRoot(id:string):Promise<void>{
    this.calls.push({operation:"revoke",id});
    if(this.failRevoke)throw new Error("EVM status update refused");
  }
}
function fixture(record:TrustedApprovalRecord=trustedApproval()){
  const adapter=new Adapter();
  let loads=0;
  const session=new TrustedEngineerAuthoritySession({
    snapshot:snapshot(),credentials:adapter,
    approvals:{async loadAuthenticatedApproval(id){
      loads++;
      assert.equal(id,"session-s1");
      return structuredClone(record);
    }},
    authenticatedEngineerDid:did
  });
  return {adapter,session, get loads(){return loads}};
}

test("preliminary root lists only exact read-only operations on main and is bounded",()=>{
  const perms=preliminaryReadPermissions(snapshot());
  assert.deepEqual(perms.map(x=>x.operation),[
    "read_repository","list_directory","list_directory","list_directory","read_file"
  ]);
  assert.deepEqual(perms.map(x=>x.resource),[
    rootUri,
    rootUri+"/branches/main/directories",
    rootUri+"/branches/main/directories/apps",
    rootUri+"/branches/main/directories/apps/backend",
    rootUri+"/branches/main/files/"+MAIN_FILE
  ]);
  for(const attack of [
    {...snapshot(),files:["../../secret"]},
    {...snapshot(),files:["/etc/shadow"]},
    {...snapshot(),directories:["","apps//backend"]},
    {...snapshot(),directories:["",""]},
    {...snapshot(),directories:["apps"]},
    {...snapshot(),files:["apps/%2e%2e/secret"]},
    {...snapshot(),base_revision:"main"}
  ])assert.throws(()=>preliminaryReadPermissions(attack));
});

test("approval revokes preliminary root before independent operational root issuance",async()=>{
  const {session,adapter}=fixture();
  const planning=await session.startPlanning(root(PREP_ID,"100",600));
  assert.equal(session.phase,"planning");
  assert.equal(planning.permissions.length,5);
  assert.ok(planning.permissions.every(x=>x.operation.startsWith("read_") ||
    x.operation==="list_directory"));
  const result=await session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600));
  assert.equal(session.phase,"operational");
  assert.equal(result.phase,"operational");
  assert.match(result.plan_digest,/^[0-9a-f]{64}$/);
  assert.deepEqual(adapter.calls.map(x=>x.operation),["issue","revoke","issue"]);
  assert.deepEqual(adapter.calls.map(x=>x.id),[PREP_ID,PREP_ID,OPER_ID]);
  assert.deepEqual(adapter.calls[2].permissions,[
    {operation:"create_branch",resource:rootUri},
    {operation:"update_file",resource:featureFile}
  ]);
  assert.ok(!adapter.calls[2].permissions?.some(p=>p.operation==="create_pull_request"));
  await assert.rejects(()=>session.approveAndIssueOperationalRoot(root("another","102",3600)),
    /active preliminary authority missing/);
});

test("approval is sourced from trusted store, not caller-supplied plan",async()=>{
  const {session,adapter}=fixture();
  await session.startPlanning(root(PREP_ID,"100",600));
  const extra={...root(OPER_ID,"101",3600),approval:trustedApproval(),plan:plan()};
  await session.approveAndIssueOperationalRoot(extra);
  assert.equal(adapter.calls[2].permissions?.length,2);
});

test("wrong Engineer identity, changed plan digest, version, base SHA and repository deny before revocation",async()=>{
  for(const altered of [
    {...trustedApproval(),authenticated_engineer_did:"did:thesis:attacker"},
    {...trustedApproval(),approval:{...trustedApproval().approval,approved_by:"did:thesis:attacker"}},
    {...trustedApproval(),plan:{...plan(),base_revision:"b".repeat(40)}},
    {...trustedApproval(),plan:{...plan(),version:2}},
    {...trustedApproval(),plan:{...plan(),repository:{...repo,owner:"attacker"}}},
    {...trustedApproval(),plan:{...plan(),requirement:"malicious surprise"}}
  ]){
    const {session,adapter}=fixture(altered);
    await session.startPlanning(root(PREP_ID,"100",600));
    await assert.rejects(()=>session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600)));
    assert.deepEqual(adapter.calls.map(x=>x.operation),["issue"]);
  }
});

test("unapproved operation and disabled provider capability cannot be minted",async()=>{
  for(const op of ["delete_file","merge_pull_request","trigger_workflow","write_file"]){
    const p=plan();p.requested_permissions[1].operation=op;
    const scope=trustedApproval(p);
    const {session,adapter}=fixture(scope);
    await session.startPlanning(root(PREP_ID,"100",600));
    await assert.rejects(()=>session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600)),
      /unimplemented or unapproved tool operation/);
    assert.deepEqual(adapter.calls.map(x=>x.operation),["issue"]);
  }
});

test("no main-branch mutation, foreign-repo or noncanonical scopes are approved",async()=>{
  for(const badUri of [
    rootUri+"/branches/main/files/apps/backend/user.ts",
    "gitea://attacker.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/user.ts",
    rootUri+"/branches/feature%2Faccount-suspension/files/../secrets",
    rootUri+"/branches/feature%2Faccount-suspension/files/%2e%2e/secret",
    rootUri+"/branches/feature%2Faccount-suspension/directories/",
    rootUri+"/branches/feature%2Faccount-suspension/files/apps%2Fbackend/user.ts"
  ]){
    const p=plan();p.tasks[1].resources=[badUri];
    p.requested_permissions[1].resource=badUri;
    const {session,adapter}=fixture(trustedApproval(p));
    await session.startPlanning(root(PREP_ID,"100",600));
    await assert.rejects(()=>session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600)));
    assert.deepEqual(adapter.calls.map(x=>x.operation),["issue"]);
  }
});

test("failed or ambiguous provisional revocation cannot create operational authority",async()=>{
  const {session,adapter}=fixture();
  await session.startPlanning(root(PREP_ID,"100",600));
  adapter.failRevoke=true;
  await assert.rejects(()=>session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600)),
    /revocation not confirmed/);
  assert.equal(session.phase,"failed_closed");
  assert.deepEqual(adapter.calls.map(x=>x.operation),["issue","revoke"]);
  await assert.rejects(()=>session.approveAndIssueOperationalRoot(root("retry","102",3600)),
    /active preliminary authority missing/);
});

test("issuer rejects reused root ids, statuses, excessive lifetimes and double planning",async()=>{
  const {session,adapter}=fixture();
  await assert.rejects(()=>session.startPlanning(root(PREP_ID,"100",901)),/time budget/);
  assert.equal(adapter.calls.length,0);
  await session.startPlanning(root(PREP_ID,"100",900));
  await assert.rejects(()=>session.startPlanning(root("another","102",600)));
  for(const invalid of [
    root(PREP_ID,"101",3600),
    root(OPER_ID,"100",3600),
    root(OPER_ID,"101",7201)
  ])await assert.rejects(()=>session.approveAndIssueOperationalRoot(invalid));
  assert.equal(adapter.calls.length,1);
});

test("revocation network response is acknowledged before any root issuance",async()=>{
  let release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve});
  const adapter=new Adapter();
  const revoke=adapter.revokeRoot.bind(adapter);
  adapter.revokeRoot=async(id)=>{await barrier;await revoke(id)};
  const session=new TrustedEngineerAuthoritySession({
    snapshot:snapshot(),credentials:adapter,
    approvals:{async loadAuthenticatedApproval(){return trustedApproval()}},
    authenticatedEngineerDid:did
  });
  await session.startPlanning(root(PREP_ID,"100",600));
  const pending=session.approveAndIssueOperationalRoot(root(OPER_ID,"101",3600));
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(session.phase,"operational");
  await assert.rejects(()=>session.approveAndIssueOperationalRoot(root("second","103",3600)));
  release();
  await pending;
  assert.deepEqual(adapter.calls.map(x=>x.operation),["issue","revoke","issue"]);
});
