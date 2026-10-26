/**
 * Offline integration: actual Gateway prepare/execute, pinned Planning
 * registry and read-only Gitea executor. Adapter presentation, verifier,
 * policy and Gitea transport are explicit fixtures, NOT native Rust/EVM.
 * No Gemini call or production credential material.
 */
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,rm,readFile,writeFile,chmod,readdir} from "node:fs/promises";
import {join} from "node:path";
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {tmpdir} from "node:os";
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
import {startOwnerControlledPlanningReview}
  from "../src/trusted-owner-planning-bootstrap.ts";
import {SignedPlanningCheckpointFileStore}
  from "../src/trusted-planning-checkpoint-store.ts";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";
import {TrustedActivePlanningCheckpoint}
  from "../src/trusted-active-planning-checkpoint.ts";
import {TrustedPlanningRecoveryStore}
  from "../src/trusted-planning-recovery-store.ts";
import {TrustedOperationalRecoveryStore}
  from "../src/trusted-operational-recovery-store.ts";
import {startOwnerControlledEngineerReviewHost}
  from "../../../apps/orchestrator/src/trusted-engineer-host.mjs";
import {prepareConfiguredOwnerEngineerBootstrap}
  from "../../../apps/orchestrator/src/trusted-engineer-service.mjs";
import {TrustedReviewedPlanFile}
  from "../src/trusted-reviewed-plan-file.ts";
