/**
 * Offline integration: actual Gateway prepare/execute, pinned Planning
 * registry and read-only Gitea executor. Adapter presentation, verifier,
 * policy and Gitea transport are explicit fixtures, NOT native Rust/EVM.
 * No Gemini call or production credential material.
 */
import {generateKeyPairSync,randomBytes,scryptSync,X509Certificate} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,rm,readFile,writeFile,chmod,readdir} from "node:fs/promises";
import {join} from "node:path";
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {makeApproval} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {signEngineerApproval} from "../../plan-contracts/src/signed-approval.mjs";
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
import {TrustedPlanningRetirementStore}
  from "../../../apps/gateway/src/trusted-planning-retirement-store.ts";
import {TrustedOperationalSessionStore}
  from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";
import {createTrustedPlanIpcServer}
  from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {InMemoryAuditSink} from "../../../apps/gateway/src/prepare.ts";
import type {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {
  TrustedEngineerAuthoritySession,preliminaryReadPermissions,trustedPlanningSourceBranch,
  type EngineerCredentialPort,type RootParameters
} from "../src/trusted-engineer-authority.ts";
import type {IssuedDelegationCredential}
  from "../src/authority-client.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {TrustedPlanningGatewayReadPort}
  from "../src/trusted-planning-gateway-port.ts";
import {TrustedAdkReadOnlyPlanner}
  from "../src/trusted-adk-planner.ts";
import {compilePlanningProposal} from "../src/trusted-adk-planner.ts";
import {startTrustedFreshRepairPlanningReview,
  prepareTrustedFreshPlanningIntake,verifyTrustedFreshRepairEngineerApproval}
  from "../src/trusted-fresh-planning-intake.ts";
import {auditTrustedRetiredFeatureWork,startAuditedFreshRepairPlanning}
  from "../src/trusted-fresh-work-audit.ts";
import {TrustedFreshWorkDecisionStore}
  from "../src/trusted-fresh-work-decision-store.ts";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
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
import {startOwnerControlledEngineerReviewHost,
  startOwnerControlledFreshRepairEngineerReviewHost}
  from "../../../apps/orchestrator/src/trusted-engineer-host.mjs";
import {prepareConfiguredOwnerEngineerBootstrap}
  from "../../../apps/orchestrator/src/trusted-engineer-service.mjs";
import {TrustedReviewedPlanFile}
  from "../src/trusted-reviewed-plan-file.ts";
import {R5ScriptedNoProviderPlanningModel}
  from "../src/trusted-r5-scripted-planning-model.ts";

const SHA="a".repeat(40),FILE="src/billing/invoice.ts";
const SECOND_FILE="src/billing/tax.ts";
const DYNAMIC_FILE="src/billing/emergent.ts";
const DYNAMIC_DIR="src/billing/extensions";
const DEEP_FILE=DYNAMIC_DIR+"/additional.ts";
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
test("R350.13 trusted feature Planning permissions never authorize main read",()=>{
  const feature={...snapshot,planning_branch:"feature/account-suspension"};
  const permissions=preliminaryReadPermissions(feature);
  assert.equal(permissions.length,feature.directories.length+feature.files.length);
  assert.ok(permissions.every(p=>p.resource.includes(
    "/branches/feature%2Faccount-suspension/")));
  assert.equal(permissions.some(p=>p.operation==="read_repository"),false);
  assert.equal(permissions.some(p=>p.resource.includes("/branches/main/")),false);
  assert.equal(trustedPlanningSourceBranch(feature),"feature/account-suspension");
  assert.equal(trustedPlanningSourceBranch(snapshot),"main");
  for(const bad of ["feature/../main","feature//other","feature/",
    "refs/heads/main","main/feature","feature/%2Fmain"]){
    assert.throws(()=>preliminaryReadPermissions({...snapshot,planning_branch:bad}),
      /trusted Planning source branch/);
  }
});


/** End-to-end ADK read-function result regression for the signed source
 * branch. This uses a scripted model and in-process read port, no paid API. */
test("R350.14 ADK Planner accepts verified feature read, refuses main provider substitution",async()=>{
  const workBranch="feature/invoice-sort";
  const feature={...snapshot,planning_branch:workBranch};
  const authorityDraft={requested_permissions:[
    {operation:"update_file",resource_type:"file",path:FILE},
    {operation:"run_tests",resource_type:"branch",path:null}
  ],assumptions:[],uncertainties:[]};
  class FeatureReadScriptedPlanner extends BaseLlm{
    requests:LlmRequest[]=[];
    constructor(){super({model:"offline-r35014-feature-source"});}
    override async *generateContentAsync(request:LlmRequest):
      AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      if(this.requests.length===1){
        yield {content:{role:"model",parts:[{functionCall:{
          id:"feature-read-1",name:"read_file",
          args:{branch:workBranch,path:FILE}
        }}]}};
      }else{
        yield {content:{role:"model",parts:[{text:JSON.stringify(authorityDraft)}]}};
      }
    }
    override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
      return Promise.reject(Error("No live model allowed"));
    }
  }
  const observed:string[]=[];
  const readPort={
    async invoke(tool:string,args:Record<string,unknown>){
      assert.equal(tool,"read_file");
      assert.deepEqual(args,{branch:workBranch,path:FILE});
      observed.push("read");
      return {provider:"gitea",performed:true,tool,branch:workBranch,
        path:FILE,revision:SHA,content:"export const invoices = [];\n"};
    }
  };
  const model=new FeatureReadScriptedPlanner(),events:any[]=[];
  const planner=new TrustedAdkReadOnlyPlanner({
    snapshot:feature,requirement:"Fix invoices in the reviewed feature branch",
    workBranch,agents,readPort,model,planId:"r35014-feature-authority",
    maxModelTurns:3,maxProposalRevisions:0,
    onObservation:event=>events.push(event)
  });
  const result=await planner.proposeAuthority();
  assert.equal(result.status,"unapproved_authority_proposal");
  assert.equal(result.verified_source_reads,1);
  assert.equal(result.proposal.branch,workBranch);
  assert.deepEqual(result.proposal.requested_permissions.map(p=>p.operation),
    ["update_file","run_tests"]);
  assert.deepEqual(observed,["read"]);
  assert.equal(model.requests.length,2);
  assert.equal(events.filter(e=>e.kind==="read"&&e.status==="verified").length,1);
  const denied=new TrustedAdkReadOnlyPlanner({
    snapshot:feature,requirement:"Fix invoices in the reviewed feature branch",
    workBranch,agents,model:new FeatureReadScriptedPlanner(),
    readPort:{async invoke(){return {
      provider:"gitea",performed:true,tool:"read_file",
      branch:"main",path:FILE,revision:SHA,content:"foreign baseline"
    };}},
    planId:"r35014-main-substitution",maxModelTurns:3,maxProposalRevisions:0
  });
  await assert.rejects(denied.proposeAuthority(),
    /no verified read-only grounded proposal/);
});

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
  operationalRecovery?:TrustedOperationalRecoveryStore;
  hierarchicalPlanning?:boolean;dynamicDiscovery?:boolean;
  malformedDiscoveryListing?:boolean}={}){
  const planningSnapshot=options.dynamicDiscovery?
    {...snapshot,hierarchical_preliminary_read:true,
      dynamic_discovery_roots:["src/billing"],files:[...snapshot.files]}:
    options.hierarchicalPlanning
      ?{...snapshot,hierarchical_preliminary_read:true,
        files:[...snapshot.files,...Array.from({length:150},(_,i)=>
          `src/billing/extra-${i}.ts`)]}
      :snapshot;
  const observed={adapter:0,verification:0,policy:0,provider:0,
    prepare:0,execute:0,issued:0,revoked:0};
  const signed=new Map<string,{permissions:{resource:string;operation:string}[];
    challenge:string;audience:string}>();
  const client={
    async readRepository(revision?:string){
      observed.provider++;
      return {full_name:"thesis/invoices",default_branch:"main",revision:revision??SHA};
    },
    async readTextFile(branch:string,path:string,revision?:string){
      observed.provider++;
      assert.equal(branch,"main");
      assert.ok([FILE,SECOND_FILE,
        ...(options.dynamicDiscovery?[DYNAMIC_FILE,DEEP_FILE]:[])].includes(path));
      assert.equal(revision,SHA);
      const content=path===FILE?"export const invoices = [];\n":
        path===SECOND_FILE?"export const taxRate = 0.22;\n":
          path===DYNAMIC_FILE?"export const emergent = true;\n":
            "export const additional = true;\n";
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
          path===DYNAMIC_DIR&&options.dynamicDiscovery?
            [{name:"additional.ts",path:DEEP_FILE,type:"file"}]:
            [...[{name:"invoice.ts",path:FILE,type:"file"},
              {name:"tax.ts",path:SECOND_FILE,type:"file"}],
             ...(options.dynamicDiscovery?
               [{name:"emergent.ts",path:DYNAMIC_FILE,type:"file"},
                {name:"extensions",path:DYNAMIC_DIR,type:"dir"}]:[]),
             ...(options.malformedDiscoveryListing?
               [{name:"escape.ts",path:"src/billing/../secret.ts",type:"file"}]:[])]};
    }
  };
  const revisions=new TrustedPlanningRevisions(client);
  const audit=new InMemoryAuditSink();
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,
      repository:planningSnapshot.repository},
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
         permission.permissions.length!==1||
         permission.permissions[0].operation!==input.required_permission.operation||
         permission.permissions[0].resource!==input.required_permission.resource)
        throw Error("Fixture proof binding rejected");
      return {presenter_id:"did:thesis:orchestrator",
        credential_id:rootId,issuer_id:"did:thesis:engineer",
        hierarchy_depth:1,expiration:"999999999999",
        permissions:[input.required_permission]};
    },
    async verifyMultiple(input){
      observed.verification++;
      const signedProof=signed.get(input.signed_vp);
      if(!signedProof||signedProof.audience!==input.audience||
         signedProof.challenge!==input.challenge||
         signedProof.permissions.length!==input.required_permissions.length||
         input.required_permissions.some((p,i)=>
           p.operation!==signedProof.permissions[i].operation||
           p.resource!==signedProof.permissions[i].resource))
        throw Error("Fixture composite proof binding rejected");
      return {presenter_id:"did:thesis:orchestrator",
        credential_id:rootId,issuer_id:"did:thesis:engineer",
        hierarchy_depth:1,expiration:"999999999999",
        permissions:input.required_permissions};
    }},
    policy:{async evaluate(input){
      observed.policy++;
      assert.equal(input.pinned_revision,SHA);
      return {allow:options.policyAllow!==false,policy_version:"offline-planning-opa-fixture"};
    }}
  });
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:planningSnapshot,
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
      const permissions=body.disclosed_permissions as Array<{
        resource:string;operation:string}>;
      assert.ok(permissions.length>=1);
      const token="fixture-signed-vp-"+observed.adapter;
      signed.set(token,{permissions:permissions.map(p=>({...p})),
        challenge:String(body.challenge),audience:String(body.audience)});
      return response({signed_vp:token},201);
    }
    if(path==="http://trusted-gateway/v1/authorization/prepare-read-composite"){
      observed.prepare++;
      try{
        const prepared=await runtime.prepareReadComposite(body);
        return response(options.tamperPermission?{
          ...prepared,required_permissions:prepared.required_permissions.map((p,i)=>
            i===1?{...p,resource:"gitea://attacker.invalid/other"}:p)
        }:prepared,201);
      }catch{return response({error:"Gateway composite prepare denied"},403);}
    }
    if(path==="http://trusted-gateway/v1/authorization/execute-read-composite"){
      observed.execute++;
      try{
        return response(await runtime.executeReadComposite(body));
      }catch{return response({error:"Gateway composite execution denied"},403);}
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
    coordinator,snapshot:planningSnapshot,
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
  return {coordinator,start,root,makePort,fetchFn,observed,revisions,audit,
    planningSnapshot};
}


