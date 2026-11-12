/**
 * R325 — authority-only programmatic A2A owner execution entrypoint.
 *
 * This is the first canonical owner-side bridge that combines genuine
 * Coordinator Task + native-issued signed Child + independently enrolled
 * Gateway + R324 private Unix binding with the Protected A2A SDK port.
 *
 * No signed-DAG fallback, no model-supplied authority, and NO acceptance
 * of A2A text/status as independent provider completion.
 */
import {TaskState} from "@a2a-js/sdk";
import {DeterministicA2AOrchestrator,
 type A2APollingOptions} from "../../agent-runtime/src/orchestrator.ts";
import {assertTrustedApprovedA2AStartup,verifyTrustedApprovedAgentCard,
 verifyOwnerPinnedAdditionalCard,type VerifiedA2AProfiles,
 type TrustedAdditionalA2ACardPin}
 from "./trusted-a2a-startup-probe.ts";
import {isDeepStrictEqual} from "node:util";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyCreateEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
import {
 TrustedAuthorityOnlyRemoteEffectBootstrap,
 type TrustedAuthorityOnlyRemoteEffectBootstrapOptions,
 type TrustedOriginalNativeModelPrebindReceipt
} from "./trusted-authority-only-remote-effect-bootstrap.ts";
import {validateWorkflowArtifact,type ValidatedWorkflowArtifact}
 from "./artifact-validation.ts";
import type {ProtectedA2AClientPort} from "./a2a-workflow.ts";
import type {TrustedEffectStagingPort}
 from "../../agent-runtime/src/gateway-tool-client.ts";
import type {
 SpecializedAgentRole,DeterministicSubtask,DelegationEvidence
} from "../../agent-runtime/src/contracts.ts";

const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
import {isProjectTestRepairGrant,isTestAgentReadGrant,isProjectTestCreateGrant,readUpdateGrantShape}
 from "../../plan-contracts/src/gitea-permission-containment.mjs";
const ROLES=["backend","frontend","test"] as const;
function deny(reason:string):never{
 throw Error("Trusted authority-only A2A owner NO-GO: "+reason);
}
type AgentUrls=Readonly<Record<string,string>>;
const ROLE=/^[a-z][a-z0-9_-]{0,23}$/u;
const trustedRoster=(urls:AgentUrls):string[]=>{
 if(!urls||typeof urls!=="object"||Array.isArray(urls))deny("missing trusted A2A endpoints");
 const roles=Object.keys(urls).sort();
 if(roles.length<3||roles.length>16||
    !ROLES.every(role=>Object.hasOwn(urls,role))||
    roles.some(role=>!ROLE.test(role)||["orchestrator","constructor","prototype"].includes(role)))
  deny("trusted A2A roster has an unprovisioned or reserved specialist");
 return roles;
};
const endpoint=(value:string)=>{
 let url:URL;
 try{url=new URL(value);}catch{deny("invalid pinned A2A Agent Card base URL");}
 if(!["https:","http:"].includes(url!.protocol)||
    (url!.protocol==="http:"&&!["127.0.0.1","localhost","::1","[::1]"].includes(url!.hostname))||
    url!.username||url!.password||url!.search||url!.hash||
    url!.pathname!=="/"||!url!.hostname)
  deny("A2A endpoint must be HTTPS or local loopback without credentials");
 return url!.origin;
};
interface OwnerDispatchInput {
 taskId:string;runtimeTaskId:string;instruction:string;
 /** Constructed only by the trusted owner, already fixed to HEAD/Task. */
 effectStager:TrustedEffectStagingPort;
 /** Only trusted original owner process may supply this callback. */
 onNativeOriginalTaskPrebound?:(
  receipt:TrustedOriginalNativeModelPrebindReceipt
 )=>(()=>void);
}
export interface OwnerA2AReport {
 status:"a2a_report_not_gateway_completed";
 task_id:string;runtime_task_id:string;
 role:SpecializedAgentRole;remote_task_id:string;
 /** Validated Task artifact is untrusted until independent Gateway observer. */
 artifact:ValidatedWorkflowArtifact;
 provider_completion_attested:false;
}
export class TrustedAuthorityOnlyA2AOwner {
 readonly #coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 readonly #issuer:TrustedAuthorityOnlyChildIssuer;
 readonly #gateway:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #bootstrap:TrustedAuthorityOnlyRemoteEffectBootstrap;
 readonly #transport:ProtectedA2AClientPort;
 readonly #urls:AgentUrls;
 readonly verifiedAgentProfiles?:VerifiedA2AProfiles;
 readonly #attempted=new Set<string>();
 /** Actual owner dispatch reports, never A2A supplied evidence. */
 readonly #reported=new Map<string,OwnerA2AReport>();
 readonly #mixedReports=new Set<string>();
 /** Original signed Test read-only Tasks; NEVER a Runner PASS. */
 readonly #testReadReports=new Set<string>();
 /** Tracks only an original exact signed Test CREATE, not a Runner PASS. */
 readonly #testCreateReports=new Set<string>();
 readonly #attestAttempted=new Set<string>();
 #closed=false;

