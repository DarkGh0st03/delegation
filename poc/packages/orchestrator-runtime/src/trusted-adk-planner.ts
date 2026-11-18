/**
 * Opt-in ADK Planning proposal, NOT Engineer approval or execution.
 * The readPort must use the already pinned Gateway Planning session:
 * Prepare -> Rust-signed VP -> Core Rust -> OPA -> read-only Gitea.
 * Model output never grants rights, selects a DID or activates a plan.
 */
import {
  BaseLlm, FunctionTool, InMemorySessionService, LlmAgent, Runner,
  type BaseLlmConnection, type LlmRequest, type LlmResponse
} from "@google/adk";
import {z} from "zod";
import {compileAuthorityOnlyPlanningProposal,AUTHORITY_ONLY_PLANNING_INSTRUCTIONS,
 type UnapprovedAuthorityProposal} from "./authority-only-planning-proposal.ts";
import {validatePrivateApprovedBranch}
  from "../../agent-runtime/src/approved-branch.ts";
import {createSpecializedAgentCard}
  from "../../agent-runtime/src/cards.ts";
import {preliminaryReadPermissions,trustedPlanningSourceBranch,
 type TrustedPlanningSnapshot} from "./trusted-engineer-authority.ts";
import {TrustedPlanningDiscoveryLedger}
  from "./trusted-planning-discovery-ledger.ts";
import {APPLICATION_ROLES} from "../../plan-contracts/src/agent-roles.mjs";
import type {SpecialistRole} from "../../plan-contracts/src/agent-roles.mjs";

type Role=string;
type ReadTool="read_repository"|"list_directory"|"read_file";
type Op="create_branch"|"create_pull_request"|"read_file"|
  "update_file"|"create_file"|"run_tests";
const sha=/^[a-f0-9]{40}$/u;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const roleOps:Readonly<Record<string,ReadonlySet<Op>>>={
  orchestrator:new Set(["create_branch","create_pull_request"]),
  ...Object.fromEntries(APPLICATION_ROLES.map(role=>
   [role,new Set<Op>(["read_file","update_file","create_file"])])),
  test:new Set(["read_file","update_file","create_file","run_tests"])
};
/**
 * A registered specialist may expose a host-pinned Agent Card and operations.
 * The PoC roles retain their historical defaults for older offline tests.
 * New role IDs require BOTH an explicit capability list and trusted Card
 * metadata; the model is never permitted to define or discover a DID/URL.
 */
