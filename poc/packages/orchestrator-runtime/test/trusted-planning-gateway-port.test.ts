/**
 * Offline integration: actual Gateway prepare/execute, pinned Planning
 * registry and read-only Gitea executor. Adapter presentation, verifier,
 * policy and Gitea transport are explicit fixtures, NOT native Rust/EVM.
 * No Gemini call or production credential material.
 */
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection}
  from "@google/adk";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {GiteaReadOnlyExecutor}
  from "../../../apps/gateway/src/gitea-read-executor.ts";
import {TrustedPlanningRevisions}
  from "../../../apps/gateway/src/planning-revisions.ts";
import {InMemoryAuditSink} from "../../../apps/gateway/src/prepare.ts";
import type {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {
  TrustedEngineerAuthoritySession
} from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {TrustedPlanningGatewayReadPort}
  from "../src/trusted-planning-gateway-port.ts";
import {TrustedAdkReadOnlyPlanner}
  from "../src/trusted-adk-planner.ts";
import {TrustedActivePlanningCheckpoint}
  from "../src/trusted-active-planning-checkpoint.ts";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {SignedPlanningCheckpointFileStore}
  from "../src/trusted-planning-checkpoint-store.ts";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";

const SHA="a".repeat(40),FILE="src/billing/invoice.ts";
const SECOND_FILE="src/billing/tax.ts";
const rootId="urn:test:planning-root";
const snapshot={
  session_id:"trusted-billing-planning",
  repository:{authority:"gitea.local",owner:"thesis",repository:"invoices"},
  base_revision:SHA,
  directories:["","src","src/billing"],files:[FILE,SECOND_FILE]
};
const agents={
  backend:{did:"did:thesis:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:thesis:test",card_ref:"trusted:test"}
};
const proposal={
  tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create branch",
      description:"Create working branch",depends_on:[],
      permissions:[{operation:"create_branch",path:null,reason:"Isolate changes"}]},
    {id:"backend",agent_id:"backend",title:"Update invoice service",
      description:"Implement approved behavior",depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:FILE,reason:"Inspect source"},
        {operation:"update_file",path:FILE,reason:"Apply change"}
      ]}
  ],
  assumptions:[],uncertainties:[]
};
class ScriptedPlanner extends BaseLlm {
  requests:LlmRequest[]=[];
  constructor(){super({model:"offline-planner-with-gateway"});}
  override async *generateContentAsync(request:LlmRequest):
    AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    if(this.requests.length===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-1",name:"read_file",args:{branch:"main",path:FILE}
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:JSON.stringify(proposal)}]}};
    }
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("No live model in test"));
  }
}
/** Real multi-call ADK sequence: every operation passes the Gateway. */
class MultiReadScriptedPlanner extends BaseLlm {
  requests:LlmRequest[]=[];
  readonly readOutsideScope:boolean;
  constructor(readOutsideScope=false){
    super({model:"offline-gateway-multi-read"});
    this.readOutsideScope=readOutsideScope;
  }
  override async *generateContentAsync(request:LlmRequest):
    AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    const calls=[
      {name:"read_repository",args:{}},
      {name:"list_directory",args:{branch:"main",path:"src"}},
      {name:"list_directory",args:{branch:"main",path:"src/billing"}},
      {name:"read_file",args:{branch:"main",path:FILE}},
      {name:"read_file",args:{branch:"main",
        path:this.readOutsideScope?"src/secrets.txt":SECOND_FILE}}
    ];
    const call=calls[this.requests.length-1];
    if(call){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-"+this.requests.length,name:call.name,args:call.args
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:JSON.stringify(proposal)}]}};
    }
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("Offline test may not call Gemini"));
  }
}
function response(value:unknown,status=200){
  return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
}
function fixture(options:{tamperPermission?:boolean;policyAllow?:boolean}={}){
  const observed={adapter:0,verification:0,policy:0,provider:0,
    prepare:0,execute:0,issued:0};
  const signed=new Map<string,{resource:string;operation:string;challenge:string;audience:string}>();
  const client={
    async readRepository(revision?:string){
      observed.provider++;
      return {full_name:"thesis/invoices",default_branch:"main",revision:revision??SHA};
    },
    async readTextFile(branch:string,path:string,revision?:string){
      observed.provider++;
      assert.equal(branch,"main");
      assert.ok([FILE,SECOND_FILE].includes(path));assert.equal(revision,SHA);
      const content=path===FILE?"export const invoices = [];\n":
        "export const taxRate = 0.22;\n";
      return {branch,path,revision:SHA,content,
        encoding:"utf-8" as const,blob_sha:"b".repeat(40),
        last_commit_sha:SHA,size:Buffer.byteLength(content,"utf8")};
    },
    async listDirectory(branch:string,path:string,revision?:string){
      observed.provider++;
      assert.equal(branch,"main");assert.equal(revision,SHA);
      return {branch,path,revision:SHA,entries:path===""?
        [{name:"src",path:"src",type:"dir"}]:
        path==="src"?
          [{name:"billing",path:"src/billing",type:"dir"}]:
          [{name:"invoice.ts",path:FILE,type:"file"},
            {name:"tax.ts",path:SECOND_FILE,type:"file"}]};
    }
  };
  const revisions=new TrustedPlanningRevisions(client);
  const audit=new InMemoryAuditSink();
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,
      repository:snapshot.repository},
    verifier_mode:"adapter",opa_url:"http://offline-opa.invalid",
    opa_timeout_ms:500,provider_mode:"mock",gitea_timeout_ms:500
  },{
    planningRevisions:revisions,audit,
    executor:new GiteaReadOnlyExecutor(client as unknown as GiteaClient),
    verifier:{async verify(input){
      observed.verification++;
      const permission=signed.get(input.signed_vp);
      if(!permission||permission.audience!==input.audience||
         permission.challenge!==input.challenge||
         permission.operation!==input.required_permission.operation||
         permission.resource!==input.required_permission.resource)
        throw Error("Fixture proof binding rejected");
      return {presenter_id:"did:thesis:orchestrator",
        credential_id:rootId,issuer_id:"did:thesis:engineer",
        hierarchy_depth:1,expiration:"999999999999",
        permissions:[input.required_permission]};
    }},
    policy:{async evaluate(input){
      observed.policy++;
      assert.equal(input.pinned_revision,SHA);
      return {allow:options.policyAllow!==false,policy_version:"offline-planning-opa-fixture"};
    }}
  });
  const authority=new TrustedEngineerAuthoritySession({
    snapshot,
    credentials:{
      async issueScopedOrchestratorRoot(req){
        observed.issued++;
        assert.equal(req.credential_id,rootId);
        assert.ok(req.permissions.every(p=>[
          "read_file","list_directory","read_repository"
        ].includes(p.operation)));
        return {
          "@context":["https://www.w3.org/ns/credentials/v2"],
          type:["VerifiableCredential","DelegationCredential"],
          id:req.credential_id,issuer:"did:thesis:engineer",
          validFrom:new Date().toISOString(),
          credentialSubject:{sub:"did:thesis:orchestrator",
            per:req.permissions.map(x=>({...x}))}
        };
      },
      async revokeRoot(){throw Error("No revocation should run in this test");}
    },
    approvals:{async loadAuthenticatedApproval(){throw Error("No approval exists");}},
    authenticatedEngineerDid:"did:thesis:engineer",
    planningRevisions:revisions
  });
  const coordinator=new TrustedExecutionCoordinator({
    authority,sessionId:snapshot.session_id,baseRevision:SHA,
    approvedGatewayPlans:{
      async activate(){throw Error("Execution prohibited");},
      bindTask(){throw Error("Execution prohibited");},
      async confirmTaskCompletion(){throw Error("Execution prohibited");},
      closeSession(){throw Error("Execution prohibited");}
    },
    credentials:{async revokeRoot(){throw Error("Execution prohibited");}}
  });
  const fetchFn:typeof fetch=async(url,init)=>{
    const path=String(url);
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    if(path==="http://trusted-gateway/v1/authorization/prepare"){
      observed.prepare++;
      try{
        const prepared=runtime.prepare(body);
        return response(options.tamperPermission?{
          ...prepared,required_permission:{
            resource:"gitea://attacker.invalid/other",
            operation:prepared.required_permission.operation}
        }:prepared,201);
      }catch{return response({error:"Gateway prepare denied"},403);}
    }
    if(path==="http://trusted-adapter/v1/presentations"){
      observed.adapter++;
      assert.equal(new Headers(init?.headers).get("authorization"),
        "Bearer trusted-orchestrator-token");
      assert.equal(body.credential_id,rootId);
      assert.ok(Array.isArray(body.disclosed_permissions));
      const permission=(body.disclosed_permissions as Array<{resource:string;operation:string}>)[0];
      const token="fixture-signed-vp-"+observed.adapter;
      signed.set(token,{...permission,challenge:String(body.challenge),
        audience:String(body.audience)});
      return response({signed_vp:token},201);
    }
    if(path==="http://trusted-gateway/v1/authorization/execute"){
      observed.execute++;
      try{
        return response(await runtime.execute(body));
      }catch{return response({error:"Gateway execution denied"},403);}
    }
    throw Error("Unexpected transport target");
  };
  const makePort=()=>new TrustedPlanningGatewayReadPort({
    coordinator,snapshot,
    gatewayBaseUrl:"http://trusted-gateway",
    adapterBaseUrl:"http://trusted-adapter",
    adapterToken:"trusted-orchestrator-token",
    fetchFn
  });
  const start=()=>coordinator.beginPlanning({
    credential_id:rootId,valid_from:new Date().toISOString(),
    validity_seconds:300,
    credential_status:{type:"BitstringStatusListEntry",
      statusPurpose:"revocation",statusListIndex:"19",
      statusListCredential:"https://example.test/status/planning"}
  });
  return {coordinator,start,makePort,observed,revisions,audit};
}