 constructor(opts:{
  coordinator:TrustedAuthorityOnlyExecutionCoordinator;
  childIssuer:TrustedAuthorityOnlyChildIssuer;
  gateway:TrustedAuthorityOnlyGatewayAdmissions;
  bootstrap:TrustedAuthorityOnlyRemoteEffectBootstrap;
  a2a:ProtectedA2AClientPort;
  agentBaseUrls:AgentUrls;
  verifiedAgentProfiles?:VerifiedA2AProfiles;
 }){
  if(!(opts?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(opts.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
     !(opts.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.bootstrap instanceof TrustedAuthorityOnlyRemoteEffectBootstrap)||
     typeof opts.a2a?.sendProtectedTask!=="function"||
     !opts.agentBaseUrls)
    deny("original owner, active private bind and protected A2A client required");
  const roles=trustedRoster(opts.agentBaseUrls);
  if(roles.length>ROLES.length&&(!opts.verifiedAgentProfiles||
     Object.keys(opts.verifiedAgentProfiles).sort().join(",")!==roles.join(",")))
   deny("additional specialist lacks exactly matching verified owner Card pins");
  const urls=Object.fromEntries(roles.map(role=>[
   role,endpoint(opts.agentBaseUrls[role]!)
  ]));
  if(new Set(Object.values(urls)).size!==roles.length)
    deny("each specialized agent must have a distinct pinned endpoint");
  this.#coordinator=opts.coordinator;this.#issuer=opts.childIssuer;
  this.#gateway=opts.gateway;this.#bootstrap=opts.bootstrap;
  this.#transport=opts.a2a;this.#urls=Object.freeze(urls);
  this.verifiedAgentProfiles=opts.verifiedAgentProfiles;
 }
 /**
  * Actual owner-side Task handoff. The instruction is descriptive data
  * only; all operation/file/branch/role/Child fields are computed afresh
  * from the live Engineer authority and trusted registries.
  */
 async dispatchIssuedTask(input:OwnerDispatchInput):Promise<OwnerA2AReport>{
  if(this.#closed||!input||!ID.test(input.taskId)||
     !DISPATCH.test(input.runtimeTaskId)||
     typeof input.instruction!=="string"||
     !input.instruction.trim()||input.instruction.length>4000||
     input.instruction.includes("\0")||
     typeof input.effectStager?.stage!=="function"||
     this.#attempted.has(input.runtimeTaskId))
    deny("closed or malformed owner-selected Task");
  this.#attempted.add(input.runtimeTaskId);
  const root=this.#coordinator.assertTrustedGatewayAuthorityBinding();
  const row=this.#coordinator.assertTrustedGatewayRegisteredTask(input.taskId);
  const child=this.#issuer.assertTrustedIssuedChild(input.taskId,this.#coordinator);
  const registered=this.#gateway.assertTrustedOwnerRemoteEffectBinding(
   input.taskId,input.runtimeTaskId);
  if(row.status!=="task_registered_preflight_only"||
     row.task_id!==input.taskId||
     row.session_id!==root.session_id||
     row.authority_digest!==root.authority_digest||
     row.root_credential_id!==root.root_credential_id||
     row.agent_did!==child.agent_did||
     row.agent_id!==child.agent_id||
     child.credential_id!==registered.credential_id||
     registered.runtime_task_id!==input.runtimeTaskId||
     registered.agent_did!==row.agent_did||
     registered.agent_id!==row.agent_id||
     registered.gateway_execution_authorized!==false||
     child.authority_digest!==root.authority_digest||
     !isDeepStrictEqual(child.permissions,row.permissions)||
     !Object.hasOwn(this.#urls,row.agent_id)||
     (!ROLES.includes(row.agent_id as SpecializedAgentRole)&&
      !this.verifiedAgentProfiles?.[row.agent_id]))
    deny("Engineer root, Task, native Child and Gateway differ");
  const role=row.agent_id as SpecializedAgentRole;
  const card=this.verifiedAgentProfiles?.[role];
  if(card&&(card.did!==row.agent_did||
     row.permissions.some(p=>!card.capabilities.includes(p.operation))))
   deny("Task differs from verified specialist Agent Card");
  const branch=root.branch,branchUri=canonicalBranchUri(root.repository,branch);
  const filePermissions:NonNullable<DeterministicSubtask["approved_file_permissions"]>=[];
  let effects=0;
  for(const p of row.permissions){
   if(p.operation==="run_tests"){
    effects++;
    if(role!=="test"||p.resource!==branchUri)
     deny("Test run cannot escape approved branch");
    continue;
   }
   if(p.operation!=="read_file"&&p.operation!=="update_file"&&
      p.operation!=="create_file")
    deny("unsupported A2A Task grant is not a native effect");
   if(p.operation==="update_file"||p.operation==="create_file"||
      (p.operation==="read_file"&&row.permissions.length===1))effects++;
   const prefix=branchUri+"/files/";
   if(!p.resource.startsWith(prefix))
    deny("Task file grant outside native approved branch");
   let path:string;
   try{path=p.resource.slice(prefix.length).split("/").map(decodeURIComponent).join("/");}
   catch{deny("Task file resource has invalid encoding");}
   if(!path||path.startsWith("/")||path.includes("\\")||
      path.includes("%")||path.includes("//")||
      path.split("/").some(x=>!x||x==="."||x==="..")||
      canonicalFileUri(root.repository,branch,path)!==p.resource)
    deny("Task file resource not canonical");
   filePermissions.push({path,operation:p.operation});
  }
  if(effects!==1||filePermissions.length>32)
   deny("Task needs one native read, mutation or Runner effect");
  // One exact edited file plus its signed context reads (shared shape rule).
  const typedMixed=!!readUpdateGrantShape(row.permissions);
  const hasRunner=row.permissions.some(p=>p.operation==="run_tests");
  const signedTestRead=role==="test"&&!hasRunner&&!typedMixed&&
    isTestAgentReadGrant(row.permissions);
  const signedTestCreate=role==="test"&&!hasRunner&&!typedMixed&&
    isProjectTestCreateGrant(row.permissions);
  // R383.1: the native Task/Child maps to precisely one provider operation,
  // or to N reads (edited file + signed context) followed by ONE CAS update.
  // A spare grant in the signed Task must not be leaked as another
  // approved file permission to an A2A specialist. Multi-file changes
  // are separate, serial, individually observed Child Tasks.
  if((hasRunner&&(row.permissions.length!==1||
      filePermissions.length!==0))||
     (!hasRunner&&!typedMixed&&
      (row.permissions.length!==1||filePermissions.length!==1)))
   deny("native A2A Task cannot combine unrelated read/write/Runner grants");
  // Read-only investigation by the Test Agent: ONE exact Engineer-signed
  // file (application code or tests), never a directory. Writes by the Test
  // Agent remain limited to project test sources (checks below).
  if(role==="test"&&filePermissions.length===1&&
     filePermissions[0].operation==="read_file"&&!signedTestRead)
   deny("Test read requires one exact Engineer-signed file");
  if(role==="test"&&filePermissions.some(p=>p.operation==="create_file")&&
     !signedTestCreate)
   deny("Test CREATE requires one exact signed project-test source");
  if(role==="test"&&filePermissions.some(p=>p.operation==="update_file")&&
     !isProjectTestRepairGrant(row.permissions))
   deny("Test update requires an exact project test repair grant");
  if(filePermissions.some(p=>p.operation==="create_file")&&
     (filePermissions.length!==1||
      !(["backend","frontend"].includes(role)||signedTestCreate)||
      !TrustedAuthorityOnlyCreateEffectStager.isNativeForOwner(
       input.effectStager,this.#gateway,input.taskId,input.runtimeTaskId,
       root.repository.owner+"/"+root.repository.repository,branch)))
   deny("CREATE A2A requires one original branded owner Task/Child/branch stager");
  if(typedMixed&&
     (input.effectStager.stagedTool!=="read_then_update"||
      typeof input.effectStager.attest!=="function"))
   deny("reads + update Task requires owner-controlled mixed staging");
  if(!typedMixed&&input.effectStager.stagedTool==="read_then_update")
   deny("mixed staging cannot replace an ordinary Task grant");
  const paths=[...new Set(filePermissions.map(x=>x.path))];
  const subtask:DeterministicSubtask=Object.freeze({
   subtask_id:input.taskId,branch,
   instruction:input.instruction,
   relevant_paths:paths,
   approved_file_permissions:filePermissions.map(x=>Object.freeze({...x})),
   approved_run_tests:hasRunner
  });
  return this.#bootstrap.dispatchApprovedTask({
   taskId:input.taskId,runtimeTaskId:input.runtimeTaskId,
   effectStager:input.effectStager,
   ...(input.onNativeOriginalTaskPrebound
    ?{onNativeOriginalTaskPrebound:input.onNativeOriginalTaskPrebound}:{}),
   dispatch:async()=>{
    const live=this.#coordinator.assertTrustedGatewayAuthorityBinding();
    if(live.session_id!==root.session_id||
       live.authority_digest!==root.authority_digest||
       live.root_credential_id!==root.root_credential_id)
     deny("Engineer root changed before protected A2A send");
    // Consume ONLY after R324 confirms private bind; the original
    // native-issued credential is never synthesized from A2A metadata.
    const signed=this.#issuer.takeTrustedIssuedChildCredential(
     input.taskId,this.#coordinator);
    if(signed.id!==child.credential_id||
       signed.credentialSubject?.sub!==row.agent_did||
       !isDeepStrictEqual(signed.credentialSubject?.per,row.permissions))
      deny("native signed Child payload mismatches trusted Task");
    const evidence:DelegationEvidence={
     credential:JSON.stringify(signed),
     credential_id:child.credential_id,
     presenter_id:row.agent_did
    };
    const response=await this.#transport.sendProtectedTask({
     agent_base_url:this.#urls[role],
     subtask:structuredClone(subtask),
     delegation_evidence:evidence,
     trusted_gateway_task_id:input.runtimeTaskId
    });
    const task=response?.task;
    if(!response?.card?.name?.trim()||!task||task.status?.state!==
       TaskState.TASK_STATE_COMPLETED||typeof task.id!=="string"||
       !ID.test(task.id)||!Array.isArray(task.artifacts)||
       task.artifacts.length!==1||
       !Array.isArray(task.artifacts[0]?.parts)||
       task.artifacts[0].parts.length!==1||
       task.artifacts[0].parts[0]?.content?.$case!=="data")
      deny("A2A report is not one completed structured Task");
    const artifact=validateWorkflowArtifact(
     task.artifacts[0].parts[0].content.value,role,{
      expectedBranch:branch,
      // A2A Test FAIL is data for D1, not an independent PASS.
      requireTestPass:false,requireTestNotRun:role==="test"&&(typedMixed||signedTestRead||signedTestCreate)
     }
    );
    if(signedTestRead&&(artifact.files_modified.length||
       artifact.files_created.length||artifact.errors.length))
     deny("signed Test investigation cannot claim writes or failures");
    if(signedTestCreate&&
       (artifact.files_modified.length!==0||
        artifact.files_created.length!==1||
        artifact.files_created[0]!==filePermissions[0]?.path||
        artifact.errors.length!==0||
        artifact.test_outcome!=="not_run"))
     deny("signed Test CREATE cannot claim unrelated files or Runner PASS");
    // No A2A status/Artifact can unlock the next dependent Task.
    // Only the separately injected real Gateway completion observer
    // can attest the protected provider/Runner effect.
    const report:OwnerA2AReport=Object.freeze({
     status:"a2a_report_not_gateway_completed" as const,
     task_id:input.taskId,runtime_task_id:input.runtimeTaskId,
     role,remote_task_id:task.id,artifact,
     provider_completion_attested:false as const
    });
    this.#reported.set(input.runtimeTaskId,report);
    if(typedMixed)this.#mixedReports.add(input.runtimeTaskId);
    if(signedTestRead)this.#testReadReports.add(input.runtimeTaskId);
    if(signedTestCreate)this.#testCreateReports.add(input.runtimeTaskId);
    return report;
   }
  });
 }
 /**
  * R326: never trust the A2A report to confirm a provider effect. The owner
  * must call Gateway's independent completion observer, which reads the
  * original Task flight and independently attested Gitea/Runner evidence.
  * An ambiguous observer failure consumes the attempt and cannot retry.
  */
 async attestIndependentGatewayCompletion(taskId:string,runtimeTaskId:string):
 Promise<Readonly<{
  status:"owner_gateway_completion_independently_observed";
  task_id:string;runtime_task_id:string;
  gateway_execution_authorized:false;
 }>>{
  if(this.#closed||!ID.test(taskId)||!DISPATCH.test(runtimeTaskId)||
     this.#attestAttempted.has(runtimeTaskId))
   deny("closed or repeated independent completion attestation");
  const reported=this.#reported.get(runtimeTaskId);
  if(!reported||reported.task_id!==taskId||
     reported.status!=="a2a_report_not_gateway_completed"||
     reported.provider_completion_attested!==false)
   deny("no matching previous A2A report to corroborate independently");
  // R334: Test FAIL is a D1 candidate, not a successful provider effect.
  // Reject before touching the success observer; D1 needs separate proof.
  if(reported.role==="test"&&!this.#mixedReports.has(runtimeTaskId)&&
     !this.#testReadReports.has(runtimeTaskId)&&
     !this.#testCreateReports.has(runtimeTaskId)&&
     reported.artifact.test_outcome!=="pass")
   deny("nonpassing Test report needs independently verified D1 failure gate");
  this.#attestAttempted.add(runtimeTaskId); // before any async I/O
  // Gateway does NOT inspect this report; it observes its own durable
  // native-verified provider flight and trusted completion evidence.
  const confirmed=this.#mixedReports.has(runtimeTaskId)
   ?this.#gateway.assertTrustedCompletedSequentialReadUpdateTask(taskId,runtimeTaskId)
   :await this.#gateway.attestTrustedTaskCompletion(taskId,runtimeTaskId);
  if(!["task_completion_observed_staged",
       "sequential_read_update_task_completed_staged"].includes(confirmed.status)||
     confirmed.task_id!==taskId||
     confirmed.runtime_task_id!==runtimeTaskId||
     confirmed.gateway_execution_authorized!==false)
   deny("independent Gateway completion receipt mismatches original Task");
  this.#reported.delete(runtimeTaskId);
  this.#mixedReports.delete(runtimeTaskId);
  this.#testReadReports.delete(runtimeTaskId);
  this.#testCreateReports.delete(runtimeTaskId);
  return Object.freeze({
   status:"owner_gateway_completion_independently_observed" as const,
   task_id:taskId,runtime_task_id:runtimeTaskId,
   gateway_execution_authorized:false as const
  });
 }
 cancelTask(runtimeTaskId:string){
  this.#reported.delete(runtimeTaskId);
  this.#mixedReports.delete(runtimeTaskId);
  this.#testReadReports.delete(runtimeTaskId);
  this.#testCreateReports.delete(runtimeTaskId);
  return this.#bootstrap.cancelTask(runtimeTaskId);
 }
 close():Promise<void>{
  this.#closed=true;
  this.#reported.clear();
  this.#mixedReports.clear();
  this.#testReadReports.clear();
  this.#testCreateReports.clear();
  return this.#bootstrap.close();
 }
}
/**
 * Canonical programmatic owner entrypoint, after authenticated Engineer
 * activation, Rust native Child issuance and independent Gateway enrollment.
 * It never starts legacy Gemini approved-DAG code.
 */
