#!/usr/bin/env node
/**
 * Offline, non-authoritative scoring of an UNSIGNED TrustedAdkReadOnlyPlanner
 * proposal. No model, Gateway, Gitea or write tools are called here.
 * Expected reference touchpoints stay outside the model's prompts.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {getApprovedOfflineScenario} from
  "../apps/test-runner-controller/fixtures/approved-scenarios.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const ANCHORS=Object.freeze({
  "account-suspension":Object.freeze({
    backend:["apps/backend/src/users/user.service.ts",
      "apps/backend/src/users/user.routes.ts"],
    frontend:["apps/frontend/src/api/users-api.ts",
      "apps/frontend/src/pages/UserDetailPage.tsx"],
    test:["tests/backend/user.service.test.ts"]
  }),
  "department-directory":Object.freeze({
    backend:["apps/backend/src/users/user.service.ts",
      "apps/backend/src/users/user.routes.ts"],
    frontend:["apps/frontend/src/api/users-api.ts",
      "apps/frontend/src/pages/UserDetailPage.tsx"],
    test:["tests/backend/user.routes.test.ts"]
  }),
  "suspension-feedback":Object.freeze({
    frontend:["apps/frontend/src/pages/UserDetailPage.tsx"],
    test:["tests/frontend/UserDetailPage.test.tsx"]
  })
});
const ALLOWED=new Set(["create_branch","create_pull_request","read_file",
  "update_file","create_file","run_tests"]);
const ROLES=new Set(["orchestrator","backend","frontend","test"]);
const safeRecord=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const encodedPath=p=>p.split("/").map(encodeURIComponent).join("/");
const hasPath=(resource,p)=>typeof resource==="string"&&
  resource.endsWith("/files/"+encodedPath(p));

/** Diagnostic criteria only: not authorization, code acceptance or provider proof. */
export function evaluatePlannerFeasibility({scenario,expectedBaseRevision,
  proposal,observations,trustedSnapshot}){
  // The legacy benchmark uses a static reference tree for offline fixtures.
  // An actual Gemini/Gitea run MUST use the independently discovered and
  // SHA-pinned inventory, never the golden reference files.
  const live=trustedSnapshot!==undefined;
  if(!live&&!Object.hasOwn(ANCHORS,scenario))
    throw Error("unsupported benchmark scenario");
  if(!SHA.test(expectedBaseRevision))
    throw Error("independently pinned Gitea SHA required");
  if(!safeRecord(proposal)||!safeRecord(proposal.plan)||
     !Array.isArray(proposal.plan.tasks)||
     !Array.isArray(proposal.plan.requested_permissions)||
     !Array.isArray(observations)||observations.length>512)
    throw Error("invalid or absent proposal/observation artifact");
  // Feedback enhancement uses the original already-suspended baseline, not
  // the independently scripted department-directory solved fixture.
  let baseline,baselineDirs,expectedRepository;
  if(live){
    const sp=trustedSnapshot;
    const validPath=p=>typeof p==="string"&&p.length<=240&&
      !!p&&!p.startsWith("/")&&!p.includes("\\")&&
      !p.includes("%")&&!p.includes("//")&&
      p.split("/").every(x=>x&&x!=="."&&x!==".."&&
        !/[\x00-\x1f\x7f]/u.test(x));
    if(!safeRecord(sp)||sp.base_revision!==expectedBaseRevision||
       !safeRecord(sp.repository)||
       !["authority","owner","repository"].every(k=>
         typeof sp.repository[k]==="string"&&
         /^[A-Za-z0-9._-]+$/u.test(sp.repository[k]))||
       !Array.isArray(sp.files)||sp.files.length<1||sp.files.length>128||
       !Array.isArray(sp.directories)||sp.directories.length<1||
       sp.directories.length>128||
       sp.files.some(p=>!validPath(p))||
       sp.directories.some(p=>p!==""&&!validPath(p))||
       new Set(sp.files).size!==sp.files.length||
       new Set(sp.directories).size!==sp.directories.length||
       !sp.directories.includes(""))
      throw Error("invalid trusted source inventory for feasibility review");
    baseline=new Set(sp.files);
    baselineDirs=new Set(sp.directories);
    if([...baseline].some(p=>!baselineDirs.has(
      p.includes("/")?p.slice(0,p.lastIndexOf("/")):"")))
      throw Error("trusted source file parent directory missing");
    expectedRepository=sp.repository;
  }else{
    const reference=getApprovedOfflineScenario(
      scenario==="suspension-feedback"?"account-suspension":scenario);
    baseline=new Set(Object.keys(reference.files));
    baselineDirs=new Set([""]);
    for(const name of baseline){
      const parts=name.split("/");
      for(let i=1;i<parts.length;i++)
        baselineDirs.add(parts.slice(0,i).join("/"));
    }
    expectedRepository={authority:"gitea.local",owner:"thesis",
      repository:"iam-console-poc"};
  }
  const repoRoot="gitea://"+expectedRepository.authority+"/"+
    expectedRepository.owner+"/"+expectedRepository.repository;
  const exactFile=(resource,path)=>typeof resource==="string"&&
    resource.startsWith(repoRoot+"/branches/")&&
    !resource.includes("/branches/main/")&&
    hasPath(resource,path);
  // Independently check newly proposed file paths without assuming the new
  // file must already exist in the reference repository.
  const safeNewTestFile=resource=>{
    if(typeof resource!=="string"||!resource.startsWith(
      repoRoot+"/branches/"))return false;
    const split=resource.split("/files/");
    if(split.length!==2||split[0].endsWith("/branches/main"))return false;
    try {
      const parts=split[1].split("/").map(x=>decodeURIComponent(x));
      const candidate=parts.join("/");
      return parts.length>0&&parts.every(x=>x&&x!=="."&&x!==".."&&
        !x.includes("/")&&!x.includes("\\")&&
        !/[\x00-\x1f\x7f]/u.test(x))&&
        encodedPath(candidate)===split[1]&&!baseline.has(candidate)&&
        baselineDirs.has(parts.slice(0,-1).join("/"));
    }catch{return false;}
  };
  // The real trusted-owner bootstrap returns an Engineer review packet,
  // whereas direct propose() returns an unsigned proposal.
  const reviewPacket=proposal.status==="awaiting_engineer_signature";
  const proposalDigest=reviewPacket?proposal.plan_digest:proposal.digest;
  const plan=proposal.plan,grants=plan.requested_permissions,tasks=plan.tasks;
  const events=observations.filter(safeRecord);
  const reads=events.filter(e=>e.kind==="read"&&e.status==="verified"&&
    e.tool==="read_file"&&typeof e.path==="string");
  const modelTurns=events.filter(e=>e.kind==="model_turn"&&
    e.status==="started");
  const accepted=events.filter(e=>e.kind==="proposal"&&
    e.status==="unapproved");
  const denied=events.filter(e=>e.kind==="read"&&e.status==="denied");
  const claimed=proposal.verified_source_reads;
  const usage=events.filter(e=>e.kind==="model_usage"&&
    e.source==="provider_reported"&&Number.isSafeInteger(e.turn)&&
    e.turn>=1&&e.turn<=96);
  // Usage is OPTIONAL provider telemetry. Missing counts are unknown, not 0.
  // A total over calls is reported only when ALL observed calls include it.
  const sumIfComplete=field=>
    usage.length===modelTurns.length&&
      usage.every(e=>Number.isSafeInteger(e[field])&&e[field]>=0)?
      usage.reduce((total,e)=>total+e[field],0):null;
  const usageEvidence={
    source:usage.length?"provider_reported":"not_available",
    call_reports:usage.length,
    input_tokens:sumIfComplete("input_tokens"),
    output_tokens:sumIfComplete("output_tokens"),
    total_tokens:sumIfComplete("total_tokens"),
    thought_tokens:sumIfComplete("thought_tokens"),
    actual_billed_cost:"not_measured"
  };
  const scopeValid=grants.every(p=>safeRecord(p)&&ALLOWED.has(p.operation)&&
    ROLES.has(p.agent_id)&&typeof p.resource==="string"&&
    (p.operation==="create_file"?
      p.agent_id==="test"&&safeNewTestFile(p.resource):
      (p.operation!=="read_file"&&p.operation!=="update_file")||
      [...baseline].some(path=>exactFile(p.resource,path))));
  const anchors=Object.hasOwn(ANCHORS,scenario)?
    ANCHORS[scenario]:{};
  const missing={};
  for(const [role,paths] of Object.entries(anchors)){
    missing[role]=paths.filter(path=>!grants.some(p=>
      p.agent_id===role&&p.operation==="update_file"&&
      hasPath(p.resource,path)));
  }
  const add=(key,pass,detail)=>({key,pass:Boolean(pass),detail});
  const criteria=[
    add("pinned_identity",plan.base_revision===expectedBaseRevision&&
      plan.repository?.authority===expectedRepository.authority&&
      plan.repository?.owner===expectedRepository.owner&&
      plan.repository?.repository===expectedRepository.repository,
      "Compare independent Gitea SHA and repository"),
    add("unapproved_only",
      (proposal.status==="unapproved_proposal"||reviewPacket)&&
      !Object.hasOwn(proposal,"approval")&&
      !Object.hasOwn(proposal,"credential"),
      "No approval or credential in the proposal"),
    add("model_turn_trace",modelTurns.length>0&&
      modelTurns.every((e,i)=>e.turn===i+1),
      "Observed delegate attempts do not prove provider billing"),
    add("independent_source_discovery",reads.length>=2&&
      new Set(reads.map(e=>e.path)).size>=2&&
      reads.every(e=>baseline.has(e.path))&&claimed===reads.length,
      "Two distinct approved file reads; provider authenticity checked separately"),
    add("observation_consistency",denied.length===0&&accepted.length===1&&
      accepted[0].digest===proposalDigest&&
      accepted[0].verified_source_reads===claimed,
      "One accepted proposal and no denied reads"),
    add("known_tools_and_baseline_files",scopeValid&&
      tasks.every(t=>ROLES.has(t.agent_id)),
      "Diagnostic allowlist; trusted compiler remains authoritative"),
    add("branch_and_review",grants.some(p=>p.operation==="create_branch"&&
      p.agent_id==="orchestrator")&&grants.some(p=>
      p.operation==="create_pull_request"&&p.agent_id==="orchestrator")&&
      !grants.some(p=>p.operation==="merge_pull_request"),
      "Branch and PR proposed, no merge"),
    add("scenario_anchor_coverage",Object.values(missing).every(x=>x.length===0),
      "Reference touchpoints only; not functional correctness")
  ];
  return {
    schema_version:"1.0.0",scenario,baseline_revision:expectedBaseRevision,
    inventory_source:live?"trusted_pinned_gitea_snapshot":
      "offline_reference_fixture",
    evaluated_artifact:reviewPacket?"engineer_review_packet":"unapproved_proposal",
    // A valid alternative implementation may use fewer reference files.
    // Keep coverage as an independent research signal, not a hard security gate.
    technical_preflight_pass:criteria
      .filter(c=>c.key!=="scenario_anchor_coverage").every(c=>c.pass),
    criteria,
    evidence:{model_turn_attempts:modelTurns.length,
      verified_file_reads:reads.length,
      unique_files_read:new Set(reads.map(e=>e.path)).size,
      task_count:tasks.length,permission_count:grants.length,
      missing_reference_anchors:missing,
      reference_anchors_are_advisory:true,
      provider_token_usage:usageEvidence},
    limitations:{
      model_is_real_gemini:"not_established_by_this_artifact",
      native_authorized_gitea_reads:"not_established_by_this_artifact",
      functionally_correct_code:"not_tested",
      signed_engineer_approval:"not_tested",
      delegated_execution:"not_tested",
      billable_token_usage:"not_measured"
    }
  };
}

async function boundedJson(path){
  const text=await readFile(path,"utf8");
  if(Buffer.byteLength(text)>128000)throw Error("oversized benchmark artifact");
  return JSON.parse(text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [scenario,expectedBaseRevision,proposalPath,observationPath]=
      process.argv.slice(2);
    if(!scenario||!expectedBaseRevision||!proposalPath||!observationPath||
       process.argv.length!==6)
      throw Error("usage: scenario pinned-sha proposal.json observations.json");
    const report=evaluatePlannerFeasibility({scenario,expectedBaseRevision,
      proposal:await boundedJson(proposalPath),
      observations:await boundedJson(observationPath)});
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    process.exitCode=report.technical_preflight_pass?0:1;
  }catch(e){
    process.stderr.write("Planner feasibility preflight: "+e.message+"\n");
    process.exitCode=1;
  }
}
