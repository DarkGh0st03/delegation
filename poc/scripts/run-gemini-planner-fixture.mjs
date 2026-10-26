#!/usr/bin/env node
/**
 * Experimental REAL Gemini planning-only probe over a FROZEN, IN-MEMORY
 * IAM Console baseline. Intentionally NOT a live Gitea/Gateway/OPA or
 * credential-backed Planning session. No Engineer approval, DC or code writes.
 *
 * Default dry-run imports NO model. Billable inference requires an explicit
 * --execute switch AND a separate exact operator opt-in environment variable.
 */
import {createHash} from "node:crypto";
import {mkdir,lstat,open} from "node:fs/promises";
import {isAbsolute,normalize,resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {evaluatePlannerFeasibility} from "./planner-feasibility-eval.mjs";

export const CONSENT="I AUTHORIZE GEMINI API CHARGES";
export const FIXTURE_SCENARIOS=Object.freeze({
  "department-directory":{
    requirement:"Enable an administrator to search the IAM user directory by department (case-insensitive), with an authenticated API, accessible frontend and meaningful tests. Preserve existing account suspension/reactivation semantics.",
    workBranch:"feature/experiment-department-directory",
    gradeAs:"department-directory"
  },
  "suspension-feedback":{
    requirement:"Improve the accessibility of IAM Console suspension and reactivation feedback: the existing success message must be announced non-interruptively to assistive technology, and an action failure must be announced assertively. Keep the existing visible messages and backend lifecycle/API unchanged, with frontend regression tests.",
    workBranch:"feature/experiment-suspension-feedback",
    gradeAs:"suspension-feedback"
  }
});

function requireCase(id){
  if(!Object.hasOwn(FIXTURE_SCENARIOS,id))
    throw Error("unsupported isolated feasibility scenario");
  return FIXTURE_SCENARIOS[id];
}
const validPath=p=>typeof p==="string"&&p.length>0&&
  !p.startsWith("/")&&!p.includes("\\")&&
  !p.split("/").some(v=>!v||v==="."||v==="..");

export function makeIsolatedPlanningFixture(scenario){
  const spec=requireCase(scenario);
  const files=ACCOUNT_SUSPENSION_REFERENCE_FILES;
  const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length<5||entries.some(([p,body])=>!validPath(p)||
       typeof body!=="string"||!body))
    throw Error("invalid independent IAM source baseline");
  // Novelty is explicitly defined against the unsolved fixture, not a
  // pre-generated department-directory or enhancement result.
  if(scenario==="department-directory"&&
      files["apps/backend/src/users/user.service.ts"].includes("listUsersByDepartment("))
    throw Error("baseline already implements the department feature");
  if(scenario==="suspension-feedback"){
    const page=files["apps/frontend/src/pages/UserDetailPage.tsx"];
    if(!page.includes('className="success-message"')||
       !page.includes('className="error-message"'))
      throw Error("accessibility fixture requires existing visible feedback");
    // Status/alert semantic roles are ABSENT, though visible text already
    // exists. Avoid giving the model any specific file-path solution.
    if(/\brole\s*=\s*["'](?:status|alert)["']/u.test(page))
      throw Error("baseline already includes the requested accessibility semantics");
  }

  const paths=entries.map(([p])=>p);
  const dirs=new Set([""]);
  for(const p of paths){
    const parts=p.split("/");
    for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join("/"));
  }
  // This is a synthetic fixture content fingerprint, NOT a Git commit SHA,
  // native verification receipt or an authenticated Gitea base revision.
  const fingerprint=createHash("sha1").update(JSON.stringify(entries)).digest("hex");
  const snapshot=Object.freeze({
    session_id:"isolated_"+scenario.replaceAll("-","_"),
    repository:Object.freeze({
      authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"
    }),
    base_revision:fingerprint,
    directories:Object.freeze([...dirs].sort()),
    files:Object.freeze(paths)
  });
  const invoked=[];
  const readPort={
    async invoke(tool,args,signal){
      if(signal?.aborted)throw Error("read cancelled");
      invoked.push(Object.freeze({tool,path:args.path??null}));
      const common={provider:"gitea",performed:true,tool,
        revision:fingerprint};
      if(tool==="read_repository"&&Object.keys(args).length===0)
        return {...common,default_branch:"main",full_name:"thesis/iam-console-poc"};
      if((tool==="list_directory"||tool==="read_file")&&
          args.branch==="main"&&typeof args.path==="string"){
        if(tool==="read_file"&&Object.hasOwn(files,args.path))
          return {...common,branch:"main",path:args.path,content:files[args.path]};
        if(tool==="list_directory"&&dirs.has(args.path)){
          const prefix=args.path?args.path+"/":"";
          const descendants=[...dirs].filter(x=>x&&x.startsWith(prefix)&&
            x!==args.path).map(x=>({type:"dir",path:x}));
          const childDirs=descendants.filter(x=>!x.path.slice(prefix.length).includes("/"));
          const childFiles=paths.filter(x=>x.startsWith(prefix)&&
            !x.slice(prefix.length).includes("/")).map(x=>({type:"file",path:x}));
          return {...common,branch:"main",path:args.path,entries:[
            ...childDirs,...childFiles].sort((a,b)=>a.path.localeCompare(b.path))};
        }
      }
      throw Error("isolated fixture read outside approved scope");
    }
  };
  return Object.freeze({
    spec,snapshot,readPort,
    get invokedReads(){return invoked.map(x=>({...x}));},
    agents:Object.freeze({
      backend:Object.freeze({did:"did:example:fixture-backend",card_ref:"fixture:backend"}),
      frontend:Object.freeze({did:"did:example:fixture-frontend",card_ref:"fixture:frontend"}),
      test:Object.freeze({did:"did:example:fixture-test",card_ref:"fixture:test"})
    })
  });
}

export function assertBillableFixtureOptIn({flag,consent,apiKey,outputDir}){
  if(flag!=="--execute"||consent!==CONSENT||
     typeof apiKey!=="string"||!apiKey.trim())
    throw Error("billable Gemini probe denied: explicit --execute, exact consent and API key required");
  if(typeof outputDir!=="string"||!isAbsolute(outputDir)||
     normalize(outputDir)!==outputDir||resolve(outputDir)!==outputDir)
    throw Error("absolute normalized new output directory required");
  return outputDir;
}

async function createPrivateDirectory(directory){
  await mkdir(directory,{recursive:false,mode:0o700});
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o077)!==0||
     (process.getuid?.()!==undefined&&stat.uid!==process.getuid()))
    throw Error("untrusted output directory");
}
async function persistJson(directory,name,value){
  const file=await open(join(directory,name),"wx",0o600);
  try{
    await file.writeFile(JSON.stringify(value,null,2)+"\n","utf8");
  }finally{await file.close();}
}

