#!/usr/bin/env node
/**
 * F1 disposable localhost REAL Gitea owner session.
 *
 * --start: fresh Docker Gitea, pin UNSOLVED original public main, grant only
 * read:repository to a separate reader, verify F1 Planner --dry-run, save an
 * owner-private session. --check: verify same pinned main, no Gemini.
 * --stop: remove ONLY the exact Docker container with our session label.
 *
 * NEVER launches paid inference; the Gemini research CLI remains a distinct
 * explicit-consent action. This direct read is NOT Gateway/Rust/OPA Planning.
 */
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,mkdtemp,rm,open,lstat,readFile} from "node:fs/promises";
import {join,resolve,isAbsolute,normalize} from "node:path";
import {tmpdir} from "node:os";
import {setTimeout as sleep} from "node:timers/promises";
import {pathToFileURL} from "node:url";
import {runF1RealGiteaGeminiResearch,
  assertF1RealGeminiOperatorConsent}
  from "./f1-real-gitea-gemini-probe.mjs";

export const F1_ORIGINAL_SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const BASELINE="https://github.com/DarkGh0st03/iam-console-poc.git";
const IMAGE="docker.gitea.com/gitea:28.0.0";
const LABEL="org.delegation.f1.disposable";
const SESSION="owner-f1-disposable-real-gitea-v1";
const USER="f1-admin";
const READER="f1-read-only";
function deny(){throw Error("F1 disposable Gitea session NO-GO");}
function pinnedDir(path){
  if(typeof path!=="string"||!isAbsolute(path)||path.length>512||
     resolve(path)!==path||normalize(path)!==path||path==="/")deny();
  return path;
}
function command(tool,args,timeout=120000,env){
  try{
    return execFileSync(tool,args,{encoding:"utf8",timeout,
      env:env??process.env,stdio:["ignore","pipe","pipe"]}).trim();
  }catch{deny();}
}
async function json(base,path,{method="GET",authorization,body}={}){
  const resp=await fetch(base+path,{
    method,redirect:"error",signal:AbortSignal.timeout(15000),
    headers:{accept:"application/json",
      ...(authorization?{authorization}:{}),
      ...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  }).catch(()=>{deny();});
  if(![200,201,204].includes(resp.status))deny();
  if(resp.status===204)return {};
  const raw=await resp.text();
  if(raw.length>1024*1024)deny();
  try{return JSON.parse(raw);}catch{deny();}
}
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
async function waitReady(url){
  for(let i=0;i<180;i++){
    try{
      const r=await fetch(url+"/api/healthz",{
        redirect:"error",signal:AbortSignal.timeout(1200)
      });
      if(r.ok)return;
    }catch{/* Container starting */}
    await sleep(500);
  }
  deny();
}
function inspectContainer(id){
  if(!/^[a-f0-9]{64}$/u.test(id??""))deny();
  const raw=command("docker",["inspect","--format",
    "{{.Id}} {{index .Config.Labels \""+LABEL+"\"}}",id]);
  const match=/^([a-f0-9]{64}) ([a-f0-9]{32})$/u.exec(raw);
  if(!match||match[1]!==id)deny();
  return match[2];
}
async function inspectSession(dir){
  pinnedDir(dir);
  const stat=await lstat(dir).catch(()=>{deny();});
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o777)!==0o700||
     (process.getuid?.()!==undefined&&stat.uid!==process.getuid()))
    deny();
  const fd=await open(join(dir,"session.json"),
    (await import("node:fs")).constants.O_RDONLY|
    (await import("node:fs")).constants.O_NOFOLLOW).catch(()=>{deny();});
  let raw;
  try{
    const s=await fd.stat();
    if(!s.isFile()||s.nlink!==1||s.size>8192||
       (s.mode&0o777)!==0o600||
       (process.getuid?.()!==undefined&&s.uid!==process.getuid()))deny();
    raw=await fd.readFile("utf8");
  }finally{await fd.close();}
  let data;
  try{data=JSON.parse(raw);}catch{deny();}
  if(data.schema!==SESSION||data.source_sha!==F1_ORIGINAL_SHA||
     typeof data.read_token!=="string"||data.read_token.length<16||
     !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(data.url)||
     !/^[a-f0-9]{64}$/u.test(data.container_id)||
     !/^[a-f0-9]{32}$/u.test(data.container_nonce)||
     inspectContainer(data.container_id)!==data.container_nonce)
    deny();
  return data;
}
async function createSession(dir){
  pinnedDir(dir);
  // The operator's choice is a fresh directory; no overwrites or key reuse.
  await mkdir(dir,{mode:0o700,recursive:false}).catch(()=>{deny();});
  const nonce=randomBytes(16).toString("hex");
  const name="delegation-f1-"+nonce;
  const adminPass=randomBytes(24).toString("hex");
  const readerPass=randomBytes(24).toString("hex");
  let id=null,work=null;
  try{
    command("docker",["image","inspect",IMAGE]);
    id=command("docker",["run","--detach","--rm","--name",name,
      "--label",LABEL+"="+nonce,
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
      IMAGE]);
    if(inspectContainer(id)!==nonce)deny();
    const port=command("docker",["port",id,"3000/tcp"]);
    const match=/^127\.0\.0\.1:(\d+)$/u.exec(port);
    if(!match||Number(match[1])>65535)deny();
    const url="http://127.0.0.1:"+match[1];
    await waitReady(url);
    for(const [user,password,admin] of [
      [USER,adminPass,true],[READER,readerPass,false]
    ])command("docker",["exec","--user","1000:1000",id,"gitea",
      "admin","user","create","--username",user,"--password",password,
      "--email",user+"@localhost.invalid",
      ...(admin?["--admin"]:[]),"--must-change-password=false"]);
    const auth=basic(USER,adminPass);
    await json(url,"/api/v1/orgs",{
      authorization:auth,method:"POST",
      body:{username:"thesis",visibility:"private"}
    });
    await json(url,"/api/v1/orgs/thesis/repos",{
      authorization:auth,method:"POST",
      body:{name:"iam-console-poc",private:true,auto_init:false,
        default_branch:"main"}
    });
    await json(url,"/api/v1/repos/thesis/iam-console-poc/collaborators/"+READER,{
      method:"PUT",authorization:auth,body:{permission:"read"}
    });
    const token=await json(url,"/api/v1/users/"+READER+"/tokens",{
      authorization:basic(READER,readerPass),method:"POST",
      body:{name:"f1-reading-"+nonce,scopes:["read:repository","read:user"]}
    });
    if(typeof token.sha1!=="string"||token.sha1.length<20)deny();
    work=await mkdtemp(join(tmpdir(),"delegation-f1-original-"));
    const git=(args,env)=>command("git",args,180000,{
      ...process.env,GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never",
      GIT_ASKPASS:"",...(env??{})
    });
    const tree=join(work,"baseline");
    git(["clone","--single-branch","--branch",
      "baseline-before-account-suspension",BASELINE,tree]);
    if(git(["-C",tree,"rev-parse","HEAD"])!==F1_ORIGINAL_SHA)deny();
    git(["-C",tree,"branch","-M","main"]);
    const hostAuth={
      GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"http.extraheader",
      GIT_CONFIG_VALUE_0:"Authorization: "+auth
    };
    git(["-C",tree,"push",url+"/thesis/iam-console-poc.git",
      "HEAD:refs/heads/main"],hostAuth);
    let repoMeta=await json(url,"/api/v1/repos/thesis/iam-console-poc",{
      authorization:auth});
    if(repoMeta.empty){
      for(let i=0;i<40;i++){
        await sleep(500);
        repoMeta=await json(url,"/api/v1/repos/thesis/iam-console-poc",{
          authorization:auth});
        if(repoMeta.empty===false)break;
      }
      if(repoMeta.empty)deny();
    }
    const main=await json(url,
      "/api/v1/repos/thesis/iam-console-poc/branches/main",{
        authorization:auth});
    if(main.commit?.id!==F1_ORIGINAL_SHA)deny();
    const checked=await runF1RealGiteaGeminiResearch({
      flag:"--dry-run",baseUrl:url,readToken:token.sha1,
      expectedMainSha:F1_ORIGINAL_SHA
    });
    if(checked.status!=="f1_ready_without_inference"||
       checked.files_available<4||checked.billable_model_inference!==false)
      deny();
    const fd=await open(join(dir,"session.json"),"wx",0o600);
    try{await fd.writeFile(JSON.stringify({
      schema:SESSION,source_sha:F1_ORIGINAL_SHA,
      container_id:id,container_nonce:nonce,url,
      read_token:token.sha1
    },null,2)+"\n");}
    finally{await fd.close();}
    return {status:"f1_disposable_gitea_ready",
      baseline_sha:F1_ORIGINAL_SHA,
      files_readable:checked.files_available,
      model_calls:0,gemini_billing:false,
      engineering_approval:false,credential_issued:false,
      external_r5_go:false};
  }catch{
    if(id){
      try{if(inspectContainer(id)===nonce)
        command("docker",["stop","--time","5",id],30000);
      }catch{/* Best effort after bootstrap failure */}
    }
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
    deny();
  }finally{
    if(work)await rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}
export async function runF1OwnerGiteaSession({
  mode,sessionDirectory,
  apiKey,modelName,outputDir,consent,
  githubActions=process.env.GITHUB_ACTIONS
}={}){
  if(githubActions==="true"&&mode==="--execute")deny();
  // Auth is checked FIRST. An unapproved --execute must never read local
  // session secrets, make a Gitea request or contact Gemini.
  if(mode==="--execute"){
    assertF1RealGeminiOperatorConsent({
      flag:mode,apiKey,modelName,outputDir,consent,githubActions
    });
  }
  if(mode==="--start")return createSession(sessionDirectory);
  if(!["--check","--stop","--execute"].includes(mode))deny();
  const record=await inspectSession(sessionDirectory);
  if(mode==="--stop"){
    command("docker",["stop","--time","5",record.container_id],30000);
    await rm(sessionDirectory,{recursive:true,force:true});
    return {status:"f1_disposable_gitea_stopped",
      model_calls:0,external_r5_go:false};
  }
  if(mode==="--execute"){
    // The Gitea reader token stays in this owner-only process and is never
    // passed on the command line. This operation may incur charges ONLY
    // after a separately supplied literal billing consent.
    return runF1RealGiteaGeminiResearch({
      flag:"--execute",baseUrl:record.url,
      readToken:record.read_token,expectedMainSha:record.source_sha,
      apiKey,modelName,outputDir,consent,githubActions
    });
  }
  const dry=await runF1RealGiteaGeminiResearch({
    flag:"--dry-run",baseUrl:record.url,
    readToken:record.read_token,expectedMainSha:record.source_sha
  });
  if(dry.status!=="f1_ready_without_inference")deny();
  return {status:"f1_disposable_gitea_checked",
    baseline_sha:dry.source_revision,
    files_readable:dry.files_available,
    model_calls:0,gemini_billing:false,
    external_r5_go:false};
}
if(process.argv[1]&&import.meta.url===
  pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4)deny();
  runF1OwnerGiteaSession({
    mode:process.argv[2],sessionDirectory:process.argv[3],
    apiKey:process.env.GEMINI_API_KEY,
    modelName:process.env.DELEGATION_F1_GEMINI_MODEL,
    outputDir:process.env.DELEGATION_F1_OUTPUT_DIR,
    consent:process.env.DELEGATION_F1_BILLING_CONSENT
  }).then(report=>{
    process.stdout.write(JSON.stringify(report)+"\n");
  }).catch(()=>{
    // No passwords, bearer headers, source, paths or Docker diagnostics.
    process.stderr.write("F1 disposable Gitea session NO-GO\n");
    process.exitCode=1;
  });
}