import {R5ScriptedNoProviderPlanningModel}
  from "../src/trusted-r5-scripted-planning-model.ts";

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
      // The model must supply the Gemini-compatible repository selector.
      // The trusted read port still invokes read_repository with no arguments.
      {name:"read_repository",args:{repository:"invoices"}},
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
function fixture(options:{tamperPermission?:boolean;tamperPermissionOnCall?:number;policyAllow?:boolean;
  revocationFails?:boolean;planningRecovery?:TrustedPlanningRecoveryStore;
  operationalRecovery?:TrustedOperationalRecoveryStore}={}){
  const observed={adapter:0,verification:0,policy:0,provider:0,
    prepare:0,execute:0,issued:0,revoked:0};
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
      async revokeRoot(id:string){
        assert.equal(id,rootId);
        observed.revoked++;
        if(options.revocationFails)throw Error("offline Rust revocation unconfirmed");
      }
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
      closeSession(){throw Error("Execution prohibited");},
      retireSession(){throw Error("Operational retirement prohibited");}
    },
    credentials:{async revokeRoot(){throw Error("Execution prohibited");}},
    ...(options.operationalRecovery?
      {operationalRecovery:options.operationalRecovery}:{}),
    ...(options.planningRecovery?{planningRecovery:options.planningRecovery}:{})
  });
  const fetchFn:typeof fetch=async(url,init)=>{
    const path=String(url);
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    if(path==="http://trusted-gateway/v1/authorization/prepare"){
      observed.prepare++;
      try{
        const prepared=runtime.prepare(body);
        return response((options.tamperPermission||
          observed.prepare===options.tamperPermissionOnCall)?{
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
  const root=()=>({
    credential_id:rootId,valid_from:new Date().toISOString(),
    validity_seconds:300,
    credential_status:{type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,statusListIndex:"19",
      statusListCredential:"https://example.test/status/planning"}
  });
  const start=()=>coordinator.beginPlanning(root());
  return {coordinator,start,root,makePort,fetchFn,observed,revisions,audit};
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

async function makeOwnerReviewFixture(options:{
  tamperPermission?:boolean;tamperPermissionOnCall?:number;
  revocationFails?:boolean
}={}){
  const planningDir=await mkdtemp(join(tmpdir(),"owner-planning-intents-"));
  const planningRecovery=new TrustedPlanningRecoveryStore(planningDir);
  const operationalDir=await mkdtemp(join(tmpdir(),"owner-operational-intents-"));
  const operationalRecovery=new TrustedOperationalRecoveryStore(operationalDir);
  const f=fixture({...options,planningRecovery,operationalRecovery});
  const receipts=await mkdtemp(join(tmpdir(),"owner-planning-approvals-"));
  const checkpoints=await mkdtemp(join(tmpdir(),"owner-planning-checkpoints-"));
  const plans=await mkdtemp(join(tmpdir(),"owner-planning-ui-plan-"));
  const engineer=generateKeyPairSync("ed25519");
  const backend=generateKeyPairSync("ed25519");
  const backendKeyId="owner-planning-backend";
  const approvals=new SignedEngineerApprovalFileStore({
    directory:receipts,engineerDid:"did:thesis:engineer",
    trustedKeys:{engineer:{engineer_did:"did:thesis:engineer",
      public_key_pem:engineer.publicKey.export({
        format:"pem",type:"spki"
      }).toString()}}
  });
  const gate=new TrustedPlanningReviewGate({
    snapshot,expectedWorkBranch:"feature/invoice-sort",
    authenticatedEngineerDid:"did:thesis:engineer",
    signedApprovals:approvals,
    planningIsActive:()=>f.coordinator.phase==="planning"
  });
  const store=new SignedPlanningCheckpointFileStore({
    directory:checkpoints,
    trust:{
      trustedKeys:{[backendKeyId]:{public_key_pem:
        backend.publicKey.export({format:"pem",type:"spki"}).toString()}},
      expectedSessionId:snapshot.session_id,
      expectedRepository:snapshot.repository,
      expectedBaseRevision:SHA,
      expectedWorkBranch:"feature/invoice-sort"
    }
  });
  const planFilePath=join(plans,snapshot.session_id+".json");
  const planFile=new TrustedReviewedPlanFile({
    filePath:planFilePath,checkpointStore:store
  });
  const makeConfig=()=>({
    coordinator:f.coordinator,snapshot,preliminaryRoot:f.root(),
    planner:{model:new ScriptedPlanner(),snapshot,
      requirement:"Sort invoices by due date",planId:"invoice-proposal-v1",
      workBranch:"feature/invoice-sort",agents},
    gateway:{gatewayBaseUrl:"http://trusted-gateway",
      adapterBaseUrl:"http://trusted-adapter",
      adapterToken:"trusted-orchestrator-token",fetchFn:f.fetchFn},
    reviewGate:gate,checkpointStore:store,reviewPlanFile:planFile,
    planningRecovery,backendKeyId,
    backendPrivateKeyPem:backend.privateKey.export({
      format:"pem",type:"pkcs8"
    }).toString()
  });
  return {...f,store,gate,planningRecovery,operationalRecovery,
    planningDir,operationalDir,planFilePath,
    approvalDir:receipts,checkpointDir:checkpoints,
    backendKeyId,
    backendPublicKeyPem:backend.publicKey.export({
      format:"pem",type:"spki"
    }).toString(),
    engineerPublicKeyPem:engineer.publicKey.export({
      format:"pem",type:"spki"
    }).toString(),
    engineerPrivateKeyPem:engineer.privateKey.export({
      format:"pem",type:"pkcs8"
    }).toString(),
    planFile,makeConfig,async cleanup(){
    await rm(planningDir,{recursive:true,force:true});
    await rm(operationalDir,{recursive:true,force:true});
    await rm(receipts,{recursive:true,force:true});
    await rm(checkpoints,{recursive:true,force:true});
    await rm(plans,{recursive:true,force:true});
  }};
}

test("R5 zero-provider Planning issues original read-only root, performs two Gateway VP/OPA Gitea reads and persists signed human-review checkpoint",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const model=new R5ScriptedNoProviderPlanningModel({
      snapshot,workBranch:"feature/invoice-sort",
      edits:{backend:[FILE],frontend:[SECOND_FILE]},
      newTestFile:"src/billing/status.spec.ts"
    });
    const cfg=f.makeConfig();
    const packet=await startOwnerControlledPlanningReview({
      ...cfg,planner:{...cfg.planner,model}
    });
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.verified_source_reads,2);
    assert.equal(packet.base_revision,SHA);
    assert.deepEqual(packet.plan.tasks.map(t=>t.id),
      ["branch","backend","frontend","test","pr"]);
    assert.deepEqual(packet.plan.requested_permissions
      .filter(p=>p.operation==="update_file").map(p=>p.agent_id),
      ["backend","frontend"]);
    const saved=await f.store.load();
    assert.equal(saved.proposal.digest,packet.plan_digest);
    assert.deepEqual(saved.proposal.plan,packet.plan);
    assert.deepEqual(JSON.parse(await readFile(f.planFilePath,"utf8")),
      packet.plan);
    assert.equal(f.gate.reviewPacket().plan_digest,packet.plan_digest);
    assert.deepEqual({
      issued:f.observed.issued,revoked:f.observed.revoked,
      prepared:f.observed.prepare,adapter:f.observed.adapter,
      verified:f.observed.verification,opa:f.observed.policy,
      executed:f.observed.execute
    },{
      issued:1,revoked:0,prepared:2,adapter:2,verified:2,opa:2,
      executed:2
    });
    // No mock Engineer signature is created. A correct digest is not
    // sufficient to activate independent operational credentials.
    await assert.rejects(
      f.gate.loadAuthenticatedApproval(snapshot.session_id),
      (error:any)=>error.code==="ENOENT");
    assert.equal(f.coordinator.phase,"planning");
    await f.coordinator.closePlanning();
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.revoked,1);
    await f.planningRecovery.assertClean();
  }finally{await f.cleanup();}
});

test("R5 denied second Gateway Planning read never stages a partial signed Engineer plan",async()=>{
  const f=await makeOwnerReviewFixture({tamperPermissionOnCall:2});
  try{
    const model=new R5ScriptedNoProviderPlanningModel({
      snapshot,workBranch:"feature/invoice-sort",
      edits:{backend:[FILE],frontend:[SECOND_FILE]},
      newTestFile:"src/billing/status.spec.ts"
    });
    const cfg=f.makeConfig();
    await assert.rejects(startOwnerControlledPlanningReview({
      ...cfg,planner:{...cfg.planner,model}
    }));
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.issued,1);
    assert.equal(f.observed.revoked,1);
    // The first read DID pass VP/OPA/Gitea; the second was denied by
    // the canonical Gateway permission binding before minting another VP.
    assert.equal(f.observed.prepare,2);
    assert.equal(f.observed.adapter,1);
    assert.equal(f.observed.verification,1);
    assert.equal(f.observed.execute,1);
    await assert.rejects(f.store.load(),(error:any)=>error.code==="ENOENT");
    await assert.rejects(readFile(f.planFilePath,"utf8"),
      (error:any)=>error.code==="ENOENT");
    await f.planningRecovery.assertClean();
  }finally{await f.cleanup();}
});

