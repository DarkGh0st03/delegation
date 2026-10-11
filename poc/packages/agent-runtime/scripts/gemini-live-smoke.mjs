import assert from "node:assert/strict";
import {BaseLlm, Gemini, FunctionTool, InMemorySessionService, LlmAgent, Runner} from "@google/adk";
import {z} from "zod";

// Real Gemini API, but no Gitea, Gateway, Adapter, credentials or filesystem tools.
const apiKey=process.env.GEMINI_API_KEY;
if(!apiKey?.trim())throw new Error("GEMINI_API_KEY GitHub secret is missing");
const modelName=process.env.GEMINI_MODEL??"gemini-3.8-flash";
if(!/^gemini-[a-z0-9.-]+$/u.test(modelName))throw new Error("Invalid Gemini model");
const branch="feature/account-suspension";
const path="apps/backend/src/users/user.service.ts";
let reads=0,turns=0,errorOccurred=false;
const failureCategories=new Set();
const safeErrorCodes=new Set();
function safeCategory(value){
  const v=String(value??"").toLowerCase();
  if(/429|quota|rate.limit|resource.exhausted/.test(v))return "quota_or_rate_limit";
  if(/401|api.key.invalid|unauthenticated|authentication/.test(v))return "invalid_api_key";
  if(/403|permission.denied|not authorized/.test(v))return "access_denied";
  if(/404|not.found|not available|unsupported model/.test(v))return "model_unavailable";
  if(/400|invalid.argument|invalid_request|function|schema/.test(v))return "invalid_request_or_tool_schema";
  if(/500|503|unavailable|internal/.test(v))return "provider_unavailable";
  return "unclassified_provider_error";
}
const tool=new FunctionTool({
  name:"read_file",
  description:"Read one harmless synthetic TypeScript fixture stored in memory.",
  parameters:z.object({branch:z.literal(branch),path:z.literal(path)}).strict(),
  execute:async args=>{
    reads++;
    assert.equal(reads,1,"Repeated tool invocation is forbidden");
    assert.equal(args.branch,branch);
    assert.equal(args.path,path);
    return {ok:true,result:{source:"synthetic_fixture",
      content:"export const accountStatus = 'ACTIVE'; // demonstration only"}};
  }
});
class BoundedGemini extends BaseLlm{
  constructor(delegate){super({model:delegate.model});this.delegate=delegate;this.exceeded=false;}
  async *generateContentAsync(request,stream,signal){
    turns++;
    if(turns>3){this.exceeded=true;throw new Error("Gemini turn budget exhausted");}
    yield* this.delegate.generateContentAsync(request,stream,signal);
  }
  async connect(){throw new Error("Live streaming disabled");}
}
const model=new BoundedGemini(new Gemini({model:modelName,apiKey,vertexai:false}));
const agent=new LlmAgent({
  name:"thesis_gemini_readonly_smoke",
  description:"Safe external Gemini ADK tool-calling test.",
  model,
  instruction:"Call read_file exactly once, with branch=feature/account-suspension "+
    "and path=apps/backend/src/users/user.service.ts. When done reply READY.",
  tools:[tool],
  disallowTransferToParent:true,disallowTransferToPeers:true,
  generateContentConfig:{maxOutputTokens:1024,temperature:0}
});
const appName="thesis_gemini_smoke",userId="test_user",sessionId="isolated";
const sessions=new InMemorySessionService();
await sessions.createSession({appName,userId,sessionId});
const runner=new Runner({appName,agent,sessionService:sessions});
for await(const event of runner.runAsync({
  userId,sessionId,newMessage:{role:"user",parts:[{
    text:"Use the only available controlled read_file tool once to inspect the synthetic fixture."
  }]}
})){
  if(event.errorCode||event.errorMessage){
    errorOccurred=true;
    const v=String(event.errorCode??"")+" "+String(event.errorMessage??"");
    failureCategories.add(safeCategory(v));
    const code=String(event.errorCode??"");
    if(/^[A-Z0-9_]{1,48}$/u.test(code))safeErrorCodes.add(code);
  }
}
if(errorOccurred||model.exceeded||reads!==1){
  console.error(JSON.stringify({result:"gemini-smoke-failed",turns,reads,
    categories:[...failureCategories],codes:[...safeErrorCodes],
    reason:errorOccurred?"provider_or_model_error":"tool_contract_not_met"}));
  process.exitCode=1;
}else{
  console.log(JSON.stringify({result:"gemini-adk-live-readonly-pass",
    model:modelName,provider_turns:turns,controlled_fixture_reads:reads,
    actual_repository_access:false}));
}
