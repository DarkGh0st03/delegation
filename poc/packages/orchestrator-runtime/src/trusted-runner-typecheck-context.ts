import {readdir,lstat,readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {canonicalFileUri,canonicalRepositoryUri} from "../../../apps/gateway/src/canonical.ts";
import {extractTypecheckLocations,sanitizeTypecheckLocations} from "../../../apps/test-runner-controller/src/typecheck-diagnostics.ts";
const issued=new WeakSet<object>();
const deny=():never=>{throw Error("Private Runner typecheck context NO-GO");};
export interface TrustedRunnerTypecheckContext {
 readonly status:"private_runner_typecheck_original_read_scope";
 readonly tested_commit_sha:string;readonly branch:string;
 readonly causal_attribution:"not_established";
 readonly diagnostics:readonly Readonly<{role:string;resource:string;line:number;column:number;code:string;message:string;message_truncated:boolean}>[];
}
/** Owner-only view of the retained log. Hash consistency is not an independent
 * attestation: the Runner effect and original grants must be host-owned. No
 * public Runner result is expanded. Compiler output remains untrusted DATA. */
export async function loadTrustedRunnerTypecheckContext({directory,effect,repo,branch,approvedRows,rootPermissions,roles}:{directory?:string;effect:any;repo:any;branch:string;approvedRows:any[];rootPermissions:any[];roles:readonly string[]}):Promise<TrustedRunnerTypecheckContext|null>{
 if(!directory)return null;
 if(effect?.provider!=="runner"||effect.performed!==true||effect.tool!=="run_tests"||effect.status!=="fail"||effect.branch!==branch||effect.revision!==effect.tested_commit_sha||! /^[a-f0-9]{40}$/u.test(effect.tested_commit_sha??"")||! /^runner-log:\/\/[a-f0-9-]{36}$/u.test(effect.log_reference??"")||!Array.isArray(approvedRows)||!Array.isArray(rootPermissions)||!roles.length||roles.some(r=>!["backend","frontend","test"].includes(r)))deny();
 if(effect.phases?.find((p:any)=>p.status==="fail")?.phase!=="typecheck")return null;
 const locations=sanitizeTypecheckLocations(effect.typecheck_diagnostics);
 if(!locations.length)return null;
 const entries=await readdir(directory,{withFileTypes:true});if(entries.length>256)deny();
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
 if(selected.schema!=="runner-private-failure-v1"||selected.repository!==canonicalRepositoryUri(repo)||selected.branch!==branch||selected.tested_commit_sha!==effect.tested_commit_sha||selected.profile!=="poc-default"||selected.phases?.find((p:any)=>p.status==="fail")?.phase!=="typecheck")deny();
 const file=join(selectedDir,"runner.log"),stat=await lstat(file);if(!stat.isFile()||stat.size>20*1024*1024)deny();
 const bytes=await readFile(file);if(createHash("sha256").update(bytes).digest("hex")!==selected.log_sha256)deny();
 // Parse only the actual typecheck phase, never another phase's arbitrary log.
 const text=bytes.toString("utf8"),parts=text.split("=== typecheck ===\n");if(parts.length!==2)deny();
 const phase=parts[1]!.split(/^=== [a-z_]+ ===$/mu)[0]!.slice(0,100000);
 const diagnostics:TrustedRunnerTypecheckContext["diagnostics"][number][]=[];
 let banner="";
 for(const line of phase.split(/\r?\n/u).slice(0,1000)){
  if(/^> \S+@\S+ typecheck$/u.test(line))banner=line;
  const hit=/^(?:[^\r\n]{1,181}\([0-9]{1,6},[0-9]{1,5}\): error |[^\r\n]{1,181}:[0-9]{1,6}:[0-9]{1,5} - error )TS[0-9]{4,5}: (.+)$/u.exec(line);
  if(!hit)continue;
  const location=extractTypecheckLocations(banner+"\n"+line,"")[0];
  if(!location||!locations.some(x=>JSON.stringify(x)===JSON.stringify(location)))continue;
  const message=hit[1]!;if(/[\x00-\x1f\x7f]/u.test(message))continue;
  const resource=canonicalFileUri(repo,branch,location.path);
  for(const role of new Set(roles)){
   if(!approvedRows.some(g=>g.agent_id===role&&g.resource===resource&&g.operation==="read_file")||!rootPermissions.some(g=>g.resource===resource&&g.operation==="read_file"))continue;
   const row=Object.freeze({role,resource,line:location.line,column:location.column,code:location.code,message:message.slice(0,600),message_truncated:message.length>600});
   if(diagnostics.length>=8||Buffer.byteLength(JSON.stringify([...diagnostics,row]),"utf8")>6000)deny();
   diagnostics.push(row);
  }
 }
 if(!diagnostics.length)return null;
 const context=Object.freeze({status:"private_runner_typecheck_original_read_scope" as const,tested_commit_sha:effect.tested_commit_sha,branch,causal_attribution:"not_established" as const,diagnostics:Object.freeze(diagnostics)});
 issued.add(context);return context;
}
export function verifyTrustedRunnerTypecheckContext(value:unknown,sha:string,branch:string,roles:readonly string[]):TrustedRunnerTypecheckContext{
 if(!value||typeof value!=="object"||!issued.has(value))deny();
 const context=value as TrustedRunnerTypecheckContext;
 if(context.tested_commit_sha!==sha||context.branch!==branch||context.diagnostics.some(d=>!roles.includes(d.role)))deny();
 return context;
}
export function projectTrustedRunnerTypecheckForTask(value:unknown,sha:string,branch:string,role:string,grants:readonly {operation:string;resource:string}[]):TrustedRunnerTypecheckContext|null{
 const context=verifyTrustedRunnerTypecheckContext(value,sha,branch,[role]);
 const diagnostics=context.diagnostics.filter(d=>grants.some(g=>g.operation==="read_file"&&g.resource===d.resource));
 if(!diagnostics.length)return null;
 const scoped=Object.freeze({...context,diagnostics:Object.freeze(diagnostics)});issued.add(scoped);return scoped;
}
