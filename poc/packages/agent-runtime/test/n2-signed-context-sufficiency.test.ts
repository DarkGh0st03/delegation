import test from "node:test";
import assert from "node:assert/strict";
import {
 BaseLlm,InMemorySessionService,Runner,
 type LlmRequest,type LlmResponse,type BaseLlmConnection
} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";

const branch="feature/account-suspension";
const importer="apps/backend/src/users/user.service.ts";
const exporter="packages/shared/src/account-status.ts";
const forbidden="packages/private/src/secret.ts";
const importerGrants=[
 {path:importer,operation:"read_file" as const},
 {path:importer,operation:"update_file" as const}
];

class OneReadModel extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 readonly path:string;
 constructor(path:string){super({model:"n2-offline-adk-read"});this.path=path;}
 override async *generateContentAsync(request:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(request);
  if(this.requests.length===1)
   yield {content:{role:"model",parts:[{functionCall:{
    id:"n2-read",name:"read_file",args:{branch,path:this.path}
   }}]}};
  else yield {content:{role:"model",parts:[{text:
   "If the exporter source is not readable, report insufficient context; no edit."
  }]}};
 }
 override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("N2 has no provider connection"));
 }
}
async function run(grants:Array<{path:string;operation:"read_file"|"update_file"}>,
 requestPath:string){
 const model=new OneReadModel(requestPath);
 const effects:Array<{name:string;path:unknown}>=[];
 const built=createAdkSpecializedAgent({
  role:"backend",model,trustedBranch:branch,
  trustedTaskPaths:[importer,exporter],
  trustedFilePermissions:grants,
  gatewayClient:{invoke:async(name:string,args:{path?:unknown})=>{
   effects.push({name,path:args.path});
   return {provider:"gitea",content:"export const ACCOUNT_STATUS = {ACTIVE:'ACTIVE',SUSPENDED:'SUSPENDED'}"};
  }} as never
 });
 const services=new InMemorySessionService(),appName="n2_signed_context",userId="owner",sessionId="fresh-backend-d1";
 await services.createSession({appName,userId,sessionId});
 const runner=new Runner({agent:built.agent,appName,sessionService:services});
 try{
  for await(const _event of runner.runAsync({
   userId,sessionId,newMessage:{role:"user",parts:[{text:JSON.stringify({
    task_id:"new-backend-d1",subtask:{instruction:"Inspect only signed context",branch}
   })}]}
  })){}
 }catch(error){
  // ADK versions may terminate a rejected, out-of-schema tool call.
  // In both versions, a denied read MUST cause zero Gateway effects.
  if(effects.length||grants.some(g=>g.path===requestPath&&g.operation==="read_file"))
   throw error;
 }
 const declarations=(model.requests[0]?.config?.tools??[])
  .flatMap(x=>x.functionDeclarations??[]);
 return {model,effects,read:JSON.stringify(declarations.find(x=>x.name==="read_file")),
  write:JSON.stringify(declarations.find(x=>x.name==="update_file")),
  system:built.profile.system_prompt};
}

test("N2 signed Backend D1 sees only importer read/update without exporter authority",async()=>{
 const got=await run(importerGrants,exporter);
 assert.equal(got.effects.length,0);
 assert.ok(got.read.includes(importer));
 assert.ok(got.write.includes(importer));
 assert.ok(!got.read.includes(exporter));
 assert.ok(!got.write.includes(exporter));
 assert.ok(got.system.includes("Do not guess a type, imported symbol"));
 assert.ok(got.system.includes("report the limitation"));
});

test("N2 independently signed read-only exporter context can be consulted but never edited",async()=>{
 const got=await run([...importerGrants,{path:exporter,operation:"read_file"}],exporter);
 assert.deepEqual(got.effects,[{name:"read_file",path:exporter}]);
 assert.ok(got.read.includes(exporter));
 assert.ok(!got.write.includes(exporter));
 assert.ok(got.write.includes(importer));
});

test("N2 exporter update_file alone never implies a read_file capability",async()=>{
 const got=await run([...importerGrants,{path:exporter,operation:"update_file"}],exporter);
 assert.equal(got.effects.length,0);
 assert.ok(!got.read.includes(exporter));
 assert.ok(got.write.includes(exporter));
});

test("N2 a foreign or unsanctioned path cannot be read through the signed ADK wrapper",async()=>{
 const got=await run(importerGrants,forbidden);
 assert.equal(got.effects.length,0);
 assert.ok(!got.read.includes(forbidden));
 assert.ok(!got.system.includes(forbidden));
});
