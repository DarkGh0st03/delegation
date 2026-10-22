/**
 * GitHub workflow_dispatch input boundary. NEVER an Engineer approval.
 * A workflow event cannot restore an active Planning root or confer DC/VP
 * authority. startGithubReviewedGeminiHandoff requires the live trusted host.
 */
import {startPersistedReviewedGeminiHandoff}
  from "./trusted-manual-gemini-handoff.ts";

const SHA=/^[a-f0-9]{40}$/u;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MODEL=/^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const FIELDS=["authorization","model","max_model_turns",
  "max_output_tokens","max_model_call_ms"] as const;
type Env=Readonly<Record<string,string|undefined>>;
export interface PinnedGithubDispatch{
  repository:string;
  ref:string;
  workflowPath:string;
  /** Code source SHA, NOT the independent Gitea Planning SHA. */
  sourceSha?:string;
}
export interface ReviewedGithubDispatchRequest{
  readonly status:"manual_workflow_input_only_not_authorized";
  readonly source_repository:string;
  readonly source_ref:string;
  readonly source_sha:string;
  readonly run_id:string;
  readonly model_name:string;
  readonly max_model_turns:number;
  readonly max_output_tokens:number;
  readonly max_model_call_ms:number;
  readonly authorization_input:string;
}
function deny(reason:string):never{
  throw Error("Trusted Github manual dispatch: "+reason);
}
function bounded(value:unknown,name:string,min:number,max:number):number{
  if(typeof value!=="string"||!/^(0|[1-9]\d*)$/u.test(value)||
     value.length>8)deny("invalid "+name);
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)
    deny("out-of-range "+name);
  return parsed;
}
export function verifyGithubManualGeminiDispatch(input:{
  env:Env;event:unknown;pinned:PinnedGithubDispatch
}):Readonly<ReviewedGithubDispatchRequest>{
  const {env,event,pinned}=input;
  if(!REPO.test(pinned.repository)||
     !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(pinned.ref)||
     !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u.test(
       pinned.workflowPath))deny("independent repository/ref/workflow pin missing");
  if(pinned.sourceSha!==undefined&&!SHA.test(pinned.sourceSha))
    deny("invalid pinned source revision");
  if(env.GITHUB_ACTIONS!=="true"||
     env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
     env.GITHUB_RUN_ATTEMPT!=="1")
    deny("first manual GitHub Actions attempt required");
  if(env.GITHUB_REPOSITORY!==pinned.repository||
     env.GITHUB_REF!==pinned.ref||
     env.GITHUB_WORKFLOW_REF!==
       pinned.repository+"/"+pinned.workflowPath+"@"+pinned.ref)
    deny("workflow, repository or branch not independently pinned");
  if(!SHA.test(env.GITHUB_SHA??"")||
     (pinned.sourceSha!==undefined&&env.GITHUB_SHA!==pinned.sourceSha)||
     !/^[1-9]\d{0,19}$/u.test(env.GITHUB_RUN_ID??""))
    deny("source revision or run ID invalid");
  if(!event||typeof event!=="object"||Array.isArray(event))
    deny("GitHub event payload absent");
  const e=event as Record<string,unknown>;
  const identity=e.repository as Record<string,unknown>|undefined;
  if(!identity||identity.full_name!==pinned.repository||
     e.ref!==pinned.ref)
    deny("event repository/ref mismatch");
  const inputs=e.inputs;
  if(!inputs||typeof inputs!=="object"||Array.isArray(inputs))
    deny("manual inputs absent");
  const fields=inputs as Record<string,unknown>;
  if(Object.keys(fields).length!==FIELDS.length||
     FIELDS.some(key=>!Object.hasOwn(fields,key)))
    deny("unexpected/missing workflow inputs");
  if(fields.authorization!==CONFIRM)deny("explicit charges consent missing");
  if(typeof fields.model!=="string"||fields.model.length>80||
     !MODEL.test(fields.model))deny("invalid model");
  return Object.freeze({
    status:"manual_workflow_input_only_not_authorized" as const,
    source_repository:pinned.repository,
    source_ref:pinned.ref,
    source_sha:env.GITHUB_SHA!,
    run_id:env.GITHUB_RUN_ID!,
    model_name:fields.model,
    max_model_turns:bounded(fields.max_model_turns,"max_model_turns",1,32),
    max_output_tokens:bounded(fields.max_output_tokens,
      "max_output_tokens",1,32000),
    max_model_call_ms:bounded(fields.max_model_call_ms,
      "max_model_call_ms",1000,360000),
    authorization_input:CONFIRM
  });
}

/** The ONLY paid bridge: requires actual Coordinator/checkpoint/Engineer
 * objects in this process. No event input can supply those objects. */
export async function startGithubReviewedGeminiHandoff(input:
  Omit<Parameters<typeof startPersistedReviewedGeminiHandoff>[0],
    "manual"|"maxModelCallMs">&{
    env:Env;event:unknown;pinned:PinnedGithubDispatch;
    geminiApiKey:string|undefined;
  }
){
  const checked=verifyGithubManualGeminiDispatch(input);
  const {env,event,pinned,geminiApiKey,...trusted}=input;
  return startPersistedReviewedGeminiHandoff({
    ...trusted,
    maxModelCallMs:checked.max_model_call_ms,
    manual:{
      githubEventName:env.GITHUB_EVENT_NAME!,
      githubRunAttempt:env.GITHUB_RUN_ATTEMPT!,
      authorizationInput:checked.authorization_input,
      geminiApiKey,
      modelName:checked.model_name,
      maxModelTurns:checked.max_model_turns,
      maxOutputTokens:checked.max_output_tokens
    }
  });
}
