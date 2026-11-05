/**
 * R323 — actual Coordinator + native Child + Gateway approval are the
 * ONLY source of remote ADK/A2A effect Task pins.
 *
 * The agent cannot choose Task/Child/perimeter/role/branch/HEAD. This
 * privileged owner call is attempted once, after local native enrollment,
 * and sends only exact source-free pins over R322 HMAC Unix IPC.
 */
import {isDeepStrictEqual} from "node:util";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import type {TrustedEffectStagingPort}
 from "../../agent-runtime/src/gateway-tool-client.ts";
import type {TrustedOwnerEffectStagingRegistry,
 connectTrustedEffectAgentBindingClient}
 from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

type AgentBinder=Awaited<ReturnType<typeof connectTrustedEffectAgentBindingClient>>;
type Role="backend"|"frontend"|"test";
const ROLES=["backend","frontend","test"] as const;
function validBinder(b:unknown):b is AgentBinder{
 return !!b&&typeof (b as AgentBinder).bindTask==="function"&&
  typeof (b as AgentBinder).fence==="function";
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function deny(message:string):never{
 throw Error("Trusted remote authority-only effect owner NO-GO: "+message);
}
export class TrustedAuthorityOnlyRemoteEffectOwner {
 readonly #coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 readonly #issuer:TrustedAuthorityOnlyChildIssuer;
 readonly #gateway:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #registry:TrustedOwnerEffectStagingRegistry;
 readonly #agent:AgentBinder|null;
 readonly #agents:Readonly<Record<Role,AgentBinder>>|null;
 readonly #routing=new Map<string,AgentBinder>();
 readonly #attempted=new Set<string>();
 constructor(config:{
  coordinator:TrustedAuthorityOnlyExecutionCoordinator;
  childIssuer:TrustedAuthorityOnlyChildIssuer;
  gateway:TrustedAuthorityOnlyGatewayAdmissions;
  ownerStageRegistry:TrustedOwnerEffectStagingRegistry;
  agentBindingClient?:AgentBinder;
  agentBindingClients?:Readonly<Record<Role,AgentBinder>>;
 }){
  const multi=config?.agentBindingClients;
  const hasSingle=config?.agentBindingClient!==undefined;
  const validMulti=!!multi&&Object.keys(multi).sort().join(",")==="backend,frontend,test"&&
   ROLES.every(role=>validBinder(multi[role]));
  if(hasSingle===!!multi||!(validMulti||validBinder(config?.agentBindingClient)))
   deny("exactly one owner-selected single or three-role IPC binder configuration required");
  if(!(config?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(config.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
     !(config.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !config.ownerStageRegistry||
     typeof config.ownerStageRegistry.bindTask!=="function"||
     typeof config.ownerStageRegistry.retireFor!=="function"||
     !(validMulti||validBinder(config.agentBindingClient)))
    deny("live trusted Coordinator, native Child, Gateway and owner IPC required");
  this.#coordinator=config.coordinator;
  this.#issuer=config.childIssuer;
  this.#gateway=config.gateway;
  this.#registry=config.ownerStageRegistry;
  this.#agent=config.agentBindingClient??null;
  this.#agents=multi?Object.freeze({...multi}):null;
 }
 /**
  * Bind one exact owner-selected mutation/Test effect. Read grants may be
  * present, but only one side-effect operation is currently supported.
  * Every deeper authorization still occurs in Gateway Prepare/VP/OPA.
  */
 async bindRegisteredTask(config:{
  taskId:string;runtimeTaskId:string;effectStager:TrustedEffectStagingPort;
 }):Promise<Readonly<{
  status:"owner_remote_effect_task_prebound_not_executed";
  task_id:string;runtime_task_id:string;
  gateway_execution_authorized:false
 }>>{
  const {taskId,runtimeTaskId,effectStager}=config??{};
  if(typeof taskId!=="string"||!ID.test(taskId)||
     typeof runtimeTaskId!=="string"||
     !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(runtimeTaskId)||
     typeof effectStager?.stage!=="function"||
     this.#attempted.has(runtimeTaskId))
    deny("one exact owner-selected Task and effect port required");
  this.#attempted.add(runtimeTaskId); // no retry after ambiguous bind
  const root=this.#coordinator.assertTrustedGatewayAuthorityBinding();
  const row=this.#coordinator.assertTrustedGatewayRegisteredTask(taskId);
  const issued=this.#issuer.assertTrustedIssuedChild(taskId,this.#coordinator);
  const gateway=this.#gateway.assertTrustedOwnerRemoteEffectBinding(
   taskId,runtimeTaskId);
  if(row.status!=="task_registered_preflight_only"||
     issued.status!=="native_child_response_verified_staged"||
     gateway.status!=="gateway_owner_child_task_preflight_only"||
     gateway.gateway_execution_authorized!==false||
     row.session_id!==root.session_id||
     row.authority_digest!==root.authority_digest||
     row.root_credential_id!==root.root_credential_id||
     issued.session_id!==root.session_id||
     issued.authority_digest!==root.authority_digest||
     issued.root_credential_id!==root.root_credential_id||
     issued.task_id!==row.task_id||
     issued.agent_id!==row.agent_id||
     issued.agent_did!==row.agent_did||
     issued.credential_id!==gateway.credential_id||
     issued.agent_did!==gateway.agent_did||
     row.agent_id!==gateway.agent_id||
     gateway.authority_digest!==root.authority_digest||
     !isDeepStrictEqual(row.permissions,issued.permissions))
    deny("owner root, Coordinator, native Child and Gateway disagree");
  const effects=row.permissions.filter(p=>
   p.operation==="update_file"||p.operation==="run_tests");
  if(effects.length!==1||row.permissions.some(p=>
     !["read_file","update_file","run_tests"].includes(p.operation)))
   deny("one supported Task side-effect grant required");
  const effect=effects[0]!;
  const branch=root.branch;
  const branchUri=canonicalBranchUri(root.repository,branch);
  let path:string|undefined;
  if(effect.operation==="update_file"){
   const prefix=branchUri+"/files/";
   if(!effect.resource.startsWith(prefix))deny("effect file outside original branch");
   const fragment=effect.resource.slice(prefix.length);
   try{
    path=fragment.split("/").map(decodeURIComponent).join("/");
   }catch{deny("invalid encoded file permission");}
   if(!path||path.startsWith("/")||path.includes("\\")||
      path.includes("%")||path.split("/").some(s=>!s||s==="."||s==="..")||
      canonicalFileUri(root.repository,branch,path)!==effect.resource)
    deny("noncanonical exact file permission");
  }else if(effect.operation==="run_tests"){
   if(row.agent_id!=="test"||effect.resource!==branchUri)
    deny("Test Runner must be branch-bound to exact signed Test Task");
  }
  if(!["backend","frontend","test"].includes(row.agent_id))
   deny("unsupported specialized Agent role");
  // Only immutable derived pins are sent across the private Unix binding.
  const pins={
   runtimeTaskId,planTaskId:taskId,
   role:row.agent_id as "backend"|"frontend"|"test",
   childCredentialId:issued.credential_id,presenterId:row.agent_did,
   branch,operation:effect.operation as "update_file"|"run_tests",
   ...(path!==undefined?{path}:{})
  };
  // R328: each role has a separate authenticated owner->agent socket.
  // Only the signed Coordinator row selects the route: never an A2A payload.
  const binder=this.#agents?this.#agents[pins.role]:this.#agent!;
  this.#routing.set(runtimeTaskId,binder);
  this.#registry.bindTask(runtimeTaskId,effectStager,pins.role);
  try{await binder.bindTask(pins);}
  catch(error){
   this.#registry.retireFor(runtimeTaskId);
   throw error;
  }
  // If the Engineer root is revoked or becomes unavailable DURING the
  // remote IPC bind, this exception must also fence the local effect port.
  let latest:ReturnType<TrustedAuthorityOnlyExecutionCoordinator[
   "assertTrustedGatewayAuthorityBinding"]>;
  try{latest=this.#coordinator.assertTrustedGatewayAuthorityBinding();}
  catch(error){
   this.#registry.retireFor(runtimeTaskId);
   throw error;
  }
  if(latest.root_credential_id!==root.root_credential_id||
     latest.authority_digest!==root.authority_digest||
     latest.session_id!==root.session_id){
   this.#registry.retireFor(runtimeTaskId);
   // A remote prebind may already exist; it will remain unusable because
   // the owner stage port is fenced before returning a success receipt.
   deny("Engineer root changed during authenticated remote bind");
  }
  return Object.freeze({
   status:"owner_remote_effect_task_prebound_not_executed",
   task_id:taskId,runtime_task_id:runtimeTaskId,
   gateway_execution_authorized:false
  });
 }
 async fence(runtimeTaskId:string):Promise<void>{
  if(!this.#attempted.has(runtimeTaskId))deny("unknown remote Task fence");
  this.#registry.retireFor(runtimeTaskId); // fence first, then remote IPC
  const binder=this.#routing.get(runtimeTaskId);
  if(!binder)deny("remote Task has no pinned owner IPC route");
  await binder.fence(runtimeTaskId);
 }
}