export interface TrustedPlanningAgentPin {
 readonly did:string;
 readonly card_ref:string;
 readonly capabilities?:readonly Op[];
 readonly card?:{
  readonly name:string;readonly description:string;
  readonly skills:readonly {id:string;name:string;description:string}[];
 };
}
const specialistOperations:ReadonlySet<Op>=new Set([
 "read_file","update_file","create_file","run_tests"
]);
function validatedPlannerRegistry(agents:Readonly<Record<Role,TrustedPlanningAgentPin>>):{
 roles:Role[];capabilities:Map<Role,ReadonlySet<Op>>
}{
 if(!agents||typeof agents!=="object"||Array.isArray(agents))fail("invalid trusted Agent registry");
 const roles=Object.keys(agents);
 if(!roles.length||roles.length>16)fail("invalid trusted Agent registry");
 const capabilities=new Map<Role,ReadonlySet<Op>>();
 for(const role of roles){
  const pin=agents[role],defaults=roleOps[role];
  if(!id.test(role)||role==="orchestrator"||!pin||
     typeof pin.did!=="string"||!pin.did.startsWith("did:")||
     pin.did.length>256||/[\x00-\x1f\x7f]/u.test(pin.did)||
     typeof pin.card_ref!=="string"||!pin.card_ref.trim()||
     pin.card_ref.length>256||
     Object.keys(pin).some(k=>!["did","card_ref","capabilities","card"].includes(k)))
    fail("invalid trusted Agent registry");
  const selected=pin.capabilities??(defaults?[...defaults]:undefined);
  if(!selected||!Array.isArray(selected)||!selected.length||
     selected.length>specialistOperations.size||
     new Set(selected).size!==selected.length||
     selected.some(operation=>!specialistOperations.has(operation)||
       (defaults&&!defaults.has(operation))))
    fail("unsupported trusted Agent capabilities");
  if(!defaults&&!pin.card)fail("unverified registered Agent Card");
  if(pin.card){
   const card=pin.card;
   if(typeof card!=="object"||Array.isArray(card)||
      Object.keys(card).sort().join(",")!=="description,name,skills"||
      typeof card.name!=="string"||!card.name.trim()||
      card.name.length>160||
      typeof card.description!=="string"||!card.description.trim()||
      card.description.length>800||
      !Array.isArray(card.skills)||!card.skills.length||card.skills.length>8||
      card.skills.some(skill=>!skill||typeof skill!=="object"||
        Object.keys(skill).sort().join(",")!=="description,id,name"||
        !id.test(skill.id)||typeof skill.name!=="string"||
        !skill.name.trim()||skill.name.length>160||
        typeof skill.description!=="string"||
        !skill.description.trim()||skill.description.length>800))
    fail("unverified registered Agent Card");
  }
  capabilities.set(role,new Set(selected));
 }
 return {roles,capabilities};
}
export interface PlanningReadPort {
  invoke(tool:ReadTool,args:Record<string,unknown>,
    signal?:AbortSignal):Promise<unknown>;
  /** Opt-in original-root composite reader, not a model authority port.
   * No fallback to multiple unverified provider effects. */
  invokeComposite?(actions:readonly {
    tool:"read_file"|"list_directory";arguments:Record<string,unknown>
  }[],signal?:AbortSignal):Promise<unknown>;
}
/** Evidence metadata only. No model prompts, tool contents or credentials. */
export type PlanningObservation =
  | {kind:"model_turn";status:"started"|"completed";turn:number}
  | {kind:"read";status:"verified"|"denied";tool:ReadTool;
     path?:string;reason?:string}
  | {kind:"model_usage";turn:number;source:"provider_reported";
     input_tokens?:number;output_tokens?:number;total_tokens?:number;
     thought_tokens?:number}
  | {kind:"model_failure";turn:number;
     phase:"delegate_exception"|"model_error_response"|"adk_runner_error";
     category:"authentication"|"permission_or_billing"|
       "quota_or_rate_limit"|"model_or_endpoint_not_found"|
       "invalid_request_or_tool_schema"|"provider_server_error"|
       "transport_or_timeout"|"unknown";
     http_status:number|null}
  | {kind:"proposal";status:"unapproved";digest:string;
     task_count:number;permission_count:number;verified_source_reads:number}
  /** Only static diagnostic categories: never model output, file paths or source. */
  | {kind:"plan_rejection";stage:"grounding"|"json"|"contract";
     reason:TrustedPlanningRejectionReason}
  | {kind:"budget_exhausted";budget:"model_turns";
     completed_turns:number;max_model_turns:number};
export interface TrustedAdkPlannerConfig {
  model:BaseLlm;
  snapshot:TrustedPlanningSnapshot;
  requirement:string;
  planId:string;
  workBranch:string;
  agents:Readonly<Record<Role,TrustedPlanningAgentPin>>;
  /** Trusted Gateway-backed read port; never a direct model-controlled provider. */
  readPort:PlanningReadPort;
  /** Trusted-host-owned evidence sink. Must NOT log model text or credentials.
   * An observer failure fails the Planning attempt closed. */
  onObservation?:(event:Readonly<PlanningObservation>)=>void;
  maxModelTurns?:number;
  /** Digest of the Engineer-approved project profile, bound into the proposal. */
  projectProfileSha256?:string;
  /** At most two bounded, unapproved proposal repairs in one Planning session. */
  maxProposalRevisions?:0|1|2;
  /** Explicit Gemini thinking level; unset for scripted/non-Gemini models. */
  thinkingLevel?:"LOW"|"MEDIUM"|"HIGH";
  /** Per-inference cancellation bound; does not itself guarantee a provider stops billing. */
  maxModelCallMs?:number;
  /** Actual ADK generateContentConfig cap, not merely a response-size check. */
  maxOutputTokens?:number;
  /** Entire Planning session, including model, tool and proposal processing. */
  maxPlanningMs?:number;
}

