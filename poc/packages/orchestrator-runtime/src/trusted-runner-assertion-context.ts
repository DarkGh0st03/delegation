import {readdir,lstat,readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {canonicalFileUri,canonicalRepositoryUri} from "../../../apps/gateway/src/canonical.ts";
import {sanitizeVitestFailureFiles} from "../../../apps/test-runner-controller/src/vitest-failure-files.ts";
const issued=new WeakSet<object>();
export interface TrustedRunnerAssertionContext {
 readonly status:"private_runner_assertions_original_read_scope";
 readonly tested_commit_sha:string;readonly branch:string;
 readonly causal_attribution:"not_established";
 readonly assertions:readonly Readonly<{role:string;resource:string;test_id:string;message:string}>[];
}
const deny=()=>{throw Error("Private Runner assertion context NO-GO");};
/** Host-only loader. Directory and Runner effect must come from the original
 * trusted host, never A2A/model input. Local manifests are not remote attestations.
 * Report text remains test-controlled data. No grant or execution is issued. */
export async function loadTrustedRunnerAssertionContext({directory,effect,repo,branch,
 approvedRows,rootPermissions,roles}:{directory?:string;effect:any;repo:any;branch:string;
 approvedRows:any[];rootPermissions:any[];roles:readonly string[]}):Promise<TrustedRunnerAssertionContext|null>{
 if(!directory)return null;
 const phase=effect?.phases?.find((p:any)=>p.status==="fail")?.phase;
 if(effect?.provider!=="runner"||effect.performed!==true||effect.tool!=="run_tests"||
    effect.status!=="fail"||effect.branch!==branch||effect.revision!==effect.tested_commit_sha||
    !/^[a-f0-9]{40}$/u.test(effect.tested_commit_sha??"")||
    !/^runner-log:\/\/[a-f0-9-]{36}$/u.test(effect.log_reference??"")||
    !Array.isArray(approvedRows)||!Array.isArray(rootPermissions)||
    !roles.length||roles.some(r=>!["backend","frontend","test"].includes(r)))deny();
 if(!["backend_tests","frontend_tests"].includes(phase))return null;
 const allowedFiles=sanitizeVitestFailureFiles(effect.failing_test_files,phase);
 const entries=await readdir(directory,{withFileTypes:true});
 if(entries.length>256)deny();
 let selected:any=null,selectedDir="";
 for(const entry of entries){
  if(!entry.isDirectory()||!/^failure-[A-Za-z0-9]+$/u.test(entry.name))continue;
  const path=join(directory,entry.name,"manifest.json"),stat=await lstat(path);
  if(!stat.isFile()||stat.size>512*1024)deny();
  let manifest:any;try{manifest=JSON.parse(await readFile(path,"utf8"));}catch{deny();}
  if(manifest.log_reference!==effect.log_reference)continue;
  if(selected)deny();selected=manifest;selectedDir=join(directory,entry.name);
 }
 if(!selected)return null;
 if(selected.schema!=="runner-private-failure-v1"||selected.repository!==canonicalRepositoryUri(repo)||
    selected.branch!==branch||selected.tested_commit_sha!==effect.tested_commit_sha||
    selected.phases?.find((p:any)=>p.status==="fail")?.phase!==phase)deny();
 const logStat=await lstat(join(selectedDir,"runner.log"));
 if(!logStat.isFile()||logStat.size>20*1024*1024)deny();
 const log=await readFile(join(selectedDir,"runner.log"));
 if(createHash("sha256").update(log).digest("hex")!==selected.log_sha256)deny();
 const report=selected.private_vitest_failure;
 if(report?.status!=="captured")return null;
 if(!Array.isArray(report.failures)||report.failures.length>16)deny();
 const assertions:Array<Readonly<{role:string;resource:string;test_id:string;message:string}>>=[];
 for(const failure of report.failures){
  if(!allowedFiles.includes(failure?.path))continue;
  const resource=canonicalFileUri(repo,branch,failure.path);
  for(const role of new Set(roles)){
   if(!approvedRows.some(g=>g.agent_id===role&&g.resource===resource&&g.operation==="read_file")||
      !rootPermissions.some(g=>g.resource===resource&&g.operation==="read_file"))continue;
   if(typeof failure.test_id!=="string"||failure.test_id.length>500||/[\r\n\0]/u.test(failure.test_id)||
      !Array.isArray(failure.failure_messages))continue;
   const first=failure.failure_messages[0];
   if(typeof first!=="string")continue;
   const message=first.split(/\r?\n/u)[0].replace(/\x1b\[[0-9;]*m/gu,"");
   if(!message.startsWith("AssertionError:")||message.length>600||message.includes("\0"))continue;
   const entry=Object.freeze({role,resource,test_id:failure.test_id,message});
   if(assertions.length<8&&Buffer.byteLength(JSON.stringify([...assertions,entry]),"utf8")<=6000)
    assertions.push(entry);
  }
 }
 if(!assertions.length)return null;
 const context=Object.freeze({status:"private_runner_assertions_original_read_scope" as const,
  tested_commit_sha:effect.tested_commit_sha,branch,causal_attribution:"not_established" as const,
  assertions:Object.freeze(assertions)});
 issued.add(context);return context;
}
export function verifyTrustedRunnerAssertionContext(value:unknown,sha:string,branch:string,
 roles:readonly string[]):TrustedRunnerAssertionContext{
 if(!value||typeof value!=="object"||!issued.has(value))deny();
 const context=value as TrustedRunnerAssertionContext;
 if(context.tested_commit_sha!==sha||context.branch!==branch||
    context.assertions.some(a=>!roles.includes(a.role)))deny();
 return context;
}

/** Narrow disclosure again at the actual newly admitted Task boundary. */
export function projectTrustedRunnerAssertionsForTask(value:unknown,sha:string,branch:string,
 role:string,grants:readonly {operation:string;resource:string}[]):TrustedRunnerAssertionContext|null{
 const context=verifyTrustedRunnerAssertionContext(value,sha,branch,[role]);
 const assertions=context.assertions.filter(a=>grants.some(g=>g.operation==="read_file"&&g.resource===a.resource));
 if(!assertions.length)return null;
 const projected=Object.freeze({...context,assertions:Object.freeze(assertions)});
 issued.add(projected);return projected;
}
