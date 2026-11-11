import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BaseLlm,Runner,InMemorySessionService,
 type LlmRequest,type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {retainFailureEvidence} from "../../../apps/test-runner-controller/src/failure-evidence.ts";
import {loadTrustedRunnerTypecheckContext,
 projectTrustedRunnerTypecheckForTask} from "../src/trusted-runner-typecheck-context.ts";
import {approvedTaskInstruction} from "../src/approved-task-instruction.ts";
import {createAdkSpecializedAgent} from "../../agent-runtime/src/adk-specialized-agents.ts";

const repo={authority:"gitea.local",owner:"demo",repository:"app"};
const repository="gitea://gitea.local/demo/app";
const branch="feature/fix",sha="a".repeat(40);
const path="apps/backend/src/users/user.service.ts";
const resource=repository+"/branches/feature%2Ffix/files/"+path;
const original='import { ACCOUNT_STATU } from "@iam/shared";\nexport const current=ACCOUNT_STATU.ACTIVE;\n';
const correct="'@iam/shared' has no exported member named 'ACCOUNT_STATU'. Did you mean 'ACCOUNT_STATUS'?";
const unrelated="'@iam/shared' has no exported member named 'ANOTHER_SYMBOL'. Did you mean 'ACCOUNT_STATUS'?";

