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
test("Account Suspension: changing approved route order changes the generated edit",async()=>{
  const reordered={...context,tasks:[{id:"backend",description:[
    "Implement suspension and reactivation with a different approved route order",
    "ROUTE POST /:id/suspend suspendUser BEFORE GET /:id",
    "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend"
  ].join("\n")}]};
  const model=new SourceDerivedRouteOfflineAdkModel({
    context:reordered,calls:script
  });
  await next(model,{});
  const updated=(await next(model,input({ok:true,result:data})))
    .functionCall.args.content;
  assert.ok(updated.includes('router.post("/:id/suspend", controller.suspendUser);'));
  assert.ok(updated.includes('router.post("/:id/reactivate", controller.reactivateUser);'));
  assert.ok(updated.indexOf('router.post("/:id/suspend"')<
    updated.indexOf('router.get("/:id"'));
  assert.ok(updated.indexOf('router.post("/:id/reactivate"')<
    updated.indexOf('router.get("/:id"'));
  assert.notEqual(updated,
    applyApprovedRouteRules(source,[
      {method:"post",path:"/:id/suspend",handler:"suspendUser",
        side:"AFTER",anchorMethod:"patch",anchorPath:"/:id/profile"},
      {method:"post",path:"/:id/reactivate",handler:"reactivateUser",
        side:"AFTER",anchorMethod:"post",anchorPath:"/:id/suspend"}
    ]));
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

test("Account Suspension: two source-derived Backend writes from approved controller and route reads",async()=>{
  const ctrlPath="apps/backend/src/users/user.controller.ts";
  const ctrlResource="gitea://gitea.local/thesis/iam/branches/"+
    encodeURIComponent(branch)+"/files/"+ctrlPath;
  const extended={...context,
    tasks:[{...context.tasks[0],description:description+"\n"+
      "CONTROLLER HANDLER suspendUser CALL suspendUser\n"+
      "CONTROLLER HANDLER reactivateUser CALL reactivateUser\n"+
      "CONTROLLER ERROR AccountStatusConflictError STATUS 409 CODE ACCOUNT_STATUS_CONFLICT"}],
    approved_permissions:[...context.approved_permissions,
      {task_id:"backend",operation:"read_file",resource:ctrlResource},
      {task_id:"backend",operation:"update_file",resource:ctrlResource}]
  };
  const ctrlSource=[
    'import type { NextFunction, Request, Response } from "express";',
    'import { z } from "zod";',
    'import { UserNotFoundError, UserService } from "./user.service.js";',
    'export function createUserController(service: UserService) {',
    '  return {',
    '    updateProfile(request: Request, response: Response, next: NextFunction): void {',
    '      try {',
    '        response.json(service.updateProfile(String(request.params.id), request.body));',
    '      } catch (error) { next(error); }',
    '    }',
    '  };',
    '}',
    'export function userErrorHandler(error: unknown, _request: Request,',
    '  response: Response, _next: NextFunction): void {',
    '  if (error instanceof z.ZodError) {',
    '    response.status(400).json({code: "INVALID_INPUT"});',
    '  }',
    '}',
    ''
  ].join("\n");
  const scripts=[
    {name:"read_file",args:{branch,path:ctrlPath}},
    {name:"update_file",args:{branch,path:ctrlPath}},
    ...script
  ];
  const m=new SourceDerivedRouteOfflineAdkModel({
    context:extended,calls:scripts
  });
  assert.equal((await next(m,{})).functionCall.name,"read_file");
  const ctrl=(await next(m,input({ok:true,result:{
    ...data,path:ctrlPath,content:ctrlSource
  }}))).functionCall;
  assert.equal(ctrl.name,"update_file");
  assert.ok(ctrl.args.content.includes("service.suspendUser"));
  assert.ok(ctrl.args.content.includes("AccountStatusConflictError"));
  assert.equal((await next(m,{})).functionCall.name,"read_file");
  const route=(await next(m,input({ok:true,result:data}))).functionCall;
  assert.ok(route.args.content.includes('router.post("/:id/suspend"'));
  assert.equal(m.derivedFileCount,2);
  assert.equal(m.derivedControllerProof.path,ctrlPath);
  assert.equal(m.derivedRouteProof.path,path);
  const reduced={...extended,approved_permissions:
    extended.approved_permissions.filter(p=>p.resource!==ctrlResource||
      p.operation!=="update_file")};
  assert.throws(()=>new SourceDerivedRouteOfflineAdkModel({
    context:reduced,calls:scripts
  }),/NO-GO/);
});
