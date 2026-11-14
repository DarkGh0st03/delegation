import {randomUUID} from "node:crypto";
import {validateProjectProfile,testSourceProfileOf} from "../../../packages/plan-contracts/src/project-profile.mjs";
import {resolveTrustedAuthorityOnlyExecutionBudgets} from "./trusted-authority-only-execution-budgets.mjs";
import {join} from "node:path";
import {persistStatusIndexReservation} from "../../../packages/orchestrator-runtime/src/trusted-status-index-reservation.ts";
import {TrustedAuthorityOnlyCompletionObserver} from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import {readProtectedCanonicalOwnerFile} from "./trusted-authority-only-owner-bootstrap.mjs";
import {GiteaClient} from "../../gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../gateway/src/gitea-executor.ts";
import {RunnerClient} from "../../gateway/src/runner-client.ts";
import {OpaPolicyClient} from "../../gateway/src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../../gateway/src/direct-core-loader.ts";
import {canonicalRepositoryUri} from "../../gateway/src/canonical.ts";
import {InMemoryAuditSink,InMemoryRequestStore,prepareAuthorization} from "../../gateway/src/prepare.ts";
import {executeAuthorization} from "../../gateway/src/execute.ts";
import {AuthenticatedRunnerCompletionObserver} from "../../gateway/src/trusted-authority-only-runner-evidence.ts";
import {AuthenticatedGiteaReadCompletionObserver} from "../../gateway/src/trusted-authority-only-gitea-evidence.ts";
import {AuthenticatedGiteaMutationCompletionObserver} from "../../gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {AuthenticatedGiteaCreateCompletionObserver}
 from "../../gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {provisionedSpecialists} from "../../../packages/plan-contracts/src/agent-roles.mjs";

function deny(){throw Error("Protected canonical deployment configuration denied");}

/** Default lifetime of a Task's Child DC, and the minimum left to do work. */
export const CHILD_VALIDITY_SECONDS=1200;
const MIN_CHILD_SECONDS=60,CLOCK_MARGIN_SECONDS=30;
/**
 * Validity of a new Child: the default, but never beyond `notAfter` (the
 * earlier of the operational Root and the signed approval expiry), with a
 * margin for clock skew. Too little time left ends the session clearly
 * instead of issuing a Child the issuer would reject.
 */