test("trusted coordinator-issued root -> Gateway VP/OPA -> pinned Gitea -> unapproved ADK plan",async()=>{
  const f=fixture();
  await assert.rejects(async()=>f.makePort(),/Active verified Planning root/);
  const issued=await f.start();
  assert.equal(issued.phase,"planning");
  assert.equal(issued.credential_id,rootId);
  const model=new ScriptedPlanner();
  const draft=await new TrustedAdkReadOnlyPlanner({
    model,snapshot,
    requirement:"Sort invoices by due date",planId:"invoice-proposal-v1",
    workBranch:"feature/invoice-sort",agents,readPort:f.makePort()
  }).propose();
  assert.equal(draft.status,"unapproved_proposal");
  assert.equal(draft.verified_source_reads,1);
  assert.equal(draft.plan.base_revision,SHA);
  assert.equal(draft.plan.candidate_agents[0]?.did,agents.backend.did);
  assert.deepEqual({adapter:f.observed.adapter,
    verify:f.observed.verification,policy:f.observed.policy,
    execute:f.observed.execute}, {adapter:1,verify:1,policy:1,execute:1});
  assert.equal(f.audit.events.filter(e=>e.event==="authorization_prepared").length,1);
  assert.ok(f.audit.events.filter(e=>e.event==="authorization_prepared")
    .every(e=>e.pinned_revision===SHA));
  const visible=JSON.stringify(model.requests);
  for(const hidden of [rootId,"trusted-orchestrator-token","signed-vp",
    "delegation_evidence","authenticatedEngineerDid"])
    assert.ok(!visible.includes(hidden),hidden);
});

