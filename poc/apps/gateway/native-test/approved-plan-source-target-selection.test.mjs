import test from "node:test";
import assert from "node:assert/strict";
import {canonicalFileUri} from "../src/canonical.ts";
import {selectSourceDerivedTargetsFromApprovedPlan as select}
  from "./approved-plan-source-target-selection.mjs";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension-ci";
const routes="services/identity/routes/user.routes.ts";
const controller="services/identity/handlers/user.controller.ts";
const other="services/identity/user.service.ts";
const uri=path=>canonicalFileUri(repo,branch,path);
function input({routesPath=routes,controllerPath=controller,
  includeController=true}={}){
  const description=[
    "Account Suspension is the sole tested functional requirement",
    "ROUTE POST /:id/suspend suspendUser AFTER PATCH /:id/profile",
    "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend",
    ...(includeController?[
      "CONTROLLER HANDLER suspendUser CALL suspendUser",
      "CONTROLLER HANDLER reactivateUser CALL reactivateUser",
      "CONTROLLER ERROR AccountStatusConflictError STATUS 409 CODE ACCOUNT_STATUS_CONFLICT"
    ]:[])
  ].join("\n");
  const task={id:"implement",agent_id:"backend",description};
  const tasks=[task,{id:"review",agent_id:"test",description:"Test Account Suspension"}];
  const grants=[routesPath,controllerPath,other].flatMap((path,i)=>[
    {id:"r"+i,task_id:"implement",agent_id:"backend",
      operation:"read_file",resource:uri(path)},
    {id:"w"+i,task_id:"implement",agent_id:"backend",
      operation:"update_file",resource:uri(path)}
  ]);
  return {plan:{tasks,requested_permissions:grants},
    approvedRows:grants.map(g=>({...g})),repo,branch};
}
test("Account Suspension source targets come only from dynamic approved URIs",()=>{
  const first=input();
  assert.deepEqual(select(first),[routes,controller]);
  const second=input({
    routesPath:"modules/iam/http/accounts.routes.ts",
    controllerPath:"modules/iam/http/accounts.controller.ts"
  });
  assert.deepEqual(select(second),
    ["modules/iam/http/accounts.routes.ts",
     "modules/iam/http/accounts.controller.ts"]);
  assert.deepEqual(select(input({includeController:false})),[routes]);
  assert.equal(select(first).includes(other),false);
});
test("signed Task cannot select an unapproved path, other branch or a rewritten grant",()=>{
  const original=input();
  for(const mutate of [
    x=>{x.approvedRows=x.approvedRows.filter(g=>
      !(g.operation==="read_file"&&g.resource===uri(routes)));},
    x=>{x.approvedRows[0].resource=uri("other/evil.routes.ts");},
    x=>{x.approvedRows[0].agent_id="frontend";},
    x=>{x.approvedRows[0].operation="create_file";},
    x=>{x.approvedRows.push({...x.approvedRows[0]});},
    x=>{x.repo={...repo,repository:"other-repository"};},
    x=>{x.branch="feature/wrong-branch";},
    x=>{x.plan.tasks[0].agent_id="frontend";},
    x=>{x.plan.tasks[0].description="No approved source-derived directives";}
  ]){
    const clone=structuredClone(original);mutate(clone);
    assert.throws(()=>select(clone),/NO-GO/);
  }
});
test("ambiguity and traversal in signed permissions fail closed",()=>{
  const ambiguous=input();
  for(const op of ["read_file","update_file"]){
    ambiguous.plan.requested_permissions.push({
      id:"extra_"+op,task_id:"implement",agent_id:"backend",
      operation:op,resource:uri("another/scoped.routes.ts")
    });
  }
  ambiguous.approvedRows=structuredClone(ambiguous.plan.requested_permissions);
  assert.throws(()=>select(ambiguous),/NO-GO/);
  const traversal=input({routesPath:"services/../evil.routes.ts"});
  assert.throws(()=>select(traversal),/NO-GO/);
});
