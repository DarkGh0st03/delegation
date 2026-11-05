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
import {isDeepStrictEqual} from "node:util";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {
 TrustedAuthorityOnlyRemoteEffectBootstrap,
 type TrustedAuthorityOnlyRemoteEffectBootstrapOptions
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
const ROLES=["backend","frontend","test"] as const;
function deny(reason:string):never{
 throw Error("Trusted authority-only A2A owner NO-GO: "+reason);
}
type AgentUrls=Readonly<Record<SpecializedAgentRole,string>>;
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
 readonly #attempted=new Set<string>();
 #closed=false;

 constructor(opts:{
  coordinator:TrustedAuthorityOnlyExecutionCoordinator;
  childIssuer:TrustedAuthorityOnlyChildIssuer;
  gateway:TrustedAuthorityOnlyGatewayAdmissions;
  bootstrap:TrustedAuthorityOnlyRemoteEffectBootstrap;
  a2a:ProtectedA2AClientPort;
  agentBaseUrls:AgentUrls;
 }){
  if(!(opts?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(opts.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
     !(opts.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.bootstrap instanceof TrustedAuthorityOnlyRemoteEffectBootstrap)||
     typeof opts.a2a?.sendProtectedTask!=="function"||
     !opts.agentBaseUrls||Object.keys(opts.agentBaseUrls).sort().join(",")!==
        "backend,frontend,test")
    deny("original owner, active private bind and protected A2A client required");
  const urls=Object.fromEntries(ROLES.map(r=>[r,endpoint(opts.agentBaseUrls[r])]))
    as Record<SpecializedAgentRole,string>;
  if(new Set(Object.values(urls)).size!==3)
    deny("each specialized agent must have a distinct pinned endpoint");
  this.#coordinator=opts.coordinator;this.#issuer=opts.childIssuer;
  this.#gateway=opts.gateway;this.#bootstrap=opts.bootstrap;
  this.#transport=opts.a2a;this.#urls=Object.freeze(urls);
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
     !ROLES.includes(row.agent_id as SpecializedAgentRole))
    deny("Engineer root, Task, native Child and Gateway differ");
  const role=row.agent_id as SpecializedAgentRole;
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
   if(p.operation!=="read_file"&&p.operation!=="update_file")
    deny("unsupported A2A Task grant is not a native effect");
   if(p.operation==="update_file")effects++;
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
   deny("Task needs one native mutation or Runner effect");
  const hasRunner=row.permissions.some(p=>p.operation==="run_tests");
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
      requireTestPass:false
     }
    );
    // Do NOT update Gateway completion or unlock dependent Tasks.
    // Only the separate Gateway provider/Runner observer may do that.
    return Object.freeze({
     status:"a2a_report_not_gateway_completed" as const,
     task_id:input.taskId,runtime_task_id:input.runtimeTaskId,
     role,remote_task_id:task.id,artifact,
     provider_completion_attested:false as const
    });
   }
  });
 }
 cancelTask(runtimeTaskId:string){return this.#bootstrap.cancelTask(runtimeTaskId);}
 close():Promise<void>{
  this.#closed=true;
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
  a2a:ProtectedA2AClientPort;agentBaseUrls:AgentUrls
 }):Promise<TrustedAuthorityOnlyA2AOwner>{
 const bootstrap=await TrustedAuthorityOnlyRemoteEffectBootstrap.start(config);
 try{
  return new TrustedAuthorityOnlyA2AOwner({...config,bootstrap});
 }catch(error){
  await bootstrap.close();throw error;
 }
}
