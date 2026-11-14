/**
 * R324 — trusted, programmatic authority-only Orchestrator owner bootstrap.
 *
 * Owner-side Unix staging listener is created here, after the real
 * Engineer/Coordinator and Gateway/Child have been assembled by a trusted
 * host. The existing canonical owner Task binder (R323) derives Task pins
 * from Coordinator, native-issued Child and Gateway; the model cannot supply
 * credentials, expected HEAD, signer or staging port.
 *
 * Not a public HTTP/A2A/MCP endpoint. No secrets or authority in env JSON.
 * This is a reusable owner startup/lifecycle, not yet the production ADK
 * autonomous execution entrypoint.
 */
import {resolve} from "node:path";
import {timingSafeEqual} from "node:crypto";
import {loadTrustedPlanIpcSecret} from
 "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyRemoteEffectOwner}
 from "./trusted-authority-only-remote-effect-owner.ts";
import {
 TrustedOwnerEffectStagingRegistry,
 createTrustedOwnerEffectStagingServer,
 connectTrustedEffectAgentBindingClient
} from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";
import type {TrustedEffectStagingPort}
 from "../../agent-runtime/src/gateway-tool-client.ts";
import {SPECIALIST_ROLES,REQUIRED_SPECIALISTS} from "../../plan-contracts/src/agent-roles.mjs";

const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const CORE_ROLES=SPECIALIST_ROLES;
const ROLE=/^[a-z][a-z0-9_-]{0,23}$/u;
export type TrustedRoleBindingChannels=Readonly<Record<string,Readonly<{
 socketPath:string;secretFile:string
}>>>;
/** Extra roles are provisioned only through an owner-held, fully matched
 * channel inventory. Keep all three original workers for compatibility. */
function trustedRoleChannels(value:unknown):value is TrustedRoleBindingChannels{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const entries=value as Record<string,unknown>;
 const names=Object.keys(entries);
 return names.length>=REQUIRED_SPECIALISTS.length&&names.length<=16&&
  REQUIRED_SPECIALISTS.every(role=>Object.hasOwn(entries,role))&&
  names.every(role=>{
   const ch=entries[role] as Record<string,unknown>|undefined;
   return ROLE.test(role)&&!["orchestrator","constructor","prototype"].includes(role)&&
    !!ch&&typeof ch==="object"&&!Array.isArray(ch)&&
    Object.keys(ch).sort().join(",")==="secretFile,socketPath"&&
    typeof ch.secretFile==="string"&&typeof ch.socketPath==="string";
  });
}
function deny(message:string):never{
 throw Error("Authority-only remote owner bootstrap NO-GO: "+message);
}
export interface TrustedAuthorityOnlyRemoteEffectBootstrapOptions {
 coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 childIssuer:TrustedAuthorityOnlyChildIssuer;
 gateway:TrustedAuthorityOnlyGatewayAdmissions;
 /** Legacy one-socket stage channel. Accepted for historical deployments. */
 stageSocketPath?:string;
 stageSecretFile?:string;
 /** R333: three distinct authenticated agent->owner staging channels,
  * sharing ONE owner registry and Engineer authority root. */
 stageChannels?:TrustedRoleBindingChannels;
 /** Agent-owned private Unix Task binding socket; agent already running. */
 agentBindingSocketPath?:string;
 /** Separate preprovisioned 0600 owner→agent HMAC bind secret. */
 agentBindingSecretFile?:string;
 /** R328: distinct per-role owner->agent HMAC sockets, ONE staging owner. */
 agentBindingChannels?:TrustedRoleBindingChannels;
}
type ServerHandle=Awaited<ReturnType<typeof createTrustedOwnerEffectStagingServer>>;
type TaskInput={taskId:string;runtimeTaskId:string;
 effectStager:TrustedEffectStagingPort};
export type TrustedOriginalNativeModelPrebindReceipt={
 status:"owner_remote_effect_task_prebound_not_executed";
 task_id:string;runtime_task_id:string;gateway_execution_authorized:false
};
type TaskResult=TrustedOriginalNativeModelPrebindReceipt;

