/**
 * REAL negative trusted-security-CI smoke (Docker + disposable Gitea).
 *
 * Runs IsolatedDockerRunnerExecutor with acceptance ENABLED and immutable
 * researcher-owned tests. The disposable repo intentionally omits npm's lock
 * file: the fixed dependency_install phase must fail. The trusted CI service
 * must publish pending -> failure on the exact tested SHA, NEVER success.
 *
 * No Gemini, no Rust credentials, no MCP, no production Gitea, PR or merge.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdtemp,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT} from "../src/trusted-security-ci.ts";

const suffix=randomBytes(6).toString("hex");
const dockerName="delegation-ci-security-smoke-"+suffix;
const image=process.env.GITEA_IMAGE??"docker.gitea.com/gitea:28.0.0";
const runnerImage=process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm";
const adminName=process.env.GITEA_ADMIN_USER;
const adminPassword=process.env.GITEA_ADMIN_PASSWORD;
if(!adminName||!adminPassword)throw Error("Source poc/infra/.env first");
const readerName="ci-reader-"+suffix;
const publisherName="trusted-ci-"+suffix;
const readerPassword=randomBytes(24).toString("hex");
const publisherPassword=randomBytes(24).toString("hex");
const repo="/api/v1/repos/thesis/iam-console-poc";
const branch="feature/account-suspension";
let giteaStarted=false;
/**
 * Use a referenced timer, not only AbortSignal.timeout (which can use an
 * unref'ed timer on Node 22). A truly unresolved Promise then fails with
 * a bounded, named diagnostic instead of exiting with top-level-await 13.
 * Labels are hard-coded, never derived from URLs, tokens or response bodies.
 */
