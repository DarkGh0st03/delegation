/**
 * R5 infrastructure-only scripted Planning model, using the real Google ADK
 * Planner protocol but ZERO model-provider calls.
 *
 * This is not an autonomous intelligence demonstration: owner-selected
 * inventory paths produce a fixed, REVIEWABLE proposal. The ADK FunctionTool
 * still performs real, scope-bound Gateway -> Rust/OPA -> pinned Gitea reads.
 * The original Engineer must subsequently sign the resulting plan, and
 * authentic GitHub OIDC + Gateway authority are still mandatory to execute.
 */
import {BaseLlm,type LlmRequest,type LlmResponse,
  type BaseLlmConnection} from "@google/adk";
import {isDeepStrictEqual} from "node:util";
import type {TrustedPlanningSnapshot} from "./trusted-engineer-authority.ts";

type Role="backend"|"frontend";
interface R5ScriptedPlanningIntent {
  snapshot:TrustedPlanningSnapshot;
  edits:Readonly<Record<Role,readonly string[]>>;
  newTestFile:string;
  workBranch:string;
}
const models=new WeakMap<object,Readonly<{snapshot:TrustedPlanningSnapshot;
  workBranch:string}>>();
const CANONICAL_BRANCH=/^feature\/[a-z0-9][a-z0-9./_-]*$/u;
function fail(reason:string):never{
  throw Error("R5 scripted no-provider Planning denied: "+reason);
}
function canonical(path:unknown):path is string{
  return typeof path==="string"&&path.length>0&&path.length<=240&&
    !path.startsWith("/")&&!path.includes("\\")&&!path.includes("%")&&
    !path.includes("//")&&!/[\x00-\x1f\x7f]/u.test(path)&&
    path.split("/").every(part=>part!==""&&part!=="."&&part!=="..");
}
function sketchFromOwnerIntent(intent:R5ScriptedPlanningIntent){
  const {snapshot,edits,newTestFile,workBranch}=intent;
  if(!snapshot||!Array.isArray(snapshot.files)||
     !Array.isArray(snapshot.directories)||
     !CANONICAL_BRANCH.test(workBranch??"")||
     !edits||Object.getPrototypeOf(edits)!==Object.prototype||
     Object.keys(edits).sort().join(",")!=="backend,frontend")
    fail("exact protected snapshot, branch and two role intents required");
  const existing=new Set(snapshot.files);
  const dirs=new Set(snapshot.directories);
  const claimed=new Set<string>();
  for(const role of ["backend","frontend"] as const){
    const paths=edits[role];
    if(!Array.isArray(paths)||paths.length!==1||
       !canonical(paths[0])||!existing.has(paths[0])||
       claimed.has(paths[0]))
      fail("each Agent must select one separate existing inventory file");
    claimed.add(paths[0]);
  }
  if(!canonical(newTestFile)||existing.has(newTestFile)||
     claimed.has(newTestFile))
    fail("test file must be new and canonical");
  const parent=newTestFile.includes("/")
    ?newTestFile.slice(0,newTestFile.lastIndexOf("/")):"";
  if(!dirs.has(parent))
    fail("test file parent absent from signed Gitea inventory");
  const roles=["backend","frontend"] as const;
  const tasks=[
    {id:"branch",agent_id:"orchestrator",title:"Create reviewed feature branch",
      description:"Create the isolated reviewed feature branch; never modify main",
      depends_on:[],
      permissions:[{operation:"create_branch",path:null,
        reason:"Isolate all reviewed source changes from main"}]},
    ...roles.map(role=>({
      id:role,agent_id:role,title:"Implement reviewed "+role+" modification",
      description:"Read and update the one independently reviewed "+role+" source file",
      depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:edits[role][0],
          reason:"Inspect the source pinned to the original Gitea base revision"},
        {operation:"update_file",path:edits[role][0],
          reason:"Apply the separately approved "+role+" change"}
      ]
    })),
    {id:"test",agent_id:"test",title:"Create regression and verify changed SHA",
      description:"Create the reviewed test and run exact-SHA acceptance",
      depends_on:["backend","frontend"],
      permissions:[
        {operation:"create_file",path:newTestFile,
          reason:"Add the reviewed functional regression test"},
        {operation:"run_tests",path:null,
          reason:"Validate the complete approved changes against the exact commit"}
      ]},
    {id:"pr",agent_id:"orchestrator",title:"Open human-review Pull Request",
      description:"Open a reviewed PR only after acceptance; do not merge",
      depends_on:["test"],
      permissions:[{operation:"create_pull_request",path:null,
        reason:"Request a separate Engineer review with no automatic merge"}]}
  ];
  return {tasks,assumptions:[],uncertainties:[]};
}

/** A locally constructed ADK BaseLlm that cannot open a model connection. */
export class R5ScriptedNoProviderPlanningModel extends BaseLlm {
  readonly #draft:ReturnType<typeof sketchFromOwnerIntent>;
  readonly #readPaths:readonly string[];
  #turn=0;
  constructor(intent:R5ScriptedPlanningIntent){
    const draft=sketchFromOwnerIntent(intent);
    super({model:"r5-scripted-no-provider-planning"});
    this.#draft=structuredClone(draft);
    this.#readPaths=Object.freeze([
      intent.edits.backend[0],intent.edits.frontend[0]
    ]);
    models.set(this,{snapshot:structuredClone(intent.snapshot),
      workBranch:intent.workBranch});
  }
  override async *generateContentAsync(
    _r:LlmRequest,_stream?:boolean,_signal?:AbortSignal
  ):AsyncGenerator<LlmResponse,void>{
    const turn=this.#turn++;
    if(turn<this.#readPaths.length){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"r5-real-gateway-read-"+(turn+1),
        name:"read_file",args:{
          branch:"main",path:this.#readPaths[turn]
        }
      }}]}};
      return;
    }
    if(turn===this.#readPaths.length){
      yield {content:{role:"model",parts:[{
        text:JSON.stringify(this.#draft)
      }]}};
      return;
    }
    fail("model cannot be reused after the bounded proposal");
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("R5 scripted model has no network provider"));
  }
}
// Capture original code references once. Instance checks alone are unsafe:
// a subclass or an overwritten generateContentAsync() could call a paid API
// while retaining a valid WeakMap entry created by super(intent).
const ORIGINAL_GENERATOR=R5ScriptedNoProviderPlanningModel.prototype.generateContentAsync;
const ORIGINAL_CONNECTION=R5ScriptedNoProviderPlanningModel.prototype.connect;

/**
 * An in-process owner check; model output is still NEVER trusted for approval.
 * A paid BaseLlm or caller-created model-like object cannot satisfy it.
 */
export function isBoundR5NoProviderPlanningModel(
  model:unknown,snapshot:TrustedPlanningSnapshot,workBranch:string
):boolean{
  if(!(model instanceof R5ScriptedNoProviderPlanningModel)||
     Object.getPrototypeOf(model)!==
       R5ScriptedNoProviderPlanningModel.prototype||
     model.generateContentAsync!==ORIGINAL_GENERATOR||
     model.connect!==ORIGINAL_CONNECTION||
     Object.hasOwn(model,"generateContentAsync")||
     Object.hasOwn(model,"connect"))
    return false;
  const state=models.get(model);
  return !!state&&state.workBranch===workBranch&&
    isDeepStrictEqual(state.snapshot,snapshot);
}
