import assert from "node:assert/strict";
import { BaseLlm, FunctionTool, InMemorySessionService, LlmAgent, Runner } from "@google/adk";
import { z } from "zod";
import { OpenAIAdkModel } from "../src/index.ts";

// Optional live-provider interoperability probe. It never receives a DC, VP,
// Gitea token, repository write tool, Gateway URL or sensitive project content.
const modelName = process.env.OPENAI_MODEL;
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey?.trim()) {
  throw new Error("OPENAI_API_KEY is required to run the manual live smoke");
}
if (!modelName?.trim()) {
  throw new Error("OPENAI_MODEL must explicitly name an enabled API model");
}
const branch = "feature/account-suspension";
const path = "apps/backend/src/users/user.service.ts";
let calls = 0;
const readOnly = new FunctionTool({
  name:"read_file",
  description:"Read the fixed, harmless in-memory fixture. No repository is connected.",
  parameters:z.object({branch:z.literal(branch),path:z.literal(path)}).strict(),
  execute:async args=>{
    calls++;
    assert.equal(calls,1,"An autonomous duplicate read is not acceptable");
    assert.equal(args.branch,branch);
    assert.equal(args.path,path);
    return {ok:true,result:{provider:"in_memory_fixture",
      content:"export const accountStatus = 'ACTIVE'; // non-sensitive demo fixture"
    }};
  }
});

class Budgeted extends BaseLlm {
  constructor(model) {
    super({model:model.model});
    this.source=model;
    this.turns=0;
    this.exceeded=false;
  }
  async *generateContentAsync(request,stream,signal){
    this.turns++;
    if (this.turns>3) {
      this.exceeded=true;
      throw new Error("Live model smoke exceeded its three-turn budget");
    }
    yield* this.source.generateContentAsync(request,stream,signal);
  }
  async connect(){throw new Error("Live ADK streaming is not permitted");}
}
const model = new Budgeted(new OpenAIAdkModel({
  apiKey,model:modelName,maxOutputTokens:1536,
  allowedToolNames:["read_file"]
}));
const agent = new LlmAgent({
  name:"account_suspension_live_openai_probe",
  model,
  description:"Safe real-provider interoperability probe without repository access.",
  instruction:
    "Perform exactly one read_file call with branch=feature/account-suspension " +
    "and path=apps/backend/src/users/user.service.ts. " +
    "Do not call any other tool. After seeing the response, reply READY.",
  tools:[readOnly],
  disallowTransferToParent:true,
  disallowTransferToPeers:true
});
const appName="thesis_adk_openai_live_probe";
const userId="live_probe";
const sessionId="one_invocation";
const sessionService=new InMemorySessionService();
const runner=new Runner({agent,appName,sessionService});
await sessionService.createSession({appName,userId,sessionId});
let failures=0;
for await(const event of runner.runAsync({
  userId,sessionId,newMessage:{role:"user",parts:[{
    text:"Read the fixed fixture with the controlled read_file tool exactly once."
  }]}
})){
  if(event.errorCode||event.errorMessage)failures++;
}
assert.equal(failures,0,"ADK reported a provider/model error");
assert.equal(model.exceeded,false,"Model exceeded budget");
assert.equal(calls,1,"Provider failed to invoke the single allowed read_file tool");
process.stdout.write(JSON.stringify({
  result:"openai-adk-live-readonly-pass",
  model_configured:modelName,
  provider_turns:model.turns,
  controlled_fixture_reads:calls,
  real_repository_access:false
})+"\n");