test("owner bootstrap issues one read-only root, traverses Gateway and persists signed review",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const packet=await startOwnerControlledPlanningReview(f.makeConfig());
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.verified_source_reads,1);
    assert.equal(packet.base_revision,SHA);
    assert.equal((await f.store.load()).proposal.digest,packet.plan_digest);
    const ownerReviewPlan=JSON.parse(await readFile(f.planFilePath,"utf8"));
    assert.equal(ownerReviewPlan.session_id,snapshot.session_id);
    assert.equal(ownerReviewPlan.base_revision,SHA);
    assert.deepEqual(ownerReviewPlan,packet.plan);
    assert.equal(f.gate.reviewPacket().plan_digest,packet.plan_digest);
    assert.equal(f.coordinator.phase,"planning");
    assert.deepEqual({issued:f.observed.issued,revoked:f.observed.revoked,
      adapter:f.observed.adapter,opa:f.observed.policy,execute:f.observed.execute},
      {issued:1,revoked:0,adapter:1,opa:1,execute:1});
    await assert.rejects(startOwnerControlledPlanningReview(f.makeConfig()),
      /idle Coordinator required/);
    const closed=f.coordinator.closePlanning();
    assert.equal(f.coordinator.phase,"failed_closed");
    await closed;
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.revoked,1);
    await f.planningRecovery.assertClean();
    await assert.rejects(f.planningRecovery.assertFreshSession(snapshot.session_id),
      /retired session cannot be reused/);
    await f.coordinator.closePlanning();
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.revoked,1);
  }finally{await f.cleanup();}
});