async function stage(label,action,timeoutMs=30000){
  process.stderr.write("[trusted-ci-smoke] start "+label+"\n");
  let timer;
  try{
    const result=await Promise.race([
      Promise.resolve().then(action),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(
          "Timed out waiting for isolated CI stage: "+label
        )),timeoutMs);
      })
    ]);
    process.stderr.write("[trusted-ci-smoke] ok "+label+"\n");
    return result;
  }finally{
    if(timer!==undefined)clearTimeout(timer);
  }
}
function docker(args,label){
  try{return execFileSync("docker",args,{
    encoding:"utf8",timeout:120000,stdio:["ignore","pipe","pipe"]
  }).trim();}
  catch{throw Error("Isolated Docker operation failed: "+label);}
}
function stopDocker(){
  try{execFileSync("docker",["stop","--time","5",dockerName],{
    timeout:30000,stdio:"ignore"
  });}catch{/* a failed container might already be gone */}
}
for(const signal of ["SIGINT","SIGTERM"]){
  process.once(signal,()=>{
    if(giteaStarted)stopDocker();
    process.exitCode=130;
  });
}
function basic(u,p){return "Basic "+Buffer.from(u+":"+p).toString("base64");}
async function api(base,path,options={}){
  const {method="GET",body,authorization,expect=[200,201],label="Gitea request"}=options;
  // Stage covers both network response and JSON body materialization.
  return await stage("gitea_api_"+label,async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),16000);
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
      if(!expect.includes(response.status)){
        throw Error(label+" HTTP "+response.status);
      }
      return response.status===204?{}:await response.json();
    }finally{
      clearTimeout(timer);
    }
  },20000);
}
async function waitForGitea(base){
  for(let n=0;n<180;n++){
    try{
      const healthy=await stage("gitea_health_request",async()=>{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),1500);
        try{
          const r=await fetch(base+"/api/healthz",{
            signal:controller.signal
          });
          return r.ok;
        }finally{clearTimeout(timer);}
      },2500);
      if(healthy)return;
    }catch{}
    await sleep(500);
  }
  throw Error("Disposable Gitea did not become healthy");
}
function createUser(username,password,email,admin=false){
  docker(["exec","--user","1000:1000",dockerName,"gitea",
    "admin","user","create","--username",username,
    "--password",password,"--email",email+"@localhost.invalid",
    ...(admin?["--admin"]:[]),"--must-change-password=false"],
  "create disposable Gitea actor");
}
async function seed(base){
  createUser(adminName,adminPassword,"admin-"+suffix,true);
  createUser(readerName,readerPassword,"read-"+suffix);
  createUser(publisherName,publisherPassword,"publisher-"+suffix);
  const adminAuth=basic(adminName,adminPassword);
  await api(base,"/api/v1/orgs",{method:"POST",authorization:adminAuth,
    body:{username:"thesis",visibility:"private"},label:"create isolated org"});
  await api(base,"/api/v1/orgs/thesis/repos",{
    method:"POST",authorization:adminAuth,label:"create isolated repo",
    body:{name:"iam-console-poc",private:true,auto_init:true,
      default_branch:"main",readme:"Default"}
  });
  const original=await api(base,repo+"/branches/main",{
    authorization:adminAuth,label:"get isolated main"
  });
  const mainSha=original.commit?.id;
  assert.match(mainSha??"",/^[a-f0-9]{40}$/u);
  await api(base,repo+"/branches",{
    method:"POST",authorization:adminAuth,label:"create isolated branch",
    body:{new_branch_name:branch,old_branch_name:"main"}
  });
  const fixture=JSON.stringify({
    name:"trusted-ci-negative-fixture",version:"1.0.0",
    private:true,scripts:{typecheck:"echo unexpected"}
  },null,2)+"\n";
  await api(base,repo+"/contents/package.json",{
    method:"POST",authorization:adminAuth,label:"create missing-lockfile fixture",
    body:{branch,content:Buffer.from(fixture).toString("base64"),
      message:"fixture: dependency_install must fail npm ci"}
  });
  const feature=await api(base,repo+"/branches/"+
    encodeURIComponent(branch),{authorization:adminAuth});
  const featureSha=feature.commit?.id;
  assert.match(featureSha??"",/^[a-f0-9]{40}$/u);
  await api(base,repo+"/branch_protections",{
    method:"POST",authorization:adminAuth,label:"protect isolated main",
    body:{branch_name:"main",enable_push:false,enable_force_push:false,
      required_approvals:1,block_admin_merge_override:true,
      dismiss_stale_approvals:true,block_on_outdated_branch:true}
  });
  for(const [username,permission] of [[readerName,"read"],[publisherName,"write"]]){
    await api(base,repo+"/collaborators/"+username,{
      method:"PUT",authorization:adminAuth,expect:[204],
      label:"grant isolated CI role",body:{permission}
    });
  }
  const readAuth=basic(readerName,readerPassword);
  const publishAuth=basic(publisherName,publisherPassword);
  const [read,pub]=await Promise.all([
    api(base,"/api/v1/users/"+readerName+"/tokens",{
      method:"POST",authorization:readAuth,label:"create isolated read token",
      body:{name:"ci-reader-"+suffix,scopes:["read:repository","read:user"]}
    }),
    api(base,"/api/v1/users/"+publisherName+"/tokens",{
      method:"POST",authorization:publishAuth,label:"create isolated CI write token",
      body:{name:"security-ci-"+suffix,scopes:["write:repository","read:user"]}
    })
  ]);
  assert.ok(typeof read.sha1==="string"&&read.sha1.length>=20);
  assert.ok(typeof pub.sha1==="string"&&pub.sha1.length>=20);
  const actor=await api(base,"/api/v1/user",{
    authorization:"token "+pub.sha1,label:"resolve CI publisher identity"
  });
  assert.equal(actor.login,publisherName);
  assert.ok(Number.isSafeInteger(actor.id)&&actor.id>0);
  const access=await api(base,repo,{
    authorization:"token "+read.sha1,label:"check read-only CI reader"
  });
  assert.equal(access.full_name,"thesis/iam-console-poc");
  return {mainSha,featureSha,readToken:read.sha1,
    publisherToken:pub.sha1,actor:{id:actor.id,login:actor.login},adminAuth};
}
async function main(){
  const acceptanceDir=fileURLToPath(new URL(
    "../../../runner/acceptance/",import.meta.url
  ));
  const folder=await stage("acceptance_directory",()=>stat(acceptanceDir),10000);
  assert.ok(folder.isDirectory());
  // Never pull multi-GB images; fail early when not already available.
  docker(["image","inspect",image],"cached Gitea image");
  docker(["image","inspect",runnerImage],"cached Node Runner image");
  docker(["run","--rm","--detach","--name",dockerName,
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
    image],"create no-volume disposable Gitea");
  giteaStarted=true;
  let logs;
  try{
    const mapped=docker(["port",dockerName,"3000/tcp"],"Gitea bound port");
    const port=/127\.0\.0\.1:(\d+)/u.exec(mapped)?.[1];
    if(!port)throw Error("Gitea is not loopback-only");
    const base="http://127.0.0.1:"+port;
    await stage("disposable_gitea_ready",()=>waitForGitea(base),125000);
    const fixture=await stage("disposable_gitea_bootstrap",()=>seed(base),180000);
    logs=await stage("create_private_log_dir",
      ()=>mkdtemp(join(tmpdir(),"thesis-ci-smoke-logs-")),10000);
    const realRunner=new IsolatedDockerRunnerExecutor({
      gitea_base_url:base,gitea_owner:"thesis",
      gitea_repository:"iam-console-poc",
      gitea_token:fixture.readToken,
      docker_image:runnerImage,phase_timeout_ms:300000,
      log_dir:logs,acceptance_enabled:true,
      acceptance_dir:acceptanceDir
    });
    const ci=new TrustedGiteaSecurityCi({
      giteaBaseUrl:base,giteaReadToken:fixture.readToken,
      giteaStatusToken:fixture.publisherToken,
      trustedStatusActor:fixture.actor,
      runner:realRunner
    });
    const outcome=await stage("real_docker_runner_and_ci_status",()=>ci.run({
      request_id:"disposable-ci-"+randomUUID(),
      repository:"gitea://gitea.local/thesis/iam-console-poc",
      branch,commit_sha:fixture.featureSha,profile:"poc-default"
    }),360000);
    assert.equal(outcome.status,"failure",
      "Real negative Docker Runner was incorrectly marked success");
    assert.equal(outcome.tested_commit_sha,fixture.featureSha);
    assert.equal(outcome.context,SECURITY_STATUS_CONTEXT);
    const branchAfter=await api(base,repo+"/branches/"+
      encodeURIComponent(branch),{authorization:fixture.adminAuth});
    const mainAfter=await api(base,repo+"/branches/main",{
      authorization:fixture.adminAuth
    });
    assert.equal(branchAfter.commit.id,fixture.featureSha);
    assert.equal(mainAfter.commit.id,fixture.mainSha);
    const statuses=await api(base,repo+"/commits/"+
      fixture.featureSha+"/statuses?limit=50",{
        authorization:"token "+fixture.readToken,
        label:"list real trusted CI statuses"
      });
    assert.ok(Array.isArray(statuses));
    const own=statuses.filter(st=>st.context===SECURITY_STATUS_CONTEXT);
    assert.equal(own.length,2,"Expected exactly pending then failure status");
    assert.ok(own.some(st=>st.status==="pending"));
    assert.ok(own.some(st=>st.status==="failure"&&
      st.creator?.id===fixture.actor.id&&
      st.creator?.login===fixture.actor.login));
    assert.ok(!own.some(st=>st.status==="success"));
    const prs=await api(base,repo+"/pulls?state=all",{
      authorization:fixture.adminAuth
    });
    assert.deepEqual(prs,[],"CI may never create PR or merge");
    process.stdout.write(JSON.stringify({
      event:"trusted_security_ci_real_docker_negative_smoke",
      status:"PASS",runner:"real_isolated_docker",
      acceptance_enabled:true,
      tested_sha:fixture.featureSha,
      status_context:SECURITY_STATUS_CONTEXT,
      gitea_statuses:["pending","failure"],
      success_statuses:0,prs:0,merges:0,main_unchanged:true,
      disposable_gitea_only:true
    })+"\n");
  }finally{
    // Do not leave a disposable container running if temp-log cleanup stalls.
    try{
      if(logs){
        await stage("remove_private_log_dir",
          ()=>rm(logs,{recursive:true,force:true}),20000);
      }
    }finally{
      if(giteaStarted){stopDocker();giteaStarted=false;}
    }
  }
}
try{
  await stage("complete_disposable_security_ci_smoke",main,450000);
}catch(error){
  // Never print Gitea response bodies, credentials or command arguments.
  const message=error instanceof Error?error.message:"Unknown isolated CI error";
  process.stderr.write("[trusted-ci-smoke] ERROR "+message+"\n");
  process.exitCode=1;
}