async function verifiedInstruction(t:import("node:test").TestContext,
 message:string,readable=true){
 const directory=await mkdtemp(join(tmpdir(),"n3-diagnostic-"));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const archivePath=join(directory,"source.tar.gz");
 await writeFile(archivePath,"fixture");
 const phases=[{phase:"dependency_install" as const,status:"pass" as const},
  {phase:"typecheck" as const,status:"fail" as const}];
 const logReference="runner-log://11111111-1111-4111-8111-111111111111";
 await retainFailureEvidence({
  directory,archivePath,logReference,
  log:"=== dependency_install ===\nPRIVATE_ORIGINAL_LOG\n"+
   "=== typecheck ===\n> @iam/backend@1.0.0 typecheck\n"+
   "src/users/user.service.ts(1,10): error TS2724: "+message+"\nPRIVATE_STACK\n",
  request:{request_id:"n3",repository,branch,commit_sha:sha,profile:"poc-default"},
  phases
 });
 const effect={provider:"runner",performed:true,tool:"run_tests",
  branch,revision:sha,tested_commit_sha:sha,status:"fail",
  phases,log_reference:logReference,
  typecheck_diagnostics:[{path,line:1,column:10,code:"TS2724"}]};
 const context=await loadTrustedRunnerTypecheckContext({
  directory,effect,repo,branch,
  approvedRows:[{agent_id:"backend",task_id:"original",
   resource,operation:"read_file"}],
  rootPermissions:[{resource,operation:"read_file"}],roles:["backend"]
 });
 assert.ok(context);
 const scoped=projectTrustedRunnerTypecheckForTask(context,sha,branch,
  "backend",readable?[{resource,operation:"read_file"}]:[]);
 return approvedTaskInstruction("Preserve Account Suspension behavior",
  "Repair the compiler error without inventing dependencies",{
   repairEditor:true,...(scoped?{typecheckContext:scoped}:{})
  });
}
class DiagnosticSensitiveEditor extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 private bad:string|null=null;
 private good:string|null=null;
 constructor(){super({model:"n3-scripted-evidence-sensitive-no-network"});}
 override async *generateContentAsync(req:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  const reply=(part:Record<string,unknown>)=>({
   content:{role:"model" as const,parts:[part]}
  });
  if(this.requests.length===1){
   const txt=req.contents?.at(-1)?.parts?.find(p=>typeof p.text==="string")?.text;
   const task=JSON.parse(txt??"{}");
   const instruction=JSON.parse(task.subtask?.instruction?.split("\n")[1]??"{}");
   const diag=instruction.diagnostic_typecheck?.diagnostics?.[0];
   const match=diag?.message?.match(
    /has no exported member named '([A-Za-z_]+)'\. Did you mean '([A-Za-z_]+)'\?/u);
   if(diag?.code==="TS2724"&&diag.resource===resource&&
      instruction.diagnostic_typecheck?.tested_commit_sha===sha&&
      task.task_id==="fresh-backend-d1"&&match&&match[1]!==match[2]){
    this.bad=match[1];this.good=match[2];
   }
   yield reply({functionCall:{id:"n3-read",name:"read_file",args:{branch,path}}});
   return;
  }
  if(this.requests.length===2){
   const response=req.contents?.flatMap(c=>c.parts??[]).filter(
    p=>p.functionResponse?.name==="read_file").at(-1)?.functionResponse?.response as any;
   const envelope=response?.structuredContent??response?.result?.structuredContent??response;
   const data=envelope?.result;
   if(this.bad&&this.good&&envelope?.ok===true&&
      data?.provider==="gitea"&&data?.performed===true&&
      data?.tool==="read_file"&&data?.branch===branch&&
      data?.path===path&&data?.revision===sha&&
      typeof data?.content==="string"&&
      new RegExp("\\b"+this.bad+"\\b","u").test(data.content)){
     const corrected=data.content.replace(
      new RegExp("\\b"+this.bad+"\\b","gu"),this.good);
     yield reply({functionCall:{id:"n3-edit",name:"update_file",
      args:{branch,path,content:corrected}}});
     return;
   }
   yield reply({text:"Unverified diagnostic or source mismatch; no edit."});
   return;
  }
  yield reply({text:"Tool call observed; no claim of Docker PASS."});
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("N3 forbids all model provider connections"));
 }
}
async function run(t:import("node:test").TestContext,message:string,
 readable=true){
 const instruction=await verifiedInstruction(t,message,readable);
 const model=new DiagnosticSensitiveEditor(),calls:Array<{name:string;args:any}>=[];
 const built=createAdkSpecializedAgent({role:"backend",model,trustedBranch:branch,
  trustedTaskPaths:[path],
  trustedFilePermissions:[{path,operation:"read_file"},{path,operation:"update_file"}],
  gatewayClient:{invoke:async(name:string,args:Record<string,unknown>)=>{
   calls.push({name,args});
   if(name==="read_file")return {
    provider:"gitea",performed:true,tool:"read_file",
    branch,path,revision:sha,content:original
   };
   if(name==="update_file")return {
    provider:"gitea",performed:true,tool:"update_file",
    branch,path,commit_sha:"b".repeat(40)
   };
   throw Error("No other tool allowed");
  }} as never});
 const sessions=new InMemorySessionService();
 const appName="n3_diagnostic_sensitive",userId="owner",sessionId="fresh-backend-d1";
 await sessions.createSession({appName,userId,sessionId});
 const runner=new Runner({agent:built.agent,appName,sessionService:sessions});
 for await(const event of runner.runAsync({userId,sessionId,
  newMessage:{role:"user",parts:[{text:JSON.stringify({
   task_id:"fresh-backend-d1",subtask:{instruction,branch}
  })}]}
 }))assert.equal(event.errorMessage,undefined);
 return {model,calls,instruction};
}
test("N3 compiler message changes scripted editor behavior at actual Backend ADK boundary",async t=>{
 const valid=await run(t,correct);
 assert.deepEqual(valid.calls.map(c=>c.name),["read_file","update_file"]);
 const edit=valid.calls[1]!.args.content;
 assert.equal(edit,
  'import { ACCOUNT_STATUS } from "@iam/shared";\nexport const current=ACCOUNT_STATUS.ACTIVE;\n');
 assert.equal(valid.model.requests.length,3);
 assert.match(valid.instruction,/diagnostic_typecheck/u);
 assert.doesNotMatch(JSON.stringify(valid.model.requests),/PRIVATE_ORIGINAL_LOG|PRIVATE_STACK/u);
 const wrong=await run(t,unrelated);
 assert.deepEqual(wrong.calls.map(c=>c.name),["read_file"]);
 assert.equal(wrong.model.requests.length,2);
 assert.notDeepEqual(valid.calls,wrong.calls);
});
test("N3 no signed diagnostic read grant yields no source edit",async t=>{
 const missing=await run(t,correct,false);
 assert.deepEqual(missing.calls.map(c=>c.name),["read_file"]);
 assert.doesNotMatch(missing.instruction,/diagnostic_typecheck/u);
});