export function childValiditySeconds(notAfter,nowMs=Date.now()){
 const end=Date.parse(notAfter);
 if(typeof notAfter!=="string"||!Number.isFinite(end))deny();
 const left=Math.floor((end-nowMs)/1000)-CLOCK_MARGIN_SECONDS;
 if(left<MIN_CHILD_SECONDS)
  throw Error("La Root operativa sta per scadere: nessun nuovo Task può essere delegato. "+
   "Avvia una nuova sessione (la durata dell'approvazione firmata è limitata).");
 return Math.min(CHILD_VALIDITY_SECONDS,left);
}
function exact(value,keys){
 return !!value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
// Single-label names only (e.g. Docker Compose service names): they resolve
// only on the private container network, never through public DNS.
const INTERNAL_HOST=/^[a-z][a-z0-9-]{0,62}$/u;
function endpoint(value,internalHosts=[]){
 if(typeof value!=="string"||!URL.canParse(value))deny();
 const url=new URL(value);
 if(url.username||url.password||url.hash||url.search||url.pathname!=="/"||
    (url.protocol!=="https:"&&!(url.protocol==="http:"&&
     (url.hostname==="127.0.0.1"||internalHosts.includes(url.hostname)))))
  deny();
 return url.origin;
}
async function token(file){
 const value=(await readProtectedCanonicalOwnerFile(file,8192)).trim();
 if(value.length<8||/\s/u.test(value))deny();
 return value;
}

/** Shared in-process composition. Model construction does not perform inference. */
export async function assembleCanonicalOperationalDeployment({pins,config:c,loadModelFactory}){
 if(typeof loadModelFactory!=="function")deny();
 const standardKeys=["directory","giteaUrl","giteaWriterFile","giteaReaderFile",
  "runnerUrl","runnerTokenFile","opaUrl","evidenceKeyFile","orchestratorTokenFile",
  "workerTokens","workerPorts","rootIndex","childIndices","draftTitle","draftBody",
  "projectProfile"];
 // No implicit CREATE enablement from an environment variable or agent payload:
 // only the already protected 0600 owner deployment manifest may opt in.
 const nativeCreateEnabled=c?.enableNativeCreateFile===true;
 // Only an explicit protected 0600 owner manifest may request the
 // post-failure authenticated diagnostic-read-before-UPDATE policy.
 const requireVerifiedRepairDiagnostic=c?.requireVerifiedRepairDiagnostic===true;
 const optionalKeys=[...(nativeCreateEnabled?["enableNativeCreateFile"]:[]),
  ...(Object.hasOwn(c??{},"baseBranch")?["baseBranch"]:[]),
  ...(requireVerifiedRepairDiagnostic?["requireVerifiedRepairDiagnostic"]:[]),
  ...(Object.hasOwn(c??{},"executionBudget")?["executionBudget"]:[]),
  ...(Object.hasOwn(c??{},"internalHttpHosts")?["internalHttpHosts"]:[])];
 // Specialist roster: the required roles plus the optional ones (Documentation,
 // Data, DevOps) the owner provisioned with a token and a port.
 const roles=provisionedSpecialists(c?.workerTokens);
 if(!exact(c,[...standardKeys,...optionalKeys])||
    typeof c.directory!=="string"||!c.directory.startsWith("/")||
    !exact(c.workerTokens,roles)||!exact(c.workerPorts,roles)||
    !Array.isArray(c.childIndices)||c.childIndices.length<1||c.childIndices.length>24||
    typeof c.draftTitle!=="string"||typeof c.draftBody!=="string")
  deny();
 // Only the protected 0600 owner manifest may select these bounded budgets.
 const executionBudget=resolveTrustedAuthorityOnlyExecutionBudgets({
  childCount:c.childIndices.length,ownerBudget:c.executionBudget
 });
 const indices=[c.rootIndex,...c.childIndices];
 if(indices.some(i=>typeof i!=="string"||!/^(0|[1-9][0-9]{0,7})$/u.test(i)||
    Number(i)===Number(pins.preliminaryRoot.credential_status.statusListIndex))||
    new Set(indices).size!==indices.length||
    new Set(Object.values(c.workerPorts)).size!==roles.length||
    Object.values(c.workerPorts).some(port=>!Number.isSafeInteger(port)||port<1||port>65535))
  deny();
 // Optional, owner-config only: plain HTTP to named services of the private
// container network (Compose). Never a dotted or public host name.
 const internalHosts=c.internalHttpHosts??[];
 if(!Array.isArray(internalHosts)||internalHosts.length>8||
    internalHosts.some(h=>typeof h!=="string"||!INTERNAL_HOST.test(h)))
  deny();
 const giteaUrl=endpoint(c.giteaUrl,internalHosts),runnerUrl=endpoint(c.runnerUrl,internalHosts),
  opaUrl=endpoint(c.opaUrl,internalHosts);
 const [writer,reader,runnerKey,key,...workerTokens]=await Promise.all([
  token(c.giteaWriterFile),token(c.giteaReaderFile),token(c.runnerTokenFile),
  token(c.evidenceKeyFile),...roles.map(role=>token(c.workerTokens[role]))
 ]);
 if(writer===reader||!/^[a-f0-9]{64}$/u.test(key))deny();
 const model=await loadModelFactory();
 if(typeof model!=="function")deny();
 const repository=pins.snapshot.repository,branch=pins.workBranch;
 const resource=canonicalRepositoryUri(repository);
 const repoName=repository.owner+"/"+repository.repository;
 // The repository's base branch (default "main"): source of the work branch
 // (at the Engineer-pinned commit) and target of the Draft PR.
 const baseBranch=c.baseBranch??"main";
 const gitea=secret=>new GiteaClient({
  baseUrl:giteaUrl,token:secret,owner:repository.owner,repository:repository.repository,baseBranch
 });
 const giteaClient=gitea(writer),independentGiteaClient=gitea(reader);
 // The Runner executes ONLY the phases of the Engineer-approved project
 // profile (validated here; its digest is bound in the signed grant).
 const projectProfile=validateProjectProfile(c.projectProfile);
 const runnerClient=new RunnerClient({baseUrl:runnerUrl,gatewayToken:runnerKey,projectProfile});
 const audit=new InMemoryAuditSink(),store=new InMemoryRequestStore();
 const rootGateway={audit,verifier:loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true}),
  policy:new OpaPolicyClient({baseUrl:opaUrl}),executor:new GiteaExecutor(giteaClient)};
 const directories=Object.fromEntries([
  "mutationIntent","giteaReceipts","runnerIntent","runnerFailureReceipts","runnerPassReceipts",
  ...(nativeCreateEnabled?["createIntent","createReceipts"]:[])
 ].map(name=>[name,join(c.directory,name)]));
 const evidenceKey=Buffer.from(key,"hex");
 const observation={key:evidenceKey,repository:repoName,branch,giteaClient:independentGiteaClient};
 const runnerPassObserver=new AuthenticatedRunnerCompletionObserver({
  ...observation,directory:directories.runnerPassReceipts
 });
 const readObserver=new AuthenticatedGiteaReadCompletionObserver({
  ...observation,directory:directories.giteaReceipts
 });
 const mutationObserver=new AuthenticatedGiteaMutationCompletionObserver({
  ...observation,directory:directories.giteaReceipts
 });
 const createObserver=nativeCreateEnabled
  ?new AuthenticatedGiteaCreateCompletionObserver({
    directory:directories.createReceipts,key:evidenceKey,
    repository:repoName,branch,independentGiteaClient
   }):undefined;
 const completionObserver=new TrustedAuthorityOnlyCompletionObserver({
  async readVerifiedCompletion(expected){
   switch(store.get(expected.request_id)?.request.tool){
    case "run_tests":return runnerPassObserver.observe(expected);
    case "read_file":case "read_files":return readObserver.observe(expected);
    case "create_file":
     // CREATE has no old blob. Never accept the UPDATE receipt schema for
     // an effect which must independently prove old-file absence.
     if(!createObserver)deny();
     return createObserver.observe(expected);
    case "update_file":return mutationObserver.observe(expected);
    default:deny();
   }
  }
 });
 let authorization;
 const gatewayUrl=new URL(pins.gateway.gatewayBaseUrl).origin;
 const workerFetch=role=>async(url,init)=>{
  if(!authorization||init?.method!=="POST")deny();
  const body=JSON.parse(String(init.body));
  if(String(url)===gatewayUrl+"/v1/authorization/prepare"&&body.agent_role===role)
   return Response.json(prepareAuthorization(body,{
    audience:"cloud-access-gateway",request_ttl_ms:role==="test"?1200000:120000,repository
   },authorization),{status:201});
  if(String(url)===gatewayUrl+"/v1/authorization/execute"&&
     store.get(body.request_id)?.agent_role===role)
   return Response.json(await executeAuthorization(body,{...authorization,signal:init.signal}));
  deny();
 };
 const reservationDirectory=join(c.directory,"status-reservations");
 const list=pins.preliminaryRoot.credential_status.statusListCredential;
 let nextIndex=0;
 return {
  journalDirectory:join(c.directory,"journals"),
  orchestratorTokenFile:c.orchestratorTokenFile,completionObserver,rootGateway,
  rootReservation:{directory:reservationDirectory,index:c.rootIndex,validitySeconds:7200},
  nativeEffects:{store,giteaClient,independentGiteaClient,runnerClient,runnerPassObserver,
   readObserver,directories,evidenceKey,
   installAuthorization(deps){authorization=Object.freeze({...rootGateway,...deps,repository});}},
  localWorkers:{directory:c.directory,projectTestSourceProfile:testSourceProfileOf(projectProfile),
   workers:Object.fromEntries(roles.map((role,i)=>[
   role,{port:c.workerPorts[role],adk:{model:model(),gatewayBaseUrl:gatewayUrl,
    adapterToken:workerTokens[i],scopeModelPaths:true,fetchFn:workerFetch(role),
    gatewayTimeoutMs:role==="test"?900000:60000}}
  ]))},
  workflow:{
   createBranch:{model:model(),branch,baseBranch,permission:{resource,operation:"create_branch"}},
   adaptive:{model:model(),maxSteps:executionBudget.maxDecisions,
    maxVerifiedFailures:executionBudget.maxVerifiedFailures,
    ...(requireVerifiedRepairDiagnostic?{requireVerifiedRepairDiagnostic:true}:{}),
    async nextChildParameters(task){
    const validity_seconds=childValiditySeconds(task?.not_after);
    const index=c.childIndices[nextIndex++];
    if(index===undefined)deny();
    const credential_id="urn:operational-child:"+randomUUID();
    await persistStatusIndexReservation(reservationDirectory,list,index,{
     version:1,session_id:pins.snapshot.session_id,credential_id,status_list:list,index
    });
    return {credential_id,valid_from:new Date().toISOString(),validity_seconds,
     credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListCredential:list,statusListIndex:index}};
   }},
   draftPullRequest:{model:model(),headBranch:branch,baseBranch,
    title:c.draftTitle,body:c.draftBody,permission:{resource,operation:"create_pull_request"}}
  }
 };
}