export class TrustedAuthorityOnlyRemoteEffectBootstrap {
 readonly #owner:TrustedAuthorityOnlyRemoteEffectOwner;
 readonly #servers:readonly ServerHandle[];
 readonly #registry:TrustedOwnerEffectStagingRegistry;
 readonly #attempted=new Set<string>();
 readonly #pending=new Set<string>();
 /** Only remotely ACKed, not yet terminally fenced bindings. */
 readonly #bound=new Set<string>();
 readonly #cancelled=new Set<string>();
 /** Optional ORIGINAL owner-only model IPC admission retirement callbacks.
  * Never persisted, serialized or given to A2A workers. */
 readonly #modelTaskFences=new Map<string,()=>void>();
 #modelTaskFenceFailed=false;
 #fenceModelTask(runtimeTaskId:string){
  const callback=this.#modelTaskFences.get(runtimeTaskId);
  if(!callback)return;
  this.#modelTaskFences.delete(runtimeTaskId);
  try{callback();}catch{this.#modelTaskFenceFailed=true;}
 }
 #closed=false;
 #closing?:Promise<void>;

 private constructor(
  owner:TrustedAuthorityOnlyRemoteEffectOwner,
  registry:TrustedOwnerEffectStagingRegistry,servers:readonly ServerHandle[]
 ){
  this.#owner=owner;this.#registry=registry;this.#servers=servers;
 }
 static async start(opts:TrustedAuthorityOnlyRemoteEffectBootstrapOptions):
 Promise<TrustedAuthorityOnlyRemoteEffectBootstrap>{
  if(!(opts?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(opts.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
     !(opts.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     opts.coordinator.phase!=="active"||opts.gateway.phase!=="active")
   deny("live Engineer Coordinator, native Child and active Gateway required");
  const multi=opts.agentBindingChannels;
  const hasSingle=opts.agentBindingSocketPath!==undefined||
    opts.agentBindingSecretFile!==undefined;
  if(!!multi===hasSingle||
     (multi&&!trustedRoleChannels(multi))||
     (!multi&&(typeof opts.agentBindingSocketPath!=="string"||
               typeof opts.agentBindingSecretFile!=="string")))
   deny("exactly one legacy binder or three per-role bind IPC channels required");
  const liveRoles=multi?Object.keys(multi).sort():[...REQUIRED_SPECIALISTS];
  const bindingChannels=multi?liveRoles.map(role=>multi[role]!):[{
   socketPath:opts.agentBindingSocketPath!,
   secretFile:opts.agentBindingSecretFile!
  }];
  const roleStages=opts.stageChannels;
  const legacyStage=opts.stageSocketPath!==undefined||
    opts.stageSecretFile!==undefined;
  if(!!roleStages===legacyStage||
     (roleStages&&(!multi||!trustedRoleChannels(roleStages)||
      Object.keys(roleStages).sort().join(",")!==liveRoles.join(",")))||
     (!roleStages&&(typeof opts.stageSocketPath!=="string"||
       typeof opts.stageSecretFile!=="string")))
   deny("exactly one legacy stage or three role-pinned stage IPC channels required");
  const stageChannels=roleStages?liveRoles.map(role=>roleStages[role]!):[{
   socketPath:opts.stageSocketPath!,
   secretFile:opts.stageSecretFile!
  }];
  const paths=[
   ...stageChannels.flatMap(x=>[x.socketPath,x.secretFile]),
   ...bindingChannels.flatMap(x=>[x.socketPath,x.secretFile])
  ];
  if(paths.some(v=>typeof v!=="string"||!v.startsWith("/")||
     v.includes("\0")||v.length>95)||
     new Set(paths.map(p=>resolve(p))).size!==paths.length)
   deny("distinct short absolute private Unix sockets and secret files required");
  // No two authorization directions or role bind channels share HMAC
  // keys; a compromised Frontend binder cannot enroll Backend Tasks.
  const secretPaths=[...stageChannels.map(x=>x.secretFile),
   ...bindingChannels.map(x=>x.secretFile)];
  const secrets=await Promise.all(secretPaths.map(loadTrustedPlanIpcSecret));
  for(let i=0;i<secrets.length;i++)
   for(let j=i+1;j<secrets.length;j++)
    if(timingSafeEqual(secrets[i]!,secrets[j]!))
     deny(roleStages?"all role-pinned stage and bind HMAC keys must differ":
       multi?"stage and per-role bind HMAC keys must differ":
       "stage and bind HMAC keys must differ");
  // Confirm the Engineer root BEFORE opening a private listener.
  opts.coordinator.assertTrustedGatewayAuthorityBinding();
  const registry=new TrustedOwnerEffectStagingRegistry();
  const servers:ServerHandle[]=[];
  try{
   for(let i=0;i<stageChannels.length;i++){
    const stage=stageChannels[i]!;
    const role=roleStages?liveRoles[i]:undefined;
    const server=await createTrustedOwnerEffectStagingServer({
     socketPath:stage.socketPath,secretFile:stage.secretFile,
     registry,...(role?{expectedRole:role}:{})
    });
    servers.push(server); // close even if start partially fails
    await server.start();
   }
   const clients=await Promise.all(bindingChannels.map((ch,i)=>
    connectTrustedEffectAgentBindingClient({
     socketPath:ch.socketPath,secretFile:ch.secretFile,
     // Extra roles must match the owner-provisioned physical binder.
     // Without this pin the IPC validator deliberately admits only base roles.
     ...(multi?{expectedRole:liveRoles[i]}:{}),
     projectTestSourceProfile:opts.gateway.projectTestSourceProfile
    })
   ));
   const binders=multi
    ?{agentBindingClients:Object.fromEntries(
      liveRoles.map((role,i)=>[role,clients[i]!])
     ) as Record<string,(typeof clients)[number]>}
    :{agentBindingClient:clients[0]!};
   const owner=new TrustedAuthorityOnlyRemoteEffectOwner({
    coordinator:opts.coordinator,childIssuer:opts.childIssuer,
    gateway:opts.gateway,ownerStageRegistry:registry,...binders
   });
   return new TrustedAuthorityOnlyRemoteEffectBootstrap(
    owner,registry,Object.freeze([...servers]));
  }catch(error){
   registry.retireAll();
   await Promise.allSettled(servers.map(server=>server.close()));
   throw error;
  }
 }
 /**
  * The trusted Coordinator's caller controls the A2A dispatch closure.
  * The A2A message is NOT a source for any bind parameters or effect port.
  * Fence owner effects synchronously on terminal completion, failure or
  * ambiguous remote transport, before awaiting the remote fence ACK.
  */
 async dispatchApprovedTask<T>(opts:TaskInput &{
  dispatch:()=>Promise<T>;
  /** Called ONLY after the genuine R323 native/Child/Gateway bind.
   * Must synchronously return a one-shot model Task retirement closure. */
  onNativeOriginalTaskPrebound?:(
   receipt:TrustedOriginalNativeModelPrebindReceipt
  )=>(()=>void);
 }):Promise<T>{
  if(this.#closed||this.#modelTaskFenceFailed||
     !opts||typeof opts.dispatch!=="function"||
     (opts.onNativeOriginalTaskPrebound!==undefined&&
      typeof opts.onNativeOriginalTaskPrebound!=="function")||
     !DISPATCH.test(opts.runtimeTaskId)||
     this.#attempted.has(opts.runtimeTaskId))
   deny("closed, duplicate or invalid owner dispatch");
  this.#attempted.add(opts.runtimeTaskId);
  this.#pending.add(opts.runtimeTaskId);
  let bound=false;
  try{
   const receipt:TaskResult=await this.#owner.bindRegisteredTask({
    taskId:opts.taskId,runtimeTaskId:opts.runtimeTaskId,
    effectStager:opts.effectStager
   });
   if(receipt.status!=="owner_remote_effect_task_prebound_not_executed"||
      receipt.gateway_execution_authorized!==false||
      receipt.task_id!==opts.taskId||
      receipt.runtime_task_id!==opts.runtimeTaskId)
    deny("private prebind receipt is not exact and cannot authorize execution");
   bound=true;
   this.#bound.add(opts.runtimeTaskId);
   if(this.#closed||this.#cancelled.has(opts.runtimeTaskId))
    deny("owner Task cancelled or retired during remote bind");
   if(opts.onNativeOriginalTaskPrebound){
    // A JSON clone of this receipt has no original-issued WeakMap brand.
    // This callback executes exclusively inside the trusted owner.
    const retirement=opts.onNativeOriginalTaskPrebound(receipt);
    if(typeof retirement!=="function")
     deny("model Task admission requires one terminal retirement closure");
    this.#modelTaskFences.set(opts.runtimeTaskId,retirement);
    if(this.#closed||this.#cancelled.has(opts.runtimeTaskId))
     deny("model Task cancelled during IPC prebind");
   }
   return await opts.dispatch();
  }finally{
   this.#pending.delete(opts.runtimeTaskId);
   // Revoke model calls synchronously before any async original native
   // Gateway/agent bind retirement. No stale worker may request new turns.
   this.#fenceModelTask(opts.runtimeTaskId);
   // If bind never reached owner stage registration, retireFor has no
   // registered entry. A failed binding remains unretryable by this host.
   if(bound){
    await this.#owner.fence(opts.runtimeTaskId);
    this.#bound.delete(opts.runtimeTaskId);
   }else{
    // Failed bind may be ambiguous: revoke remote capability if present.
    try{await this.#owner.fence(opts.runtimeTaskId);}catch{
     // No later effect can be staged if owner registration was absent
     // or the owner port was already fenced by R323.
    }
   }
   if(this.#modelTaskFenceFailed)
    deny("original model Task retirement unconfirmed");
  }
 }
 /**
  * Cancel a Task even if a remote A2A response has not returned.
  * local retirement precedes all awaits, and a failed remote ACK cannot
  * un-retire a one-use Task.
  */
 async cancelTask(runtimeTaskId:string):Promise<void>{
  if(!this.#attempted.has(runtimeTaskId))
   deny("unknown Task cancellation");
  // Mark cancellation BEFORE awaiting a remote bind or fence. If the
  // agent's bind ACK is still in flight, dispatchApprovedTask will
  // observe this flag and refuse to invoke the A2A callback.
  this.#cancelled.add(runtimeTaskId);
  this.#fenceModelTask(runtimeTaskId); // before native async fence
  try{
   await this.#owner.fence(runtimeTaskId);
   this.#bound.delete(runtimeTaskId);
  }catch(error){
   if(this.#pending.has(runtimeTaskId)){
    // Binding may not have allocated a local slot yet. Completion of
    // that in-flight bind is terminally fenced in dispatchApprovedTask.
    if(this.#modelTaskFenceFailed)
     deny("model retirement unconfirmed during cancellation");
    return;
   }
   throw error;
  }
  if(this.#modelTaskFenceFailed)
   deny("model retirement unconfirmed during cancellation");
 }
 close():Promise<void>{
  if(this.#closing)return this.#closing;
  this.#closed=true;
  for(const id of this.#attempted)this.#cancelled.add(id);
  for(const id of [...this.#modelTaskFences.keys()])
   this.#fenceModelTask(id);
  this.#registry.retireAll(); // synchronously block EVERY future stage
  this.#closing=(async()=>{
   // A denied prebind may never allocate a local owner slot and
   // cannot be remotely fenced. R323 already made that attempt terminal.
   // Only ACKed, still-active remote slots require close acknowledgements.
   const names=[...this.#bound];
   const results=await Promise.allSettled([
    ...names.map(id=>this.#owner.fence(id)),
    ...this.#servers.map(server=>server.close())
   ]);
   const failures=results.filter(r=>r.status==="rejected");
   if(failures.length||this.#modelTaskFenceFailed)
    deny("one or more native/model Task fences were not acknowledged");
  })();
  return this.#closing;
 }
}
export async function startTrustedAuthorityOnlyRemoteEffectBootstrap(
 opts:TrustedAuthorityOnlyRemoteEffectBootstrapOptions){
 return TrustedAuthorityOnlyRemoteEffectBootstrap.start(opts);
}
