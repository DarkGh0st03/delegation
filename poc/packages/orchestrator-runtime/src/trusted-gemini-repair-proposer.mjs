/**
 * R151.0: untrusted Gemini/ADK model -> one bounded repair-DAG PROPOSAL.
 *
 * This adapter grants NO permissions and never writes/dispatches. The only
 * executor of its output is TrustedOperationalRepairPlanner, which checks
 * exact signed original-root grants, dependencies, Gitea HEAD and reserves
 * a new epoch; Gateway must separately admit it before any Child DC.
 *
 * Model input is a trusted, source-free Gateway failure/authorized-grant
 * snapshot. No raw prompt, model response or tokens may go into CI logs.
 */
const SHA=/^[a-f0-9]{40}$/u;
const MAX_PROMPT_BYTES=16000;
const MAX_RESULT_BYTES=48000;
const MAX_MODEL_MS=90000;
const fail=()=>{throw Error("R151 model repair proposal unavailable or invalid");};

function inspectInput(x){
 if(!x||typeof x!=="object"||Array.isArray(x)||typeof x.requirement!=="string"||
    x.requirement.length>8000||!x.requirement.trim()||
    !x.feedback||typeof x.feedback!=="object"||
    !SHA.test(x.feedback.tested_commit_sha??"")||
    !Number.isSafeInteger(x.feedback.remaining_repair_epochs)||
    x.feedback.remaining_repair_epochs<1||
    x.feedback.remaining_repair_epochs>2||
    typeof x.feedback.failed_phase!=="string"||
    !Array.isArray(x.feedback.typecheck_error_codes)||
    x.feedback.typecheck_error_codes.length>16||
    x.feedback.typecheck_error_codes.some(c=>
      typeof c!=="string"||!/^TS[0-9]{3,6}$/u.test(c))||
    typeof x.feedback.work_branch!=="string"||
    !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(x.feedback.work_branch)||
    x.feedback.work_branch.includes("..")||
    !Array.isArray(x.already_delegated_grants)||
    x.already_delegated_grants.length>64||
    x.already_delegated_grants.some(g=>
      !g||typeof g.resource!=="string"||g.resource.length>1024||
      !g.resource.startsWith("gitea://")||
      typeof g.operation!=="string"||g.operation.length>64)||
    !Array.isArray(x.agents)||x.agents.length>4||
    x.agents.some(a=>!["backend","frontend","test","orchestrator"].includes(a))||
    new Set(x.agents).size!==x.agents.length)
   fail();
 return {
  requirement:x.requirement,
  feedback:{
   failed_phase:x.feedback.failed_phase,
   typecheck_error_codes:[...x.feedback.typecheck_error_codes],
   tested_commit_sha:x.feedback.tested_commit_sha,
   work_branch:x.feedback.work_branch,
   remaining_repair_epochs:x.feedback.remaining_repair_epochs
  },
  already_delegated_grants:x.already_delegated_grants.map(g=>({
    resource:g.resource,operation:g.operation
  })),
  agents:[...x.agents]
 };
}
function strictDraft(text){
 if(typeof text!=="string"||!text.trim()||
    Buffer.byteLength(text,"utf8")>MAX_RESULT_BYTES)fail();
 let value;
 try{value=JSON.parse(text.trim());}catch{fail();}
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==1||!Array.isArray(value.tasks)||
    value.tasks.length<2||value.tasks.length>12)fail();
 // NO permission decisions here. Only the original-root planner can compile
 // these untrusted rows and reject anything outside the signed scope.
 return value;
}
export function createTrustedGeminiRepairProposer({
 model,maxCallMs=MAX_MODEL_MS,maxOutputTokens=8192
}={}){
 if(!model||typeof model.generateContentAsync!=="function"||
    typeof model.model!=="string"||
    !Number.isSafeInteger(maxCallMs)||maxCallMs<1000||
    maxCallMs>MAX_MODEL_MS||
    !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<512||
    maxOutputTokens>16000)fail();
 let used=false;
 return async function proposeRepairPlan(input){
  if(used)fail();used=true;
  const trusted=inspectInput(input);
  const guidance=[
   "You propose a new repair DAG AFTER a real Gateway-verified failed Test.",
   "Return ONLY a JSON object with exactly one key: tasks.",
   "Each task has exactly id, agent_id, title, description, depends_on, permissions.",
   "Each permission has exactly resource, operation, reason.",
   "Use ONLY resource/operation pairs from already_delegated_grants.",
   "Use ONLY listed agents and never ask for new identities or root credentials.",
   "Include at least one implementation write and exactly one downstream Test",
   "task with run_tests. Tests depend on every repair write.",
   "The repair branch already exists. Do not create another branch.",
   "Do not claim a test passed. Do not open a PR or invoke any tool.",
   "Optional review task, if included, must depend on the new Test task.",
   "Never include credentials, code contents, explanations or Markdown.",
   "Prefer minimal repair actions derived from verified error evidence."
  ].join(" ");
  const message=guidance+"\nTrusted observation: "+JSON.stringify(trusted);
  if(Buffer.byteLength(message,"utf8")>MAX_PROMPT_BYTES)fail();
  const stop=AbortSignal.timeout(maxCallMs);
  let answer="",responses=0;
  try{
   const req={
    model:model.model,
    contents:[{role:"user",parts:[{text:message}]}],
    config:{maxOutputTokens,temperature:0}
   };
   for await(const response of model.generateContentAsync(req,false,stop)){
    if(stop.aborted||response?.errorCode||response?.errorMessage)fail();
    if(response?.content){
     const parts=response.content.parts;
     if(!Array.isArray(parts)||parts.length!==1||
        typeof parts[0]?.text!=="string")fail();
     answer=parts[0].text;responses++;
    }
    if(responses>3||Buffer.byteLength(answer,"utf8")>MAX_RESULT_BYTES)fail();
   }
   if(stop.aborted||!responses)fail();
   return strictDraft(answer);
  }catch{fail();}
 };
}