test("failed owner Planning read cancels root and denies any signed checkpoint",async()=>{
  const f=await makeOwnerReviewFixture({tamperPermission:true});
  try{
    await assert.rejects(startOwnerControlledPlanningReview(f.makeConfig()),
      /no verified read-only grounded proposal/);
    assert.equal(f.observed.issued,1);
    assert.equal(f.observed.revoked,1);
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.adapter,0);
    assert.equal(f.observed.execute,0);
    await assert.rejects(f.store.load(),
      (e:any)=>e.code==="ENOENT");
    await assert.rejects(readFile(f.planFilePath),
      (e:any)=>e.code==="ENOENT");
    await assert.rejects(startOwnerControlledPlanningReview(f.makeConfig()),
      /idle Coordinator required/);
  }finally{await f.cleanup();}
});

test("uncertain native revocation after failed Planning remains terminal",async()=>{
  const f=await makeOwnerReviewFixture({
    tamperPermission:true,revocationFails:true
  });
  try{
    await assert.rejects(startOwnerControlledPlanningReview(f.makeConfig()),
      /manual reconciliation required/);
    assert.equal(f.observed.revoked,1);
    assert.equal(f.coordinator.phase,"failed_closed");
    assert.equal((await f.planningRecovery.pending()).length,1);
    await assert.rejects(f.coordinator.closePlanning(),
      /cancellation not confirmed/);
    assert.equal(f.observed.revoked,1);
    await assert.rejects(f.store.load(),(e:any)=>e.code==="ENOENT");
  }finally{await f.cleanup();}
});

test("signed Planning materializer denies overwriting untrusted Engineer plan",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    await writeFile(f.planFilePath,"{\"untrusted\":true}",{mode:0o600});
    await assert.rejects(startOwnerControlledPlanningReview(f.makeConfig()),
      (e:any)=>e.code==="EEXIST");
    assert.equal(await readFile(f.planFilePath,"utf8"),
      "{\"untrusted\":true}");
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.revoked,1);
    await f.planningRecovery.assertClean();
  }finally{await f.cleanup();}
});

test("review plan file requires the identical independently pinned checkpoint store",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const config=f.makeConfig();
    const alienStore=new SignedPlanningCheckpointFileStore({
      directory:join("/tmp","other-checkpoints"),
      trust:{trustedKeys:{},expectedSessionId:snapshot.session_id,
        expectedRepository:snapshot.repository,
        expectedBaseRevision:SHA,
        expectedWorkBranch:"feature/invoice-sort"}
    });
    assert.throws(()=>f.planFile.assertCheckpointStore(alienStore),
      /checkpoint store identity differs/);
    await assert.rejects(startOwnerControlledPlanningReview({
      ...config,checkpointStore:alienStore
    }),/checkpoint store identity differs/);
    assert.equal(f.observed.issued,0);
  }finally{await f.cleanup();}
});

test("owner Planning and Engineer host bind exact recovery journal, signed UI file and session before root",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const planning=f.makeConfig();
    const host={
      approval:{
        expectedSessionId:snapshot.session_id,
        expectedBaseRevision:SHA,repository:snapshot.repository,
        trustedPlanFile:f.planFilePath,
        planningCheckpointStore:f.store
      },
      recovery:{
        planningDirectory:f.planningDir,directory:f.operationalDir
      },
      operationalRecovery:f.operationalRecovery
    };
    await assert.rejects(startOwnerControlledEngineerReviewHost({
      planning,host:{...host,approval:{
        ...host.approval,trustedPlanFile:join(f.operationalDir,"foreign.json")
      }}
    }),/Engineer host plan path differs/);
    await assert.rejects(startOwnerControlledEngineerReviewHost({
      planning,host:{...host,recovery:{
        ...host.recovery,planningDirectory:f.operationalDir
      }}
    }),/active Planning journal differs|journal differs/);
    await assert.rejects(startOwnerControlledEngineerReviewHost({
      planning,host:{...host,operationalRecovery:
        new TrustedOperationalRecoveryStore(f.operationalDir)}
    }),/recovery journal differs from verified Engineer host/);
    assert.equal(f.observed.issued,0);
    assert.equal(f.coordinator.phase,"idle");
    assert.equal((await f.planningRecovery.pending()).length,0);
  }finally{await f.cleanup();}
});

