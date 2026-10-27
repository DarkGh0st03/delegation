/**
 * F1 research rehearsal: real Gitea read port -> actual Google ADK Planner
 * -> compiled UNAPPROVED draft -> independent offline feasibility rubric.
 *
 * A tiny BaseLlm is a SCRIPTED TEST MODEL, not Gemini. It deliberately
 * requests real read-only tool calls and returns an artificial task sketch.
 * No API key, model inference, Engineer signature, credential or write tool.
 * This proves integration readiness, NOT intelligent autonomous Planning.
 */
import {BaseLlm} from "@google/adk";
import {TrustedAdkReadOnlyPlanner}
  from "../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {evaluatePlannerFeasibility} from "./planner-feasibility-eval.mjs";
import {assessF1DepartmentDirectoryPlan}
  from "./f1-department-directory-functional-review.mjs";
import {buildF1RealGiteaResearchPlanningPort}
  from "./f1-gitea-research-planning-port.mjs";

const REQUIREMENT="Enable an administrator to search the IAM user directory by department (case-insensitive), with an authenticated API, accessible frontend and meaningful tests. Preserve existing account suspension/reactivation semantics.";
const SERVICE="apps/backend/src/users/user.service.ts";
const ROUTES="apps/backend/src/users/user.routes.ts";
const UI="apps/frontend/src/pages/UserDetailPage.tsx";
const CLIENT="apps/frontend/src/api/users-api.ts";
function deny(){throw Error("F1 scripted ADK real-Gitea rehearsal NO-GO");}
function offlineDraft(){
  // A fixture that tests compiler/permissions. Not a golden implementation.
  const permission=(operation,path,reason)=>({operation,path,reason});
  return {tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create an isolated branch",
      description:"Keep main immutable during the experiment",
      depends_on:[],permissions:[
        permission("create_branch",null,"Separate the feature from main")
      ]},
    {id:"backend",agent_id:"backend",title:"Implement directory API",
      description:"Add case-insensitive department filtering to existing user services and HTTP routes",
      depends_on:["branch"],permissions:[
        permission("read_file",SERVICE,"Inspect users and filtering"),
        permission("update_file",SERVICE,"Add scoped department filtering"),
        permission("read_file",ROUTES,"Inspect HTTP and auth middleware"),
        permission("update_file",ROUTES,"Add authenticated department listing")
      ]},
    {id:"frontend",agent_id:"frontend",title:"Expose department directory",
      description:"Provide accessible filtered user search with a frontend API",
      depends_on:["backend"],permissions:[
        permission("read_file",CLIENT,"Inspect API calls"),
        permission("update_file",CLIENT,"Add department query"),
        permission("read_file",UI,"Inspect UI and accessibility"),
        permission("update_file",UI,"Provide accessible search")
      ]},
    {id:"test",agent_id:"test",title:"Run independent project tests",
      description:"Use approved Docker test path and verify expected changes",
      depends_on:["frontend"],permissions:[
        permission("run_tests",null,"Run approved project and acceptance tests")
      ]},
    {id:"pr",agent_id:"orchestrator",title:"Open an unmerged pull request",
      description:"Publish changes for Engineer review without merging",
      depends_on:["test"],permissions:[
        permission("create_pull_request",null,"Review isolated branch changes")
      ]}
  ],assumptions:[],uncertainties:[]};
}
class OfflinePlanningRehearsalModel extends BaseLlm {
  turns=0;
  constructor(){super({model:"offline-research-rehearsal-no-gemini"});}
  async *generateContentAsync(){
    const calls=[
      {name:"read_repository",args:{repository:"iam-console-poc"}},
      {name:"list_directory",args:{branch:"main",path:""}},
      {name:"read_file",args:{branch:"main",path:SERVICE}},
      {name:"read_file",args:{branch:"main",path:ROUTES}},
      {name:"read_file",args:{branch:"main",path:CLIENT}},
      {name:"read_file",args:{branch:"main",path:UI}}
    ];
    const turn=++this.turns;
    if(turn<=calls.length){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"offline-gitea-rehearsal-"+turn,...calls[turn-1]
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{
        text:JSON.stringify(offlineDraft())
      }]}};
    }
  }
  connect(){return Promise.reject(Error("research-only no live LLM"));}
}
export async function rehearseF1RealGiteaAdkPlanning({
  baseUrl,readToken,expectedMainSha,sessionId,fetchFn=fetch
}={}){
  const host=await buildF1RealGiteaResearchPlanningPort({
    baseUrl,readToken,expectedMainSha,sessionId,fetchFn
  });
  const observations=[];
  const model=new OfflinePlanningRehearsalModel();
  const planner=new TrustedAdkReadOnlyPlanner({
    model,snapshot:host.snapshot,requirement:REQUIREMENT,
    planId:"f1_scripted_real_gitea_rehearsal",
    workBranch:"feature/experiment-department-directory",
    agents:{
      backend:{did:"did:example:test-backend",card_ref:"fixture:backend"},
      frontend:{did:"did:example:test-frontend",card_ref:"fixture:frontend"},
      test:{did:"did:example:test-agent",card_ref:"fixture:test"}
    },readPort:host.readPort,
    maxModelTurns:10,maxModelCallMs:30000,maxPlanningMs:120000,
    onObservation:e=>observations.push(e)
  });
  const proposal=await planner.propose();
  const grade=evaluatePlannerFeasibility({
    scenario:"department-directory",expectedBaseRevision:expectedMainSha,
    proposal,observations
  });
  const functional=assessF1DepartmentDirectoryPlan({
    proposal,expectedBaseRevision:expectedMainSha
  });
  const taskRoles=proposal.plan.tasks.map(x=>x.agent_id);
  if(!grade.technical_preflight_pass||model.turns!==7||
     proposal.status!=="unapproved_proposal"||
     proposal.plan.base_revision!==expectedMainSha||
     proposal.verified_source_reads!==4||
     JSON.stringify(taskRoles)!==
       JSON.stringify(["orchestrator","backend","frontend","test","orchestrator"])||
     observations.filter(x=>x.kind==="read"&&x.status==="denied").length||
     grade.evidence?.provider_token_usage?.actual_billed_cost!=="not_measured")
    deny();
  return Object.freeze({
    schema:"f1-scripted-adk-real-gitea-rehearsal-v1",
    status:"actual_adk_planner_scripted_proposal_on_real_gitea_pass",
    scenario_id:"department-directory",base_revision:expectedMainSha,
    discovered_files:host.snapshot.files.length,
    verified_source_reads:proposal.verified_source_reads,
    model_turns:model.turns,
    compiled_task_count:proposal.plan.tasks.length,
    compiled_permission_count:proposal.plan.requested_permissions.length,
    technical_preflight_pass:grade.technical_preflight_pass,
    functional_design_plausible:functional.functional_design_plausible,
    functional_review_failed_checks:Object.freeze([...functional.failed_checks]),
    human_engineer_review_still_required:true,
    proposal_digest_verified:typeof proposal.digest==="string"&&
      /^[0-9a-f]{64}$/u.test(proposal.digest),
    no_approval_or_credential:true,
    scripted_model_only:true,
    real_gemini_calls:0,gemini_billing_incurred:false,
    direct_gitea_research_only:true,
    gateway_vp_opa_attested_by_this_rehearsal:false,
    execution_permitted:false,external_r5_go:false
  });
}
