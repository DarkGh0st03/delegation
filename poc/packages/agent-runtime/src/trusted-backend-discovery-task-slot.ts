/**
 * R151.40: Backend-owned, one-use dynamic signer slot.
 *
 * The Orchestrator chooses a fresh random dispatch ID only AFTER the
 * Gateway admitted and bound the read-only discovery Task. This holder,
 * already installed on the Backend host, cannot be chosen by the A2A
 * caller/model. An authenticated owner control channel must invoke
 * prepare()/fence(); they must NEVER be published as A2A or MCP tools.
 *
 * The slot DOES NOT verify Gateway authorization; the Gateway's fresh
 * Rust/OPA Prepare/Execute remains authoritative.
 */
import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {canonicalFileUri} from "../../../apps/gateway/src/canonical.ts";
import type {AgentTaskContext} from "./contracts.ts";
import {TrustedBackendDiscoveryChildPresenter} from
 "./trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryCryptoPresentation} from
 "./trusted-backend-discovery-crypto-presentation.ts";
import {validateTrustedBackendDiscoveryA2ABinding,
 selectTrustedBackendDiscoveryA2A,
 type TrustedBackendDiscoveryA2ABinding} from
 "./trusted-backend-discovery-a2a-binding.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const deny=(why:string):never=>{throw Error("Trusted Backend discovery slot NO-GO: "+why);};