test("owner Planning generates signed UI plan then strict host denial revokes original root",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const planning=f.makeConfig();
    const host={
      approval:{
        expectedSessionId:snapshot.session_id,
        expectedBaseRevision:SHA,repository:snapshot.repository,
        trustedPlanFile:f.planFilePath,
        planningCheckpointStore:f.store
      },
      recovery:{
        planningDirectory:f.planningDir,directory:f.operationalDir
      },
      operationalRecovery:f.operationalRecovery,
      oidc:{} // Intentionally absent pinned mutual TLS on operational host
    };
    await assert.rejects(startOwnerControlledEngineerReviewHost({
      planning,host
    }),/pinned mutual TLS admission/);
    assert.equal(f.observed.issued,1);
    assert.equal(f.observed.revoked,1);
    assert.equal(f.observed.adapter,1);
    assert.equal(f.observed.verification,1);
    assert.equal(f.observed.policy,1);
    assert.equal(f.coordinator.phase,"closed");
    await f.planningRecovery.assertClean();
    assert.equal(JSON.parse(await readFile(f.planFilePath,"utf8"))
      .session_id,snapshot.session_id);
    assert.equal((await f.store.load()).proposal.digest,
      f.gate.reviewPacket().plan_digest);
    // A crashed/denied host may not silently repeat an old Planning run.
    await assert.rejects(startOwnerControlledEngineerReviewHost({
      planning,host
    }),/owner Planning Coordinator must be unused/);
  }finally{await f.cleanup();}
});