/** Rejection categories of a Planning draft (static, never model text). */
export type TrustedPlanningRejectionReason=
  "ungrounded_or_missing_output"|"invalid_json"|"invalid_permissions";
/** Advisory repair hint: static, no provider payload, no new authority. */
const TRUSTED_STRUCTURE_HINT=
  "Recheck the indicated structural constraint against the trusted snapshot; do not add undiscovered files or permissions.";
function fail(reason:string):never {throw Error("Unapproved Planning: "+reason);}
function obj(x:unknown):Record<string,unknown> {
  if(!x||typeof x!=="object"||Array.isArray(x))fail("expected object");
  return x as Record<string,unknown>;
}
/** Provider failure categories ONLY; never return API/SDK text or prompts. */
function sanitizedModelFailure(error:unknown,
  phase:"delegate_exception"|"model_error_response"|"adk_runner_error"):{
  phase:"delegate_exception"|"model_error_response"|"adk_runner_error";
  category:Extract<PlanningObservation,{kind:"model_failure"}>["category"];
  http_status:number|null
}{
  const e=error&&typeof error==="object"?error as Record<string,unknown>:{};
  const response=e.response&&typeof e.response==="object"?
    e.response as Record<string,unknown>:{};
  const nested=e.error&&typeof e.error==="object"?
    e.error as Record<string,unknown>:{};
  const numeric=[e.status,e.code,response.status,nested.code]
    .filter(x=>Number.isInteger(x)&&Number(x)>=400&&Number(x)<=599);
  const http_status=numeric.length?Number(numeric[0]):null;
  const code=[e.errorCode,e.code,e.status,nested.status]
    .filter(x=>typeof x==="string").join("|").slice(0,128).toUpperCase();
  let category:Extract<PlanningObservation,{kind:"model_failure"}>["category"]="unknown";
  if(http_status===401||code.includes("UNAUTHENTICATED"))category="authentication";
  else if(http_status===403||code.includes("PERMISSION_DENIED"))
    category="permission_or_billing";
  else if(http_status===429||code.includes("RESOURCE_EXHAUSTED"))
    category="quota_or_rate_limit";
  else if(http_status===404||code.includes("NOT_FOUND"))
    category="model_or_endpoint_not_found";
  else if(http_status===400||code.includes("INVALID_ARGUMENT"))
    category="invalid_request_or_tool_schema";
  else if(http_status!==null&&http_status>=500)
    category="provider_server_error";
  else if(code.includes("DEADLINE")||code.includes("UNAVAILABLE")||
          code.includes("TIMEOUT"))
    category="transport_or_timeout";
  return {phase,category,http_status};
}

