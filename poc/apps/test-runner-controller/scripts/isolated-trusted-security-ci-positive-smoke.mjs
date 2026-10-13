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
 * This is a deterministic reference-fixture CI test, NOT an A2A Agent test,
 * not an LLM-generated implementation, and not a human approval/merge test.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,mkdtemp,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT,
  TRUSTED_PROJECT_PHASES} from "../src/trusted-security-ci.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../fixtures/account-suspension-reference.mjs";

const baseline="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const baselineSource="https://github.com/DarkGh0st03/iam-console-poc.git";
const branch="feature/account-suspension";
const repository="/api/v1/repos/thesis/iam-console-poc";
const suffix=randomBytes(6).toString("hex");
const container="delegation-ci-positive-"+suffix;
const image=process.env.GITEA_IMAGE??"docker.gitea.com/gitea:28.0.0";
const nodeImage=process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm";
const adminUser=process.env.GITEA_ADMIN_USER;
const adminPassword=process.env.GITEA_ADMIN_PASSWORD;
if(!adminUser||!adminPassword)throw Error("Source poc/infra/.env first");
const readerUser="ci-reader-"+suffix;
const publisherUser="ci-publisher-"+suffix;
const readerPass=randomBytes(24).toString("hex");
const publisherPass=randomBytes(24).toString("hex");
let containerStarted=false;

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
function stopDocker(){
  try{
    execFileSync("docker",["stop","--time","5",container],{
      timeout:30000,stdio:"ignore"
    });
  }catch{/* Already stopped or removed */}
}
for(const signal of ["SIGTERM","SIGINT"]){
  process.once(signal,()=>{
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
  const entries=Object.entries(ACCOUNT_SUSPENSION_REFERENCE_FILES);
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
    "commit","-m","fixture: complete Account Suspension reference implementation"
  ],{cwd:workTree,label:"commit isolated Account Suspension fixture"});
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
  let workRoot=null,logs=null;
  try{
    const portInfo=docker(["port",container,"3000/tcp"],
      "inspect disposable Gitea localhost port");
    const port=/127\.0\.0\.1:(\d+)/u.exec(portInfo)?.[1];
    if(!port)throw Error("Disposable Gitea not bound to loopback");
    const base="http://127.0.0.1:"+port;
    await stage("isolated_gitea_ready",()=>ready(base),125000);
    const creds=await stage("disposable_accounts",
      ()=>bootstrap(base),180000);
    workRoot=await mkdtemp(join(tmpdir(),"thesis-positive-acceptance-"));
    const workingDir=join(workRoot,"iam-console-poc");
    const fixture=await stage("commit_reference_implementation",
      ()=>pushReferenceApp(base,workingDir,
        basic(adminUser,adminPassword)),300000);
    logs=await mkdtemp(join(tmpdir(),"thesis-positive-runner-"));
    const executor=new IsolatedDockerRunnerExecutor({
      gitea_base_url:base,gitea_owner:"thesis",
      gitea_repository:"iam-console-poc",
      gitea_token:creds.readToken,
      docker_image:nodeImage,phase_timeout_ms:600000,
      log_dir:logs,acceptance_enabled:true,
      acceptance_dir:acceptanceDir
    });
    let observedRunnerResult=null;
    const ci=new TrustedGiteaSecurityCi({
      giteaBaseUrl:base,giteaReadToken:creds.readToken,
      giteaStatusToken:creds.statusToken,
      trustedStatusActor:creds.actor,
      runner:{
        async run(request){
          const result=await executor.run(request);
          observedRunnerResult=result;
          process.stderr.write(JSON.stringify({
            event:"positive_runner_phase_results",
            status:result.status,
            project_tests:result.project_tests?.status,
            researcher_acceptance:result.researcher_acceptance?.status,
            phases:result.phases.map(p=>({
              phase:p.phase,status:p.status
            }))
          })+"\n");
          return result;
        }
      }
    });
    const exactRequest={
      request_id:"isolated-positive-ci-"+randomUUID(),
      repository:"gitea://gitea.local/thesis/iam-console-poc",
      branch,commit_sha:fixture.featureSha,profile:"poc-default"
    };
    const verdict=await stage("real_docker_project_and_researcher_acceptance",
      ()=>ci.run(exactRequest),2400000);
    assert.equal(verdict.status,"success",
      "Real reference app tests/acceptance did not pass");
    assert.equal(observedRunnerResult?.status,"pass");
    assert.equal(observedRunnerResult?.tested_commit_sha,fixture.featureSha);
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
      api(base,repository+"/commits/"+fixture.featureSha+
        "/statuses?limit=50",{
        authorization:"token "+creds.readToken,
        label:"read_real_security_statuses"
      }),
      api(base,repository+"/pulls?state=all",{
        authorization:creds.admin,label:"check_zero_pull_requests"
      })
    ]);
    assert.equal(main.commit.id,fixture.mainSha);
    assert.equal(feature.commit.id,fixture.featureSha);
    assert.ok(Array.isArray(statuses));
    const own=statuses.filter(s=>s.context===SECURITY_STATUS_CONTEXT);
    assert.equal(own.length,2,"Expected exactly pending then success");
    assert.ok(own.some(s=>s.status==="pending"));
    assert.ok(own.some(s=>s.status==="success"&&
      s.creator?.id===creds.actor.id&&s.creator?.login===creds.actor.login));
    assert.ok(!own.some(s=>s.status==="failure"||s.status==="error"));
    assert.deepEqual(prs,[]);
    process.stdout.write(JSON.stringify({
      event:"trusted_security_ci_real_docker_positive_acceptance",
      status:"PASS",source:"pinned_baseline_plus_phase10b_reference",
      baseline_sha:baseline,tested_commit_sha:fixture.featureSha,
      exact_project_phases:TRUSTED_PROJECT_PHASES.length,
      project_tests:"pass",researcher_acceptance:"pass",
      security_context:SECURITY_STATUS_CONTEXT,
      gitea_statuses:["pending","success"],
      real_docker_runner:true,
      approval_created:false,pr_created:false,merge_calls:0,
      persistent_gitea_modified:false
    })+"\n");
  }finally{
    try{
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
