/**
 * Real ADK agent + A2A handler: a specialist reads the edited file and its
 * context (several signed reads), then decides that the file needs no change.
 * The identical "update" is answered locally (no Gateway Prepare, no owner
 * stage), and the Task ends with an owner-fenced "no change needed" outcome
 * that the Orchestrator can take into account. Offline, no paid model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedEffectStagingTaskRegistry} from "../src/trusted-effect-staging-task-registry.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const RUNTIME="dispatch_"+"N".repeat(22),PLAN="no-change-routes",BRANCH="feature/s-search";
const EDIT="apps/backend/src/users/user.routes.ts",DEP="apps/backend/src/users/user.controller.ts";
const CHILD="urn:no-change:backend",PRESENTER="did:thesis:backend-agent";
const SHA="c".repeat(40);
const SOURCE:Record<string,string>={[EDIT]:"router.get(\"/\", controller.listUsers);\n",
 [DEP]:"export function listUsers(request) { /* reads request.query */ }\n"};
const context=():AgentTaskContext=>({
 task_id:"a2a-no-change",context_id:"ctx",role:"backend",trusted_gateway_task_id:RUNTIME,
 subtask:{subtask_id:PLAN,branch:BRANCH,instruction:"Expose search and department filters on GET /api/users",
  relevant_paths:[DEP,EDIT],
  approved_file_permissions:[{path:DEP,operation:"read_file"},{path:EDIT,operation:"read_file"},
   {path:EDIT,operation:"update_file"}],
  approved_run_tests:false},
 delegation_evidence:{credential:"PRIVATE_CHILD",credential_id:CHILD,presenter_id:PRESENTER}
});
class ScriptedNoChange extends BaseLlm {
 readonly requests:LlmRequest[]=[];
 constructor(){super({model:"scripted-no-change-no-api"});}
 override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  const call=(id:string,name:string,args:Record<string,unknown>)=>
   ({content:{role:"model",parts:[{functionCall:{id,name,args}}]}});
  const n=this.requests.length;
  if(n===1)yield call("r1","read_file",{branch:BRANCH,path:DEP});
  else if(n===2)yield call("r2","read_file",{branch:BRANCH,path:EDIT});
  // The model "rewrites" the file with exactly the same content.
  else if(n===3)yield call("u1","update_file",{branch:BRANCH,path:EDIT,content:SOURCE[EDIT]});
  else yield {content:{role:"model",parts:[{text:"No change needed: the route already uses the controller."}]}};
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{return Promise.reject(Error("offline"));}
}

test("several signed reads + an identical update end as an owner-fenced 'no change needed'",async()=>{
 const owner:string[]=[],gateway:string[]=[];
 let next=0;
 const registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask({runtimeTaskId:RUNTIME,planTaskId:PLAN,role:"backend",branch:BRANCH,
  operation:"read_then_update",path:EDIT,childCredentialId:CHILD,presenterId:PRESENTER,
  effectStager:{stagedTool:"read_then_update",plannedReads:2,
   async stage(id:string){owner.push("stage:"+id);},
   async attest(id:string,tool:"read_file"|"update_file"){owner.push("attest:"+tool+":"+id);},
   async reportNoChange(id:string){owner.push("no_change:"+id);}}});
 const model=new ScriptedNoChange();
 const handler=createAdkA2ATaskHandler({model,gatewayBaseUrl:"http://gateway.invalid",
  adapterToken:"ADAPTER_SECRET",adapterBaseUrl:"http://signer.invalid",maxModelTurns:6,
  scopeModelPaths:true,trustedEffectTaskRegistry:registry,
  fetchFn:(async(url:unknown,options?:RequestInit)=>{
   const u=String(url),body=JSON.parse(String(options?.body));
   if(u.endsWith("/v1/authorization/prepare")){
    gateway.push("prepare:"+body.tool+":"+body.arguments.path);
    return Response.json({request_id:"req-"+(++next),audience:"gateway",challenge:"ch",
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{resource:"signed",operation:body.tool}},{status:201});
   }
   if(u.endsWith("/v1/presentations"))return Response.json({signed_vp:"VP"});
   if(u.endsWith("/v1/authorization/execute")){
    const path=next===1?DEP:EDIT;
    gateway.push("execute:"+body.request_id);
    return Response.json({request_id:body.request_id,decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"read_file",branch:BRANCH,path,
      revision:SHA,content:SOURCE[path]}});
   }
   throw Error("unexpected offline call "+u);
  }) as typeof fetch});
 await assert.rejects(handler(context()),/ended after read without producing an update/u);
 // Only the two signed reads reached the Gateway; the identical update did not.
 assert.deepEqual(gateway,["prepare:read_file:"+DEP,"execute:req-1",
  "prepare:read_file:"+EDIT,"execute:req-2"]);
 // Owner: two staged + attested reads, then the fenced no-change report.
 assert.deepEqual(owner,["stage:req-1","attest:read_file:req-1",
  "stage:req-2","attest:read_file:req-2","no_change:req-2"]);
 // The model was told why its update was not performed.
 assert.match(JSON.stringify(model.requests.at(-1)),/no change is needed/u);
});