test("R380.2 owner-selected Gitea discovery enables newly listed source paths, never arbitrary ones",async()=>{
 const f=fixture({dynamicDiscovery:true});
 const root=await f.start();
 assert.deepEqual(root.permissions.map(x=>x.operation),
   ["read_repository","list_directory","read_file"]);
 const port=f.makePort();
 const opts=(path:string)=>({branch:"main",path});
 await assert.rejects(port.invoke("read_file",opts(DYNAMIC_FILE)));
 await assert.rejects(port.invoke("list_directory",opts(DYNAMIC_DIR)));
 assert.equal(f.observed.prepare,0);
 const listing=await port.invoke("list_directory",opts("src/billing")) as {
   entries:{path:string}[]
 };
 assert.ok(listing.entries.some(x=>x.path===DYNAMIC_FILE));
 const seen=await port.invoke("read_file",opts(DYNAMIC_FILE)) as {
   path:string;content:string;revision:string
 };
 assert.equal(seen.path,DYNAMIC_FILE);
 assert.equal(seen.revision,SHA);
 assert.match(seen.content,/emergent = true/u);
 await port.invoke("list_directory",opts(DYNAMIC_DIR));
 const deeper=await port.invoke("read_file",opts(DEEP_FILE)) as {
   content:string
 };
 assert.match(deeper.content,/additional = true/u);
 const before=f.observed.prepare;
 for(const [tool,args] of [
   ["read_file",opts("src/secrets/passwords.txt")],
   ["list_directory",opts("src/secrets")],
   ["read_file",opts("src/billing/ghost.ts")],
   ["read_file",{branch:"feature/other",path:DYNAMIC_FILE}],
   ["update_file",{...opts(DYNAMIC_FILE),content:"evil"}]
 ] as const)await assert.rejects(port.invoke(tool as never,args));
 assert.equal(f.observed.prepare,before);
 f.revisions.end(snapshot.session_id);
 await assert.rejects(port.invoke("read_file",opts(DYNAMIC_FILE)));
 assert.equal(f.observed.adapter,4,"one scoped VP for each permitted list/read");
});

