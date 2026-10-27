/**
 * Host-only ADK model binding for a reviewed execution DAG.
 * The model factory receives only its role, Task metadata and approved
 * permissions. It must not be supplied test implementation fixtures,
 * other roles' permissions, root/child DCs, VPs or service tokens.
 *
 * This function does NOT verify signatures or issue credentials. Its
 * approvedRows MUST first come from assertApprovedPlanScope applied to
 * an authenticated Engineer review. The Gateway still verifies each call.
 */
import {BaseLlm} from "@google/adk";
const ROLES=Object.freeze(["backend","frontend","test"]);
function deny(reason){throw Error("Approved agent model binding NO-GO: "+reason);}
const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
export function bindModelsToApprovedRoleTasks({
  plan,approvedRows,modelFactory
}={}){
  if(!plain(plan)||!Array.isArray(plan.tasks)||plan.tasks.length>64||
     !Array.isArray(approvedRows)||approvedRows.length>256||
     typeof modelFactory!=="function")deny("reviewed context missing");
  const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
  if(tasks.size!==plan.tasks.length)deny("duplicate Task identities");
  const grantIds=new Set();
  for(const g of approvedRows){
    const t=tasks.get(g?.task_id);
    if(!plain(g)||typeof g.id!=="string"||grantIds.has(g.id)||
       !t||t.agent_id!==g.agent_id||
       typeof g.operation!=="string"||
       typeof g.resource!=="string")
      deny("unbound or duplicated grant");
    grantIds.add(g.id);
  }
  const models={},contexts={};
  for(const role of ROLES){
    const selected=plan.tasks.filter(t=>t.agent_id===role&&
      approvedRows.some(g=>g.task_id===t.id));
    if(!selected.length)continue;
    const grants=approvedRows.filter(g=>g.agent_id===role);
    const context=Object.freeze({
      role,
      tasks:Object.freeze(selected.map(t=>Object.freeze({
        id:t.id,title:t.title,description:t.description,
        depends_on:Object.freeze([...t.depends_on])
      }))),
      approved_permissions:Object.freeze(grants.map(g=>Object.freeze({
        task_id:g.task_id,operation:g.operation,resource:g.resource
      }))),
      source:"authenticated_approved_plan_scope"
    });
    const model=modelFactory(context);
    if(!(model instanceof BaseLlm))
      deny("trusted factory did not return ADK BaseLlm");
    models[role]=model;contexts[role]=context;
  }
  if(!Object.keys(models).length)deny("no active approved agent roles");
  return Object.freeze({
    models:Object.freeze(models),
    contexts:Object.freeze(contexts),
    selected_roles:Object.freeze(Object.keys(models))
  });
}
