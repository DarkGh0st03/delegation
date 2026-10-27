import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {SourceDerivedRouteOfflineAdkModel,applyApprovedRouteRules}
  from "./source-derived-route-offline-adk-model.mjs";
const branch="feature/scoped-route",path="apps/backend/src/users/user.routes.ts";
const resource="gitea://gitea.local/thesis/iam/branches/"+
  encodeURIComponent(branch)+"/files/"+path;
const description="Implement approved backend feature.\n"+
  "ROUTE POST /:id/suspend suspendUser AFTER PATCH /:id/profile\n"+
  "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend";
const source='export function createUserRouter() {\n'+
  '  const controller = createUserController(service);\n'+
  '  router.get("/", controller.listUsers);\n'+
  '  router.get("/:id", controller.getUser);\n'+
  '  router.patch("/:id/profile", controller.updateProfile);\n'+
  '  return router;\n}\n';
const context={role:"backend",tasks:[{id:"backend",description}],
  approved_permissions:[
    {task_id:"backend",operation:"read_file",resource},
    {task_id:"backend",operation:"update_file",resource}
  ]};
const script=[{name:"read_file",args:{branch,path}},
  {name:"update_file",args:{branch,path}}];
const data={provider:"gitea",performed:true,tool:"read_file",
  branch,path,revision:"a".repeat(40),content:source};
const input=response=>({contents:[{parts:[{functionResponse:{
  name:"read_file",response
}}]}]});
async function next(model,request){
  const items=[];
  for await(const item of model.generateContentAsync(request))items.push(item);
  return items[0].content.parts[0];
}
test("Account Suspension: source and approved directives generate real route code without final fixture",async()=>{
  for(const envelope of [
    {ok:true,result:data},
    {structuredContent:{ok:true,result:data}},
    {result:{structuredContent:{ok:true,result:data}}}
  ]){
    const model=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
    const first=(await next(model,{})).functionCall;
    assert.deepEqual({name:first.name,args:first.args},script[0]);
    const output=(await next(model,input(envelope))).functionCall;
    assert.equal(output.name,"update_file");
    assert.deepEqual(Object.keys(output.args).sort(),["branch","content","path"]);
    const expected=source.replace('  return router;',
      '  router.post("/:id/suspend", controller.suspendUser);\n'+
      '  router.post("/:id/reactivate", controller.reactivateUser);\n'+
      '  return router;');
    assert.equal(output.args.content,expected);
    assert.deepEqual(model.derivedRouteProof,{
      branch,path,source_sha256:createHash("sha256").update(source).digest("hex"),
      directive_count:2,source_derived:true
    });
  }
});
test("Department Directory: static route generated before parameterized route",async()=>{
  const modified={...context,tasks:[{id:"backend",description:
    "Approved directory\nROUTE GET /by-department/:department listUsersByDepartment BEFORE GET /:id"}]};
  const model=new SourceDerivedRouteOfflineAdkModel({
    context:modified,calls:script
  });
  await next(model,{});
  const text=(await next(model,input({ok:true,result:data}))).functionCall.args.content;
  assert.ok(text.indexOf('router.get("/by-department/:department"')<
    text.indexOf('router.get("/:id"'));
  assert.ok(text.includes("controller.listUsersByDepartment"));
  assert.ok(!text.includes("router.post("));
});
test("unknown permission, malformed source and spoofed provider read fail closed",async()=>{
  for(const supplied of [
    {...context,approved_permissions:context.approved_permissions.slice(0,1)},
    {...context,approved_permissions:context.approved_permissions.slice(1)},
    {...context,role:"frontend"},
    {...context,tasks:[{id:"backend",description:"No directives"}]}
  ])assert.throws(()=>new SourceDerivedRouteOfflineAdkModel({
    context:supplied,calls:script
  }),/NO-GO/);
  assert.throws(()=>new SourceDerivedRouteOfflineAdkModel({
    context,calls:[script[0],{name:"update_file",args:{
      branch,path,content:"golden"
    }}]
  }),/NO-GO/);
  for(const payload of [
    {ok:false,result:data},
    {ok:true,result:{...data,path:"src/evil.ts"}},
    {ok:true,result:{...data,provider:"fixture"}},
    {ok:true,result:{...data,revision:"invalid"}},
    {ok:true,result:{...data,content:7}}
  ]){
    const model=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
    await next(model,{});
    await assert.rejects(()=>next(model,input(payload)),/NO-GO/);
    assert.equal(model.derivedRouteProof,null);
  }
  assert.throws(()=>applyApprovedRouteRules(source,[{
    method:"post",path:"/:id/suspend",handler:"suspendUser",side:"AFTER",
    anchorMethod:"patch",anchorPath:"/does-not-exist"
  }]),/NO-GO/);
});
