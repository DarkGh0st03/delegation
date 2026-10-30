/**
 * REAL positive exact-SHA CI integration — isolated disposable Gitea.
 *
 * Uses the GitHub-published immutable baseline iam-console-poc at SHA
 * 405748b...; commits the existing Phase 10B reference Account Suspension
 * implementation (eleven genuine source/test files) to an isolated feature
 * branch, never the persistent Gitea installation.
 *
 * Actual IsolatedDockerRunnerExecutor performs all six fixed project phases
 * and the separately mounted, researcher-owned acceptance suite.
 * Actual TrustedGiteaSecurityCi publishes pending -> success on the exact
 * feature commit ONLY after both tests and acceptance genuinely pass.
 *
 * This is a deterministic reference-fixture CI test with real ADK/A2A
 * when opted in: NOT LLM-generated code or production human sign-off.
 * The native three-agent profile appends harmless source comments only.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT,
  TRUSTED_PROJECT_PHASES} from "../src/trusted-security-ci.ts";
import {getApprovedOfflineScenario} from
  "../fixtures/approved-scenarios.mjs";
import {beginApprovedRealRunnerSession} from
  "./approved-gateway-runner-session.mjs";
import {TrustedGiteaPriorDiffReader}
  from "../../../packages/orchestrator-runtime/src/trusted-gitea-prior-diff-reader.ts";
import {safeNativeDockerFailureDiagnostic}
  from "./native-dag-result-diagnostic.mjs";
import {safeGeminiPilotChildObservations,
  safeGeminiPilotAgentObservations}
  from "../../../scripts/signed-gemini-pilot-usage.mjs";
import {inspectF1RealGiteaPlannerReadiness}
  from "../../../scripts/f1-real-gitea-planner-readiness.mjs";
import {buildF1RealGiteaResearchPlanningPort}
  from "../../../scripts/f1-gitea-research-planning-port.mjs";
import {runF1RealGiteaGeminiResearch}
  from "../../../scripts/f1-real-gitea-gemini-probe.mjs";
import {rehearseF1RealGiteaAdkPlanning}
  from "../../../scripts/f1-real-gitea-adk-planner-rehearsal.mjs";
import {runSourceDerivedGiteaAdkProbe}
  from "../../gateway/native-test/source-derived-gitea-adk-probe.mjs";

const baseline="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const baselineSource="https://github.com/DarkGh0st03/iam-console-poc.git";
const scenario=getApprovedOfflineScenario(process.env.APPROVED_RUNNER_SCENARIO);
const referenceFiles=scenario.files;
const branch=scenario.fixtureBranch;
const repository="/api/v1/repos/thesis/iam-console-poc";
const suffix=randomBytes(6).toString("hex");
const container="delegation-ci-positive-"+suffix;
const opaContainer="delegation-ci-positive-opa-"+suffix;
const opaImage=process.env.OPA_IMAGE??"openpolicyagent/opa:1.21.1";
const image=process.env.GITEA_IMAGE??"docker.gitea.com/gitea:28.0.0";
const nodeImage=process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm";
const adminUser=process.env.GITEA_ADMIN_USER;
const adminPassword=process.env.GITEA_ADMIN_PASSWORD;
if(!adminUser||!adminPassword)throw Error("Source poc/infra/.env first");
const readerUser="ci-reader-"+suffix;
const publisherUser="ci-publisher-"+suffix;
const readerPass=randomBytes(24).toString("hex");
const publisherPass=randomBytes(24).toString("hex");
let containerStarted=false,opaStarted=false;

function docker(args,label){
  try{
    return execFileSync("docker",args,{encoding:"utf8",timeout:120000,
      stdio:["ignore","pipe","pipe"]}).trim();
  }catch{throw Error("Disposable Docker operation failed: "+label);}
}
function git(args,{cwd,auth,timeout=180000,label="Git step"}={}){
  const env={...process.env,GIT_TERMINAL_PROMPT:"0",
    GCM_INTERACTIVE:"never",GIT_ASKPASS:""};
  if(auth){
    // Never put the temporary Gitea admin password into Git command-line
    // arguments, remote URLs, repository config, diagnostic output or files.
    env.GIT_CONFIG_COUNT="1";
    env.GIT_CONFIG_KEY_0="http.extraheader";
    env.GIT_CONFIG_VALUE_0="Authorization: "+auth;
  }
  try{
    return execFileSync("git",args,{cwd,env,encoding:"utf8",timeout,
      stdio:["ignore","pipe","pipe"]}).trim();
  }catch(error){
    // Git stderr was previously discarded, hiding the actual remote push
    // failure. Log only a bounded, sanitized excerpt for disposable CI.
    // Never enable GIT_TRACE_CURL: it can expose Authorization headers.
    const sensitive=[adminPassword,readerPass,publisherPass,
      basic(adminUser,adminPassword)];
    const safeLines=String(error?.stderr??"").split(/\r?\n/u)
      .filter(line=>line.trim().length>0)
      .slice(-18)
      .map(line=>{
        let safe=line.replace(/[\x00-\x1f\x7f]/gu," ").slice(0,500)
          .replace(/https?:\/\/[^\s"'<>]+/giu,"[remote-url]")
          .replace(/Authorization\s*:\s*[^\s]+(?:\s+[^\s]+)?/giu,
            "Authorization: [REDACTED]")
          .replace(/Basic\s+[A-Za-z0-9+/=]+/gu,"Basic [REDACTED]");
        for(const secret of sensitive){
          if(secret)safe=safe.split(secret).join("[REDACTED]");
        }
        return safe;
      });
    process.stderr.write("[trusted-positive-ci] git_diagnostic "+
      JSON.stringify({step:label,exit_code:error?.status??null,
        stderr_lines:safeLines})+"\n");
    throw Error(label+" failed");
  }
}
function stopOpa(){
  if(!opaStarted)return;
  try{
    execFileSync("docker",["stop","--time","5",opaContainer],{
      timeout:30000,stdio:"ignore"
    });
  }catch{/* Already stopped or removed */}
  opaStarted=false;
}
function stopDocker(){
  try{
    execFileSync("docker",["stop","--time","5",container],{
      timeout:30000,stdio:"ignore"
    });
  }catch{/* Already stopped or removed */}
}
for(const signal of ["SIGTERM","SIGINT"]){
  process.once(signal,()=>{
    stopOpa();
    if(containerStarted)stopDocker();
    process.exitCode=130;
  });
}
function basic(u,p){return "Basic "+Buffer.from(u+":"+p).toString("base64");}
async function stage(name,work,timeout=30000){
  process.stderr.write("[trusted-positive-ci] start "+name+"\n");
  let timer;
  try{
    const result=await Promise.race([
      Promise.resolve().then(work),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error("Stage timed out: "+name)),timeout);
      })
    ]);
    process.stderr.write("[trusted-positive-ci] ok "+name+"\n");
    return result;
  }finally{
    if(timer)clearTimeout(timer);
  }
}
async function api(base,path,{authorization,method="GET",body,
  expected=[200,201],label="controlled_api"}={}){
  return stage(label,async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(base+path,{
        method,redirect:"error",signal:controller.signal,
        headers:{
          accept:"application/json",
          ...(authorization?{authorization}:{}),
          ...(body===undefined?{}:{"content-type":"application/json"})
        },
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      });
      if(!expected.includes(response.status)){
        // Diagnose disposable-server failures without dumping API bodies,
        // repository contents, credentials, tokens or HTTP request headers.
        if(response.status>=500 && containerStarted){
          try{
            const serverLogs=execFileSync("docker",[
              "logs","--tail","120",container
            ],{encoding:"utf8",timeout:10000,
              stdio:["ignore","pipe","pipe"]});
            const allLogs=serverLogs.split(/\r?\n/u);
            const panicAt=allLogs.findIndex(line=>/PANIC:|panic recovered/iu.test(line));
            const relevant=panicAt>=0?allLogs.slice(panicAt,panicAt+65):allLogs.slice(-30);
            const logIssues=relevant.filter(line=>line.trim().length>0)
              .map(line=>{
                let safe=line.replace(/[\x00-\x1f\x7f]/gu," ").slice(0,300)
                  .replace(/https?:\/\/[^\s"'<>]+/giu,"[remote-url]")
                  .replace(/(?:Basic|Bearer|token)\s+[A-Za-z0-9+/_=.-]+/giu,
                    "[REDACTED]");
                for(const secret of [adminPassword,readerPass,publisherPass]){
                  if(secret)safe=safe.split(secret).join("[REDACTED]");
                }
                return safe;
              });
            process.stderr.write("[trusted-positive-ci] isolated_server_errors "+
              JSON.stringify({step:label,status:response.status,
                lines:logIssues})+"\n");
          }catch{/* Best-effort server diagnostics only. */}
        }
        throw Error("Isolated Gitea "+label+" HTTP "+response.status);
      }
      return response.status===204?{}:response.json();
    }finally{clearTimeout(timer);}
  },25000);
}
async function ready(base){
  for(let i=0;i<180;i++){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),1600);
      try{
        const response=await fetch(base+"/api/healthz",{
          signal:controller.signal
        });
        if(response.ok)return;
      }finally{clearTimeout(timer);}
    }catch{/* Gitea is starting */}
    await sleep(500);
  }
  throw Error("Disposable Gitea health check timed out");
}
function createUser(name,password,label,admin=false){
  docker(["exec","--user","1000:1000",container,"gitea",
    "admin","user","create","--username",name,
    "--password",password,"--email",label+"-"+suffix+"@localhost.invalid",
    ...(admin?["--admin"]:[]),"--must-change-password=false"],
  "create disposable user "+label);
}
async function bootstrap(base){
  createUser(adminUser,adminPassword,"administrator",true);
  createUser(readerUser,readerPass,"read");
  createUser(publisherUser,publisherPass,"security-ci");
  const admin=basic(adminUser,adminPassword);
  await api(base,"/api/v1/orgs",{authorization:admin,method:"POST",
    body:{username:"thesis",visibility:"private"},label:"create_org"});
  await api(base,"/api/v1/orgs/thesis/repos",{
    authorization:admin,method:"POST",label:"create_empty_repo",
    body:{name:"iam-console-poc",private:true,auto_init:false,
      default_branch:"main"}
  });
  for(const [name,permission] of [
    [readerUser,"read"],[publisherUser,"write"]
  ]){
    await api(base,repository+"/collaborators/"+name,{
      authorization:admin,method:"PUT",expected:[204],
      body:{permission},label:"grant_"+permission+"_role"
    });
  }
  const [reader,publisher]=await Promise.all([
    api(base,"/api/v1/users/"+readerUser+"/tokens",{
      authorization:basic(readerUser,readerPass),method:"POST",
      body:{name:"read-only-"+suffix,scopes:["read:repository","read:user"]},
      label:"create_reader_pat"
    }),
    api(base,"/api/v1/users/"+publisherUser+"/tokens",{
      authorization:basic(publisherUser,publisherPass),method:"POST",
      body:{name:"trusted-ci-"+suffix,scopes:["write:repository","read:user"]},
      label:"create_publisher_pat"
    })
  ]);
  assert.ok(typeof reader.sha1==="string"&&reader.sha1.length>=20);
  assert.ok(typeof publisher.sha1==="string"&&publisher.sha1.length>=20);
  const actor=await api(base,"/api/v1/user",{
    authorization:"token "+publisher.sha1,label:"validate_publisher_identity"
  });
  assert.equal(actor.login,publisherUser);
  assert.ok(Number.isSafeInteger(actor.id)&&actor.id>0);
  return {
    admin,readToken:reader.sha1,statusToken:publisher.sha1,
    actor:{id:actor.id,login:actor.login}
  };
}

