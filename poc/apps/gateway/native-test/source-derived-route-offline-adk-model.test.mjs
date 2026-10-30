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

test("Account Suspension source-derived Backend model handles approved status union as third edit",async()=>{
  const statusPath="packages/shared/src/account-status.ts";
  const statusUri="gitea://gitea.local/thesis/iam/branches/"+
    encodeURIComponent(branch)+"/files/"+statusPath;
  const approved={...context,tasks:[{id:"backend",description:description+"\n"+
    "STATUS TYPE AccountStatus CONST ACCOUNT_STATUS ADD SUSPENDED"}],
    approved_permissions:[...context.approved_permissions,
      {task_id:"backend",operation:"read_file",resource:statusUri},
      {task_id:"backend",operation:"update_file",resource:statusUri}]
  };
  const statusSource='export type AccountStatus = "ACTIVE";\n\n'+
    'export const ACCOUNT_STATUS = {\n  ACTIVE: "ACTIVE"\n} as const satisfies Record<string, AccountStatus>;\n';
  const calls=[{name:"read_file",args:{branch,path:statusPath}},
    {name:"update_file",args:{branch,path:statusPath}},...script];
  const m=new SourceDerivedRouteOfflineAdkModel({context:approved,calls});
  assert.equal((await next(m,{})).functionCall.name,"read_file");
  const updated=(await next(m,input({ok:true,result:{
    ...data,path:statusPath,content:statusSource
  }}))).functionCall;
  assert.equal(updated.name,"update_file");
  assert.ok(updated.args.content.includes('"ACTIVE" | "SUSPENDED"'));
  assert.ok(updated.args.content.includes('  SUSPENDED: "SUSPENDED"'));
  assert.equal(m.derivedStatusProof.path,statusPath);
  assert.equal((await next(m,{})).functionCall.name,"read_file");
  await next(m,input({ok:true,result:data}));
  assert.equal(m.derivedFileCount,2);
});

test("R150.8 one-use D1 repair requires actual failed SHA read and real Gateway write",async()=>{
 const m=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
 await next(m,{});
 await next(m,input({ok:true,result:data}));
 await next(m,{});
 const repairPath="apps/backend/src/users/user.service.ts";
 const failedSha="b".repeat(40),repairedSha="c".repeat(40);
 const args={branch,path:repairPath,failedSha,taskId:"r150-owner-backend-repair"};
 m.armTrustedD1TypecheckRepair(args);
 const read=(await next(m,{})).functionCall;
 assert.equal(read.name,"read_file");
 assert.deepEqual(read.args,{branch,path:repairPath});
 const injected='export const x=1;\n'+
   'const __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n';
 const write=(await next(m,input({ok:true,result:{
  ...data,path:repairPath,revision:failedSha,content:injected
 }}))).functionCall;
 assert.equal(write.name,"update_file");
 assert.deepEqual(write.args,{branch,path:repairPath,content:"export const x=1;\n"});
 const finish=await next(m,{contents:[{parts:[{functionResponse:{
  name:"update_file",response:{ok:true,result:{
   provider:"gitea",performed:true,tool:"update_file",
   branch,path:repairPath,commit_sha:repairedSha
  }}
 }}]}]});
 assert.match(finish.text,/confirmed through protected Gateway/);
 assert.throws(()=>m.armTrustedD1TypecheckRepair(args),/NO-GO/);
});

test("R150.8 refuses early, stale, forged or duplicated repair evidence",async()=>{
 const repairPath="apps/backend/src/users/user.service.ts";
 const failedSha="b".repeat(40);
 const args={branch,path:repairPath,failedSha,taskId:"r150-owner-backend-repair"};
 const early=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
 assert.throws(()=>early.armTrustedD1TypecheckRepair(args),/NO-GO/);
 const m=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
 await next(m,{});await next(m,input({ok:true,result:data}));await next(m,{});
 assert.throws(()=>m.armTrustedD1TypecheckRepair({...args,
  taskId:"unapproved-task"}),/NO-GO/);
 assert.throws(()=>m.armTrustedD1TypecheckRepair({...args,
  path:"apps/backend/../secrets.ts"}),/NO-GO/);
 m.armTrustedD1TypecheckRepair(args);
 await next(m,{});
 await assert.rejects(()=>next(m,input({ok:true,result:{
  ...data,path:repairPath,revision:"c".repeat(40),content:source
 }})),/NO-GO/);
 const write=new SourceDerivedRouteOfflineAdkModel({context,calls:script});
 await next(write,{});await next(write,input({ok:true,result:data}));await next(write,{});
 write.armTrustedD1TypecheckRepair(args);
 await next(write,{});
 await next(write,input({ok:true,result:{...data,path:repairPath,
  revision:failedSha,content:'const x=1;\n'+
   'const __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n'}}));
 await assert.rejects(()=>next(write,{contents:[{parts:[{functionResponse:{
  name:"update_file",response:{ok:true,result:{provider:"mock",
   performed:true,tool:"update_file",branch,path:repairPath,
   commit_sha:"c".repeat(40)}}
 }}]}]}),/NO-GO/);
});