class BudgetedModel extends BaseLlm {
  turns=0;
  readonly delegate:BaseLlm;
  readonly limit:number;
  readonly maxCallMs:number;
  readonly planningSignal:AbortSignal;
  readonly onObservation?:TrustedAdkPlannerConfig["onObservation"];
  constructor(model:BaseLlm,limit:number,maxCallMs:number,
    planningSignal:AbortSignal,
    onObservation?:TrustedAdkPlannerConfig["onObservation"]){
    super({model:model.model});
    this.delegate=model;this.limit=limit;this.maxCallMs=maxCallMs;
    this.planningSignal=planningSignal;this.onObservation=onObservation;
  }
  override async *generateContentAsync(request:LlmRequest,stream?:boolean,
    signal?:AbortSignal):AsyncGenerator<LlmResponse,void>{
    if(this.planningSignal.aborted)
      fail("Planning session deadline exceeded");
    const turn=++this.turns;
    if(turn>this.limit){
      this.onObservation?.(Object.freeze({
        kind:"budget_exhausted",budget:"model_turns",
        completed_turns:turn-1,max_model_turns:this.limit
      }));
      fail("model turn budget exceeded");
    }
    // Counts actual delegate invocation attempts, not provider-billed usage.
    this.onObservation?.(Object.freeze({kind:"model_turn",status:"started",turn}));
    // Per-call and session budgets are independent and both must hold.
    // Signal delivery is cooperative: late responses still fail closed.
    const timeout=AbortSignal.timeout(this.maxCallMs);
    const bounded=AbortSignal.any(
      signal?[signal,timeout,this.planningSignal]:
        [timeout,this.planningSignal]
    );
    if(bounded.aborted)fail("model call timed out or cancelled");
    let lastUsage:Extract<PlanningObservation,{kind:"model_usage"}>|undefined;
    const count=(value:unknown):number|undefined=>
      typeof value==="number"&&Number.isSafeInteger(value)&&
      value>=0&&value<=1_000_000_000?value:undefined;
    try{
      for await(const response of this.delegate.generateContentAsync(
        request,stream,bounded
      )){
        if(bounded.aborted)fail("model call timed out or cancelled");
        if(response.errorCode||response.errorMessage){
          this.onObservation?.(Object.freeze({kind:"model_failure",turn,
            ...sanitizedModelFailure(response,"model_error_response")}));
        }
        // Token fields are optional provider reports, never raw prompt text.
      // Streaming chunks can repeat cumulative counts: keep the LAST
      // reported metadata for each model call, never sum per chunk.
      const usage=response.usageMetadata;
      if(usage){
        const counts={
          input_tokens:count(usage.promptTokenCount),
          output_tokens:count(usage.candidatesTokenCount),
          total_tokens:count(usage.totalTokenCount),
          thought_tokens:count(usage.thoughtsTokenCount)
        };
        if(Object.values(counts).some(value=>value!==undefined)){
          lastUsage={kind:"model_usage",turn,source:"provider_reported",
            ...(counts.input_tokens===undefined?{}:{
              input_tokens:counts.input_tokens}),
            ...(counts.output_tokens===undefined?{}:{
              output_tokens:counts.output_tokens}),
            ...(counts.total_tokens===undefined?{}:{
              total_tokens:counts.total_tokens}),
            ...(counts.thought_tokens===undefined?{}:{
              thought_tokens:counts.thought_tokens})
          };
        }
      }
        yield response;
      }
    }catch(error){
      // Even if ADK later collapses this exception into its generic error
      // event, record the provider HTTP/code classification at the boundary.
      this.onObservation?.(Object.freeze({kind:"model_failure",turn,
        ...sanitizedModelFailure(error,"delegate_exception")}));
      throw error;
    }
    if(bounded.aborted)fail("model call timed out or cancelled");
    if(lastUsage)this.onObservation?.(Object.freeze(lastUsage));
    this.onObservation?.(Object.freeze({kind:"model_turn",status:"completed",turn}));
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("Planning streaming is disabled"));
  }
}