export async function runIsolatedGeminiFixture({scenario,apiKey,modelName,
  outputDir,billingConsent}){
  // Enforce charge consent at the exported API boundary too, not just CLI.
  assertBillableFixtureOptIn({flag:"--execute",consent:billingConsent,
    apiKey,outputDir});
  const fixture=makeIsolatedPlanningFixture(scenario);
  // Own a private evidence directory before consuming a model budget.
  await createPrivateDirectory(outputDir);
  const {createGeminiAdkModel}=await import(
    "../packages/agent-runtime/src/gemini-adk-model.ts");
  const {TrustedAdkReadOnlyPlanner}=await import(
    "../packages/orchestrator-runtime/src/trusted-adk-planner.ts");
  const observations=[];
  let status="failed_closed";
  try{
    const model=createGeminiAdkModel({apiKey,model:modelName});
    const planner=new TrustedAdkReadOnlyPlanner({
      model,snapshot:fixture.snapshot,requirement:fixture.spec.requirement,
      planId:"isolated_"+scenario.replaceAll("-","_")+"_v1",
      workBranch:fixture.spec.workBranch,
      agents:fixture.agents,readPort:fixture.readPort,
      onObservation(e){observations.push(e);},
      maxModelTurns:8,maxModelCallMs:60000,
      maxPlanningMs:300000,maxOutputTokens:8192
    });
    const proposal=await planner.propose();
    // This benchmark checks model feasibility only. The in-memory port
    // deliberately imitates Gitea's response SHAPE, not its trust properties.
    const report=evaluatePlannerFeasibility({
      scenario:fixture.spec.gradeAs,
      expectedBaseRevision:fixture.snapshot.base_revision,
      proposal,observations
    });
    await persistJson(outputDir,"proposal.json",proposal);
    await persistJson(outputDir,"observations.json",observations);
    await persistJson(outputDir,"evaluation.json",report);
    status="unapproved_isolated_proposal";
    return {status,report};
  }finally{
    // The local marker is not a provider usage receipt; invoices/tokens
    // must be checked separately with the API provider.
    await persistJson(outputDir,"fixture-run.json",{
      schema_version:"1.0.0",scenario,model_name:modelName,
      status,baseline_kind:"synthetic_in_memory_fixture",
      base_revision:fixture.snapshot.base_revision,
      native_rust_gateway_opa_gitea:"not_tested",
      engineer_approval:"not_requested",
      operational_delegations:"not_issued",
      can_authorize_execution:false,
      provider_tokens_and_cost:"not_measured"
    });
  }
}

async function main(){
  const [flag,scenario]=process.argv.slice(2);
  if(process.argv.length!==4||
     !["--dry-run","--execute"].includes(flag))
    throw Error("usage: --dry-run|--execute department-directory|suspension-feedback");
  const fixture=makeIsolatedPlanningFixture(scenario);
  if(flag==="--dry-run"){
    process.stdout.write(JSON.stringify({
      status:"no_model_or_network_called",
      case:scenario,requirement:fixture.spec.requirement,
      baseline_kind:"synthetic_in_memory_fixture",
      fingerprint_not_git_sha:fixture.snapshot.base_revision,
      files:fixture.snapshot.files.length,
      directories:fixture.snapshot.directories.length,
      available_tools:["read_repository","list_directory","read_file"],
      can_write:false,can_approve:false,gemini_inference_calls:0
    },null,2)+"\n");
    return;
  }
  const dir=assertBillableFixtureOptIn({
    flag,consent:process.env.DELEGATION_PLANNER_BILLING_CONSENT,
    apiKey:process.env.GEMINI_API_KEY,
    outputDir:process.env.DELEGATION_PLANNER_OUTPUT_DIR
  });
  const out=await runIsolatedGeminiFixture({
    scenario,apiKey:process.env.GEMINI_API_KEY,
    modelName:process.env.DELEGATION_PLANNER_MODEL||"gemini-3.8-flash",
    billingConsent:process.env.DELEGATION_PLANNER_BILLING_CONSENT,
    outputDir:dir
  });
  process.stdout.write(JSON.stringify({
    status:out.status,technical_preflight_pass:out.report.technical_preflight_pass,
    baseline_kind:"synthetic_in_memory_fixture",
    artifact_directory:dir,provider_cost:"not_measured",
    authorized_execution:false
  })+"\n");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{
    // Never print secrets, source snippets, provider request body or errors.
    process.stderr.write("Isolated Planner experiment refused or failed: "+
      (String(e?.message??"unknown").startsWith("billable Gemini probe denied")?
        "operator opt-in missing":"see private host diagnostics")+"\n");
    process.exitCode=1;
  });
}