test("R380.2 malformed source listing cannot partially expand the trusted Planning ledger",async()=>{
 const f=fixture({dynamicDiscovery:true,malformedDiscoveryListing:true});
 await f.start();
 const port=f.makePort();
 await assert.rejects(port.invoke("list_directory",{
   branch:"main",path:"src/billing"
 }),/Planning discovery entry/u);
 const before=f.observed.prepare;
 await assert.rejects(port.invoke("read_file",{
   branch:"main",path:DYNAMIC_FILE
 }));
 assert.equal(f.observed.prepare,before);
});

test("R380.2 ADK proposes only a verified newly discovered source file for Engineer review",async()=>{
 class SourceDrivenPlanner extends BaseLlm {
   readonly requests:LlmRequest[]=[];
   constructor(private readonly skipListing=false){
     super({model:"offline-r3802-source-discovery"});
   }
   override async *generateContentAsync(request:LlmRequest):
     AsyncGenerator<LlmResponse,void>{
     this.requests.push(request);
     const turn=this.requests.length;
     if(turn===1&&!this.skipListing){
       yield {content:{role:"model",parts:[{functionCall:{
         id:"discover-billing",name:"list_directory",
         args:{branch:"main",path:"src/billing"}
       }}]}};
     }else if((turn===2&&!this.skipListing)||(turn===1&&this.skipListing)){
       yield {content:{role:"model",parts:[{functionCall:{
         id:"read-new-source",name:"read_file",
         args:{branch:"main",path:DYNAMIC_FILE}
       }}]}};
     }else{
       yield {content:{role:"model",parts:[{text:JSON.stringify({
         requested_permissions:[
           {operation:"update_file",resource_type:"file",path:DYNAMIC_FILE},
           {operation:"run_tests",resource_type:"branch",path:null}
         ],assumptions:[],uncertainties:[]
       })}]}};
     }
   }
   override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
     return Promise.reject(Error("No model API in dynamic-discovery test"));
   }
 }
 const f=fixture({dynamicDiscovery:true});await f.start();
 const model=new SourceDrivenPlanner();
 const draft=await new TrustedAdkReadOnlyPlanner({
   model,snapshot:f.planningSnapshot,
   requirement:"Adjust discovered billing source and verify its tests",
   planId:"r3802-dynamic-intake",workBranch:"feature/invoice-sort",
   agents,readPort:f.makePort()
 }).proposeAuthority();
 assert.equal(draft.status,"unapproved_authority_proposal");
 assert.equal(draft.verified_source_reads,1);
 assert.ok(draft.proposal.requested_permissions.some(p=>
   p.resource.endsWith("/files/"+DYNAMIC_FILE)&&
   p.operation==="update_file"));
 assert.deepEqual({adapter:f.observed.adapter,
   verification:f.observed.verification,policy:f.observed.policy},
   {adapter:2,verification:2,policy:2});
 assert.equal(model.requests.length,3);
 const first=JSON.stringify(model.requests[0]);
 assert.ok(first.includes("list_directory"));
 assert.ok(first.includes("dynamic_discovery_roots"));
 assert.ok(!first.includes(rootId));
 const f2=fixture({dynamicDiscovery:true});await f2.start();
 await assert.rejects(new TrustedAdkReadOnlyPlanner({
   model:new SourceDrivenPlanner(true),snapshot:f2.planningSnapshot,
   requirement:"Attempt to skip attested discovery",
   planId:"r3802-deny-ungrounded",workBranch:"feature/invoice-sort",
   agents,readPort:f2.makePort()
 }).proposeAuthority(),/no verified read-only grounded proposal/u);
 assert.equal(f2.observed.adapter,0,
   "model must not get a signed VP for a guessed new path");
});

test("R380.0 hierarchical preliminary Root issues three read grants for >128 files and executes only trusted reads",async()=>{
  const f=fixture({hierarchicalPlanning:true});
  const issued=await f.start();
  assert.equal(issued.permissions.length,3);
  assert.deepEqual(issued.permissions.map(p=>p.operation),
    ["read_repository","list_directory","read_file"]);
  assert.ok(issued.permissions[1].resource.endsWith("/branches/main/directories"));
  assert.equal(issued.permissions[2].resource,issued.permissions[1].resource);
  const port=f.makePort();
  const first=await port.invoke("read_file",{branch:"main",path:FILE}) as {path:string};
  assert.equal(first.path,FILE);
  const directory=await port.invoke("list_directory",{
    branch:"main",path:"src/billing"
  }) as {path:string};
  assert.equal(directory.path,"src/billing");
  assert.equal(f.observed.prepare,2);
  assert.equal(f.observed.adapter,2);
  assert.equal(f.observed.verification,2);
  assert.equal(f.observed.policy,2);
  assert.equal(f.observed.execute,2);
  const before=f.observed.prepare;
  for(const [tool,args] of [
    ["read_file",{branch:"main",path:"src/billing/not-in-snapshot.ts"}],
    ["read_file",{branch:"feature/other",path:FILE}],
    ["list_directory",{branch:"main",path:"src/billing/secrets"}],
    ["update_file",{branch:"main",path:FILE,content:"mutated"}],
    ["create_file",{branch:"main",path:"src/billing/new.ts",content:"new"}]
  ] as const)await assert.rejects(port.invoke(tool as never,args));
  assert.equal(f.observed.prepare,before,
    "a scoped read-only Root is not a model-selected broad provider capability");
  assert.ok(f.audit.events.filter(e=>e.event==="authorization_prepared")
    .every(e=>e.pinned_revision===SHA));
});

test("R380.1 ADK Planner observes two source files from one verified read_files VP",async()=>{
  class CompositeScriptedPlanner extends BaseLlm {
    requests:LlmRequest[]=[];
    constructor(){super({model:"offline-r3801-gateway-composite"});}
    override async *generateContentAsync(request:LlmRequest):
      AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      if(this.requests.length===1){
        yield {content:{role:"model",parts:[{functionCall:{
          id:"read-files",name:"read_files",
          args:{branch:"main",paths:[FILE,SECOND_FILE]}
        }}]}};
      }else{
        yield {content:{role:"model",parts:[{
          text:JSON.stringify(proposal)
        }]}};
      }
    }
    override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
      return Promise.reject(Error("Gemini prohibited in R380 offline test"));
    }
  }
  const f=fixture({hierarchicalPlanning:true});
  await f.start();
  const model=new CompositeScriptedPlanner();
  const expandedSnapshot={...snapshot,hierarchical_preliminary_read:true,
    files:[...snapshot.files,...Array.from({length:150},(_,i)=>
      `src/billing/extra-${i}.ts`)]};
  const draft=await new TrustedAdkReadOnlyPlanner({
    model,snapshot:expandedSnapshot,
    requirement:"Sort invoices and calculate tax",
    planId:"r3801-composite-planning",workBranch:"feature/invoice-sort",
    agents,readPort:f.makePort()
  }).propose();
  assert.equal(draft.status,"unapproved_proposal");
  assert.equal(draft.verified_source_reads,2);
  assert.equal(f.observed.adapter,1);
  assert.equal(f.observed.verification,1);
  assert.equal(f.observed.policy,2);
  assert.equal(f.observed.execute,1);
  assert.equal(f.observed.prepare,1);
  const modelVisible=JSON.stringify(model.requests);
  assert.ok(modelVisible.includes("read_files"));
  for(const secret of [rootId,"trusted-orchestrator-token","fixture-signed-vp",
    "signed_vp","credential_id","signed-vp"])
    assert.ok(!modelVisible.includes(secret),secret);
});