type Pins=Readonly<{
 planTaskId:string;childCredentialId:string;presenterId:string;
 repository:Readonly<{authority:string;owner:string;repository:string}>;
 branch:string;path:string;resource:string;
 audience:"cloud-access-gateway";
}>;
type PrebindRequest=Readonly<{
 runtime_task_id:string;plan_task_id:string;credential_id:string;
 presenter_id:string;branch:string;path:string;resource:string;
 audience:"cloud-access-gateway";
}>;
export class TrustedBackendDiscoveryTaskSlot {
 readonly #pins:Pins;
 readonly #holder:TrustedBackendDiscoveryChildPresenter;
 #binding?:TrustedBackendDiscoveryA2ABinding;
 #reserved=false;
 #retired=false;
 #captured=false;
 #taken=false;
 #source?:Readonly<{
  revision:string;content:string;bytes:number;sha256:string;
  branch:string;path:string;resource:string;
 }>;
 constructor(config:Readonly<Pins & {holder:TrustedBackendDiscoveryChildPresenter}>){
  if(!config||!ID.test(config.planTaskId)||!ID.test(config.childCredentialId)||
     !/^did:[A-Za-z0-9:._-]{6,240}$/u.test(config.presenterId)||
     !(config.holder instanceof TrustedBackendDiscoveryChildPresenter)||
     typeof config.branch!=="string"||typeof config.path!=="string"||
     config.audience!=="cloud-access-gateway")
   deny("fixed Child, Backend DID and native signer required");
  let canonical:string;
  try{canonical=canonicalFileUri(config.repository,config.branch,config.path);}
  catch{deny("unrecognized Gitea repository or branch");}
  if(canonical!==config.resource)deny("noncanonical fixed discovery file");
  // Bind the signer to the config's immutable Child in the holder itself.
  this.#holder=config.holder;
  this.#pins=Object.freeze({
   planTaskId:config.planTaskId,childCredentialId:config.childCredentialId,
   presenterId:config.presenterId,repository:Object.freeze({...config.repository}),
   branch:config.branch,path:config.path,resource:config.resource,
   audience:"cloud-access-gateway" as const
  });
 }
 /** One owner-only call after Gateway admission and private bind receipt. */
 async prepare(req:PrebindRequest){
  if(this.#reserved||this.#retired)deny("slot already consumed");
  this.#reserved=true; // cannot retry after an ambiguous or malformed request
  const p=this.#pins;
  if(!req||Object.keys(req).sort().join(",")!==
      "audience,branch,credential_id,path,plan_task_id,presenter_id,resource,runtime_task_id"||
     !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(req.runtime_task_id)||
     req.plan_task_id!==p.planTaskId||
     req.credential_id!==p.childCredentialId||
     req.presenter_id!==p.presenterId||
     req.branch!==p.branch||req.path!==p.path||
     req.resource!==p.resource||req.audience!==p.audience)
   deny("owner pins do not match unique authorized Gateway Backend Task");
  const presentation=new TrustedBackendDiscoveryCryptoPresentation({
   holder:this.#holder,childCredentialId:p.childCredentialId,
   resource:p.resource,audience:p.audience,
   isTaskActive:()=>!this.#retired
  });
  const binding:TrustedBackendDiscoveryA2ABinding={
   runtimeTaskId:req.runtime_task_id,
   planTaskId:p.planTaskId,childCredentialId:p.childCredentialId,
   presenterId:p.presenterId,repository:p.repository,
   branch:p.branch,path:p.path,resource:p.resource,audience:p.audience,
   presentation
  };
  validateTrustedBackendDiscoveryA2ABinding(binding);
  this.#binding=Object.freeze(binding);
  return Object.freeze({
   status:"backend_discovery_read_prebound_not_executed" as const,
   runtime_task_id:req.runtime_task_id,plan_task_id:p.planTaskId,
   credential_id:p.childCredentialId,presenter_id:p.presenterId,
   resource:p.resource,execution_authorized:false as const,
   source_read:false as const
  });
 }
 /** Only the already prebound Task can use this otherwise inactive signer. */
 bindingFor(context:AgentTaskContext){
  const b=this.#binding;
  if(!b)return undefined;
  // A matching but malformed A2A Task must fail closed, not silently
  // fall back to a generic Adapter bearer.
  return selectTrustedBackendDiscoveryA2A(b,context);
 }
 /**
  * Trusted Backend-only callback from an actual successful Gateway Execute.
  * The A2A caller and model never receive an accessor for this private slot.
  * Capture is one-use, <=32 KiB, and is NOT evidence of Gateway completion.
  */
 captureGatewaySource(runtimeTaskId:string,result:unknown):void{
  const b=this.#binding,p=this.#pins;
  if(this.#captured||this.#taken||this.#retired||
     !b||b.runtimeTaskId!==runtimeTaskId)
   deny("no active unique Backend discovery read capture");
  this.#captured=true; // reserve even if malformed: no second source attempt
  if(!result||typeof result!=="object"||Array.isArray(result))
   deny("Gateway source read is not an object");
  const v=result as Record<string,unknown>;
  if(v.provider!=="gitea"||v.performed!==true||
     v.tool!=="read_file"||v.branch!==p.branch||
     v.path!==p.path||typeof v.revision!=="string"||
     !/^[a-f0-9]{40}$/u.test(v.revision)||
     v.encoding!=="utf-8"||
     typeof v.content!=="string"||!v.content.length||
     v.content.includes("\0")||
     !Number.isSafeInteger(v.size))
   deny("Gateway source differs from exact signed Backend discovery file");
  const content=v.content as string;
  const bytes=Buffer.byteLength(content,"utf8");
  if(bytes>32768||bytes!==(v.size as number))
   deny("Gateway source is too large or has invalid byte count");
  this.#source=Object.freeze({
   revision:v.revision as string,content,bytes,
   sha256:createHash("sha256").update(content,"utf8").digest("hex"),
   branch:p.branch,path:p.path,resource:p.resource
  });
 }
 /**
  * The authenticated owner may extract the one source snapshot privately.
  * Reading consumes it. It must independently check Gateway provider ledger
  * and SHA-256 BEFORE using these untrusted bytes in repair inference.
  */
 takeCapturedSource(runtimeTaskId:string){
  const b=this.#binding;
  if(this.#retired||this.#taken||!b||
     b.runtimeTaskId!==runtimeTaskId||!this.#source)
   deny("no one-use captured source for exact Backend Task");
  this.#taken=true;
  const snapshot=this.#source;
  this.#source=undefined;
  return snapshot;
 }
 /** Authenticated owner task retirement; also valid after unknown bind. */
 async fence(runtimeTaskId:string){
  if(!/^dispatch_[A-Za-z0-9_-]{22}$/u.test(runtimeTaskId))deny("invalid task fence");
  if(this.#binding&&this.#binding.runtimeTaskId!==runtimeTaskId)
   deny("foreign Task cannot retire a live Backend holder");
  this.retireAll();
 }
 /** A process or socket shutdown must revoke the private holder even
  * without any matching runtime ID or completed A2A Task. */
 retireAll(){
  this.#retired=true;this.#reserved=true;
  this.#source=undefined;
  this.#binding?.presentation.fence();
  this.#holder.fence();
 }
}