test("R1 multiple Gateway-backed ADK reads preserve VP, OPA and Gitea SHA per operation",async()=>{
  const f=fixture();await f.start();
  const model=new MultiReadScriptedPlanner();
  const draft=await new TrustedAdkReadOnlyPlanner({
    model,snapshot,
    requirement:"Sort invoices and calculate tax",
    planId:"invoice-multi-read-proposal",workBranch:"feature/invoice-sort",
    agents,readPort:f.makePort()
  }).propose();
  assert.equal(draft.status,"unapproved_proposal");
  // Only distinct file reads count as source reads; repository and directory
  // metadata also traverse Prepare/Execute but do not inflate this counter.
  assert.equal(draft.verified_source_reads,2);
  assert.equal(draft.plan.base_revision,SHA);
  assert.equal(model.requests.length,6);
  assert.deepEqual({
    prepare:f.observed.prepare,adapter:f.observed.adapter,
    verify:f.observed.verification,opa:f.observed.policy,
    execute:f.observed.execute,provider:f.observed.provider
  },{prepare:5,adapter:5,verify:5,opa:5,execute:5,provider:6});
  const entries=f.audit.events.filter(e=>e.event==="authorization_prepared");
  assert.equal(entries.length,5);
  assert.ok(entries.every(e=>e.pinned_revision===SHA));
  const visible=JSON.stringify(model.requests);
  for(const secret of [rootId,"trusted-orchestrator-token",
    "fixture-signed-vp","signed_vp","adapterToken"])
    assert.ok(!visible.includes(secret),secret);
});