async function pushReferenceApp(base,workTree,admin){
  await stage("clone_immutable_public_baseline",()=>git([
    // Gitea rejects pushing a shallow clone to an empty repository.
    // Download full history while pinning/verifying the exact baseline HEAD.
    "clone","--single-branch",
    "--branch","baseline-before-account-suspension",
    baselineSource,workTree
  ],{label:"clone public baseline"}),200000);
  const observed=git(["rev-parse","HEAD"],{cwd:workTree,
    label:"read baseline SHA"});
  assert.equal(observed,baseline,"Public baseline reference has changed");
  git(["branch","-M","main"],{cwd:workTree,
    label:"rename pinned baseline main"});
  const isolatedUrl=base+"/thesis/iam-console-poc.git";
  git(["push",isolatedUrl,"HEAD:refs/heads/main"],{
    cwd:workTree,auth:admin,label:"push immutable main to isolated Gitea"
  });
  let repoAfterPush=await api(base,repository,{
    authorization:admin,label:"inspect_repo_after_push"
  });
  if(repoAfterPush.empty){
    // Git receive-hooks can update Gitea's repository metadata after the
    // HTTP push returns. A branches lookup while is_empty=true panics on
    // this disposable Gitea version. Wait for actual metadata convergence,
    // but never fabricate a successful branch/commit verification.
    await stage("wait_post_receive_repository_state",async()=>{
      for(let attempt=0;attempt<40;attempt++){
        await sleep(500);
        repoAfterPush=await api(base,repository,{
          authorization:admin,label:"inspect_post_receive_state"
        });
        if(repoAfterPush.empty===false)return;
      }
      throw Error("Gitea still marks pushed repository empty after 20 seconds");
    },30000);
  }
  process.stderr.write("[trusted-positive-ci] repo_after_push "+
    JSON.stringify({empty:repoAfterPush.empty,
      default_branch:repoAfterPush.default_branch})+"\n");
  const main=await api(base,repository+"/branches/main",{
    authorization:admin,label:"verify_isolated_main"
  });
  assert.equal(main.commit.id,baseline);
  git(["switch","-c",branch],{
    cwd:workTree,label:"create local feature branch"
  });
  const entries=Object.entries(referenceFiles);
  assert.equal(entries.length,11,"Reference app must have eleven fixed files");
  for(const [path,content] of entries){
    assert.ok(typeof content==="string"&&content.length>0);
    assert.ok(!path.startsWith("/")&&!path.includes("..")&&
      !path.includes("\\"),"Unexpected reference file path");
    const target=join(workTree,...path.split("/"));
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,content,{encoding:"utf8"});
    git(["add","--",path],{cwd:workTree,label:"stage approved fixture file"});
  }
  git(["-c","user.name=Isolated Fixture Builder",
    "-c","user.email=fixture@localhost.invalid",
    "commit","-m","fixture: implement "+scenario.id+" offline reference requirement"
  ],{cwd:workTree,label:"commit isolated approved scenario fixture"});
  const sha=git(["rev-parse","HEAD"],{cwd:workTree,
    label:"resolve final exact feature SHA"});
  assert.match(sha,/^[a-f0-9]{40}$/u);
  assert.notEqual(sha,baseline);
  git(["push",isolatedUrl,"HEAD:refs/heads/"+branch],{
    cwd:workTree,auth:admin,
    label:"push reference feature to disposable Gitea"
  });
  const feature=await api(base,repository+"/branches/"+
    encodeURIComponent(branch),{
    authorization:admin,label:"verify_isolated_feature"
  });
  assert.equal(feature.commit.id,sha);
  await api(base,repository+"/branch_protections",{
    method:"POST",authorization:admin,
    label:"protect_disposable_main",
    body:{
      branch_name:"main",enable_push:false,enable_force_push:false,
      required_approvals:1,block_admin_merge_override:true,
      dismiss_stale_approvals:true,block_on_outdated_branch:true
    }
  });
  return {mainSha:baseline,featureSha:sha};
}

