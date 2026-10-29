/**
 * R100 migration preflight: a new immutable plan is a subset of an already
 * issued Rust operational root, not an additional Engineer authorization.
 *
 * Pure data check only. It NEVER registers Gateway tasks, issues child DCs,
 * authenticates the Engineer, proves VP/accumulators or authorizes execution.
 * The trusted host must supply its authenticated original plan, live
 * Coordinator root, pinned Agent Card registry and durable replay history.
 */
import {planDigest,validatePlan} from "./plan.mjs";
import {approvedWorkBranch} from "./approved-work-branch.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const ROLES=new Set(["backend","frontend","test"]);
const pair=p=>JSON.stringify([p.resource,p.operation]);
const fail=x=>{throw Error("Operational epoch preflight: "+x);};
function idHistory(values,label,max){
 if(!Array.isArray(values)||values.length>max||
    values.some(x=>typeof x!=="string"||!ID.test(x))||
    values.length!==new Set(values).size)fail("invalid "+label+" history");
 return new Set(values);
}
function parentPairs(root,ops){
 if(!root||typeof root.credential_id!=="string"||
    !ID.test(root.credential_id)||!SHA.test(root.plan_digest)||
    !Array.isArray(root.permissions)||!root.permissions.length||
    root.permissions.length>128)fail("invalid operational root");
 const seen=new Set();
 for(const p of root.permissions){
  if(!p||typeof p.resource!=="string"||
     typeof p.operation!=="string"||!ops.has(p.operation)||
     !p.resource.startsWith("gitea://"))fail("invalid root permission");
  if(seen.has(pair(p)))fail("duplicate root permission");
  seen.add(pair(p));
 }
 return seen;
}
function agentsPinned(values){
 if(!Array.isArray(values)||values.length>32)fail("trusted Agent registry required");
 const out=new Map();
 for(const a of values){
  if(!a||!ROLES.has(a.agent_id)||out.has(a.agent_id)||
     typeof a.did!=="string"||!a.did.startsWith("did:")||
     typeof a.card_ref!=="string"||!a.card_ref.trim())
     fail("malformed trusted Agent registry");
  out.set(a.agent_id,a);
 }
 return out;
}
const sameRepo=(a,b)=>a.authority===b.authority&&
 a.owner===b.owner&&a.repository===b.repository;
const repoUri=r=>"gitea://"+r.authority+"/"+encodeURIComponent(r.owner)+
 "/"+encodeURIComponent(r.repository);

/** Side-effect-free scope test. Not a trusted registration or an authorization. */
export function preflightNextOperationalEpoch(input,{allowedOperations}={}){
 if(!(allowedOperations instanceof Set)||!allowedOperations.size)
  fail("authoritative Rust operation catalog required");
 const {originalSignedPlan,previousEpochPlan,candidatePlan,operationalRoot,
   pinnedAgentRegistry,priorTaskIds,priorPlanIds}=input??{};
 for(const p of [originalSignedPlan,previousEpochPlan,candidatePlan])
  validatePlan(p,{allowedOperations});
 const grants=parentPairs(operationalRoot,allowedOperations);
 if(planDigest(originalSignedPlan)!==operationalRoot.plan_digest)
  fail("root does not match authenticated original plan");
 if(!sameRepo(originalSignedPlan.repository,previousEpochPlan.repository)||
    !sameRepo(originalSignedPlan.repository,candidatePlan.repository))
  fail("repository changed");
 if(originalSignedPlan.base_revision!==previousEpochPlan.base_revision||
    originalSignedPlan.base_revision!==candidatePlan.base_revision)
  fail("pinned main revision changed");
 if(originalSignedPlan.session_id!==previousEpochPlan.session_id||
    originalSignedPlan.session_id!==candidatePlan.session_id)
  fail("session changed");
 const branch=approvedWorkBranch(originalSignedPlan);
 if(approvedWorkBranch(previousEpochPlan)!==branch||
    approvedWorkBranch(candidatePlan)!==branch)fail("working branch changed");
 const prefix=repoUri(originalSignedPlan.repository)+
  "/branches/"+encodeURIComponent(branch);
 if(!candidatePlan.requested_permissions.some(p=>p.resource===prefix||
    p.resource.startsWith(prefix+"/")))fail("explicit branch scope missing");
 if(candidatePlan.version!==previousEpochPlan.version+1||
    candidatePlan.plan_id===previousEpochPlan.plan_id)
  fail("immutable plan epoch must advance one version");
 const oldTasks=idHistory(priorTaskIds,"Task ID",256);
 const oldPlans=idHistory(priorPlanIds,"plan ID",32);
 if(!oldPlans.has(originalSignedPlan.plan_id)||
    !oldPlans.has(previousEpochPlan.plan_id)||
    oldPlans.has(candidatePlan.plan_id)||
    candidatePlan.tasks.some(t=>oldTasks.has(t.id))||
    candidatePlan.tasks.length+oldTasks.size>256)
  fail("plan or Task replay / incomplete history");
 for(const p of [originalSignedPlan,previousEpochPlan]){
  if(p.tasks.some(t=>!oldTasks.has(t.id)))fail("trusted Task history incomplete");
 }
 const trustedAgents=agentsPinned(pinnedAgentRegistry);
 for(const a of candidatePlan.candidate_agents){
  const pinned=trustedAgents.get(a.agent_id);
  if(!pinned||pinned.did!==a.did||pinned.card_ref!==a.card_ref)
   fail("Agent identity or Card not pinned");
 }
 for(const p of candidatePlan.requested_permissions){
  if(!grants.has(pair(p)))fail("permission outside actually issued root");
 }
 return Object.freeze({
   status:"scope_preflight_only",
   execution_authorized:false,
   child_credential_issued:false,
   parent_credential_id:operationalRoot.credential_id,
   parent_plan_digest:operationalRoot.plan_digest,
   candidate_plan_digest:planDigest(candidatePlan),
   new_plan_id:candidatePlan.plan_id,
   new_epoch_version:candidatePlan.version
 });
}
