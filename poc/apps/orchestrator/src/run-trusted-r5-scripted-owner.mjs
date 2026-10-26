/**
 * Owner-only R5 Planning entrypoint. No paid provider, automatic Engineer
 * approval, GitHub dispatch or A2A execution. An input from GitHub is denied.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,normalize,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {prepareConfiguredR5ScriptedEngineerBootstrap}
  from "./trusted-engineer-service.mjs";

const SHA=/^[a-f0-9]{40}$/u;
function deny(){throw Error("R5 protected live owner input denied");}
function record(x){return !!x&&typeof x==="object"&&!Array.isArray(x);}
function exact(x,fields){
  return record(x)&&Object.keys(x).length===fields.length&&
    Object.keys(x).every(k=>fields.includes(k));
}
/** Read a bounded owner-only plain file. No symlink or group access. */
async function ownerText(path,maxBytes=32768){
  if(typeof path!=="string"||!isAbsolute(path)||
     normalize(path)!==path||resolve(path)!==path)
    deny();
  try{
    const directory=await lstat(dirname(path));
    if(!directory.isDirectory()||directory.isSymbolicLink()||
       (directory.mode&0o077)!==0||
       (process.getuid?.()!==undefined&&
        directory.uid!==process.getuid()))
      deny();
    const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const meta=await f.stat();
      if(!meta.isFile()||(meta.mode&0o077)!==0||
         (process.getuid?.()!==undefined&&
          meta.uid!==process.getuid())||
         meta.size===0||meta.size>maxBytes)
        deny();
      return await f.readFile("utf8");
    }finally{await f.close();}
  }catch{deny();}
}
const OWNER_FIELDS=["profile","snapshot","preliminaryRoot","edits",
  "newTestFile","requirement","planId","agents","gatewayBaseUrl",
  "backendPrivateKeyFile"];
/**
 * Strict owner file; the Backend Ed25519 private key is in its own 0600
 * file and is never included in JSON, model prompts or routine log output.
 */
export async function loadProtectedR5ScriptedOwnerInput(inputFile){
  let input;
  try{input=JSON.parse(await ownerText(inputFile));}catch{deny();}
  if(!exact(input,OWNER_FIELDS)||
     input.profile!=="scripted_offline"||
     !exact(input.snapshot,["session_id","repository",
       "base_revision","directories","files"])||
     !exact(input.preliminaryRoot,["credential_id","valid_from",
       "validity_seconds","credential_status"])||
     !exact(input.edits,["backend","frontend"])||
     !exact(input.agents,["backend","frontend","test"])||
     !Array.isArray(input.snapshot.directories)||
     !Array.isArray(input.snapshot.files)||
     !Array.isArray(input.edits.backend)||
     !Array.isArray(input.edits.frontend)||
     typeof input.newTestFile!=="string"||
     typeof input.requirement!=="string"||
     typeof input.planId!=="string"||
     typeof input.gatewayBaseUrl!=="string"||
     input.backendPrivateKeyFile===inputFile)
    deny();
  const signer=await ownerText(input.backendPrivateKeyFile,8192);
  if(!signer.includes("BEGIN PRIVATE KEY"))deny();
  const {profile,backendPrivateKeyFile,...params}=input;
  return Object.freeze({...params,backendPrivateKeyPem:signer});
}

/**
 * Once the original Coordinator starts, failed attempts require durable
 * Gateway and native Adapter reconciliation; never simply retry the root.
 */
export async function startProtectedR5ScriptedOwnerSession({
  configPath,expectedSourceSha,inputFile
}={}){
  // Never start an Engineer signer, Coordinator or privileged listener
  // from a hosted/runner workflow; this is the separately owned host only.
  if(process.env.GITHUB_ACTIONS==="true"||
     !SHA.test(expectedSourceSha??""))deny();
  const prepared=await prepareConfiguredR5ScriptedEngineerBootstrap(
    configPath,{expectedSourceSha});
  const params=await loadProtectedR5ScriptedOwnerInput(inputFile);
  const assembly=await prepared.assemblePlanning(params);
  const host=await prepared.start(assembly.planning);
  return Object.freeze({
    host,coordinator:assembly.coordinator,
    status:"live_original_planning_for_human_review_not_r5_go",
    async close(){await host.close();}
  });
}

/** Standalone foreground process, only when explicitly invoked by owner. */
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  let active,startPromise,shutdownPromise,interrupted=false;
  async function stop(){
    if(shutdownPromise)return shutdownPromise;
    shutdownPromise=(async()=>{
      interrupted=true;
      try{await startPromise;}catch{}
      if(active)await active.close();
    })();
    return shutdownPromise;
  }
  for(const signal of ["SIGINT","SIGTERM"]){
    process.on(signal,()=>{
      void stop().then(()=>{process.exitCode=0;},()=>{
        process.stderr.write(
          "R5 owner shutdown/credential retirement unconfirmed; manual reconciliation required\n");
        process.exitCode=1;
      });
    });
  }
  startPromise=startProtectedR5ScriptedOwnerSession({
    configPath:process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,
    expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
    inputFile:process.env.DELEGATION_R5_OWNER_INPUT_FILE
  });
  try{
    active=await startPromise;
    if(interrupted)await stop();
    else process.stdout.write(
      "R5 original Planning staged for genuine Engineer review; "+
      "no GitHub OIDC, approved DAG or R5 GO established\n");
  }catch{
    process.stderr.write(
      "R5 owner startup denied; reconcile durable Gateway/Adapter before retry\n");
    process.exitCode=1;
  }
}
