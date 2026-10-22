/**
 * Offline integration: actual Gateway prepare/execute, pinned Planning
 * registry and read-only Gitea executor. Adapter presentation, verifier,
 * policy and Gitea transport are explicit fixtures, NOT native Rust/EVM.
 * No Gemini call or production credential material.
 */
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

const SHA="a".repeat(40),FILE="src/billing/invoice.ts";
const rootId="urn:test:planning-root";
const snapshot={
  session_id:"trusted-billing-planning",
  repository:{authority:"gitea.local",owner:"thesis",repository:"invoices"},
  base_revision:SHA,
  directories:["","src","src/billing"],files:[FILE]
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
      assert.equal(branch,"main");assert.equal(path,FILE);assert.equal(revision,SHA);
      return {branch,path,revision:SHA,content:"export const invoices = [];\n",
        encoding:"utf-8" as const,blob_sha:"b".repeat(40),
        last_commit_sha:SHA,size:28};
    },
    async listDirectory(branch:string,path:string,revision?:string){
      observed.provider++;
      assert.equal(branch,"main");assert.equal(revision,SHA);
      return {branch,path,revision:SHA,entries:path===""?
        [{name:"src",path:"src",type:"dir"}]:
        [{name:"billing",path:"src/billing",type:"dir"}]};
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