test("R380.1 original Planning Root signs one multipermission VP for two verified Gitea reads",async()=>{
  const f=fixture({hierarchicalPlanning:true});
  await f.start();
  const port=f.makePort();
  const first={tool:"read_file" as const,arguments:{branch:"main",path:FILE}};
  const second={tool:"read_file" as const,arguments:{branch:"main",path:SECOND_FILE}};
  const result=await port.invokeComposite([first,second]) as {
    decision:string;pinned_revision:string;executions:Record<string,unknown>[]
  };
  assert.equal(result.decision,"allow");
  assert.equal(result.pinned_revision,SHA);
  assert.deepEqual(result.executions.map(e=>e.path),[FILE,SECOND_FILE]);
  assert.deepEqual(result.executions.map(e=>e.content),[
    "export const invoices = [];\n","export const taxRate = 0.22;\n"
  ]);
  assert.equal(f.observed.prepare,1);
  assert.equal(f.observed.adapter,1,"exactly ONE multipermission VP");
  assert.equal(f.observed.verification,1);
  assert.equal(f.observed.policy,2,"OPA evaluates every operation BEFORE provider IO");
  assert.equal(f.observed.execute,1);
  assert.equal(f.observed.provider,3,"one trusted base revision plus two provider reads");
  assert.ok(f.audit.events.filter(e=>e.event==="composite_authorization_prepared").length===1);
  assert.ok(f.audit.events.filter(e=>e.event==="composite_read_executed").length===1);
});

test("R380.1 composite Planning denies scope, duplicates, branch changes and write without VP",async()=>{
  const f=fixture({hierarchicalPlanning:true});await f.start();
  const port=f.makePort();
  const valid={tool:"read_file" as const,arguments:{branch:"main",path:FILE}};
  const bad=[
    [valid,{tool:"read_file",arguments:{branch:"main",path:"src/secrets.ts"}}],
    [valid,{tool:"read_file",arguments:{branch:"feature/other",path:SECOND_FILE}}],
    [valid,valid],
    [valid,{tool:"update_file",arguments:{branch:"main",path:FILE,content:"evil"}}],
    [valid,{tool:"list_directory",arguments:{branch:"main",path:"src/secret"}}],
    [valid,{tool:"create_file",arguments:{branch:"main",path:"src/new.ts",content:"evil"}}]
  ];
  for(const actions of bad)
    await assert.rejects(port.invokeComposite(actions as never));
  assert.equal(f.observed.prepare,0);
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.execute,0);
  assert.equal(f.observed.provider,1);
});

test("R380.1 an untrusted composite permission substitution is rejected before signing",async()=>{
  const f=fixture({tamperPermission:true,hierarchicalPlanning:true});
  await f.start();
  const port=f.makePort();
  await assert.rejects(port.invokeComposite([
    {tool:"read_file",arguments:{branch:"main",path:FILE}},
    {tool:"read_file",arguments:{branch:"main",path:SECOND_FILE}}
  ]),/composite challenge differs from trusted Planning/u);
  assert.equal(f.observed.prepare,1);
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.execute,0);
  assert.equal(f.observed.provider,1);
});

test("R380.1 one denied OPA permission prevents all composite Gitea reads",async()=>{
  const f=fixture({policyAllow:false,hierarchicalPlanning:true});
  await f.start();
  await assert.rejects(f.makePort().invokeComposite([
    {tool:"read_file",arguments:{branch:"main",path:FILE}},
    {tool:"read_file",arguments:{branch:"main",path:SECOND_FILE}}
  ]));
  assert.equal(f.observed.prepare,1);
  assert.equal(f.observed.adapter,1);
  assert.equal(f.observed.verification,1);
  assert.equal(f.observed.policy,1);
  assert.equal(f.observed.provider,1,"no Gitea read after OPA denial");
});

test("R380.1 retired Planning session rejects composite read before any VP",async()=>{
  const f=fixture({hierarchicalPlanning:true});await f.start();
  const port=f.makePort();
  f.revisions.end(snapshot.session_id);
  await assert.rejects(port.invokeComposite([
    {tool:"read_file",arguments:{branch:"main",path:FILE}},
    {tool:"read_file",arguments:{branch:"main",path:SECOND_FILE}}
  ]));
  assert.equal(f.observed.adapter,0);
  assert.equal(f.observed.provider,1);
});

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
    coordinator:f.coordinator,snapshot,
    preliminaryRoot:{...f.root(),validity_seconds:2700},
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