test("R1 out-of-scope ADK arguments never reach Gateway or mint an additional VP",async()=>{
  const f=fixture();await f.start();
  const model=new MultiReadScriptedPlanner(true);
  const draft=await new TrustedAdkReadOnlyPlanner({
    model,snapshot,
    requirement:"Sort invoices without secrets",
    planId:"invoice-unapproved-source",workBranch:"feature/invoice-sort",
    agents,readPort:f.makePort()
  }).propose();
  // ADK's strict enum rejects unknown paths BEFORE the FunctionTool. The
  // Planner is still permitted to return an UNAPPROVED draft grounded by an
  // earlier legitimate file read; it does NOT grant write authority.
  assert.equal(draft.status,"unapproved_proposal");
  assert.equal(draft.verified_source_reads,1);
  assert.deepEqual({
    adapter:f.observed.adapter,verify:f.observed.verification,
    opa:f.observed.policy,execute:f.observed.execute,
    provider:f.observed.provider
  },{adapter:4,verify:4,opa:4,execute:4,provider:5});
});

test("bound Planning port refuses write, outside files and non-main without Adapter calls",async()=>{
  const f=fixture();await f.start();
  const port=f.makePort();
  for(const [tool,args] of [
    ["update_file",{branch:"main",path:FILE,content:"evil"}],
    ["read_file",{branch:"main",path:"secrets/passwords.txt"}],
    ["read_file",{branch:"feature/other",path:FILE}],
    ["list_directory",{branch:"main",path:"private"}],
    ["read_repository",{branch:"main"}]
  ] as const){
    await assert.rejects(port.invoke(tool as never,args));
  }
  assert.equal(f.observed.prepare,0);
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.provider,1); // trusted beginPlanning SHA lookup only
});

test("bad Gateway permission binding is rejected before Adapter signing",async()=>{
  const f=fixture({tamperPermission:true});await f.start();
  await assert.rejects(f.makePort().invoke("read_file",{
    branch:"main",path:FILE
  }),/challenge does not match trusted resource/);
  assert.equal(f.observed.prepare,1);
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.execute,0);
});

test("ended Planning session rejects a retained port before provider execution",async()=>{
  const f=fixture();await f.start();
  const port=f.makePort();
  f.revisions.end(snapshot.session_id);
  await assert.rejects(port.invoke("read_file",{branch:"main",path:FILE}));
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.execute,0);
});

test("OPA denial prevents Gitea read and ADK proposal",async()=>{
  const f=fixture({policyAllow:false});await f.start();
  const model=new ScriptedPlanner();
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    model,snapshot,
    requirement:"Sort invoices by due date",planId:"invoice-proposal-v1",
    workBranch:"feature/invoice-sort",agents,readPort:f.makePort()
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(f.observed.verification,1);
  assert.equal(f.observed.policy,1);
  assert.equal(f.observed.provider,1);
  assert.equal(f.observed.execute,1);
});