export class TrustedAdkReadOnlyPlanner {
  readonly config:TrustedAdkPlannerConfig;
  #attempted=false;
  constructor(config:TrustedAdkPlannerConfig){
    preliminaryReadPermissions(config.snapshot);
    validatePrivateApprovedBranch(config.workBranch);
    validatedPlannerRegistry(config.agents);
    if(!config.model||!config.readPort||
       typeof config.readPort.invoke!=="function"||
       !sha.test(config.snapshot.base_revision)||
       !id.test(config.planId)||
       !Number.isSafeInteger(config.maxModelTurns??96)||
       (config.maxModelTurns??96)<1||(config.maxModelTurns??96)>96||
       ![0,1,2].includes(config.maxProposalRevisions??0)||
       (config.projectProfileSha256!==undefined&&
        !/^[a-f0-9]{64}$/u.test(config.projectProfileSha256))||
       !Number.isSafeInteger(config.maxModelCallMs??120000)||
       (config.maxModelCallMs??120000)<1000||
       (config.maxModelCallMs??60000)>360000||
       !Number.isSafeInteger(config.maxOutputTokens??16384)||
       (config.maxOutputTokens??16384)<1||
       (config.maxOutputTokens??8192)>32000||
       !Number.isSafeInteger(config.maxPlanningMs??900000)||
       (config.maxPlanningMs??900000)<1000||
       (config.maxPlanningMs??900000)>900000||
       (config.thinkingLevel!==undefined&&
         !["LOW","MEDIUM","HIGH"].includes(config.thinkingLevel)))
      fail("invalid trusted Planning config");
    this.config=config;
  }
  /** Propose the maximum permission scope (never Tasks, never an approval). */
  async proposeAuthority():Promise<UnapprovedAuthorityProposal>{
    // Reserve synchronously: no retries, including concurrent attempts,
    // may consume another model budget or create divergent unsigned plans.
    if(this.#attempted)fail("Planning proposal already attempted");
    this.#attempted=true;
    const cfg=this.config,sp=cfg.snapshot;
    const trustedAgents=validatedPlannerRegistry(cfg.agents);
    // The total session limit starts before any ADK setup or provider read.
    // Late responses are never accepted even when an upstream ignores abort.
    const planningDeadline=AbortSignal.timeout(cfg.maxPlanningMs??900000);
    const model=new BudgetedModel(cfg.model,cfg.maxModelTurns??96,
      cfg.maxModelCallMs??120000,planningDeadline,cfg.onObservation);
    const sourceBranch=trustedPlanningSourceBranch(sp);
    const discovery=new TrustedPlanningDiscoveryLedger(sp);
    const files=new Set(sp.files),directories=new Set(sp.directories);
    // Files/dirs observed later are derived exclusively from verified,
    // revision-pinned Gitea listings, not from model-proposed paths.
    let calls=0,bytes=0,readCount=0,denied=false;
    let cardReadCount=0;
    const read=async(tool:ReadTool,args:Record<string,unknown>)=>{
      const refuse=(reason:string)=>{
        denied=true;
        cfg.onObservation?.(Object.freeze({
          kind:"read",status:"denied",tool,reason
        }));
        return {ok:false,error:reason};
      };
      const verified=(path?:string)=>cfg.onObservation?.(Object.freeze({
        kind:"read",status:"verified",tool,...(path===undefined?{}:{path})
      }));
      if(planningDeadline.aborted){
        return refuse("planning_deadline");
      }
      if(++calls>64)return refuse("read_budget");
      if((tool==="read_file"&&(!files.has(args.path as string)||args.branch!==sourceBranch))||
         (tool==="list_directory"&&(!directories.has(args.path as string)||args.branch!==sourceBranch))||
         (tool==="read_repository"&&(sourceBranch.startsWith("feature/")||Object.keys(args).length!==0))){
        return refuse("outside_planning_scope");
      }
      try{
        const result=obj(await cfg.readPort.invoke(tool,args,planningDeadline));
        if(planningDeadline.aborted)
          throw Error("Planning deadline elapsed during provider read");
        if(result.provider!=="gitea"||result.performed!==true||
           result.tool!==tool||result.revision!==sp.base_revision)
          throw Error("provider revision mismatched");
        if(tool==="read_repository"){
          if(result.default_branch!==sourceBranch||
             result.full_name!==sp.repository.owner+"/"+sp.repository.repository)
            throw Error("repository identity mismatched");
          verified();
          return {ok:true,revision:result.revision,default_branch:sourceBranch};
        }
        if(result.path!==args.path||result.branch!==sourceBranch)
          throw Error("provider path mismatched");
        if(tool==="list_directory"){
          if(!Array.isArray(result.entries)||result.entries.length>200)
            throw Error("directory too large");
          const entries=result.entries.map(entry=>{
            const e=obj(entry);
            if((e.type!=="file"&&e.type!=="dir")||
               typeof e.path!=="string"||
               (args.path===""?e.path.includes("/"):
                 !e.path.startsWith((args.path as string)+"/")))
              throw Error("unexpected directory entry");
            return {path:e.path,type:e.type};
          });
          // Check the full listing (including canonical direct-child paths)
          // before extending the private resource catalog. A partial or
          // forged listing must never authorize a new model read.
          if(discovery.enabled){
            discovery.observeListings([{path:args.path as string,entries}]);
            for(const file of discovery.files())files.add(file);
            for(const directory of discovery.directories())directories.add(directory);
          }
          verified(args.path as string);
          return {ok:true,revision:result.revision,entries};
        }
        if(typeof result.content!=="string")throw Error("missing read content");
        const size=Buffer.byteLength(result.content,"utf8");
        bytes+=size;
        if(size>24000||bytes>524288)throw Error("read content too large");
        readCount++;
        verified(args.path as string);
        return {ok:true,revision:result.revision,path:args.path,content:result.content};
      }catch{
        return refuse("trusted_planning_read_failed");
      }
    };
    // A batch has one signed multipermission Gateway VP; never emulate it
    // using separate reads or expose a partial result after a late failure.
    const readBatch=async(paths:readonly string[],branch:string)=>{
      const refused=(reason:string)=>{
        denied=true;
        cfg.onObservation?.(Object.freeze({
          kind:"read",status:"denied",tool:"read_file",reason
        }));
        return {ok:false,error:reason};
      };
      if(planningDeadline.aborted)return refused("planning_deadline");
      if(!cfg.readPort.invokeComposite)return refused("composite_unavailable");
      if(!Array.isArray(paths)||paths.length<2||paths.length>12||
         branch!==sourceBranch||
         new Set(paths).size!==paths.length||
         paths.some(path=>typeof path!=="string"||!files.has(path)))
        return refused("outside_planning_scope");
      if(calls+paths.length>64)return refused("read_budget");
      calls+=paths.length;
      try{
        const actions=paths.map(path=>({
          tool:"read_file" as const,arguments:{branch,path}
        }));
        const raw=obj(await cfg.readPort.invokeComposite(actions,planningDeadline));
        if(planningDeadline.aborted||raw.decision!=="allow"||
           raw.pinned_revision!==sp.base_revision||
           !Array.isArray(raw.executions)||
           raw.executions.length!==paths.length)
          throw Error("Composite read result differs from pinned trusted source");
        const results:{path:string;content:string}[]=[];
        let readBytes=0;
        for(let i=0;i<paths.length;i++){
          const file=obj(raw.executions[i]);
          if(file.provider!=="gitea"||file.performed!==true||
             file.tool!=="read_file"||file.branch!==sourceBranch||
             file.path!==paths[i]||file.revision!==sp.base_revision||
             file.encoding!=="utf-8"||typeof file.content!=="string")
            throw Error("Composite read evidence mismatched");
          const size=Buffer.byteLength(file.content,"utf8");
          if(size>24000)throw Error("Composite file content too large");
          readBytes+=size;
          results.push({path:paths[i],content:file.content});
        }
        if(bytes+readBytes>524288)throw Error("Composite cumulative read exceeded");
        bytes+=readBytes;
        readCount+=results.length;
        for(const path of paths)cfg.onObservation?.(Object.freeze({
          kind:"read",status:"verified",tool:"read_file",path
        }));
        return {ok:true,revision:sp.base_revision,files:results};
      }catch{
        return refused("trusted_planning_read_failed");
      }
    };
    const tools=[
      // The same approved-plan Card factory as A2A; host-only skill lookup.
      // The trusted registry pins DID/card_ref; no model-controlled URL.
      new FunctionTool({
        name:"read_agent_card",
        description:"Read a registered A2A Agent Card's specialist skills; this never grants authority.",
        parameters:z.object({role:z.enum(trustedAgents.roles as [string,...string[]])}).strict(),
        execute:async(args)=>{
          if(planningDeadline.aborted)return {ok:false,error:"planning_deadline"};
          if(++cardReadCount>6)return {ok:false,error:"agent_card_budget"};
          const role=args.role as Role;
          const registered=cfg.agents[role];
          const capabilities=trustedAgents.capabilities.get(role);
          if(!registered||!capabilities)
            return {ok:false,error:"unregistered_agent_card"};
          // Unknown roles must carry a trusted owner-supplied Card; no model
          // URL fetching and no synthetic fallback into a different role.
          const card=registered.card??createSpecializedAgentCard(
            role as SpecialistRole,"http://127.0.0.1");
          return {
            ok:true,role,card_ref:registered.card_ref,
            name:card.name,description:card.description,
            capabilities:[...capabilities],
            skills:card.skills.map(skill=>({
              id:skill.id,name:skill.name,description:skill.description
            }))
          };
        }
      }),
      ...(!sourceBranch.startsWith("feature/")?[new FunctionTool({
        name:"read_repository",
        description:"Read only pinned trusted repository metadata.",
        // Google Gemini FunctionDeclaration forbids an OBJECT with empty
        // properties. The nonempty repository selector is schema-validated,
        // but never forwarded to the trusted provider (no authority change).
        parameters:z.object({
          repository:z.enum([sp.repository.repository])
        }).strict(),
        execute:async()=>read("read_repository",{})
      })]:[]),
      new FunctionTool({
        name:"list_directory",
        description:"List only approved snapshot directories at the trusted SHA.",
        // The trusted root directory is the empty string. Gemini rejects
        // enum entries equal to "", so validate the directory at the
        // trusted read boundary instead of encoding that enum in the model.
        parameters:z.object({branch:z.enum([sourceBranch]),
          path:z.string()}).strict(),
        execute:async(args)=>read("list_directory",args)
      }),
      ...(sp.files.length||discovery.enabled?[new FunctionTool({
        name:"read_file",
        description:discovery.enabled
          ?"Read an exact file listed by the trusted SHA-pinned directory discovery or already enumerated in the Engineer snapshot. The original Root and Gateway remain authoritative."
          :"Read an explicitly authorized snapshot file at the trusted SHA.",
        parameters:z.object({branch:z.enum([sourceBranch]),
          path:discovery.enabled?z.string().min(1).max(240):
            z.enum(sp.files as [string,...string[]])}).strict(),
        execute:async(args)=>read("read_file",args)
      })]:[]),
      ...((sp.files.length>=2||discovery.enabled)&&cfg.readPort.invokeComposite?[new FunctionTool({
        name:"read_files",
        description:"Read 2-12 distinct files from the verified Planning catalog with one multipermission Gateway VP; no write permission.",
        parameters:z.object({branch:z.enum([sourceBranch]),
          paths:z.array(discovery.enabled?z.string().min(1).max(240):
            z.enum(sp.files as [string,...string[]])).min(2).max(12)}).strict(),
        execute:async(args)=>readBatch(args.paths,args.branch)
      })]:[])
    ];
    const agent=new LlmAgent({
      name:"read_only_plan_proposer",
      description:"Produce a reviewable draft, never an approval",
      model,tools,
      generateContentConfig:{maxOutputTokens:cfg.maxOutputTokens??16384,
        ...(cfg.thinkingLevel?{thinkingConfig:{thinkingLevel:cfg.thinkingLevel}}:{})},
      instruction:AUTHORITY_ONLY_PLANNING_INSTRUCTIONS,
      disallowTransferToParent:true,disallowTransferToPeers:true
    });
    const appName="trusted_planning_only",userId="engineer_planning";
    const sessionId="planning_"+sp.session_id;
    const sessions=new InMemorySessionService();
    const runner=new Runner({agent,appName,sessionService:sessions});
    await sessions.createSession({appName,userId,sessionId});
    const firstMessage={role:"user" as const,parts:[{text:JSON.stringify({
      requirement:cfg.requirement,repository:sp.repository,
      base_revision:sp.base_revision,work_branch:cfg.workBranch,
      roles:trustedAgents.roles,
      directories:sp.directories,files:sp.files,
      ...(discovery.enabled?{dynamic_discovery_roots:sp.dynamic_discovery_roots}:{})
    })}]};
    const maxRevisions=cfg.maxProposalRevisions??0;
    let revisions=0;
    let feedback:{stage:"json"|"contract";reason:TrustedPlanningRejectionReason}|null=null;
    // All drafts share this one Planner session, model budget and deadline.
    // No failed draft is approved, persisted or sent to Execution.
    for(;;){
      let finalText:string|undefined,error=false,errorLoggedByDelegate=false;
      const newMessage=feedback===null?firstMessage:{
        role:"user" as const,parts:[{text:[
          "Your preceding UNAPPROVED draft failed trusted contract validation.",
          "Rejected stage: "+feedback.stage,
          "Rejected category: "+feedback.reason,
          "Trusted structural correction (advisory, no new authority): "+TRUSTED_STRUCTURE_HINT,
          "Return the COMPLETE corrected JSON plan with exact required keys.",
          "Use only the approved read-only snapshot and authorized role operations.",
          "Never expand permissions or use undiscovered file paths.",
          "The previous draft has NOT been approved or executed."
        ].join("\n")}]};
      for await(const event of runner.runAsync({
        userId,sessionId,newMessage
      })){
        if(planningDeadline.aborted){error=true;break;}
        if(event.errorCode||event.errorMessage){
          error=true;
          if(!errorLoggedByDelegate){
            errorLoggedByDelegate=true;
            cfg.onObservation?.(Object.freeze({
              kind:"model_failure",turn:model.turns||1,
              ...sanitizedModelFailure(event,"adk_runner_error")
            }));
          }
        }
        if(event.author===agent.name&&event.content?.role==="model"){
          for(const part of event.content.parts??[]){
            if(typeof part.text==="string"&&part.text.trim())
              finalText=part.text.trim();
          }
        }
      }
      if(planningDeadline.aborted||error||denied||
         readCount===0||!finalText||finalText.length>65000){
        cfg.onObservation?.(Object.freeze({
          kind:"plan_rejection",stage:"grounding",
          reason:"ungrounded_or_missing_output"
        }));
        fail("no verified read-only grounded proposal");
      }
      let proposed:unknown;
      try{proposed=JSON.parse(finalText);}catch{
        const rejection={stage:"json" as const,reason:"invalid_json" as const};
        cfg.onObservation?.(Object.freeze({kind:"plan_rejection",...rejection}));
        if(revisions<maxRevisions&&model.turns<model.limit&&!planningDeadline.aborted){
          feedback=rejection;revisions++;continue;
        }
        fail("model output was not strict JSON");
      }
      // This enlarged snapshot is model-inaccessible and only carries paths
      // independently grounded in this exact SHA's verified Gitea listings.
      // It does not replace the Engineer's original Root or grant anything.
      const checkedCfg=discovery.enabled
        ?{...cfg,snapshot:{...sp,files:discovery.files(),
          directories:discovery.directories()}}:cfg;
      let proposal:UnapprovedAuthorityProposal;
      try{proposal=compileAuthorityOnlyPlanningProposal(proposed,checkedCfg);}
      catch(error){
        const rejection={stage:"contract" as const,reason:"invalid_permissions" as const};
        cfg.onObservation?.(Object.freeze({kind:"plan_rejection",...rejection}));
        if(revisions<maxRevisions&&model.turns<model.limit&&!planningDeadline.aborted){
          feedback=rejection;revisions++;continue;
        }
        throw error;
      }
      if(planningDeadline.aborted)fail("Planning session deadline exceeded");
      cfg.onObservation?.(Object.freeze({kind:"proposal",status:"unapproved",
        digest:proposal.digest,task_count:0,
        permission_count:proposal.proposal.requested_permissions.length,
        verified_source_reads:readCount}));
      return {...proposal,verified_source_reads:readCount};
    }
  }
}