test("owner refuses a provisional root that cannot cover both long Planning and human review",async()=>{
  const f=await makeOwnerReviewFixture();
  try{
    const cfg=f.makeConfig();
    await assert.rejects(startOwnerControlledPlanningReview({
      ...cfg,preliminaryRoot:{...cfg.preliminaryRoot,validity_seconds:900}
    }),/lacks independent Planning, Engineer review and handoff time/);
    assert.equal(f.coordinator.phase,"idle");
    assert.equal(f.observed.issued,0);
    assert.equal(f.observed.adapter,0);
    assert.equal(f.observed.prepare,0);
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


/** Shared private 0600 owner bootstrap config; never a model or signed approval. */
async function makeProtectedOwnerServiceConfig(f:any,home:string,
  planningMode:"original"|"fresh_repair"="original"){
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
  if(planningMode==="fresh_repair"){
    await writeFile(configPath,JSON.stringify({...protectedConfig,planningMode}),
      {mode:0o600});
  }
  return {configPath,protectedConfig,replayDir,admissionDir,credentialFiles};
}

/** Disposable mTLS test materials: signed CA and private client fingerprint. */
async function prepareR49Mtls(directory:string){
  await mkdir(directory,{mode:0o700});
  const run=(args:string[])=>execFileSync("openssl",args,{
    cwd:directory,stdio:"ignore"
  });
  run(["req","-x509","-newkey","rsa:2048","-nodes","-days","1",
    "-subj","/CN=R49 Disposable CA","-addext",
    "basicConstraints=critical,CA:TRUE","-keyout","ca.key","-out","ca.pem"]);
  const sign=async(role:string,usage:string,extra="")=>{
    run(["req","-newkey","rsa:2048","-nodes",
      "-subj","/CN="+role,"-keyout",role+".key","-out",role+".csr"]);
    await writeFile(join(directory,role+".ext"),
      "basicConstraints=critical,CA:FALSE\n"+
      "keyUsage=critical,digitalSignature,keyEncipherment\n"+
      "extendedKeyUsage="+usage+"\n"+extra,{mode:0o600});
    run(["x509","-req","-days","1","-in",role+".csr",
      "-CA","ca.pem","-CAkey","ca.key","-CAcreateserial",
      "-out",role+".pem","-extfile",role+".ext"]);
    return {
      cert:await readFile(join(directory,role+".pem"),"utf8"),
      key:await readFile(join(directory,role+".key"),"utf8")
    };
  };
  const server=await sign("server","serverAuth",
    "subjectAltName=IP:127.0.0.1\n");
  const client=await sign("client","clientAuth");
  const ca=await readFile(join(directory,"ca.pem"),"utf8");
  return {ca,server,client,
    expectedClientFingerprint256:new X509Certificate(client.cert).fingerprint256};
}

test("R5 protected owner service composes signed ADK Planning with strict host and revokes when IPC unavailable",async()=>{
  const f=await makeOwnerReviewFixture();
  const home=await mkdtemp(join(tmpdir(),"r5-configured-owner-"));
  try{
    const {configPath,protectedConfig,replayDir,admissionDir}=
      await makeProtectedOwnerServiceConfig(f,home);
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
    const repairConfigPath=join(home,"owner-fresh-repair-service.json");
    await writeFile(repairConfigPath,JSON.stringify({
      ...protectedConfig,planningMode:"fresh_repair"
    }),{mode:0o600});
    const second=await prepareConfiguredOwnerEngineerBootstrap(repairConfigPath,{
      operationalRecovery:f.operationalRecovery
    });
    await assert.rejects(second.start({}),
      /original Planning disabled for fresh repair mode/);
    await assert.rejects(prepared.startFreshRepair({}),
      /fresh repair requires protected recovery mode/);
    const repairPlanning=f.makeConfig();
    repairPlanning.checkpointStore=second.planningCheckpointStore;
    delete (repairPlanning as any).reviewPlanFile;
    const repairDir=join(home,"decisions");
    await mkdir(repairDir,{mode:0o700});
    const oldCoordinator=new TrustedExecutionCoordinator({
      sessionId:"r46-old-bootstrap",baseRevision:SHA,
      authority:{} as any,credentials:{} as any,
      approvedGatewayPlans:{} as any
    });
    let unauthorizedReads=0;
    await assert.rejects(second.startFreshRepair({
      planning:repairPlanning,audit:undefined,
      previousCoordinator:oldCoordinator,
      nextSessionId:snapshot.session_id,
      disposition:"start_from_pinned_main",
      decisionStore:new TrustedFreshWorkDecisionStore(repairDir),
      trustedGitea:{async readPinnedMainSnapshot(){
        unauthorizedReads++;
        throw Error("unapproved recovery requested main read");
      }}
    }),/fresh audited owner decision must be bound and single-use/);
    assert.equal(unauthorizedReads,0);
    assert.equal(f.observed.issued,0);
    assert.equal(f.coordinator.phase,"idle");
    await assert.rejects(second.start(repairPlanning),
      /original Planning disabled for fresh repair mode/);
    await assert.rejects(second.startFreshRepair({planning:repairPlanning}),
      /single-use/);
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
    await assert.rejects(prepared.startFreshRepair({
      planning,audit:undefined
    }),/fresh repair requires protected recovery mode/);
    await assert.rejects(f.planningRecovery.assertFreshSession(
      snapshot.session_id),/retired session cannot be reused/);
  }finally{
    await rm(home,{recursive:true,force:true});
    await f.cleanup();
  }
});


test("closed prior DAG -> durable prior work disposition -> fresh ADK plan -> signed Engineer review",async()=>{
  const f=await makeOwnerReviewFixture();
  const auditDir=await mkdtemp(join(tmpdir(),"r42-prior-signed-"));
  const decisionDir=await mkdtemp(join(tmpdir(),"r42-prior-decision-"));
  const oldSnapshot={...snapshot,session_id:"previous-invoice-session"};
  const previous=compilePlanningProposal(proposal,{
    snapshot:oldSnapshot,requirement:"Original invoice improvement",
    planId:"previous-invoice-plan",workBranch:"feature/invoice-sort",agents
  });
  const priorApproval=makeApproval(previous.plan,{
    allowedOperations:new Set<string>(RUST_OPERATIONS),
    decision_id:"previous-invoice-approval",
    approved_by:"did:thesis:engineer",
    approved_at:new Date().toISOString(),
    approved_permission_ids:previous.plan.requested_permissions.map(p=>p.id)
  });
  const revocations:string[]=[];
  const rootCredentials:EngineerCredentialPort={
    async issueScopedOrchestratorRoot(input):Promise<IssuedDelegationCredential>{
      return {
        "@context":["https://www.w3.org/ns/credentials/v2"],
        type:["VerifiableCredential","DelegationCredential"],
        id:input.credential_id,issuer:"did:thesis:engineer",
        validFrom:input.valid_from,credentialSubject:{
          sub:"did:thesis:orchestrator",
          per:structuredClone(input.permissions)
        }
      };
    },
    async revokeRoot(id:string){revocations.push(id);}
  };
  const oldAuthority=new TrustedEngineerAuthoritySession({
    snapshot:oldSnapshot,credentials:rootCredentials,
    approvals:{async loadAuthenticatedApproval(sessionId){
      assert.equal(sessionId,oldSnapshot.session_id);
      return {plan:previous.plan,approval:priorApproval,
        authenticated_engineer_did:"did:thesis:engineer"};
    }},
    authenticatedEngineerDid:"did:thesis:engineer"
  });
  let retired=false;
  const prior=new TrustedExecutionCoordinator({
    authority:oldAuthority,credentials:rootCredentials,
    sessionId:oldSnapshot.session_id,baseRevision:oldSnapshot.base_revision,
    approvedGatewayPlans:{
      async activate(){return planDigest(previous.plan);},
      bindTask(){},
      async confirmTaskCompletion(){},
      async closeSession(){retired=true;}
    }
  });
  const root=(id:string,index:string,ttl:number):RootParameters=>({
    credential_id:id,valid_from:new Date().toISOString(),
    validity_seconds:ttl,
    credential_status:{
      type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,
      statusListIndex:index,
      statusListCredential:"https://example.test/previous-invoice-revocation"
    }
  });
  try{
    await prior.beginPlanning(root("urn:prior:planning","77",600));
    await prior.beginExecution(root("urn:prior:operational","78",3600));
    // An active old operational root must NOT allow new Gitea reads or a model.
    let freshDiscoveryReads=0;
    const trustedGitea={async readPinnedMainSnapshot(){
      freshDiscoveryReads++;
      return {repository:snapshot.repository,base_revision:SHA,
        directories:[...snapshot.directories],files:[...snapshot.files]};
    }};
    const config=f.makeConfig();
    const offlineModel=new R5ScriptedNoProviderPlanningModel({
      snapshot,workBranch:"feature/invoice-sort",
      edits:{backend:[FILE],frontend:[SECOND_FILE]},
      newTestFile:"src/billing/repair.spec.ts"
    });
    const planning={
      ...config,
      planner:{...config.planner,model:offlineModel,
        requirement:"Repair the reported invoice TypeScript regression",
        planId:"new-approved-only-after-review"}
    };
    // Even with an otherwise valid Planner, the legacy direct entry is
    // terminally blocked before any provider read or root issuance.
    await assert.rejects(startTrustedFreshRepairPlanningReview({
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,trustedGitea,planning
    }),/audited durable owner disposition required/);
    // The read-only snapshot preflight still independently refuses an
    // active previous execution before any Gitea/main read.
    await assert.rejects(prepareTrustedFreshPlanningIntake({
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,trustedGitea
    }),/terminal closure/);
    assert.equal(freshDiscoveryReads,0);
    assert.equal(f.observed.issued,0);
    assert.equal(f.coordinator.phase,"idle");

    await prior.closeExecution();
    assert.equal(retired,true);
    assert.deepEqual(revocations,[
      "urn:prior:planning","urn:prior:operational"
    ]);
    const keys=generateKeyPairSync("ed25519"),keyId="r42-old-signing";
    const issued=new Date();
    const signedPrior=signEngineerApproval({
      plan:previous.plan,approval:priorApproval,
      engineerDid:"did:thesis:engineer",keyId,
      privateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
      issuedAt:issued.toISOString(),
      expiresAt:new Date(issued.getTime()+600_000).toISOString()
    });
    await writeFile(join(auditDir,oldSnapshot.session_id+".json"),
      JSON.stringify(signedPrior),{mode:0o600});
    const previousSignedApprovals=new SignedEngineerApprovalFileStore({
      directory:auditDir,engineerDid:"did:thesis:engineer",
      trustedKeys:{[keyId]:{
        engineer_did:"did:thesis:engineer",
        public_key_pem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
      }}
    });
    const previousBranch=approvedWorkBranch(previous.plan);
    const previousHead="b".repeat(40);
    let diffReads=0;
    const audit=await auditTrustedRetiredFeatureWork({
      previousCoordinator:prior,nextSessionId:snapshot.session_id,
      previousSignedApprovals,trustedFinalFeatureSha:previousHead,
      trustedGitea:{async readPinnedFeatureDiff(pin){
        diffReads++;
        assert.equal(pin.branch,previousBranch);
        assert.equal(pin.base_revision,SHA);
        assert.equal(pin.head_revision,previousHead);
        return {branch:pin.branch,base_revision:pin.base_revision,
          head_revision:pin.head_revision,
          changes:[{path:FILE,change:"modified" as const}]};
      }}
    });
    assert.equal(diffReads,1);
    const decisionStore=new TrustedFreshWorkDecisionStore(decisionDir);
    const started=await startAuditedFreshRepairPlanning({
      audit,disposition:"start_from_pinned_main",decisionStore,
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,trustedGitea,planning
    });
    if(started.status!=="awaiting_engineer_signature")
      throw Error("Persisted main repair did not start signed review");
    const persisted=await decisionStore.assertRecorded({
      audit,disposition:"start_from_pinned_main"
    });
    assert.equal(persisted.previous_feature_head_sha,previousHead);
    assert.equal(persisted.previous_branch,previousBranch);
    assert.equal(persisted.next_session_id,snapshot.session_id);
    const packet=started;
    assert.equal(freshDiscoveryReads,1);
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.base_revision,SHA);
    assert.equal(packet.session_id,snapshot.session_id);
    assert.equal(packet.plan.requirement,
      "Repair the reported invoice TypeScript regression");
    assert.deepEqual(packet.plan.tasks.map(t=>t.id),
      ["branch","backend","frontend","test","pr"]);
    assert.equal(packet.verified_source_reads,2);
    assert.equal(packet.plan_digest,(await f.store.load()).proposal.digest);
    assert.deepEqual(packet.plan,(await f.store.load()).proposal.plan);
    assert.equal(f.gate.reviewPacket().plan_digest,packet.plan_digest);
    assert.deepEqual({
      issued:f.observed.issued,adapter:f.observed.adapter,
      verified:f.observed.verification,opa:f.observed.policy,
      executed:f.observed.execute
    },{issued:1,adapter:2,verified:2,opa:2,executed:2});
    assert.equal(f.coordinator.phase,"planning");
    assert.throws(()=>f.coordinator.trustedOperationalAuthority(),
      /Verified operational root is not active/);
    await assert.rejects(verifyTrustedFreshRepairEngineerApproval({
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,reviewGate:f.gate
    }),(e:unknown)=>!!e&&typeof e==="object"&&"code" in e&&e.code==="ENOENT");
    const now=new Date(),expiry=new Date(now.getTime()+600_000);
    const signForEngineer=(plan:typeof packet.plan,decision_id:string)=>
      signEngineerApproval({plan,
        approval:makeApproval(plan,{
          allowedOperations:new Set<string>(RUST_OPERATIONS),
          decision_id,
          approved_by:"did:thesis:engineer",
          approved_at:now.toISOString(),
          approved_permission_ids:plan.requested_permissions.map(p=>p.id)
        }),
        engineerDid:"did:thesis:engineer",
        keyId:"engineer",privateKeyPem:f.engineerPrivateKeyPem,
        issuedAt:now.toISOString(),expiresAt:expiry.toISOString()
      });
    const receiptFile=join(f.approvalDir,snapshot.session_id+".json");
    // Even a valid signature for the PRIOR session cannot approve the
    // new task/plan, despite the same Engineer DID and repository.
    await writeFile(receiptFile,
      JSON.stringify(signForEngineer(previous.plan,"old-session-approval")),
      {mode:0o600});
    await assert.rejects(verifyTrustedFreshRepairEngineerApproval({
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,reviewGate:f.gate
    }),/Signed approval session ID does not match requested file/);
    await writeFile(receiptFile,
      JSON.stringify(signForEngineer(packet.plan,"new-session-review")),
      {mode:0o600});
    const approved=await verifyTrustedFreshRepairEngineerApproval({
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,reviewGate:f.gate
    });
    assert.deepEqual(approved,{
      status:"fresh_engineer_review_verified",
      session_id:snapshot.session_id,base_revision:SHA,
      plan_digest:packet.plan_digest,
      approval_decision_id:"new-session-review",
      planning_authority_only:true,
      operational_credentials_issued:false
    });
    assert.ok(Object.isFrozen(approved));
    assert.equal(f.coordinator.phase,"planning");
    assert.equal(f.observed.issued,1,
      "Verifier must NOT issue an operational root or dispatch new Agents");
    assert.equal(prior.phase,"closed");
    await f.coordinator.closePlanning();
    assert.equal(f.coordinator.phase,"closed");
    await f.planningRecovery.assertClean();
    assert.equal(f.observed.revoked,1);

    // R48: a SECOND, independently configured Engineer owner instance
    // exercises the same prior signed old root through the real one-shot
    // startFreshRepair(), ADK checkpoint and persistent-host bootstrap.
    // Its missing private Gateway IPC is deliberately fatal AFTER the
    // signed human-review packet, proving it cannot silently execute.
    const nextFixture=await makeOwnerReviewFixture();
    const ownerHome=await mkdtemp(join(tmpdir(),"r48-configured-owner-"));
    const nextDecisionDir=await mkdtemp(join(tmpdir(),"r48-owner-decision-"));
    try{
      const {configPath}=await makeProtectedOwnerServiceConfig(
        nextFixture,ownerHome,"fresh_repair");
      const service=await prepareConfiguredOwnerEngineerBootstrap(configPath,{
        operationalRecovery:nextFixture.operationalRecovery
      });
      const nextPlanning=nextFixture.makeConfig();
      nextPlanning.checkpointStore=service.planningCheckpointStore;
      delete (nextPlanning as any).reviewPlanFile;
      nextPlanning.planner={...nextPlanning.planner,
        model:new R5ScriptedNoProviderPlanningModel({
          snapshot,workBranch:"feature/invoice-sort",
          edits:{backend:[FILE],frontend:[SECOND_FILE]},
          newTestFile:"src/billing/r48-repair.spec.ts"
        }),
        requirement:"Repair prior invoice TypeScript failure",
        planId:"r48-independent-engineer-review"};
      const reaudited=await auditTrustedRetiredFeatureWork({
        previousCoordinator:prior,nextSessionId:snapshot.session_id,
        previousSignedApprovals,trustedFinalFeatureSha:previousHead,
        trustedGitea:{async readPinnedFeatureDiff(pin){
          assert.equal(pin.branch,previousBranch);
          assert.equal(pin.base_revision,SHA);
          assert.equal(pin.head_revision,previousHead);
          return {branch:pin.branch,base_revision:pin.base_revision,
            head_revision:pin.head_revision,
            changes:[{path:FILE,change:"modified" as const}]};
        }}
      });
      const recordStore=new TrustedFreshWorkDecisionStore(nextDecisionDir);
      await assert.rejects(service.start(nextPlanning),
        /original Planning disabled for fresh repair mode/);
      await assert.rejects(service.startFreshRepair({
        planning:nextPlanning,audit:reaudited,
        previousCoordinator:prior,nextSessionId:snapshot.session_id,
        disposition:"start_from_pinned_main",decisionStore:recordStore,
        trustedGitea
      }),/ENOENT|connect|Gateway|IPC/iu,
        "Engineer's unavailable private IPC must close fresh Planning, not approve");
      const persisted=await recordStore.assertRecorded({
        audit:reaudited,disposition:"start_from_pinned_main"
      });
      assert.equal(persisted.previous_feature_head_sha,previousHead);
      assert.equal(persisted.next_session_id,snapshot.session_id);
      assert.equal(freshDiscoveryReads,2);
      assert.equal(nextFixture.observed.issued,1);
      assert.equal(nextFixture.observed.revoked,1);
      assert.equal(nextFixture.coordinator.phase,"closed");
      assert.equal(prior.phase,"closed");
      const newCheckpoint=await service.planningCheckpointStore.load();
      assert.equal(newCheckpoint.snapshot.session_id,snapshot.session_id);
      assert.equal(newCheckpoint.proposal.plan.requirement,
        "Repair prior invoice TypeScript failure");
      assert.equal(newCheckpoint.proposal.digest,
        nextFixture.gate.reviewPacket().plan_digest);
      assert.deepEqual(JSON.parse(await readFile(nextFixture.planFilePath,"utf8")),
        newCheckpoint.proposal.plan);
      assert.throws(()=>nextFixture.coordinator.trustedOperationalAuthority(),
        /Verified operational root is not active/);
      await assert.rejects(nextFixture.gate.loadAuthenticatedApproval(
        snapshot.session_id),(e:any)=>e.code==="ENOENT",
        "checkpoint is not an independent Engineer approval");
      await nextFixture.planningRecovery.assertClean();
      await assert.rejects(service.startFreshRepair({
        planning:nextPlanning,audit:reaudited
      }),/single-use/);
      assert.equal(nextFixture.observed.issued,1);
    }finally{
      await rm(ownerHome,{recursive:true,force:true});
      await rm(nextDecisionDir,{recursive:true,force:true});
      await nextFixture.cleanup();
    }

    // R49 positive: unlike R48's intentionally absent IPC, the private
    // Gateway socket and pinned mTLS credentials are actually available.
    // The fresh Engineer UI starts, but no approved write root exists until
    // an independently authenticated human reviews and signs the new plan.
    const positive=await makeOwnerReviewFixture();
    const positiveHome=await mkdtemp(join(tmpdir(),"r49-live-review-"));
    const positiveDecisionDir=await mkdtemp(join(tmpdir(),"r49-disposition-"));
    let positiveHost:any,privateIpc:any;
    try{
      const {configPath,protectedConfig,credentialFiles}=
        await makeProtectedOwnerServiceConfig(positive,positiveHome,"fresh_repair");
      const mtls=await prepareR49Mtls(join(positiveHome,"mtls"));
      await writeFile(credentialFiles.ca,mtls.ca,{mode:0o600});
      await writeFile(credentialFiles.server,mtls.server.cert,{mode:0o600});
      await writeFile(credentialFiles.serverKey,mtls.server.key,{mode:0o600});
      const password="r49-offline-human-review";
      await writeFile(configPath,JSON.stringify({
        ...protectedConfig,planningMode:"fresh_repair",
        approval:{...protectedConfig.approval,
          passwordScryptHex:scryptSync(password,
            Buffer.from(protectedConfig.approval.passwordSaltHex,"hex"),64)
            .toString("hex")},
        oidc:{...protectedConfig.oidc,tls:{
          ...protectedConfig.oidc.tls,
          expectedClientFingerprint256:mtls.expectedClientFingerprint256
        }}
      }),{mode:0o600});
      const gatewayHome=join(positiveHome,"gateway");
      const retired=join(positiveHome,"gateway-retired");
      const active=join(positiveHome,"gateway-active");
      for(const dir of [gatewayHome,retired,active])
        await mkdir(dir,{mode:0o700});
      const socketPath=join(gatewayHome,"gateway.sock");
      // The owner configuration and IPC server MUST use the same protected
      // HMAC file and exact Unix socket; an orphan placeholder cannot work.
      const secretFile=credentialFiles.gatewaySecret;
      const boundConfig=JSON.parse(await readFile(configPath,"utf8"));
      await writeFile(configPath,JSON.stringify({
        ...boundConfig,recovery:{
          ...boundConfig.recovery,gatewaySocketPath:socketPath
        }
      }),{mode:0o600});
      const gatewayRevision=new TrustedPlanningRevisions({
        async readRepository(){return {
          default_branch:"main",revision:SHA
        };}
      },{retirementStore:new TrustedPlanningRetirementStore(retired)});
      await gatewayRevision.begin(snapshot.session_id,300000);
      const plans=new TrustedApprovedExecutionPlans({
        repository:snapshot.repository,engineerDid:"did:thesis:engineer",
        approvals:{async loadAuthenticatedApproval(){
          throw Error("R49 cannot use an unsigned old Engineer receipt");
        }},
        completionAttestor:{async confirmCompleted(){return false;}},
        operationalLeaseMs:60000,
        operationalSessionStore:new TrustedOperationalSessionStore(active)
      });
      privateIpc=await createTrustedPlanIpcServer({
        socketPath,secretFile,plans,planningRevisions:gatewayRevision
      });
      await privateIpc.start();
      const service=await prepareConfiguredOwnerEngineerBootstrap(configPath,{
        operationalRecovery:positive.operationalRecovery
      });
      const positivePlanning=positive.makeConfig();
      positivePlanning.checkpointStore=service.planningCheckpointStore;
      delete (positivePlanning as any).reviewPlanFile;
      positivePlanning.planner={...positivePlanning.planner,
        model:new R5ScriptedNoProviderPlanningModel({
          snapshot,workBranch:"feature/invoice-sort",
          edits:{backend:[FILE],frontend:[SECOND_FILE]},
          newTestFile:"src/billing/r49-recovery.spec.ts"
        }),
        requirement:"R49 independent repair review for TypeScript regression",
        planId:"r49-independent-review"};
      const nextAudit=await auditTrustedRetiredFeatureWork({
        previousCoordinator:prior,nextSessionId:snapshot.session_id,
        previousSignedApprovals,trustedFinalFeatureSha:previousHead,
        trustedGitea:{async readPinnedFeatureDiff(pin){
          assert.equal(pin.branch,previousBranch);
          return {branch:pin.branch,base_revision:pin.base_revision,
            head_revision:pin.head_revision,changes:[
              {path:FILE,change:"modified" as const}
            ]};
        }}
      });
      const decisionStore=new TrustedFreshWorkDecisionStore(positiveDecisionDir);
      const trustedMain={async readPinnedMainSnapshot(){
        return {repository:snapshot.repository,base_revision:SHA,
          directories:[...snapshot.directories],files:[...snapshot.files]};
      }};
      positiveHost=await service.startFreshRepair({
        planning:positivePlanning,audit:nextAudit,
        previousCoordinator:prior,nextSessionId:snapshot.session_id,
        disposition:"start_from_pinned_main",
        decisionStore,trustedGitea:trustedMain
      });
      assert.match(positiveHost.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/u);
      assert.equal(positive.coordinator.phase,"planning");
      assert.equal(positive.observed.issued,1);
      assert.equal(positive.observed.revoked,0);
      assert.equal((await positive.operationalRecovery.pending()).length,0);
      await assert.rejects(positive.gate.loadAuthenticatedApproval(
        snapshot.session_id),(e:any)=>e.code==="ENOENT");
      assert.equal((await fetch(positiveHost.engineerUrl+"/api/plan")).status,401);
      const login=await fetch(positiveHost.engineerUrl+"/api/login",{
        method:"POST",headers:{"content-type":"application/json",
          origin:positiveHost.engineerUrl},
        body:JSON.stringify({password})
      });
      assert.equal(login.status,200);
      const cookie=login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const planResponse=await fetch(positiveHost.engineerUrl+"/api/plan",{
        headers:{cookie}
      });
      assert.equal(planResponse.status,200);
      const ui=await planResponse.json();
      const checkpoint=await service.planningCheckpointStore.load();
      const digest=checkpoint.proposal.digest;
      assert.equal(ui.plan_digest,digest);
      const permissions=checkpoint.proposal.plan.requested_permissions
        .map((p:any)=>p.id);
      const decision=await fetch(positiveHost.engineerUrl+"/api/approve",{
        method:"POST",headers:{"content-type":"application/json",
          origin:positiveHost.engineerUrl,cookie,
          "x-csrf-token":ui.csrf_token},
        body:JSON.stringify({plan_digest:digest,
          approved_permission_ids:permissions,
          confirmation:"APPROVE "+digest})
      });
      assert.equal(decision.status,201);
      const signedNew=await positive.gate.loadAuthenticatedApproval(
        snapshot.session_id);
      assert.equal(signedNew.authenticated_engineer_did,"did:thesis:engineer");
      assert.equal(planDigest(signedNew.plan),digest);
      assert.deepEqual(signedNew.approval.approved_permission_ids,permissions);
      assert.equal(positive.coordinator.phase,"planning");
      assert.equal((await positive.operationalRecovery.pending()).length,0);
      assert.throws(()=>positive.coordinator.trustedOperationalAuthority(),
        /Verified operational root is not active/);
      assert.deepEqual(await decisionStore.assertRecorded({
        audit:nextAudit,disposition:"start_from_pinned_main"
      }).then(x=>x.next_session_id),snapshot.session_id);
      await positiveHost.close();
      positiveHost=undefined;
      assert.equal(positive.coordinator.phase,"closed");
      assert.equal(positive.observed.revoked,1);
      await positive.planningRecovery.assertClean();
    }finally{
      try{await positiveHost?.close();}finally{
        try{await privateIpc?.close();}finally{
          await rm(positiveHome,{recursive:true,force:true});
          await rm(positiveDecisionDir,{recursive:true,force:true});
          await positive.cleanup();
        }
      }
    }
  }finally{
    await rm(auditDir,{recursive:true,force:true});
    await rm(decisionDir,{recursive:true,force:true});
    await f.cleanup();
  }
});

test("R46 persistent Engineer recovery refuses unaudited owner intake before any root or Gitea read",async()=>{
  const f=await makeOwnerReviewFixture();
  const dir=await mkdtemp(join(tmpdir(),"r46-decision-"));
  try{
    const planning=f.makeConfig();
    const host={
      approval:{
        expectedSessionId:snapshot.session_id,
        expectedBaseRevision:SHA,repository:snapshot.repository,
        trustedPlanFile:f.planFilePath,
        planningCheckpointStore:f.store
      },
      recovery:{planningDirectory:f.planningDir,directory:f.operationalDir},
      operationalRecovery:f.operationalRecovery
    };
    let giteaReads=0;
    const prior=new TrustedExecutionCoordinator({
      sessionId:"r46-retired-session",baseRevision:SHA,
      authority:{} as any,credentials:{} as any,
      approvedGatewayPlans:{} as any
    });
    const input={
      previousCoordinator:prior,nextCoordinator:f.coordinator,
      nextSessionId:snapshot.session_id,
      disposition:"start_from_pinned_main" as const,
      decisionStore:new TrustedFreshWorkDecisionStore(dir),
      audit:undefined,
      trustedGitea:{async readPinnedMainSnapshot(){
        giteaReads++;
        throw Error("unaudited Gitea read is forbidden");
      }},
      planning,host
    };
    await assert.rejects(startOwnerControlledFreshRepairEngineerReviewHost(
      input),/fresh audited owner decision must be bound and single-use/);
    assert.equal(giteaReads,0);
    assert.equal(f.observed.issued,0);
    assert.equal(f.coordinator.phase,"idle");
    assert.equal((await f.planningRecovery.pending()).length,0);
    assert.deepEqual(await readdir(dir),[],
      "invalid audit cannot persist a decision or start Planning");
    await assert.rejects(startOwnerControlledFreshRepairEngineerReviewHost({
      ...input,nextSessionId:"different-session"
    }),/same new idle Coordinator/);
    await assert.rejects(startOwnerControlledFreshRepairEngineerReviewHost({
      ...input,host:{...host,approval:{
        ...host.approval,expectedBaseRevision:"f".repeat(40)
      }}
    }),/owner Planning and Engineer session pins must be identical/);
    assert.equal(f.observed.issued,0);
    assert.equal(giteaReads,0);
  }finally{
    await rm(dir,{recursive:true,force:true});
    await f.cleanup();
  }
});