async function checkpointFixture(){
  const f=fixture();
  const receiptDir=await mkdtemp(join(tmpdir(),"live-planning-receipts-"));
  const checkpointDir=await mkdtemp(join(tmpdir(),"live-planning-checkpoint-"));
  const engineer=generateKeyPairSync("ed25519");
  const backend=generateKeyPairSync("ed25519");
  const keyId="planning-backend-key";
  const privateKeyPem=backend.privateKey.export({
    format:"pem",type:"pkcs8"
  }).toString();
  const publicKeyPem=backend.publicKey.export({
    format:"pem",type:"spki"
  }).toString();
  const signedApprovals=new SignedEngineerApprovalFileStore({
    directory:receiptDir,engineerDid:"did:thesis:engineer",
    trustedKeys:{engineer:{engineer_did:"did:thesis:engineer",
      public_key_pem:engineer.publicKey.export({
        format:"pem",type:"spki"
      }).toString()}}
  });
  const reviewGate=new TrustedPlanningReviewGate({
    snapshot,expectedWorkBranch:"feature/invoice-sort",
    authenticatedEngineerDid:"did:thesis:engineer",
    signedApprovals,planningIsActive:()=>f.coordinator.phase==="planning"
  });
  const checkpointStore=new SignedPlanningCheckpointFileStore({
    directory:checkpointDir,
    trust:{
      trustedKeys:{[keyId]:{public_key_pem:publicKeyPem}},
      expectedSessionId:snapshot.session_id,
      expectedRepository:snapshot.repository,
      expectedBaseRevision:SHA,
      expectedWorkBranch:"feature/invoice-sort"
    }
  });
  const planner=()=>new TrustedAdkReadOnlyPlanner({
    model:new ScriptedPlanner(),snapshot,
    requirement:"Sort invoices by due date",planId:"invoice-proposal-v1",
    workBranch:"feature/invoice-sort",agents,readPort:f.makePort()
  });
  const config=(instance:TrustedAdkReadOnlyPlanner)=>({
    coordinator:f.coordinator,planner:instance,reviewGate,
    checkpointStore,snapshot,expectedWorkBranch:"feature/invoice-sort",
    backendKeyId:keyId,backendPrivateKeyPem:privateKeyPem
  });
  return {...f,reviewGate,checkpointStore,planner,config,
    async close(){
      await rm(receiptDir,{recursive:true,force:true});
      await rm(checkpointDir,{recursive:true,force:true});
    }};
}

test("active real Gateway Planning produces one durable backend-signed review packet",async()=>{
  const f=await checkpointFixture();
  try{
    await f.start();
    const model=f.planner();
    const bridge=new TrustedActivePlanningCheckpoint(f.config(model));
    const packet=await bridge.proposePersistAndStage();
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.session_id,snapshot.session_id);
    assert.equal(packet.base_revision,SHA);
    assert.equal(packet.verified_source_reads,1);
    const saved=await f.checkpointStore.load();
    assert.equal(saved.proposal.digest,packet.plan_digest);
    assert.equal(f.reviewGate.reviewPacket().plan_digest,packet.plan_digest);
    assert.equal(f.observed.prepare,1);
    assert.equal(f.observed.adapter,1);
    assert.equal(f.observed.verification,1);
    assert.equal(f.observed.policy,1);
    assert.equal(f.observed.execute,1);
    // No operational credential or autonomous human approval.
    assert.equal(f.observed.issued,1);
    assert.equal(f.coordinator.phase,"planning");
    await assert.rejects(bridge.proposePersistAndStage(),/one attempt only/);
  }finally{await f.close();}
});

test("checkpoint bridge rejects forged snapshot and unrelated Planning authority",async()=>{
  const f=await checkpointFixture();
  try{
    await f.start();
    const goodPlanner=f.planner();
    const changed={...snapshot,base_revision:"b".repeat(40)};
    assert.throws(()=>new TrustedActivePlanningCheckpoint({
      ...f.config(goodPlanner),snapshot:changed
    }),/missing or changed active authority/);
    // A real port bound to a different coordinator is not equivalent to
    // merely copying the same root ID and SHA.
    const other=fixture();await other.start();
    assert.throws(()=>new TrustedActivePlanningCheckpoint({
      ...f.config(goodPlanner),coordinator:other.coordinator
    }),/inactive or out-of-scope read/);
    assert.equal(f.observed.adapter,0);
    assert.equal(f.observed.execute,0);
    await assert.rejects(f.checkpointStore.load(),
      (error:any)=>error.code==="ENOENT");
  }finally{await f.close();}
});

test("backend signing key must be valid before any model read",async()=>{
  const f=await checkpointFixture();
  try{
    await f.start();
    const planner=f.planner();
    assert.throws(()=>new TrustedActivePlanningCheckpoint({
      ...f.config(planner),backendPrivateKeyPem:"not a private key"
    }),/missing or changed active authority/);
    assert.equal(f.observed.adapter,0);
    assert.equal(f.observed.execute,0);
    await assert.rejects(f.checkpointStore.load(),
      (error:any)=>error.code==="ENOENT");
  }finally{await f.close();}
});