export async function startTrustedAuthorityOnlyA2AOwner(
 config:TrustedAuthorityOnlyRemoteEffectBootstrapOptions & {
  a2a:ProtectedA2AClientPort;agentBaseUrls:AgentUrls;verifiedAgentProfiles?:VerifiedA2AProfiles
 }):Promise<TrustedAuthorityOnlyA2AOwner>{
 const bootstrap=await TrustedAuthorityOnlyRemoteEffectBootstrap.start(config);
 try{
  return new TrustedAuthorityOnlyA2AOwner({...config,bootstrap});
 }catch(error){
  await bootstrap.close();throw error;
 }
}

/**
 * R327 — canonical production-facing A2A SDK owner factory.
 *
 * A trusted owner starts THREE separate ADK/A2A agent processes itself,
 * then supplies the loopback endpoints. Before opening private effect
 * staging, verify each role's live Agent Card, DID, skill and A2A protocol.
 * The authenticated Unix Task bind still precedes the actual HTTP send.
 *
 * A card is discovery metadata, NOT an authenticated remote caller or a
 * native delegated grant. Only Gateway/Rust/OPA completion grants authority.
 */
export async function startTrustedAuthorityOnlySdkA2AOwner(
 config:TrustedAuthorityOnlyRemoteEffectBootstrapOptions & {
  agentBaseUrls:AgentUrls;
  additionalRolePins?:Readonly<Record<string,TrustedAdditionalA2ACardPin>>;
  a2aPolling?:A2APollingOptions;
 }):Promise<TrustedAuthorityOnlyA2AOwner>{
 if(!config||Object.hasOwn(config,"a2a")||!config.agentBaseUrls)
  deny("canonical SDK owner requires only trusted pinned role endpoints");
 const roles=trustedRoster(config.agentBaseUrls);
 const extra=roles.filter(role=>!ROLES.includes(role as SpecializedAgentRole));
 if((extra.length>0&&(!config.additionalRolePins||
     Object.keys(config.additionalRolePins).sort().join(",")!==extra.join(",")))||
    (!extra.length&&config.additionalRolePins&&
     Object.keys(config.additionalRolePins).length!==0))
  deny("additional roles require exact owner-provisioned Agent Card pins");
 const urls=Object.freeze(Object.fromEntries(roles.map(role=>[
  role,endpoint(config.agentBaseUrls[role]!)
 ])));
 if(new Set(Object.values(urls)).size!==roles.length||
    Object.values(urls).some(url=>!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(url)))
  deny("canonical SDK A2A startup requires distinct loopback role hosts");
 // Card probes use GET with no credential, then the protected SDK client
 // performs the one-shot A2A HTTP send only after R324 private Task bind.
 const verifiedAgentProfiles=await assertTrustedApprovedA2AStartup({
  endpoints:urls as Record<"backend"|"frontend"|"test",string>,
  ...(extra.length?{additionalRolePins:config.additionalRolePins}:{})
 });
 const client=new DeterministicA2AOrchestrator(config.a2aPolling,(url,card)=>{
  const role=roles.find(candidate=>urls[candidate]===url);
  if(!role)deny("SDK send has no verified specialist endpoint");
  const live=ROLES.includes(role as SpecializedAgentRole)
   ?verifyTrustedApprovedAgentCard(role as "backend"|"frontend"|"test",url,card)
   :verifyOwnerPinnedAdditionalCard(role,url,card,config.additionalRolePins![role]!);
  const pinned=verifiedAgentProfiles[role]!;
  if(live.did!==pinned.did||
     live.capabilities.length!==pinned.capabilities.length||
     live.capabilities.some(operation=>!pinned.capabilities.includes(operation)))
   deny("specialist Agent Card identity or capabilities changed after startup");
 });
 return startTrustedAuthorityOnlyA2AOwner({
  ...config,agentBaseUrls:urls,a2a:client,verifiedAgentProfiles
 });
}