async function main(){
  const acceptanceDir=fileURLToPath(new URL(
    "../../../runner/acceptance/",import.meta.url
  ));
  assert.ok((await stat(acceptanceDir)).isDirectory());
  docker(["image","inspect",image],"Gitea Docker image must be cached");
  docker(["image","inspect",nodeImage],"Node Docker image must be cached");
  docker(["image","inspect",opaImage],"Pinned OPA image must be cached");
  docker(["run","--rm","--detach","--name",container,
    "--publish","127.0.0.1::3000/tcp",
    "--env","USER_UID=1000","--env","USER_GID=1000",
    "--env","GITEA__database__DB_TYPE=sqlite3",
    "--env","GITEA__database__PATH=/data/gitea/gitea.db",
    "--env","GITEA__server__DOMAIN=localhost",
    "--env","GITEA__server__ROOT_URL=http://localhost:3000/",
    "--env","GITEA__server__DISABLE_SSH=true",
    "--env","GITEA__service__DISABLE_REGISTRATION=true",
    "--env","GITEA__security__INSTALL_LOCK=true",
    "--env","GITEA__actions__ENABLED=false",
    image],"start no-volume isolated Gitea");
  containerStarted=true;
  let workRoot=null,logs=null,approvedSession=null;
  let nativePrEvidence=null; // Separate signed DAG branch, not Security CI's branch
  try{
    const portInfo=docker(["port",container,"3000/tcp"],
      "inspect disposable Gitea localhost port");
    const port=/127\.0\.0\.1:(\d+)/u.exec(portInfo)?.[1];
    if(!port)throw Error("Disposable Gitea not bound to loopback");
    const base="http://127.0.0.1:"+port;
    await stage("isolated_gitea_ready",()=>ready(base),125000);
    // Real OPA, no shared docker-compose names, no persistent volumes.
    const opaDir=fileURLToPath(new URL("../../../opa/",import.meta.url));
    docker(["run","--rm","--detach","--name",opaContainer,
      "--publish","127.0.0.1::8181/tcp",
      "--volume",opaDir+":/policy:ro",
      opaImage,"run","--server","--addr=0.0.0.0:8181","/policy"],
      "start disposable real OPA policy server");
    opaStarted=true;
    const opaPortInfo=docker(["port",opaContainer,"8181/tcp"],
      "inspect isolated OPA localhost port");
    const opaPort=/127\.0\.0\.1:(\d+)/u.exec(opaPortInfo)?.[1];
    if(!opaPort)throw Error("Real OPA port must bind only to loopback");
    const opaBaseUrl="http://127.0.0.1:"+opaPort;
    await stage("isolated_opa_ready",async()=>{
      for(let i=0;i<100;i++){
        try{
          const response=await fetch(opaBaseUrl+"/health",{
            signal:AbortSignal.timeout(1000)
          });
          if(response.ok)return;
        }catch{/* OPA still loading policy */}
        await sleep(250);
      }
      throw Error("Isolated OPA failed to load signed-plan Rego policy");
    },35000);
    const creds=await stage("disposable_accounts",
      ()=>bootstrap(base),180000);
    workRoot=await mkdtemp(join(tmpdir(),"thesis-positive-acceptance-"));
    const workingDir=join(workRoot,"iam-console-poc");
    const fixture=await stage("commit_reference_implementation",
      ()=>pushReferenceApp(base,workingDir,
        basic(adminUser,adminPassword)),300000);
    // R45: exercise the same owner-private, source-free SHA comparison
    // used by an audited fresh recovery against REAL disposable Gitea.
    // Compare the original pinned main to the existing independently
    // observed feature head; no model, patch, cherry-pick or Gitea write.
    const priorDiff=await stage("r45_gitea_retired_branch_diff_audit",async()=>{
      const reader=new TrustedGiteaPriorDiffReader({
        baseUrl:base,token:creds.readToken,
        repository:{authority:"gitea.local",owner:"thesis",
          repository:"iam-console-poc"}
      });
      const pins={
        repository:{authority:"gitea.local",owner:"thesis",
          repository:"iam-console-poc"},
        branch,base_revision:fixture.mainSha,
        head_revision:fixture.featureSha
      };
      const observed=await reader.readPinnedFeatureDiff(pins);
      const changed=observed.changes.map(x=>x.path).sort();
      assert.deepEqual(changed,Object.keys(referenceFiles).sort(),
        "Comparison metadata must enumerate the exact fixture code changes");
      assert.ok(observed.changes.every(x=>
        ["added","modified","deleted"].includes(x.change)));
      assert.equal(observed.base_revision,fixture.mainSha);
      assert.equal(observed.head_revision,fixture.featureSha);
      assert.equal(observed.branch,branch);
      // A stale or unobserved feature head must fail WITHOUT reading diff,
      // even if the old session has previously been revoked.
      await assert.rejects(reader.readPinnedFeatureDiff({
        ...pins,head_revision:"f".repeat(40)
      }),/old feature branch changed during pinned audit/);
      const [mainAfter,featureAfter]=await Promise.all([
        api(base,repository+"/branches/main",{
          authorization:creds.admin,label:"r45_check_unchanged_main"
        }),
        api(base,repository+"/branches/"+encodeURIComponent(branch),{
          authorization:creds.admin,label:"r45_check_unchanged_feature"
        })
      ]);
      assert.equal(mainAfter.commit.id,fixture.mainSha);
      assert.equal(featureAfter.commit.id,fixture.featureSha);
      return Object.freeze({main:observed.base_revision,
        head:observed.head_revision,changed_files:changed.length});
    },45000);
    process.stderr.write("[trusted-positive-ci] r45_real_gitea_prior_diff "+
      JSON.stringify({status:"PASS",exact_sha:true,
        source_exposed:false,changed_files:priorDiff.changed_files,
        main_unchanged:true,feature_unchanged:true})+"\n");
    if(process.env.APPROVED_RUNNER_NATIVE_EVM==="1"){
      // Additional ADK+Gitea probe, strictly NOT a Rust/Gateway authority test.
      const receipt=await stage("source_derived_adk_real_gitea_no_golden",
        ()=>runSourceDerivedGiteaAdkProbe({
          baseUrl:base,readToken:creds.readToken,
          writeToken:creds.statusToken,pinnedMainSha:fixture.mainSha
        }),90000);
      assert.equal(receipt.gitea_provider_committed,true);
      assert.equal(receipt.source_derived_tool_output,true);
      assert.equal(receipt.main_unchanged,true);
      assert.equal(receipt.signed_gateway_credential_e2e,false);
      process.stderr.write("[trusted-positive-ci] source_derived_probe "+
        JSON.stringify(receipt)+"\n");
    }
    if(process.env.APPROVED_RUNNER_NATIVE_EVM==="1"&&
       scenario.id==="department-directory"){
      const f1=await stage("f1_gitea_pinned_unsolved_main",
        ()=>inspectF1RealGiteaPlannerReadiness({
          baseUrl:base,readToken:creds.readToken,
          expectedMainSha:fixture.mainSha
        }),60000);
      assert.equal(f1.verified_source_files,4);
      assert.equal(f1.provider_model_inference_calls,0);
      process.stderr.write("[trusted-positive-ci] f1_real_gitea_baseline "+
        JSON.stringify(f1)+"\n");
      const port=await stage("f1_gitea_full_readonly_research_snapshot",
        ()=>buildF1RealGiteaResearchPlanningPort({
          baseUrl:base,readToken:creds.readToken,
          expectedMainSha:fixture.mainSha,
          sessionId:"f1_readonly_"+fixture.mainSha.slice(0,12)
        }),75000);
      assert.equal(port.production_gateway_vp_opa_verification,false);
      assert.equal(port.snapshot.base_revision,fixture.mainSha);
      assert.ok(port.snapshot.files.length>=4);
      const observed=await port.readPort.invoke("read_file",{
        branch:"main",path:"apps/backend/src/users/user.routes.ts"
      });
      assert.equal(observed.revision,fixture.mainSha);
      assert.ok(observed.content.includes('router.get("/:id"'));
      process.stderr.write("[trusted-positive-ci] f1_real_gitea_read_port "+
        JSON.stringify({status:"PASS",base_revision:fixture.mainSha,
          discovered_files:port.snapshot.files.length,
          discovered_directories:port.snapshot.directories.length,
          pinned_source_read:true,model_calls:0,
          native_gateway_attested_by_this_port:false})+"\n");
      // Exercise the ACTUAL operator probe code without Gemini inference,
      // writing a plan, exporting credentials or provider billing.
      const dry=await stage("f1_real_gitea_gemini_probe_dry_run",
        ()=>runF1RealGiteaGeminiResearch({
          flag:"--dry-run",baseUrl:base,readToken:creds.readToken,
          expectedMainSha:fixture.mainSha,githubActions:"true"
        }),90000);
      assert.equal(dry.status,"f1_ready_without_inference");
      assert.equal(dry.source_revision,fixture.mainSha);
      assert.equal(dry.billable_model_inference,false);
      assert.equal(dry.execution_permitted,false);
      process.stderr.write("[trusted-positive-ci] f1_gemini_probe_dry_run "+
        JSON.stringify({status:"PASS",
          base_revision:dry.source_revision,
          source_kind:dry.source_kind,
          discovered_files:dry.files_available,
          model_calls:0,billable_model_inference:false,
          execution_permitted:false})+"\n");
      // The REAL ADK Runner, proposal compiler, and feasibility rubric
      // use actual Gitea reads. The BaseLlm is a SCRIPTED TEST MODEL.
      // No paid Gemini inference, credential or auto-approval occurs.
      const adk=await stage("f1_actual_adk_planner_scripted_on_real_gitea",
        ()=>rehearseF1RealGiteaAdkPlanning({
          baseUrl:base,readToken:creds.readToken,
          expectedMainSha:fixture.mainSha,
          sessionId:"f1_adk_"+fixture.mainSha.slice(0,12)
        }),120000);
      assert.equal(adk.scripted_model_only,true);
      assert.equal(adk.real_gemini_calls,0);
      assert.equal(adk.technical_preflight_pass,true);
      process.stderr.write("[trusted-positive-ci] f1_real_gitea_adk_rehearsal "+
        JSON.stringify(adk)+"\n");
    }
    if(process.env.APPROVED_RUNNER_NATIVE_EVM==="1"){
      const realGeminiPilot=process.env.DELEGATION_SIGNED_GEMINI_PILOT==="1";
      const typecheckProbe=
        process.env.APPROVED_RUNNER_SIGNED_DAG_TYPECHECK_PROBE==="1";
      if(typecheckProbe&&(realGeminiPilot||
         process.env.APPROVED_RUNNER_THREE_AGENT_DAG!=="1"||
         process.env.APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS!=="1"))
        throw Error("Typecheck probe requires scripted signed-DAG fixture");
      // Reuse this same disposable Gitea. Read-only PAT, actual main SHA,
      // real Rust/EVM root, native Core verifier, and independent OPA.
      // Running before A2A file writes makes the immutable feature SHA
      // comparison meaningful; this Planning test creates no approvals.
      await stage("native_preliminary_planning_real_disposable_gitea",async()=>{
        const planningScript=fileURLToPath(new URL(
          "../../gateway/native-test/native-planning-read-core-evm-e2e.mjs",
          import.meta.url
        ));
        const output=execFileSync(process.execPath,[
          "--experimental-strip-types",planningScript
        ],{
          cwd:process.cwd(),encoding:"utf8",timeout:180000,
          env:{...process.env,
            OPA_URL:opaBaseUrl,
            PLANNING_DISPOSABLE_GITEA_URL:base,
            PLANNING_DISPOSABLE_GITEA_READ_TOKEN:creds.readToken,
            PLANNING_DISPOSABLE_GITEA_MAIN_SHA:fixture.mainSha,
            PLANNING_NATIVE_SIGNED_HANDOFF:"1",
            // No source fault probe during the PRE-activation read-only phase.
            // Its flag belongs solely to the later signed operational DAG.
            APPROVED_RUNNER_SIGNED_DAG_TYPECHECK_PROBE:"0",
            // The earlier denial-only rehearsal NEVER consumes Gemini calls.
            DELEGATION_SIGNED_GEMINI_PILOT:"0"
          }
        });
        const result=output.split(/\r?\n/u).filter(Boolean)
          .map(line=>{try{return JSON.parse(line);}catch{return null;}})
          .find(event=>event?.event==="native_preliminary_adk_planning");
        assert.equal(result?.status,"pass");
        assert.equal(result?.real_disposable_gitea_pinned_reads,true);
        assert.equal(result?.real_gitea_main_unchanged,true);
        assert.equal(result?.native_rust_vp_verified,true);
        assert.equal(result?.independent_revocation_denial,true);
        assert.equal(result?.approval_created,true);
        assert.equal(result?.signed_ed25519_fixture,true);
        assert.equal(result?.native_operational_root_and_activation,true);
        assert.equal(result?.operational_root_closed,true);
        assert.equal(result?.dispatcher_bound_signed_dag,true);
        assert.equal(result?.dispatcher_stopped_before_a2a_on_provider_denial,true);
        assert.equal(result?.a2a_tasks_dispatched,0);
        assert.equal(result?.child_dc_issued,0);
        assert.equal(result?.real_provider_mutations,0);
        assert.equal(result?.provider_writes,0);
        let positiveOutput;
        try{
          positiveOutput=execFileSync(process.execPath,[
            "--experimental-strip-types",planningScript
          ],{
          cwd:process.cwd(),encoding:"utf8",
          timeout:realGeminiPilot?3600000:980000,
          maxBuffer:2*1024*1024,
          env:{...process.env,
            OPA_URL:opaBaseUrl,
            PLANNING_DISPOSABLE_GITEA_URL:base,
            PLANNING_DISPOSABLE_GITEA_READ_TOKEN:creds.readToken,
            PLANNING_DISPOSABLE_GITEA_WRITE_TOKEN:creds.statusToken,
            PLANNING_DISPOSABLE_GITEA_MAIN_SHA:fixture.mainSha,
            PLANNING_NATIVE_SIGNED_HANDOFF:"1",
            PLANNING_NATIVE_POSITIVE_DAG:"1",
            // Same real Gitea/Docker/Rust/OPA positive DAG, but all
            // model-facing tools and VP issuance now use shared MCP.
            APPROVED_RUNNER_NATIVE_MCP:"1",
            APPROVED_RUNNER_SCENARIO:scenario.id
          }
          });
        }catch(error){
          // The child may report a real Docker project-test failure and
          // then the A2A handler correctly denies signed DAG completion.
          // NEVER echo raw child stderr/stdout: source, tokens and model
          // inputs may be present in untrusted logs. Only fixed phase
          // names and success/failure enums may cross this CI boundary.
          const evidence=safeNativeDockerFailureDiagnostic(error?.stderr);
          // Expose only a bounded source location from our fixed offline
          // harness files; never publish child stderr, source, credentials,
          // arbitrary assertion text or provider responses.
          const childStderr=Buffer.isBuffer(error?.stderr)?
            error.stderr.toString("utf8"):
            typeof error?.stderr==="string"?error.stderr:"";
          if(realGeminiPilot){
            // Re-emit only bounded, parsed usage observations: no raw stdout.
            for(const event of safeGeminiPilotChildObservations(error?.stdout))
              process.stderr.write((event.event==="adk_llm_timing"
                ?"":"[signed-gemini-pilot] ")+JSON.stringify(event)+"\n");
            // Strict, fixed-category tool and model failures only.
            for(const part of [error?.stdout,error?.stderr])
              for(const event of safeGeminiPilotAgentObservations(part))
                process.stderr.write(
                  "[trusted-positive-ci] gemini_agent_observation "+
                  JSON.stringify(event)+"\n");
          }
          const locationMatch=childStderr.slice(-262144).match(
            /(?:^|[\\/])(native-approved-planner-dag-positive|native-planning-read-core-evm-e2e)\.mjs:(\d{1,4}):\d{1,4}/u);
          const locationLine=Number(locationMatch?.[2]);
          const offlineLocation=locationMatch&&locationLine>0&&
            locationLine<2000
            ?{module:locationMatch[1],line:locationLine}:null;
          // Allow only recognized Task IDs and fixed failure categories out
          // of the native signed multi-Test harness. No provider messages.
          let multiTestDiagnostic=null;
          const diagnosticPrefix="[native-dag-adk] multi_test_safe_diagnostic ";
          for(const line of childStderr.slice(-262144).split(/\r?\n/u)
            .filter(line=>line.startsWith(diagnosticPrefix)&&line.length<4096)
            .reverse()){
            try{
              const event=JSON.parse(line.slice(diagnosticPrefix.length));
              const ids=["branch","backend","frontend","test-preparation","test","pr"];
              const categories=[
                "a2a_task_not_completed","a2a_artifact_invalid","controlled_tool_failure","no_confirmed_revision","a2a_dispatch_failed","orchestrator_task_failed",
                "root_revocation_unconfirmed","dependency_denied",
                "adk_model_failure","a2a_result_mismatch",
                "attestation_effect_race","approved_plan_denied",
                "test_assertion","unclassified"
              ];
              const validIds=value=>Array.isArray(value)&&value.length<=6&&
                value.every(id=>ids.includes(id));
              if(!validIds(event.completed_task_ids)||
                 !validIds(event.issued_task_ids)||
                 !categories.includes(event.category)||
                 !categories.includes(event.cause_category)||
                 !Number.isSafeInteger(event.runner_runs)||
                 event.runner_runs<0||event.runner_runs>2||
                 !Number.isSafeInteger(event.signed_test_write_count)||
                 event.signed_test_write_count<0||
                 event.signed_test_write_count>4)continue;
              // R116 second sanitization boundary. Child stderr can
              // contain model text; never forward arbitrary extra keys.
              const phases=new Set(["none","dependency_install","typecheck",
                "backend_tests","frontend_tests","build","playwright_e2e",
                "researcher_acceptance"]);
              const statuses=new Set(["pass","fail","unknown"]);
              const safeSites=new Set([
                "native-approved-planner-dag-positive.mjs",
                "trusted-approved-a2a-dispatcher.ts","a2a-workflow.ts",
                "orchestrator.ts","executor.ts","adk-a2a-handler.ts",
                "artifact-validation.ts","private-request-handler.ts",
                "gateway-tool-client.ts","adk-tool-progress.ts",
                "approved-execution-plans.ts","runtime.ts","execute.ts",
                "runner-client.ts","isolated-executor.ts",
                "native-approved-dag-failure-category.mjs"
              ]);
              const safeKinds=new Set(["Error","AssertionError","TypeError",
                "RangeError","SyntaxError","AbortError","TimeoutError",
                "AggregateError","unknown"]);
              const safeCodes=new Set(["ERR_ASSERTION","approved_plan_denied",
                "ERR_INVALID_ARG_TYPE","ERR_HTTP_HEADERS_SENT",
                "ECONNRESET","ETIMEDOUT","ECONNREFUSED","ABORT_ERR",
                "ERR_INVALID_STATE","unknown"]);
              const trace=Array.isArray(event.failure_trace)&&
                event.failure_trace.length<=4&&
                event.failure_trace.every(item=>
                  item&&typeof item==="object"&&
                  categories.includes(item.category)&&
                  safeKinds.has(item.kind)&&safeCodes.has(item.code)&&
                  (item.site===null||
                   (item.site&&safeSites.has(item.site.module)&&
                    Number.isSafeInteger(item.site.line)&&
                    item.site.line>0&&item.site.line<=2500)))
                ?event.failure_trace.map(item=>({
                  category:item.category,kind:item.kind,code:item.code,
                  site:item.site===null?null:{
                    module:item.site.module,line:item.site.line
                  }
                })):null;
              multiTestDiagnostic={
                completed_task_ids:[...event.completed_task_ids],
                issued_task_ids:[...event.issued_task_ids],
                category:event.category,
                cause_category:event.cause_category,
                runner_runs:event.runner_runs,
                signed_test_write_count:event.signed_test_write_count,
                runner_status:statuses.has(event.runner_status)
                  ?event.runner_status:"unknown",
                runner_project_status:statuses.has(event.runner_project_status)
                  ?event.runner_project_status:"unknown",
                first_failed_phase:phases.has(event.first_failed_phase)
                  ?event.first_failed_phase:"none",
                ...(trace?{failure_trace:trace}:{})
              };
              break;
            }catch{/* never print untrusted stderr */}
          }
          // Child errors are untrusted. Only known enum fields and integers
          // from our own signed-gemini-pilot marker may cross this boundary.
          let geminiDiagnostic=null;
          if(realGeminiPilot){
            const raw=Buffer.isBuffer(error?.stderr)?
              error.stderr.toString("utf8"):
              typeof error?.stderr==="string"?error.stderr:"";
            const prefix="[signed-gemini-pilot] ";
            const matches=raw.slice(-262144).split(/\r?\n/u)
              .filter(line=>line.startsWith(prefix)&&line.length<1024);
            for(const line of matches.reverse()){
              try{
                const item=JSON.parse(line.slice(prefix.length));
                if(["setup","gemini_planning","gemini_plan_proposed",
                  "signed_test_review","activation_dc_vp",
                  "delegated_agents_gitea_docker","complete"].includes(item.stage)&&
                   ["test_assertion","planner_contract_rejected",
                    "model_provider_failure","unclassified_failure"]
                    .includes(item.category)&&
                   ["none","authentication","permission_or_billing",
                    "quota_or_rate_limit","model_or_endpoint_not_found",
                    "invalid_request_or_tool_schema","provider_server_error",
                    "transport_or_timeout","unknown"]
                    .includes(item.model_failure)&&
                   Number.isSafeInteger(item.model_turns_started)&&
                   item.model_turns_started>=0&&
                   item.model_turns_started<=20){
                  const site=item.assertion_location;
                  const location=site&&
                    ["signed_dag_harness","planning_harness"].includes(site.module)&&
                    Number.isSafeInteger(site.line)&&
                    site.line>0&&site.line<2000
                      ?{module:site.module,line:site.line}:null;
                  const safePlanningReasons=[
                      "ungrounded_or_missing_output","invalid_json",
                      "invalid_proposal_shape","invalid_task_count",
                      "invalid_task_identity","unsupported_agent_role",
                      "unsupported_tool_for_role","unauthorized_existing_file",
                      "unauthorized_new_file","invalid_path",
                      "invalid_permission_path","missing_branch_task",
                      "missing_branch_dependency","conflicting_unordered_writes",
                      "duplicate_task_permission","incorrect_work_branch",
                      "invalid_dependencies","invalid_permissions",
                      "execution_dag_incompatible",
                      "contract_validation_other"
                    ];
                  const rejection=item.planning_rejection;
                  const planningRejection=rejection&&
                    ["grounding","json","contract"].includes(rejection.stage)&&
                    safePlanningReasons.includes(rejection.reason)
                      ?{stage:rejection.stage,reason:rejection.reason}:null;
                  const taskCounts=item.approved_task_counts;
                  const roles=["orchestrator","backend","frontend","test"];
                  const validCounts=taskCounts&&
                    typeof taskCounts==="object"&&!Array.isArray(taskCounts)&&
                    Object.keys(taskCounts).length===roles.length&&
                    roles.every(role=>Number.isSafeInteger(taskCounts[role])&&
                      taskCounts[role]>=0&&taskCounts[role]<=12)&&
                    roles.reduce((n,role)=>n+taskCounts[role],0)<=12;
                  geminiDiagnostic={
                    stage:item.stage,category:item.category,
                    ...(validCounts?{approved_task_counts:Object.fromEntries(
                      roles.map(role=>[role,taskCounts[role]])
                    )}:{}),
                    model_failure:item.model_failure,
                    model_turns_started:item.model_turns_started,
                    ...(["not_started","model_binding","dag_preflight","baseline_reads","agent_bootstrap","dispatcher_setup","a2a_dispatch","result_verification"].includes(item.delegated_phase)
                      ?{delegated_phase:item.delegated_phase}:{}),
                    ...(["none","a2a_task_not_completed","a2a_artifact_invalid","controlled_tool_failure","no_confirmed_revision","a2a_dispatch_failed","orchestrator_task_failed","root_revocation_unconfirmed","dependency_denied","adk_model_failure","a2a_result_mismatch","attestation_effect_race","approved_plan_denied","test_assertion","unclassified"].includes(item.delegated_failure)
                      ?{delegated_failure:item.delegated_failure}:{}),
                    ...(location?{assertion_location:location}:{}),
                    ...(planningRejection
                      ?{planning_rejection:planningRejection}:{})
                  };
                  break;
                }
              }catch{/* never print untrusted child stderr */}
            }
          }
          process.stderr.write("[trusted-positive-ci] native_dag_failure "+
            JSON.stringify({
              stage:"signed_dag_disposable_docker_acceptance",
              ...(evidence??{diagnosis:"no_structured_phase_status"}),
              ...(offlineLocation?{assertion_location:offlineLocation}:{}),
              ...(multiTestDiagnostic?{multi_test_diagnostic:multiTestDiagnostic}:{}),
              ...(geminiDiagnostic?{gemini_pilot_diagnostic:geminiDiagnostic}:{}),
              signed_dag_completed:false,
              permissions_bypassed:false
            })+"\n");
          throw Error("Native signed DAG failed; Docker phase evidence required");
        }
        const positive=positiveOutput.split(/\r?\n/u).filter(Boolean)
          .map(line=>{try{return JSON.parse(line);}catch{return null;}})
          .find(event=>event?.event==="native_preliminary_adk_planning");
        assert.equal(positive?.status,"pass");
        if(typecheckProbe){
          const proof=positive?.positive_dag;
          assert.equal(proof?.typecheck_probe_verified,true);
          assert.equal(proof?.status,"expected_typecheck_failure");
          assert.equal(proof?.signed_dag_completed,false);
          assert.equal(proof?.first_failed_phase,"typecheck");
          assert.equal(proof?.project_tests,"fail");
          assert.equal(proof?.researcher_acceptance,"skipped");
          assert.equal(proof?.test_runner_runs,1);
          assert.equal(proof?.pr_created,false);
          assert.equal(proof?.merge_calls,0);
          assert.equal(proof?.main_unchanged,true);
          assert.equal(proof?.operational_root_revoked,true);
          assert.equal(proof?.signed_test_cross_role_gateway_denials,2,
            "Live Gateway must deny both Test cross-role file operations");
          assert.equal(proof?.typecheck_permission_scope_audit
            ?.within_operational_root_write,1);
          assert.equal(proof?.typecheck_permission_scope_audit
            ?.within_test_task_write,0);
          assert.equal(proof?.typecheck_permission_scope_audit
            ?.covered_by_backend_write,1);
          assert.equal(proof?.typecheck_revision_comparison
            ?.different_blob_from_base,1);
          assert.equal(proof?.typecheck_revision_comparison
            ?.backend_writes_observed,1);
          assert.equal(proof?.typecheck_repair_nomination?.backend_candidates,1);
          assert.equal(proof?.typecheck_repair_nomination
            ?.signed_task_review_required,true);
          assert.equal(proof?.typecheck_repair_nomination?.permissions_issued,false);
          assert.equal(proof?.typecheck_repair_nomination?.task_dispatched,false);
          assert.equal(proof?.typecheck_repair_nomination?.retry_started,false);
          process.stdout.write(JSON.stringify({
            event:"signed_typecheck_fault_probe",status:"PASS",
            docker_failure_observed:true,first_failed_phase:"typecheck",
            signed_parent_scope_verified:true,test_not_automatically_privileged:true,
            signed_test_cross_role_gateway_denials:2,
            backend_repair_candidate_requires_new_review:true,
            no_repair_dispatched:true,
            exact_revision_difference_verified:true,
            a2a_signed_dag_refused:true,operational_root_revoked:true,
            no_pr_created:true,gemini_calls:0
          })+"\n");
          return;
        }
        assert.equal(positive?.positive_dag?.signed_dag_completed,true);
        assert.equal(positive?.positive_dag?.retired_gateway_runner_proof_verified,
          true,"Exact-SHA provider success must survive signed Task retirement");
        assert.equal(positive?.positive_dag?.scenario_id,scenario.id);
        assert.equal(positive?.positive_dag?.approved_work_branch,
          scenario.workBranch);
        assert.equal(positive?.positive_dag?.approved_shared_mcp_enabled,true);
        // Signed-DAG inner evidence already ties MCP calls to actual
        // authorized operations. Live plans need not make 21 fixture calls.
        const minimumMcpRequests=realGeminiPilot?1:21;
        assert.ok(positive?.positive_dag?.shared_mcp_http_requests>=
          minimumMcpRequests);
        assert.ok(positive?.positive_dag?.private_crypto_mcp_http_requests>=
          minimumMcpRequests);
        assert.equal(positive?.positive_dag?.real_a2a_sdk,true);
        if(realGeminiPilot){
          // The real Planner can assign several Task IDs to one role.
          // Require one independent signed child DC per completed A2A Task,
          // not exactly one DC per role.
          const children=positive?.positive_dag?.native_rust_child_credentials;
          assert.ok(Number.isSafeInteger(children)&&children>=3&&children<=10);
          assert.equal(children,positive?.positive_dag?.a2a_tasks_dispatched);
        }else assert.equal(positive?.positive_dag?.native_rust_child_credentials,
          process.env.APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS==="1"?4:3);
        const split=process.env.APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS==="1";
        if(!realGeminiPilot)assert.deepEqual(
          positive?.positive_dag?.completed_task_ids,
          split?["branch","backend","frontend","test-preparation","test","pr"]
            :["branch","backend","frontend","test","pr"]);
        assert.equal(positive?.positive_dag?.multi_test_a2a_independent_authority_verified,
          split);
        const recovery=process.env.APPROVED_RUNNER_SIGNED_DAG_RECOVERY==="1";
        if(realGeminiPilot){
          const completedRuns=positive?.positive_dag?.test_runner_runs;
          assert.ok(Number.isSafeInteger(completedRuns)&&
            completedRuns>=1&&completedRuns<=6,
            "Live Gemini may recover after a real Docker FAIL");
        }else assert.equal(positive?.positive_dag?.test_runner_runs,
          recovery?2:1);
        assert.equal(positive?.positive_dag?.recovery_verified,recovery);
        if(recovery){
          assert.match(positive.positive_dag.failed_test_sha,/^[a-f0-9]{40}$/u);
          assert.notEqual(positive.positive_dag.failed_test_sha,
            positive.positive_dag.tested_commit_sha);
        }
        assert.equal(positive?.positive_dag?.project_tests,"pass");
        assert.equal(positive?.positive_dag?.researcher_acceptance,"pass");
        assert.equal(positive?.positive_dag?.tested_commit_sha,
          positive?.positive_dag?.approved_branch_sha);
        if(realGeminiPilot){
          assert.ok(positive?.positive_dag?.source_reads>0);
          assert.ok(positive?.positive_dag?.source_reads>=
            positive?.positive_dag?.source_writes);
        }else{
          assert.equal(positive?.positive_dag?.source_reads,recovery?11:10);
          assert.equal(positive?.positive_dag?.source_writes,recovery?11:10);
        }
        if(realGeminiPilot){
          const created=positive?.positive_dag?.created_test_files;
          // Real signed test Tasks may create more than the fixture's one file.
          assert.ok(Number.isSafeInteger(created)&&created>=0&&created<=16);
        }else assert.equal(positive?.positive_dag?.created_test_files,1);
        assert.equal(positive?.positive_dag?.adk_agents_executed,3);
        assert.equal(positive?.positive_dag?.scripted_adk_no_paid_model,
          !realGeminiPilot);
        const witnessMode=
          process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1";
        const routeMode=
          process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1"||
          witnessMode;
        assert.equal(positive?.positive_dag?.model_source,realGeminiPilot
          ? "real_gemini_four_models_signed_test_approval"
          : routeMode
            ? "host_supplied_source_derived_routes_with_remaining_fixtures"
            : witnessMode
              ? "host_supplied_hybrid_source_witness_and_fixture"
              : "host_supplied_scripted_tool_calls");
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_derived_functional_route_verified,routeMode);
        const expectedDerived=routeMode
          ?(scenario.id==="account-suspension"?4:1):0;
        if(!realGeminiPilot){
          assert.equal(positive?.positive_dag
            ?.source_derived_functional_file_count,expectedDerived);
          assert.equal(positive?.positive_dag
            ?.remaining_prepackaged_application_file_count,11-expectedDerived);
        }
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_derived_controller_verified,
          routeMode&&scenario.id==="account-suspension");
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_derived_status_verified,
          routeMode&&scenario.id==="account-suspension");
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_derived_frontend_api_verified,
          routeMode&&scenario.id==="account-suspension");
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_witnessed_native_dag_verified,witnessMode);
        if(!realGeminiPilot)assert.equal(positive?.positive_dag
          ?.source_witnessed_model_still_uses_fixture_code,witnessMode);
        assert.equal(positive?.positive_dag
          ?.fixture_scripted_payloads_reach_adk_runner,!realGeminiPilot);
        assert.equal(positive?.positive_dag
          ?.independent_model_software_output_verified,realGeminiPilot);
        if(!realGeminiPilot)assert.deepEqual(
          positive?.positive_dag?.adk_model_turns,
          {backend:13,frontend:9,test:split?9:recovery?8:3});
        assert.equal(positive?.positive_dag?.main_unchanged,true);
        assert.equal(positive?.positive_dag?.operational_root_revoked,true);
        assert.equal(positive?.positive_dag?.pr_created,true);
        assert.ok(Number.isSafeInteger(
          positive?.positive_dag?.pull_request_number));
        assert.equal(positive?.positive_dag?.merge_calls,0);
        nativePrEvidence=Object.freeze({
          branch:positive.positive_dag.approved_work_branch,
          sha:positive.positive_dag.approved_branch_sha,
          number:positive.positive_dag.pull_request_number,
          url:positive.positive_dag.pull_request_url
        });
        assert.equal(nativePrEvidence.branch,scenario.workBranch);
        assert.match(nativePrEvidence.sha,/^[a-f0-9]{40}$/u);
        assert.equal(positive.positive_dag.tested_commit_sha,nativePrEvidence.sha);
        assert.equal(positive?.provider_writes,realGeminiPilot
          ?positive.positive_dag.source_writes+
            positive.positive_dag.created_test_files:recovery?12:11);
        if(realGeminiPilot){
          // Explicit PILOT: Engineer test fixture, not genuine human approval.
          // No source, Gemini prompt, API secret, VP or tokens in the receipt.
          process.stdout.write(JSON.stringify({
            event:"gemini_signed_dag_pilot",status:"PASS",
            scenario_id:"account-suspension",
            model:"gemini-3.8-flash",four_real_models:true,
            approval:"signed_test_fixture_not_human",
            native_rust_and_opa:true,shared_mcp_crypto:true,
            gitea_commit_sha:positive.positive_dag.tested_commit_sha,
            docker_acceptance:positive.positive_dag.researcher_acceptance,
            pull_request:positive.positive_dag.pr_created,
            merged:false,main_unchanged:true,operational_root_revoked:true
          })+"\n");
          return;
        }
        process.stderr.write("[trusted-positive-ci] native_disposable_planning "+
          JSON.stringify({status:"PASS",real_gitea_sha:fixture.mainSha,
            native_rust:true,live_opa:true,signed_handoff:true,
            operational_root:true,dispatcher_fail_closed:true,
            signed_dag_positive:true,backend_frontend_a2a_updates:10,
            test_agent_created_e2e:1,
            signed_generic_adk_agents:3,
            // Role count is 3, but four independent Rust-signed A2A
            // Task dispatches are required in the multi-Test DAG.
            signed_dag_completed_task_ids:positive.positive_dag.completed_task_ids,
            a2a_tasks_dispatched:positive.positive_dag.a2a_tasks_dispatched,
            native_rust_child_credentials:
              positive.positive_dag.native_rust_child_credentials,
            test_runner_runs:positive.positive_dag.test_runner_runs,
            multi_test_a2a_independent_authority_verified:
              positive.positive_dag.multi_test_a2a_independent_authority_verified,
            test_cross_role_repair_denied:
              positive.positive_dag.test_cross_role_repair_denied,
            recovery_verified:positive.positive_dag.recovery_verified,
            failed_test_sha:positive.positive_dag.failed_test_sha,
            signed_dag_pr_commit_sha:positive.positive_dag.tested_commit_sha,
            signed_dag_pr_unmerged:positive.positive_dag.pr_created&&
              positive.positive_dag.merge_calls===0,
            host_supplied_adk_models:true,
            fixture_scripted_payloads_reach_adk_runner:true,
            independent_model_software_output_verified:false,
            same_signed_dag_docker_acceptance:true,
            source_derived_functional_route_verified:positive.positive_dag
              .source_derived_functional_route_verified,
            source_derived_functional_file_count:positive.positive_dag
              .source_derived_functional_file_count,
            source_derived_controller_verified:positive.positive_dag
              .source_derived_controller_verified,
            source_derived_status_verified:positive.positive_dag
              .source_derived_status_verified,
            source_derived_frontend_api_verified:positive.positive_dag
              .source_derived_frontend_api_verified,
            remaining_prepackaged_application_file_count:positive.positive_dag
              .remaining_prepackaged_application_file_count,
            source_witnessed_native_dag:positive.positive_dag
              .source_witnessed_native_dag_verified,
            source_witnessed_still_uses_fixture_code:positive.positive_dag
              .source_witnessed_model_still_uses_fixture_code,
            a2a_before_branch:0,main_mutations:0})+"\n");
      },realGeminiPilot?3700000:1020000);
      if(typecheckProbe)return; // Expected negative test; do not run positive PR CI.
      if(realGeminiPilot)return; // One Gemini E2E; skip additional scripted CI.
    }
    logs=await mkdtemp(join(tmpdir(),"thesis-positive-runner-"));
    const executor=new IsolatedDockerRunnerExecutor({
      gitea_base_url:base,gitea_owner:"thesis",
      gitea_repository:"iam-console-poc",
      gitea_token:creds.readToken,
      docker_image:nodeImage,phase_timeout_ms:300000,
      log_dir:logs,acceptance_enabled:true,
      acceptance_dir:acceptanceDir
    });
    // Engineer Ed25519 approval is verified by the Gateway plan registry.
    // One true Docker run is submitted THROUGH Gateway/real Gitea/HTTP Runner;
    // the resulting attested evidence is handed to the trusted CI publisher.
    approvedSession=await stage("activate_signed_gateway_test_task",()=>
      beginApprovedRealRunnerSession({
        giteaBaseUrl:base,giteaGatewayToken:creds.statusToken,
        giteaReadToken:creds.readToken,executor,
        mainSha:fixture.mainSha,featureSha:fixture.featureSha,
        opaBaseUrl
      }),30000);
    const approvedFeatureSha=approvedSession.request.commit_sha;
    if(process.env.APPROVED_RUNNER_THREE_AGENT_DAG==="1"){
      assert.equal(approvedSession.approvedBackendFrontendEdits,2,
        "Two Rust-scoped ADK source updates must complete before running tests");
      assert.notEqual(approvedFeatureSha,fixture.featureSha);
    }
    let observedRunnerResult=null;
    const ci=new TrustedGiteaSecurityCi({
      giteaBaseUrl:base,giteaReadToken:creds.readToken,
      giteaStatusToken:creds.statusToken,
      trustedStatusActor:creds.actor,
      approvedBranch:branch,
      runner:{
        async run(request){
          const result=await approvedSession.run(request);
          observedRunnerResult=result;
          process.stderr.write(JSON.stringify({
            event:"positive_runner_phase_results",
            status:result.status,
            project_tests:result.project_tests?.status,
            researcher_acceptance:result.researcher_acceptance?.status,
            phases:result.phases.map(p=>({
              phase:p.phase,status:p.status,errors:p.errors
            }))
          })+"\n");
          // Only a bounded, scrubbed diagnostic excerpt from the pinned
          // reference fixture; no full logs, repo content or auth headers.
          if(result.status!=="pass"){
            const id=/^runner-log:\/\/([a-f0-9-]{36})$/u
              .exec(String(result.log_reference??""))?.[1];
            if(id){
              const full=await readFile(join(logs,id+".log"),"utf8");
              const section=full.split("=== dependency_install ===")[1]??"";
              const excerpt=section.split(/\r?\n/u)
                .filter(line=>line.trim().length>0)
                .slice(-26).map(line=>{
                  let safe=line.replace(/[\x00-\x1f\x7f]/gu," ")
                    .slice(0,230)
                    .replace(/https?:\/\/[^\s"'<>]+/giu,"[remote-url]")
                    .replace(/(?:Basic|Bearer|token)\s+[A-Za-z0-9+/_=.-]+/giu,
                      "[REDACTED]");
                  for(const secret of [adminPassword,readerPass,publisherPass]){
                    if(secret)safe=safe.split(secret).join("[REDACTED]");
                  }
                  return safe;
                });
              process.stderr.write("[trusted-positive-ci] dependency_diagnostic "+
                JSON.stringify({line_count:section.split(/\r?\n/u).length,
                  tail:excerpt})+"\n");
            }
          }
          return result;
        }
      }
    });
    const exactRequest={
      request_id:approvedSession.request.request_id,
      repository:"gitea://gitea.local/thesis/iam-console-poc",
      branch,commit_sha:approvedFeatureSha,profile:"poc-default"
    };
    const verdict=await stage("real_docker_project_and_researcher_acceptance",
      ()=>ci.run(exactRequest),2400000);
    assert.equal(verdict.status,"success",
      "Real reference app tests/acceptance did not pass");
    assert.equal(observedRunnerResult?.status,"pass");
    assert.equal(approvedSession.observedPolicyVersion,
      "phase6-approved-branch-v2",
      "Real OPA must allow signed, bound Test Task before CI success");
    if(process.env.APPROVED_RUNNER_NATIVE_EVM==="1"){
      assert.equal(approvedSession.nativeCredentialVerified,true,
        "Positive Docker acceptance must use Rust Core verified signed Test VP");
    }
    assert.equal(approvedSession.completed,true,
      "Gateway must attest the actual Runner result before CI marks success");
    assert.match(approvedSession.observedA2ATaskId??"",/^[A-Za-z0-9_-]{8,}$/u,
      "The positive Test Task must have an actual A2A SDK Task ID");
    assert.equal(observedRunnerResult?.tested_commit_sha,approvedFeatureSha);
    assert.equal(observedRunnerResult?.project_tests?.status,"pass");
    assert.equal(observedRunnerResult?.researcher_acceptance?.status,"pass");
    assert.deepEqual(observedRunnerResult?.phases.map(x=>x.phase),
      [...TRUSTED_PROJECT_PHASES,"researcher_acceptance"]);
    assert.ok(observedRunnerResult.phases.every(x=>x.status==="pass"));
    const [main,feature,statuses,prs]=await Promise.all([
      api(base,repository+"/branches/main",{
        authorization:creds.admin,label:"verify_immutable_main"
      }),
      api(base,repository+"/branches/"+encodeURIComponent(branch),{
        authorization:creds.admin,label:"verify_exact_feature"
      }),
      api(base,repository+"/commits/"+approvedFeatureSha+
        "/statuses?limit=50",{
        authorization:"token "+creds.readToken,
        label:"read_real_security_statuses"
      }),
      api(base,repository+"/pulls?state=all",{
        authorization:creds.admin,label:"verify_signed_dag_pull_request"
      })
    ]);
    assert.equal(main.commit.id,fixture.mainSha);
    assert.equal(feature.commit.id,approvedFeatureSha);
    assert.ok(Array.isArray(statuses));
    const own=statuses.filter(s=>s.context===SECURITY_STATUS_CONTEXT);
    assert.equal(own.length,2,"Expected exactly pending then success");
    assert.ok(own.some(s=>s.status==="pending"));
    assert.ok(own.some(s=>s.status==="success"&&
      s.creator?.id===creds.actor.id&&s.creator?.login===creds.actor.login));
    assert.ok(!own.some(s=>s.status==="failure"||s.status==="error"));
    assert.ok(Array.isArray(prs));
    const signedDag=process.env.APPROVED_RUNNER_THREE_AGENT_DAG==="1";
    if(signedDag){
      assert.ok(nativePrEvidence,
        "Missing immutable native DAG PR evidence");
      assert.equal(prs.length,1,
        "Signed DAG must open one real PR after exact-SHA acceptance");
      const pr=prs[0];
      // The signed DAG and independent Security CI intentionally operate
      // on DIFFERENT feature branches. Do not compare the PR to the latter.
      assert.equal(pr.state,"open");
      assert.equal(pr.merged,false);
      assert.equal(pr.number,nativePrEvidence.number);
      assert.equal(pr.head?.ref,nativePrEvidence.branch);
      assert.equal(pr.head?.sha,nativePrEvidence.sha);
      assert.equal(pr.base?.ref,"main");
      if(nativePrEvidence.url!==null){
        assert.equal(pr.html_url,nativePrEvidence.url);
      }
      const nativeHead=await api(base,repository+"/branches/"+
        encodeURIComponent(nativePrEvidence.branch),{
          authorization:creds.admin,label:"verify_native_pr_exact_head"
        });
      assert.equal(nativeHead.commit.id,nativePrEvidence.sha);
      assert.equal(main.commit.id,fixture.mainSha);
    }else{
      assert.deepEqual(prs,[],
        "Non-DAG security regression must not create a PR");
    }
    process.stdout.write(JSON.stringify({
      event:"trusted_security_ci_real_docker_positive_acceptance",
      status:"PASS",scenario_id:scenario.id,
      source:"pinned_baseline_plus_phase10b_reference",
      baseline_sha:baseline,tested_commit_sha:approvedFeatureSha,
      exact_project_phases:TRUSTED_PROJECT_PHASES.length,
      project_tests:"pass",researcher_acceptance:"pass",
      security_context:SECURITY_STATUS_CONTEXT,
      gitea_statuses:["pending","success"],
      real_docker_runner:true,
      engineer_approval_ed25519:true,
      gateway_signed_test_task_completed:true,
      real_a2a_sdk_task_completed:true,
      real_opa_signed_plan_policy:true,
      native_rust_signed_child_and_vp:
        approvedSession.nativeCredentialVerified,
      runner_via_gateway_http:true,
      exact_provider_sha_correlated:true,
      real_backend_frontend_gitea_edits:approvedSession.approvedBackendFrontendEdits,
      native_approved_source_reads:process.env.APPROVED_RUNNER_THREE_AGENT_DAG==="1"
        ? 4 : 0,
      approval_created:true,pr_created:signedDag,
      pr_source:signedDag?"native_signed_dag":null,merge_calls:0,
      persistent_gitea_modified:false
    })+"\n");
  }finally{
    try{
      if(approvedSession)await approvedSession.close();
      stopOpa();
      if(logs)await rm(logs,{recursive:true,force:true});
      if(workRoot)await rm(workRoot,{recursive:true,force:true});
    }finally{
      if(containerStarted){stopDocker();containerStarted=false;}
    }
  }
}
try{
  await stage("complete_positive_security_ci_smoke",main,2700000);
}catch(error){
  process.stderr.write("[trusted-positive-ci] ERROR "+
    (error instanceof Error?error.message:"Unclassified failure")+"\n");
  process.exitCode=1;
}