test("R5 protected owner service composes signed ADK Planning with strict host and revokes when IPC unavailable",async()=>{
  const f=await makeOwnerReviewFixture();
  const home=await mkdtemp(join(tmpdir(),"r5-configured-owner-"));
  try{
    const privateDir=join(home,"secrets");
    const replayDir=join(home,"replays");
    const admissionDir=join(home,"admissions");
    for(const d of [privateDir,replayDir,admissionDir]){
      await mkdir(d,{mode:0o700});
    }
    const credentialFiles={
      engineerPrivate:join(privateDir,"engineer.key"),
      engineerPublic:join(privateDir,"engineer.pem"),
      backendPublic:join(privateDir,"backend.pem"),
      githubToken:join(privateDir,"github.read.token"),
      hmac:join(privateDir,"session.hmac.hex"),
      ca:join(privateDir,"ca.pem"),
      server:join(privateDir,"server.pem"),
      serverKey:join(privateDir,"server.key"),
      adapterToken:join(privateDir,"adapter.token"),
      gatewaySecret:join(privateDir,"gateway.secret")
    };
    const fixtures=[
      [credentialFiles.engineerPrivate,f.engineerPrivateKeyPem],
      [credentialFiles.engineerPublic,f.engineerPublicKeyPem],
      [credentialFiles.backendPublic,f.backendPublicKeyPem],
      [credentialFiles.githubToken,"offline-actions-read-only-token"],
      [credentialFiles.hmac,"ab".repeat(32)],
      [credentialFiles.ca,"-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----"],
      [credentialFiles.server,"-----BEGIN CERTIFICATE-----\nHOST\n-----END CERTIFICATE-----"],
      [credentialFiles.serverKey,"-----BEGIN PRIVATE KEY-----\nHOST\n-----END PRIVATE KEY-----"],
      [credentialFiles.adapterToken,"offline-protected-adapter-bearer"],
      [credentialFiles.gatewaySecret,"cd".repeat(32)]
    ] as const;
    for(const [filename,value] of fixtures)
      await writeFile(filename,value,{mode:0o600});
    const protectedConfig={
      approval:{
        engineerDid:"did:thesis:engineer",keyId:"engineer",
        expectedSessionId:snapshot.session_id,
        expectedBaseRevision:SHA,repository:snapshot.repository,
        receiptDirectory:f.approvalDir,
        trustedPlanFile:f.planFilePath,
        privateKeyFile:credentialFiles.engineerPrivate,
        publicKeyPemFile:credentialFiles.engineerPublic,
        passwordSaltHex:"12".repeat(16),
        passwordScryptHex:"34".repeat(64),
        checkpoint:{
          directory:f.checkpointDir,backendKeyId:f.backendKeyId,
          backendPublicKeyPemFile:credentialFiles.backendPublic,
          expectedWorkBranch:"feature/invoice-sort"
        }
      },
      oidc:{
        pinned:{
          repository:"DarkGh0st03/delegation",
          ref:"refs/heads/refactor/post-prof-plan-contracts-20261021",
          workflowPath:".github/workflows/trusted-private-github-session-hold.yml",
          sourceSha:"b".repeat(40)
        },
        trust:{
          expectedAudience:"urn:offline-private-engineer",
          expectedSubject:"repo:DarkGh0st03/delegation:environment:r5-private-admission",
          expectedRepositoryId:"123",expectedOwnerId:"456"
        },
        replayDirectory:replayDir,admissionDirectory:admissionDir,
        bindAddress:"127.0.0.1",
        githubApiTokenFile:credentialFiles.githubToken,
        hmacSecretHexFile:credentialFiles.hmac,
        tls:{
          caFile:credentialFiles.ca,certFile:credentialFiles.server,
          keyFile:credentialFiles.serverKey,
          expectedClientFingerprint256:Array(32).fill("AA").join(":")
        }
      },
      recovery:{
        directory:f.operationalDir,
        planningDirectory:f.planningDir,
        // Deliberately absent. A strict host must confirm live Gateway
        // IPC and durable native revocation before opening ANY listener.
        gatewaySocketPath:join(home,"no-trusted-gateway.sock"),
        gatewaySecretFile:credentialFiles.gatewaySecret,
        adapterBaseUrl:"http://127.0.0.1:8090",
        adapterTokenFile:credentialFiles.adapterToken
      },
      approvalPort:0,oidcPort:0
    };
    const configPath=join(home,"owner-service.json");
    await writeFile(configPath,JSON.stringify(protectedConfig),{mode:0o600});
    await assert.rejects(readFile(f.planFilePath,"utf8"),
      (e:any)=>e.code==="ENOENT");
    // This preparation reads owner-only protected files, but DOES NOT
    // issue a root, contact Gitea/Gateway or invoke the scripted model.
    const prepared=await prepareConfiguredOwnerEngineerBootstrap(configPath,{
      operationalRecovery:f.operationalRecovery
    });
    assert.equal(f.coordinator.phase,"idle");
    assert.equal(f.observed.issued,0);
    assert.equal(prepared.operationalRecovery,f.operationalRecovery);
    assert.notEqual(prepared.planningCheckpointStore,f.store);
    const planning=f.makeConfig();
    // Adopt the exact new backend-signed checkpoint store prepared by
    // the protected service, not the superficially identical test store.
    planning.checkpointStore=prepared.planningCheckpointStore;
    delete (planning as any).reviewPlanFile;
    await assert.rejects(prepared.start(planning),
      /ENOENT|connect|Gateway|IPC/iu);
    assert.equal(f.observed.issued,1);
    assert.equal(f.observed.revoked,1);
    assert.equal(f.coordinator.phase,"closed");
    assert.equal(f.observed.adapter,1);
    assert.equal(f.observed.policy,1);
    assert.equal(f.observed.execute,1);
    const reviewed=JSON.parse(await readFile(f.planFilePath,"utf8"));
    assert.equal(reviewed.session_id,snapshot.session_id);
    assert.equal(reviewed.base_revision,SHA);
    const checkpoint=await prepared.planningCheckpointStore.load();
    assert.equal(checkpoint.proposal.digest,planDigest(reviewed));
    assert.equal((await readdir(admissionDir)).length,0);
    assert.equal((await readdir(replayDir)).length,0);
    await f.planningRecovery.assertClean();
    await assert.rejects(prepared.start(planning),/single-use/);
    await assert.rejects(f.planningRecovery.assertFreshSession(
      snapshot.session_id),/retired session cannot be reused/);
  }finally{
    await rm(home,{recursive:true,force:true});
    await f.cleanup();
  }
});
