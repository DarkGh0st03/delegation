/**
 * F1 research-only real Gitea source discovery for a possible Gemini probe.
 *
 * Host-owned, read-only, SHA-pinned source port. This intentionally does NOT
 * implement native Rust preliminary DC / Gateway / OPA enforcement and must
 * never be described as the authenticated production Planning read port.
 * The approved production alternative is TrustedPlanningGatewayReadPort.
 *
 * An unsigned model PLAN is always an unapproved proposal, not authority.
 * No paid AI invocation happens here, and no model is imported.
 */
import {GiteaClient} from "../apps/gateway/src/gitea-client.ts";
import {inspectF1RealGiteaPlannerReadiness}
  from "./f1-real-gitea-planner-readiness.mjs";

const SHA=/^[a-f0-9]{40}$/u,SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOCAL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
function deny(message){throw Error("F1 real Gitea research Planning NO-GO: "+message);}
function canonicalPath(path,allowRoot=false){
  return typeof path==="string"&&path.length<=240&&
    (allowRoot&&path===""||
    !!path&&!path.startsWith("/")&&!path.endsWith("/")&&
    !path.includes("\\")&&!path.includes("%")&&!path.includes("//")&&
    path.split("/").every(x=>x&&x!=="."&&x!==".."&&
      !/[\x00-\x1f\x7f]/u.test(x)));
}
function exact(obj,fields){
  return obj&&typeof obj==="object"&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(",")===fields.slice().sort().join(",");
}

/** Discover the actual unsolved Gitea baseline before ANY model inference.
 * Model tools cannot add files/directories to this frozen session.
 * This port never receives write-scoped credentials.
 */
export async function buildF1RealGiteaResearchPlanningPort({
  baseUrl,readToken,expectedMainSha,sessionId,fetchFn=fetch
}={}){
  const localhost=typeof baseUrl==="string"?LOCAL.exec(baseUrl):null;
  if(!localhost||Number(localhost[1])>65535||
     !SHA.test(expectedMainSha??"")||
     !SESSION.test(sessionId??"")||
     typeof readToken!=="string"||readToken.trim().length<16||
     typeof fetchFn!=="function")
    deny("operator-pinned localhost session and read-only token required");
  const verified=await inspectF1RealGiteaPlannerReadiness({
    baseUrl,readToken,expectedMainSha,fetchFn
  });
  if(verified.status!=="unsolved_pinned_real_gitea_baseline_verified")
    deny("independent unsolved baseline unavailable");
  const client=new GiteaClient({baseUrl,token:readToken,owner:"thesis",
    repository:"iam-console-poc",timeoutMs:10000,fetchFn});
  const folders=[""],directories=new Set([""]),files=new Set();
  for(let i=0;i<folders.length;i++){
    if(i>=128)deny("directory discovery limit exceeded");
    const dir=folders[i];
    const result=await client.listDirectory("main",dir,expectedMainSha);
    if(result.branch!=="main"||result.path!==dir||
       result.revision!==expectedMainSha)
      deny("Gitea directory returned wrong source revision");
    for(const entry of result.entries){
      if(!canonicalPath(entry.path)||entry.path.split("/").length>16)
        deny("noncanonical baseline path");
      if(entry.type==="dir"){
        if(directories.has(entry.path))deny("duplicate directory entry");
        directories.add(entry.path);folders.push(entry.path);
        if(folders.length>128)deny("directory limit exceeded");
      }else if(entry.type==="file"){
        if(files.has(entry.path))deny("duplicate file entry");
        files.add(entry.path);
        if(files.size>128)deny("file list exceeds planning bound");
      }else deny("unsupported Gitea entry type");
    }
  }
  if(files.size<4)deny("insufficient real application files");
  const last=await client.getBranchMetadata("main");
  if(last.name!=="main"||last.commit_sha!==expectedMainSha)
    deny("source main changed during discovery");
  const allowedFiles=Object.freeze([...files].sort());
  const allowedDirs=Object.freeze([...directories].sort());
  const snapshot=Object.freeze({
    session_id:sessionId,
    repository:Object.freeze({authority:"gitea.local",owner:"thesis",
      repository:"iam-console-poc"}),
    base_revision:expectedMainSha,directories:allowedDirs,files:allowedFiles
  });
  let readCalls=0;
  const readPort=Object.freeze({
    async invoke(tool,args,signal){
      if(signal?.aborted)deny("host Planning read cancelled");
      if(++readCalls>64)deny("read operation budget exceeded");
      let result;
      if(tool==="read_repository"&&exact(args,[])){
        result=await client.readRepository(expectedMainSha);
        if(result.revision!==expectedMainSha||
           result.default_branch!=="main"||
           result.full_name!=="thesis/iam-console-poc")
          deny("repository identity changed");
        result={provider:"gitea",performed:true,tool,...result};
      }else if((tool==="list_directory"||tool==="read_file")&&
               exact(args,["branch","path"])&&args.branch==="main"&&
               (tool==="list_directory"?directories:files).has(args.path)){
        result=tool==="list_directory"?
          await client.listDirectory("main",args.path,expectedMainSha):
          await client.readTextFile("main",args.path,expectedMainSha);
        if(result.path!==args.path||result.branch!=="main"||
           result.revision!==expectedMainSha)
          deny("provider source changed under pinned read");
        result={provider:"gitea",performed:true,tool,...result};
      }else deny("model requested operation outside immutable read scope");
      if(signal?.aborted)deny("host Planning read expired");
      return result;
    }
  });
  return Object.freeze({
    snapshot,readPort,
    research_only_direct_gitea:true,
    production_gateway_vp_opa_verification:false,
    gitea_source_pinned:true,
    no_model_calls:true
  });
}
