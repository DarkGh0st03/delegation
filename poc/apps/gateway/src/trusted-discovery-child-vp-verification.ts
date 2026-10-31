/**
 * R151.27: fresh, independent Rust verification of the exactly journalled
 * Backend discovery Child DC. No Task admission or provider read follows.
 *
 * Only the Gateway's authenticated signed-epoch inspector may select the
 * child credential. No caller-supplied VP, issuer or grant is trusted.
 * A separate private Backend-holder signer produces a nonce-bound VP.
 */
import {TrustedBackendDiscoveryVpSocketClient} from
 "../../../packages/agent-runtime/src/trusted-backend-discovery-vp-private-ipc.ts";
import {randomBytes} from "node:crypto";
import type {Permission,VerifierPort} from "./types.ts";
import {TrustedGatewaySignedEpochInspector} from
 "./trusted-gateway-signed-epoch-inspector.ts";

const AUDIENCE=/^[A-Za-z0-9:._/-]{8,256}$/u;
const deny=(s:string):never=>{throw Error("Trusted discovery Child VP NO-GO: "+s);};
type Pins=Readonly<{
 session_id:string;root_plan_digest:string;plan_digest:string;
 epoch:number;task_id:string;resource:string;
}>;
export interface TrustedDiscoveryChildPresentationSigner{
 present(input:Readonly<{
  credential_id:string;audience:string;challenge:string;
  disclosed_permissions:ReadonlyArray<Permission>;
 }>):Promise<string>;
}
export class TrustedGatewayDiscoveryChildVpVerifier{
 readonly #inspector:TrustedGatewaySignedEpochInspector;
 readonly #verifier:VerifierPort;
 readonly #signer:TrustedDiscoveryChildPresentationSigner;
 readonly #audience:string;
 constructor(options:Readonly<{
  inspector:TrustedGatewaySignedEpochInspector;
  verifier:VerifierPort;signer:TrustedDiscoveryChildPresentationSigner;
  audience:string;
 }>){
  if(!(options?.inspector instanceof TrustedGatewaySignedEpochInspector)||
     !options.inspector.nativeRootVpConfigured()||
     typeof options.verifier?.verifyMultiple!=="function"||
     typeof options.signer?.present!=="function"||
     typeof options.audience!=="string"||
     !AUDIENCE.test(options.audience))
   deny("protected Gateway journal, Rust verifier, holder signer and audience required");
  this.#inspector=options.inspector;
  this.#verifier=options.verifier;
  this.#signer=options.signer;
  this.#audience=options.audience;
 }
 /** The HMAC IPC must use the exact Gateway epoch inspector, never a clone. */
 usesInspector(inspector:TrustedGatewaySignedEpochInspector):boolean{
  return this.#inspector===inspector;
 }
 async verifyChild(pins:Pins){
  const before=await this.#inspector.inspectDiscoveryChildCandidate(pins);
  if(before.status!=="discovery_child_candidate_verified_not_admitted"||
     before.session_id!==pins.session_id||
     before.root_plan_digest!==pins.root_plan_digest||
     before.plan_digest!==pins.plan_digest||
     before.epoch!==pins.epoch||before.task_id!==pins.task_id||
     before.resource!==pins.resource||before.agent_role!=="backend"||
     before.operation!=="read_file"||
     before.adapter_response_acknowledged!==true||
     before.child_vp_verified!==false||
     before.execution_authorized!==false||
     before.gateway_task_admitted!==false)
   deny("candidate not pinned to original signed Backend read-only scope");
  const required:Permission=Object.freeze({
   resource:before.resource,operation:"read_file"
  });
  const challenge=randomBytes(32).toString("hex");
  let vp:string;
  try{
   vp=await this.#signer.present(Object.freeze({
    credential_id:before.credential_id,audience:this.#audience,
    challenge,disclosed_permissions:Object.freeze([required])
   }));
  }catch{deny("private Backend holder refused exact discovery presentation");}
  if(typeof vp!=="string"||vp.length<16||
     Buffer.byteLength(vp,"utf8")>256*1024)
   deny("missing or oversized signed discovery VP");
  // Rust Core checks the cryptographic signature, nonce/audience, EVM status,
  // expiry and revocation; all output claims are compared to journal pins.
  const verified=await this.#verifier.verifyMultiple!({
   presenter:"backend",audience:this.#audience,challenge,
   required_permissions:[required],signed_vp:vp
  });
  if(!verified||verified.presenter_id!==before.agent_did||
     verified.issuer_id!==this.#inspector.trustedOrchestratorDid()||
     verified.credential_id!==before.credential_id||
     verified.hierarchy_depth!==1||
     !Array.isArray(verified.permissions)||verified.permissions.length!==1||
     verified.permissions[0]?.resource!==required.resource||
     verified.permissions[0]?.operation!=="read_file")
   deny("Rust VP differs from pinned child identity, issuer or attenuation");
  let expiration:bigint;
  try{
   if(typeof verified.expiration==="string"){
    if(!/^[1-9][0-9]{0,38}$/u.test(verified.expiration))
     deny("invalid native expiry");
    expiration=BigInt(verified.expiration);
   }else{
    if(!Number.isFinite(verified.expiration)||verified.expiration<=0)
     deny("invalid native expiry");
    expiration=BigInt(Math.trunc(verified.expiration));
   }
  }catch{deny("invalid native expiry");}
  if(expiration<=BigInt(Date.now())*1_000_000n)
   deny("verified discovery Child DC expired");
  // Repeat signed epoch, live root, EVM status and protected journal checks
  // after the cryptographic verifier; a stale proof must never authorize IO.
  const after=await this.#inspector.inspectDiscoveryChildCandidate(pins);
  if(after.status!==before.status||
     after.root_credential_id!==before.root_credential_id||
     after.credential_id!==before.credential_id||
     after.agent_did!==before.agent_did||
     after.epoch!==before.epoch||
     after.plan_digest!==before.plan_digest||
     after.resource!==before.resource||
     after.task_id!==before.task_id||
     after.child_vp_verified!==false||
     after.gateway_task_admitted!==false||
     after.execution_authorized!==false)
   deny("root, journal or discovery identity changed during VP verification");
  return Object.freeze({
   status:"discovery_child_vp_verified_not_admitted" as const,
   session_id:before.session_id,
   root_plan_digest:before.root_plan_digest,
   plan_digest:before.plan_digest,epoch:before.epoch,
   task_id:before.task_id,resource:before.resource,
   agent_did:before.agent_did,
   credential_id:before.credential_id,
   root_credential_id:before.root_credential_id,
   operation:"read_file" as const,
   cryptographic_presentation_verified:true as const,
   gateway_task_admitted:false as const,
   execution_authorized:false as const,source_read:false as const
  });
 }
}

/**
 * R151.30: exclusively trusted Gateway-side composition. Socket authentication
 * is independent from the Rust Core proof check above; no caller-supplied VP,
 * Task grant, source content or admission flag crosses this boundary.
 */
export async function connectTrustedGatewayDiscoveryChildVpVerifier(options:Readonly<{
 inspector:TrustedGatewaySignedEpochInspector;
 verifier:VerifierPort;
 audience:string;
 backendSocketPath:string;
 backendSecretFile:string;
}>):Promise<TrustedGatewayDiscoveryChildVpVerifier>{
 if(!(options?.inspector instanceof TrustedGatewaySignedEpochInspector)||
    !options.inspector.nativeRootVpConfigured()||
    typeof options.verifier?.verifyMultiple!=="function"||
    typeof options.audience!=="string"||!AUDIENCE.test(options.audience))
  deny("trusted Gateway inspector, native verifier and fixed audience required");
 const signer=await TrustedBackendDiscoveryVpSocketClient.connect({
  socketPath:options.backendSocketPath,
  secretFile:options.backendSecretFile
 });
 return new TrustedGatewayDiscoveryChildVpVerifier({
  inspector:options.inspector,verifier:options.verifier,
  signer,audience:options.audience
 });
}
