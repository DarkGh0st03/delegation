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

const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
type Role="backend"|"frontend"|"test";
const ROLES=["backend","frontend","test"] as const;
export type TrustedRoleBindingChannels=Readonly<Record<Role,Readonly<{
 socketPath:string;secretFile:string
}>>>;
function deny(message:string):never{
 throw Error("Authority-only remote owner bootstrap NO-GO: "+message);
}
export interface TrustedAuthorityOnlyRemoteEffectBootstrapOptions {
 coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 childIssuer:TrustedAuthorityOnlyChildIssuer;
 gateway:TrustedAuthorityOnlyGatewayAdmissions;
 /** Owner-owned private (0700 parent) Unix staging server socket. */
 stageSocketPath:string;
 /** Owner-only 0600 HMAC stage secret, independent of agent bind key. */
 stageSecretFile:string;
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
type TaskResult={status:"owner_remote_effect_task_prebound_not_executed";
 task_id:string;runtime_task_id:string;gateway_execution_authorized:false};

export class TrustedAuthorityOnlyRemoteEffectBootstrap {
 readonly #owner:TrustedAuthorityOnlyRemoteEffectOwner;
 readonly #server:ServerHandle;
 readonly #registry:TrustedOwnerEffectStagingRegistry;
 readonly #attempted=new Set<string>();
 readonly #pending=new Set<string>();
 /** Only remotely ACKed, not yet terminally fenced bindings. */
 readonly #bound=new Set<string>();
 readonly #cancelled=new Set<string>();
 #closed=false;
 #closing?:Promise<void>;

 private constructor(
  owner:TrustedAuthorityOnlyRemoteEffectOwner,
  registry:TrustedOwnerEffectStagingRegistry,server:ServerHandle
 ){
  this.#owner=owner;this.#registry=registry;this.#server=server;
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
     (multi&&(
      Object.keys(multi).sort().join(",")!=="backend,frontend,test"||
      ROLES.some(role=>!multi[role]||
       typeof multi[role].socketPath!=="string"||
       typeof multi[role].secretFile!=="string")
     ))||
     (!multi&&(typeof opts.agentBindingSocketPath!=="string"||
               typeof opts.agentBindingSecretFile!=="string")))
   deny("exactly one legacy binder or three per-role bind IPC channels required");
  const bindingChannels=multi?ROLES.map(r=>multi[r]):[{
   socketPath:opts.agentBindingSocketPath!,
   secretFile:opts.agentBindingSecretFile!
  }];
  const paths=[
   opts.stageSocketPath,opts.stageSecretFile,
   ...bindingChannels.flatMap(x=>[x.socketPath,x.secretFile])
  ];
  if(paths.some(v=>typeof v!=="string"||!v.startsWith("/")||
     v.includes("\0")||v.length>95)||
     new Set(paths.map(p=>resolve(p))).size!==paths.length)
   deny("distinct short absolute private Unix sockets and secret files required");
  // No two authorization directions or role bind channels share HMAC
  // keys; a compromised Frontend binder cannot enroll Backend Tasks.
  const secretPaths=[opts.stageSecretFile,...bindingChannels.map(x=>x.secretFile)];
  const secrets=await Promise.all(secretPaths.map(loadTrustedPlanIpcSecret));
  for(let i=0;i<secrets.length;i++)
   for(let j=i+1;j<secrets.length;j++)
    if(timingSafeEqual(secrets[i]!,secrets[j]!))
     deny("stage and per-role bind HMAC keys must differ");
  // Confirm the Engineer root BEFORE opening a private listener.
  opts.coordinator.assertTrustedGatewayAuthorityBinding();
  const registry=new TrustedOwnerEffectStagingRegistry();
  const server=await createTrustedOwnerEffectStagingServer({
   socketPath:opts.stageSocketPath,secretFile:opts.stageSecretFile,
   registry
  });
  try{
   await server.start();
   const clients=await Promise.all(bindingChannels.map(ch=>
    connectTrustedEffectAgentBindingClient({
     socketPath:ch.socketPath,secretFile:ch.secretFile
    })
   ));
   const binders=multi
    ?{agentBindingClients:Object.fromEntries(
      ROLES.map((role,i)=>[role,clients[i]!])
     ) as Record<Role,(typeof clients)[number]>}
    :{agentBindingClient:clients[0]!};
   const owner=new TrustedAuthorityOnlyRemoteEffectOwner({
    coordinator:opts.coordinator,childIssuer:opts.childIssuer,
    gateway:opts.gateway,ownerStageRegistry:registry,...binders
   });
   return new TrustedAuthorityOnlyRemoteEffectBootstrap(
    owner,registry,server);
  }catch(error){
   registry.retireAll();
   await server.close();
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
 }):Promise<T>{
  if(this.#closed||!opts||typeof opts.dispatch!=="function"||
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
   return await opts.dispatch();
  }finally{
   this.#pending.delete(opts.runtimeTaskId);
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
  try{
   await this.#owner.fence(runtimeTaskId);
   this.#bound.delete(runtimeTaskId);
  }catch(error){
   if(this.#pending.has(runtimeTaskId)){
    // Binding may not have allocated a local slot yet. Completion of
    // that in-flight bind is terminally fenced in dispatchApprovedTask.
    return;
   }
   throw error;
  }
 }
 close():Promise<void>{
  if(this.#closing)return this.#closing;
  this.#closed=true;
  for(const id of this.#attempted)this.#cancelled.add(id);
  this.#registry.retireAll(); // synchronously block EVERY future stage
  this.#closing=(async()=>{
   // A denied prebind may never allocate a local owner slot and
   // cannot be remotely fenced. R323 already made that attempt terminal.
   // Only ACKed, still-active remote slots require close acknowledgements.
   const names=[...this.#bound];
   const results=await Promise.allSettled([
    ...names.map(id=>this.#owner.fence(id)),
    this.#server.close()
   ]);
   const failures=results.filter(r=>r.status==="rejected");
   if(failures.length)deny("one or more private Task fences were not acknowledged");
  })();
  return this.#closing;
 }
}
export async function startTrustedAuthorityOnlyRemoteEffectBootstrap(
 opts:TrustedAuthorityOnlyRemoteEffectBootstrapOptions){
 return TrustedAuthorityOnlyRemoteEffectBootstrap.start(opts);
}
