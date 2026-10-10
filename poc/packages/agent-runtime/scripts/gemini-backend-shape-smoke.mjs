import { BaseLlm, InMemorySessionService, Runner } from "@google/adk";
import { createAdkSpecializedAgent } from "../src/adk-specialized-agents.ts";
import { ControlledToolError } from "../src/controlled-errors.ts";
import { SPECIALIZED_AGENT_PROFILES } from "../src/specialized-agents.ts";
import { inspectAdkFailure } from "../src/adk-failure-categories.ts";
import { safeAdkRequestShape } from "../src/adk-request-shape.ts";
import { createGeminiAdkModel } from "../src/gemini-adk-model.ts";
import { pathToFileURL } from "node:url";

const BRANCH="feature/account-suspension";
const READ_PATH="apps/backend/src/users/user.service.ts";
const GENERATION={maxOutputTokens:1024,temperature:0};
const TARGETS=[
  "packages/shared/src/account-status.ts",
  READ_PATH,
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts"
];

/**
 * Exactly one upstream model request. After the first response the follow-up
 * is generated in memory. No automatic API retries, paid provider fallback,
 * Gateway, Adapter, Gitea, filesystem tools, or external repository access.
 */
class OneProviderTurn extends BaseLlm {
  constructor(delegate,{timeoutMs=60000,onRequestShape=()=>{}}={}){
    super({model:delegate.model});
    this.delegate=delegate;
    this.timeoutMs=timeoutMs;
    this.onRequestShape=onRequestShape;
    this.providerTurns=0;
    this.totalTurns=0;
    this.diagnostic=null;
  }
  async *generateContentAsync(request,stream,signal){
    this.totalTurns++;
    if(this.totalTurns>2)throw new Error("Synthetic ADK follow-up budget exhausted");
    if(this.totalTurns===2){
      yield {modelVersion:this.model,content:{
        role:"model",parts:[{text:"Synthetic probe terminated after one real model response."}]
      }};
      return;
    }
    this.providerTurns++;
    this.onRequestShape(safeAdkRequestShape(request));
    const timeout=AbortSignal.timeout(this.timeoutMs);
    const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    try{
      yield* this.delegate.generateContentAsync(request,stream,combined);
    }catch(error){
      const diagnostic=inspectAdkFailure(error);
      this.diagnostic=timeout.aborted
        ? {...diagnostic,category:"api_inference_timeout",
            http_status:null,classification_source:"runtime_timeout"}
        : diagnostic;
      throw new Error("Synthetic Gemini Backend shape provider failure");
    }
  }
  async connect(){throw new Error("Live streaming disabled");}
}

/** In-memory fixture ONLY. This never performs an HTTP request or file write. */
export async function runBackendShapeSmoke({
  model,timeoutMs=60000,onRequestShape=()=>{}
}={}){
  if(!model)throw new Error("A configured model is required");
  const boundary={
    successfulReads:0,
    attemptedWrites:0,
    allowedPaths:new Set([
      ...SPECIALIZED_AGENT_PROFILES.backend.writable_paths,
      ...SPECIALIZED_AGENT_PROFILES.backend.read_only_paths
    ]),
    async invoke(name,args){
      if(name==="update_file"){
        this.attemptedWrites++;
        throw new ControlledToolError("authorization_denied",
          "Synthetic Backend probe forbids every write");
      }
      if(name!=="read_file"||args?.branch!==BRANCH||
         !this.allowedPaths.has(args?.path)||
         this.successfulReads>=1){
        throw new ControlledToolError("authorization_denied",
          "Synthetic read is outside the single allowed fixture access");
      }
      this.successfulReads++;
      return {source:"synthetic_fixture",provider:"in_memory",
        content:"export const accountStatus = 'ACTIVE'; // synthetic only"};
    }
  };
  const bounded=new OneProviderTurn(model,{timeoutMs,onRequestShape});
  const outcomes=[];
  const {agent}=createAdkSpecializedAgent({
    role:"backend",
    model:bounded,
    gatewayClient:boundary,
    generateContentConfig:GENERATION,
    onToolOutcome:event=>outcomes.push({name:event.name,ok:event.payload.ok})
  });
  const appName="backend_shape_isolated",userId="synthetic",sessionId="one-shot";
  const service=new InMemorySessionService();
  await service.createSession({appName,userId,sessionId});
  const runner=new Runner({appName,agent,sessionService:service});
  let eventError=false;
  try {
    for await(const event of runner.runAsync({
      userId,sessionId,newMessage:{role:"user",parts:[{
        text:JSON.stringify({task:{
          task_id:"account-suspension-backend",role:"backend",
          subtask:{
            subtask_id:"account-suspension-backend",
            instruction:"Implement the backend Account Suspension lifecycle and shared status contract.",
            branch:BRANCH,relevant_paths:TARGETS
          }
        }})
      }]}
    })){
      if(event.errorCode||event.errorMessage)eventError=true;
    }
  }catch{
    return {result:"gemini-backend-shape-failed",
      reason:"provider_or_sdk_failure",
      diagnostic:bounded.diagnostic??{
        category:"sdk_model_exception",http_status:null,
        classification_source:"fallback",error_type:"other"
      },
      provider_turns:bounded.providerTurns,
      model_turns:bounded.totalTurns,
      synthetic_reads:boundary.successfulReads,
      rejected_writes:boundary.attemptedWrites,
      actual_repository_access:false};
  }
  // ADK may consume a provider exception and terminate the Runner normally.
  // Always preserve the sanitized status rather than misclassifying as no-tool.
  if(bounded.diagnostic||eventError){
    return {result:"gemini-backend-shape-failed",
      reason:"provider_or_sdk_failure",
      diagnostic:bounded.diagnostic??{
        category:"adk_event_error",http_status:null,
        classification_source:"fallback",error_type:"other"
      },
      provider_turns:bounded.providerTurns,
      model_turns:bounded.totalTurns,
      synthetic_reads:boundary.successfulReads,
      rejected_writes:boundary.attemptedWrites,
      actual_repository_access:false};
  }
  const pass=!eventError&&bounded.providerTurns===1&&
    boundary.successfulReads===1&&boundary.attemptedWrites===0&&
    outcomes.length===1&&outcomes[0].name==="read_file"&&outcomes[0].ok;
  return {result:pass?"gemini-backend-shape-pass":"gemini-backend-shape-incomplete",
    reason:pass?null:"first_response_tool_contract_not_met",
    provider_turns:bounded.providerTurns,
    model_turns:bounded.totalTurns,
    synthetic_reads:boundary.successfulReads,
    rejected_writes:boundary.attemptedWrites,
    actual_repository_access:false};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const apiKey=process.env.GEMINI_API_KEY;
  if(!apiKey?.trim())throw new Error("Missing Gemini API key for manual Backend probe");
  const modelName=process.env.GEMINI_MODEL??"gemini-3.8-flash";
  const model=createGeminiAdkModel({apiKey,model:modelName});
  const output=await runBackendShapeSmoke({
    model,
    onRequestShape:shape=>process.stdout.write(JSON.stringify({
      event:"gemini_backend_shape",...shape
    })+"\n")
  });
  process.stdout.write(JSON.stringify(output)+"\n");
  if(output.result!=="gemini-backend-shape-pass")process.exitCode=1;
}