class ScriptedReadsOnly extends BaseLlm {
 readonly requests:LlmRequest[]=[];
 readonly paths:string[];
 constructor(paths:string[]){super({model:"scripted-reads-only-no-api"});this.paths=paths;}
 override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  const path=this.paths[this.requests.length-1];
  if(path)yield {content:{role:"model",parts:[{functionCall:{id:"r"+this.requests.length,
   name:"read_file",args:{branch:BRANCH,path}}}]}};
  else yield {content:{role:"model",parts:[{text:"No change needed: the test already checks the intended behaviour; the controller ignores the department filter."}]}};
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{return Promise.reject(Error("offline"));}
}

test("Test agent: signed reads and no write end as an owner-fenced 'no change needed' (session s-7f5fb36e688c)",async()=>{
 const TEST="tests/backend/user.routes.test.ts",SRC="apps/backend/src/users/user.controller.ts";
 const files:Record<string,string>={[SRC]:"export function listUsers(){}\n",
  [TEST]:"it('filters by department',()=>{});\n"};
 const owner:string[]=[];
 let next=0;
 const registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask({runtimeTaskId:RUNTIME,planTaskId:PLAN,role:"test",branch:BRANCH,
  operation:"read_then_update",path:TEST,childCredentialId:CHILD,presenterId:"did:thesis:test-agent",
  effectStager:{stagedTool:"read_then_update",plannedReads:2,
   async stage(id:string){owner.push("stage:"+id);},
   async attest(id:string,tool:"read_file"|"update_file"){owner.push("attest:"+tool+":"+id);},
   async reportNoChange(id:string){owner.push("no_change:"+id);}}});
 const model=new ScriptedReadsOnly([SRC,TEST]);
 const handler=createAdkA2ATaskHandler({model,gatewayBaseUrl:"http://gateway.invalid",
  adapterToken:"ADAPTER_SECRET",adapterBaseUrl:"http://signer.invalid",maxModelTurns:6,
  scopeModelPaths:true,trustedEffectTaskRegistry:registry,
  fetchFn:(async(url:unknown,options?:RequestInit)=>{
   const u=String(url),body=JSON.parse(String(options?.body));
   if(u.endsWith("/v1/authorization/prepare"))
    return Response.json({request_id:"req-"+(++next),audience:"gateway",challenge:"ch",
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{resource:"signed",operation:body.tool}},{status:201});
   if(u.endsWith("/v1/presentations"))return Response.json({signed_vp:"VP"});
   if(u.endsWith("/v1/authorization/execute")){
    const path=next===1?SRC:TEST;
    return Response.json({request_id:body.request_id,decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"read_file",branch:BRANCH,path,
      revision:SHA,content:files[path]}});
   }
   throw Error("unexpected offline call "+u);
  }) as typeof fetch});
 await assert.rejects(handler({...context(),role:"test",
  subtask:{...context().subtask,instruction:"Repair the failing route test",relevant_paths:[SRC,TEST],
   approved_file_permissions:[{path:SRC,operation:"read_file"},{path:TEST,operation:"read_file"},
    {path:TEST,operation:"update_file"}]},
  delegation_evidence:{credential:"PRIVATE_CHILD",credential_id:CHILD,presenter_id:"did:thesis:test-agent"}}),
  /ended after read without producing an update/u);
 assert.deepEqual(owner,["stage:req-1","attest:read_file:req-1",
  "stage:req-2","attest:read_file:req-2","no_change:req-2"]);
});
