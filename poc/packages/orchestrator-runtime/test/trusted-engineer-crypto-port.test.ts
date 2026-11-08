import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerPrivateMcpEngineerCredentialPort,createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";
import {createOwnerPrivateMcpChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "../src/trusted-engineer-direct-core-port.ts";
import {TrustedEngineerAuthoritySession}
 from "../src/trusted-engineer-authority.ts";
import {makeApproval} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";

const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const uri="gitea://gitea.local/thesis/iam-console-poc";
const file=uri+"/branches/feature%2Freview/files/apps/backend/user.ts";
const DID="did:thesis:engineer",time="2026-10-21T09:00:00Z";
const root=(id:string,index:string,seconds:number)=>({
 credential_id:id,valid_from:time,validity_seconds:seconds,
 credential_status:{
  type:"BitstringStatusListEntry" as const,
  statusPurpose:"revocation" as const,
  statusListIndex:index,statusListCredential:"https://status.example/root"
 }
});
function fixture(denyRevoke=false){
 const calls:{method:string;path:string;body:any;auth:string|null}[]=[];
 const scoped=createOwnerPrivateMcpEngineerCredentialPort({
  adapterBaseUrl:"http://127.0.0.1:8090",
  bearerToken:"PRIVATE_ENGINEER_BEARER",
  fetchFn:async(url,opts)=>{
   const u=new URL(String(url)),body=JSON.parse(String(opts?.body));
   calls.push({method:String(opts?.method),path:u.pathname,body,
    auth:new Headers(opts?.headers).get("authorization")});
   if(u.pathname==="/v1/credentials/status"){
    if(denyRevoke)throw Error("PRIVATE_ADAPTER_REVOCATION_KEY");
    return new Response(JSON.stringify({
     credential_id:body.credential_id,status_set:true,
     status_purpose:"revocation"
    }),{status:200});
   }
   return new Response(JSON.stringify({
    "@context":["https://www.w3.org/ns/credentials/v2"],
    type:["VerifiableCredential","DelegationCredential"],
    id:body.credential_id,issuer:"did:thesis:rust",
    validFrom:body.valid_from,
    credentialSubject:{sub:"did:thesis:orchestrator",per:body.permissions}
   }),{status:201});
  }
 });
 const plan={
  schema_version:"1.0.0",plan_id:"r164-plan",session_id:"r164-session",
  version:1,repository,base_revision:"a".repeat(40),
  requirement:"Implement approved backend change",
  candidate_agents:[{agent_id:"backend",did:"did:thesis:backend",
    card_ref:"trusted:backend"}],
  tasks:[
   {id:"branch",agent_id:"orchestrator",title:"Branch",
    description:"Approved branch",depends_on:[],resources:[uri]},
   {id:"backend",agent_id:"backend",title:"Update",
    description:"Approved edit",depends_on:["branch"],resources:[file]}
  ],
  requested_permissions:[
   {id:"p1",task_id:"branch",agent_id:"orchestrator",
    operation:"create_branch",resource:uri,reason:"Approved branch"},
   {id:"p2",task_id:"backend",agent_id:"backend",
    operation:"update_file",resource:file,reason:"Approved implementation"}
  ],assumptions:[],uncertainties:[]
 };
 const approved=makeApproval(plan,{allowedOperations:new Set(RUST_OPERATIONS),
  decision_id:"r164-approval",approved_by:DID,approved_at:time,
  approved_permission_ids:["p1","p2"]});
 const session=new TrustedEngineerAuthoritySession({
  credentials:scoped,
  snapshot:{session_id:"r164-session",repository,base_revision:"a".repeat(40),
   directories:[""],files:[]},
  approvals:{async loadAuthenticatedApproval(){
   return {plan,approval:approved,authenticated_engineer_did:DID}
  }},
  authenticatedEngineerDid:DID
 });
 return {calls,session};
}

test("R164 two independent Root DCs use one trusted MCP transport and same Rust issuer with confirmed revocation between",async()=>{
 const {calls,session}=fixture();
 const early=await session.startPlanning(root("urn:r164:prelim","810",600));
 assert.equal(early.phase,"planning");
 assert.deepEqual(early.permissions.map(p=>p.operation),
   ["read_repository","list_directory"]);
 const active=await session.approveAndIssueOperationalRoot(
  root("urn:r164:operational","811",3600));
 assert.equal(session.phase,"operational");
 assert.deepEqual(calls.map(c=>c.path),
  ["/v1/credentials/root","/v1/credentials/status",
   "/v1/credentials/root"]);
 assert.deepEqual(calls.map(c=>c.body.credential_id),
  ["urn:r164:prelim","urn:r164:prelim","urn:r164:operational"]);
 assert.ok(calls.every(c=>c.auth==="Bearer PRIVATE_ENGINEER_BEARER"));
 assert.deepEqual(calls[0].body.permissions.map((p:{operation:string})=>p.operation),
   ["read_repository","list_directory"]);
 assert.deepEqual(calls[2].body.permissions.map((p:{operation:string})=>p.operation),
   ["create_branch","update_file"]);
 assert.ok(calls[1].body.status_set);
 assert.notEqual(early.credential_id,active.credential_id);
 assert.equal(calls[0].body.delegatee,"orchestrator");
 assert.equal(calls[2].body.delegatee,"orchestrator");
});
test("R164 failed private Rust root revocation prevents second root and masks secrets",async()=>{
 const {calls,session}=fixture(true);
 await session.startPlanning(root("urn:r164:prelim","810",600));
 await assert.rejects(()=>session.approveAndIssueOperationalRoot(
  root("urn:r164:operational","811",3600)),e=>{
  assert.doesNotMatch(String(e),/PRIVATE_ADAPTER_REVOCATION_KEY/);
  return /revocation not confirmed/.test(String(e));
 });
 assert.equal(session.phase,"failed_closed");
 assert.deepEqual(calls.map(c=>c.path),
  ["/v1/credentials/root","/v1/credentials/status"]);
 await assert.rejects(()=>session.approveAndIssueOperationalRoot(
  root("urn:r164:retry","812",3600)));
 assert.equal(calls.length,2);
});
test("R164 rejected invalid preliminary privileges never reach MCP or Rust",async()=>{
 const {calls,session}=fixture();
 await assert.rejects(()=>session.startPlanning(
  root("urn:r164:too-long","810",3600)),/time budget/);
 assert.equal(calls.length,0);
});

test("R385.0 lazy historical HTTP fixture preserves synchronous validation",()=>{
 assert.throws(()=>createOwnerPrivateMcpEngineerCredentialPort({
  adapterBaseUrl:"",bearerToken:"PRIVATE_ENGINEER_BEARER"
 }),/Delegation Adapter base URL cannot be empty/u);
 assert.throws(()=>createOwnerPrivateMcpEngineerCredentialPort({
  adapterBaseUrl:"http://127.0.0.1:8090",bearerToken:""
 }),/Engineer Adapter token cannot be empty/u);
});

test("R385.0 lazy historical fixture pins approved grants before async module load",async()=>{
 const calls:unknown[]=[];
 const adapter=createOwnerPrivateMcpEngineerCredentialPort({
  adapterBaseUrl:"http://fixture.invalid",bearerToken:"PRIVATE_ENGINEER_BEARER",
  fetchFn:async(_url,options)=>{
   const body=JSON.parse(String(options?.body));
   calls.push(body);
   return new Response(JSON.stringify({
    id:body.credential_id,issuer:"did:thesis:rust",
    credentialSubject:{sub:"did:thesis:orchestrator",per:body.permissions}
   }),{status:201});
  }
 });
 const request={...root("urn:r3850:pinned","991",600),
  permissions:[{resource:uri,operation:"read_repository"}]};
 const pending=adapter.issueScopedOrchestratorRoot(request as never);
 request.permissions[0]!.operation="create_branch";
 const issued=await pending;
 assert.equal(issued.id,"urn:r3850:pinned");
 assert.deepEqual((calls[0] as any).permissions,
  [{resource:uri,operation:"read_repository"}]);
});

test("R218 canonical root and child DC fail closed without a native Rust socket",()=>{
 const previousFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 const previousSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  const transport={
   adapterBaseUrl:"http://127.0.0.1:8090",
   bearerToken:"PRIVATE_ENGINEER_BEARER",
   fetchFn:(async()=>{throw Error("HTTP Adapter must not be called");}) as typeof fetch
  };
  assert.throws(()=>createTrustedEngineerCredentialPort(transport),
    /Canonical Engineer root requires native Rust issuer socket/u);
  assert.throws(()=>createOwnerPrivateMcpChildCryptographyPort(transport),
    /Canonical signed Child DC requires native Rust issuer socket/u);
 }finally{
  if(previousFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=previousFlag;
  if(previousSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=previousSocket;
 }
});

test("R225 Engineer directly calls embedded Rust API for prelim/operational roots and revocation",async()=>{
 const calls:{op:string;token:string;body:Record<string,unknown>}[]=[];
 const secret="PRIVATE_ENGINEER_BEARER";
 const binding={
  start_engineer_core(){throw Error("Injected offline binding must not auto-start");},
  async issue_engineer_root(token:string,payload:string){
   const body=JSON.parse(payload) as Record<string,unknown>;
   calls.push({op:"issue_root",token,body});
   return JSON.stringify({id:body.credential_id,
    credentialSubject:{per:body.permissions}});
  },
  async revoke_engineer_root(token:string,payload:string){
   const body=JSON.parse(payload) as Record<string,unknown>;
   calls.push({op:"revoke_root",token,body});
   return JSON.stringify({credential_id:body.credential_id,
    status_set:true,status_purpose:"revocation"});
  }
 };
 const port=createDirectRustEngineerCredentialPort({
  bearerToken:secret
 },binding);
 const request={...root("urn:r225:preliminary","925",600),
  permissions:[{operation:"read_repository" as const,resource:uri}]};
 const issued=await port.issueScopedOrchestratorRoot(request);
 assert.equal(issued.id,"urn:r225:preliminary");
 assert.deepEqual(calls[0]?.body.permissions,request.permissions);
 assert.equal(calls[0]?.body.delegatee,"orchestrator");
 await port.revokeRoot("urn:r225:preliminary");
 assert.deepEqual(calls[1]?.body,{
  credential_id:"urn:r225:preliminary",status_set:true});
 await port.issueScopedOrchestratorRoot({
  ...root("urn:r225:operational","926",3600),
  permissions:[{operation:"update_file" as const,resource:file}]
 });
 assert.deepEqual(calls.map(c=>c.op),
  ["issue_root","revoke_root","issue_root"]);
 assert.ok(calls.every(c=>c.token===secret));
});

test("R225 direct Rust Engineer rejects changed grants and private signer failures without HTTP fallback",async()=>{
 const config={bearerToken:"PRIVATE_ENGINEER_BEARER"};
 const initial={...root("urn:r225:root","927",600),
  permissions:[{operation:"read_repository" as const,resource:uri}]};
 const altered=createDirectRustEngineerCredentialPort(config,{
  start_engineer_core(){},
  async issue_engineer_root(){return JSON.stringify({
   id:initial.credential_id,
   credentialSubject:{per:[{operation:"update_file",resource:uri}]}
  });},
  async revoke_engineer_root(){throw Error("PRIVATE_SIGNER_KEY");}
 });
 await assert.rejects(()=>altered.issueScopedOrchestratorRoot(initial),
  /Trusted Software Engineer direct Rust Core unavailable/u);
 await assert.rejects(()=>altered.revokeRoot(initial.credential_id),
  error=>{
   assert.match(String(error),/Trusted Software Engineer direct Rust Core unavailable/u);
   assert.doesNotMatch(String(error),/PRIVATE_SIGNER_KEY/u);
   return true;
  });
});

test("R225 direct Engineer selector never silently downgrades when native addon is unavailable",()=>{
 const previousMode=process.env.ENGINEER_CORE_NATIVE_MODE;
 const previousSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="relative.sock";
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Direct Engineer Core requires sole native Rust delegate socket/u);
 }finally{
  if(previousMode===undefined)delete process.env.ENGINEER_CORE_NATIVE_MODE;
  else process.env.ENGINEER_CORE_NATIVE_MODE=previousMode;
  if(previousSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=previousSocket;
 }
});

test("R240 legacy HTTP Engineer fixture needs explicit URL, native direct mode does not",()=>{
 const priorMode=process.env.ENGINEER_CORE_NATIVE_MODE;
 const priorSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const priorFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 try{
  delete process.env.ENGINEER_CORE_NATIVE_MODE;
  delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Legacy HTTP Engineer fixture requires explicit Adapter URL/u);
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="relative.sock";
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Direct Engineer Core requires sole native Rust delegate socket/u);
 }finally{
  if(priorMode===undefined)delete process.env.ENGINEER_CORE_NATIVE_MODE;
  else process.env.ENGINEER_CORE_NATIVE_MODE=priorMode;
  if(priorSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=priorSocket;
  if(priorFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=priorFlag;
 }
});
