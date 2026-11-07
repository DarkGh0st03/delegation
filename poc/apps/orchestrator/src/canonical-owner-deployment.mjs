import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {createGeminiAdkModel} from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {persistStatusIndexReservation} from "../../../packages/orchestrator-runtime/src/trusted-status-index-reservation.ts";
import {TrustedAuthorityOnlyCompletionObserver} from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import {loadProtectedGeminiOwnerInput} from "./run-trusted-gemini-owner.mjs";
import {loadProtectedCanonicalOwnerManifest,readProtectedCanonicalOwnerFile}
 from "./trusted-authority-only-owner-bootstrap.mjs";
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

const roles=["backend","frontend","test"];
function deny(){throw Error("Protected canonical deployment configuration denied");}
function exact(value,keys){
 return !!value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
function endpoint(value){
 if(typeof value!=="string"||!URL.canParse(value))deny();
 const url=new URL(value);
 if(url.username||url.password||url.hash||url.search||url.pathname!=="/"||
    (url.protocol!=="https:"&&!(url.protocol==="http:"&&url.hostname==="127.0.0.1")))
  deny();
 return url.origin;
}
async function token(file){
 const value=(await readProtectedCanonicalOwnerFile(file,8192)).trim();
 if(value.length<8||/\s/u.test(value))deny();
 return value;
}

export async function prepareOperational({expectedSourceSha,chargeAuthorization}={}){
 if(chargeAuthorization!=="I AUTHORIZE GEMINI API CHARGES")deny();
 const {pins}=await loadProtectedCanonicalOwnerManifest(
  process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,{expectedSourceSha});
 const c=JSON.parse(await readProtectedCanonicalOwnerFile(
  process.env.DELEGATION_CANONICAL_DEPLOYMENT_CONFIG));
 if(!exact(c,["directory","giteaUrl","giteaWriterFile","giteaReaderFile",
   "runnerUrl","runnerTokenFile","opaUrl","evidenceKeyFile","orchestratorTokenFile",
   "workerTokens","workerPorts","rootIndex","childIndices","draftTitle","draftBody"])||
    typeof c.directory!=="string"||!c.directory.startsWith("/")||
    !exact(c.workerTokens,roles)||!exact(c.workerPorts,roles)||
    !Array.isArray(c.childIndices)||c.childIndices.length<1||c.childIndices.length>16||
    typeof c.draftTitle!=="string"||typeof c.draftBody!=="string")
  deny();
 const indices=[c.rootIndex,...c.childIndices];
 if(indices.some(i=>typeof i!=="string"||!/^(0|[1-9][0-9]{0,7})$/u.test(i)||
    Number(i)===Number(pins.preliminaryRoot.credential_status.statusListIndex))||
    new Set(indices).size!==indices.length||
    new Set(Object.values(c.workerPorts)).size!==roles.length||
    Object.values(c.workerPorts).some(port=>!Number.isSafeInteger(port)||port<1||port>65535))
  deny();
 const giteaUrl=endpoint(c.giteaUrl),runnerUrl=endpoint(c.runnerUrl),opaUrl=endpoint(c.opaUrl);
 const [writer,reader,runnerKey,key,...workerTokens]=await Promise.all([
  token(c.giteaWriterFile),token(c.giteaReaderFile),token(c.runnerTokenFile),
  token(c.evidenceKeyFile),...roles.map(role=>token(c.workerTokens[role]))
 ]);
 if(writer===reader||!/^[a-f0-9]{64}$/u.test(key))deny();
 const modelInput=await loadProtectedGeminiOwnerInput(
  process.env.DELEGATION_GEMINI_OWNER_INPUT_FILE,{chargeAuthorization});
 const model=()=>createGeminiAdkModel({apiKey:modelInput.geminiApiKey,model:modelInput.modelName});
 const repository=pins.snapshot.repository,branch=pins.workBranch;
 const resource=canonicalRepositoryUri(repository);
 const repoName=repository.owner+"/"+repository.repository;
 const gitea=secret=>new GiteaClient({
  baseUrl:giteaUrl,token:secret,owner:repository.owner,repository:repository.repository
 });
 const giteaClient=gitea(writer),independentGiteaClient=gitea(reader);
 const runnerClient=new RunnerClient({baseUrl:runnerUrl,gatewayToken:runnerKey});
 const audit=new InMemoryAuditSink(),store=new InMemoryRequestStore();
 const rootGateway={audit,verifier:loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true}),
  policy:new OpaPolicyClient({baseUrl:opaUrl}),executor:new GiteaExecutor(giteaClient)};
 const directories=Object.fromEntries([
  "mutationIntent","giteaReceipts","runnerIntent","runnerFailureReceipts","runnerPassReceipts"
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
 const completionObserver=new TrustedAuthorityOnlyCompletionObserver({
  async readVerifiedCompletion(expected){
   switch(store.get(expected.request_id)?.request.tool){
    case "run_tests":return runnerPassObserver.observe(expected);
    case "read_file":case "read_files":return readObserver.observe(expected);
    case "create_file":case "update_file":return mutationObserver.observe(expected);
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
  localWorkers:{directory:c.directory,workers:Object.fromEntries(roles.map((role,i)=>[
   role,{port:c.workerPorts[role],adk:{model:model(),gatewayBaseUrl:gatewayUrl,
    adapterToken:workerTokens[i],scopeModelPaths:true,fetchFn:workerFetch(role),
    gatewayTimeoutMs:role==="test"?900000:60000}}
  ]))},
  workflow:{
   createBranch:{model:model(),branch,baseBranch:"main",permission:{resource,operation:"create_branch"}},
   adaptive:{model:model(),maxSteps:c.childIndices.length,async nextChildParameters(){
    const index=c.childIndices[nextIndex++];
    if(index===undefined)deny();
    const credential_id="urn:operational-child:"+randomUUID();
    await persistStatusIndexReservation(reservationDirectory,list,index,{
     version:1,session_id:pins.snapshot.session_id,credential_id,status_list:list,index
    });
    return {credential_id,valid_from:new Date().toISOString(),validity_seconds:1200,
     credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListCredential:list,statusListIndex:index}};
   }},
   draftPullRequest:{model:model(),headBranch:branch,baseBranch:"main",
    title:c.draftTitle,body:c.draftBody,permission:{resource,operation:"create_pull_request"}}
  }
 };
}
