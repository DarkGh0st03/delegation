/**
 * R129: Fresh, independently verified Rust root presentation evidence.
 *
 * This owner-only port requests a NEW nonce-bound VP from the authenticated
 * Orchestrator and has the Gateway's independent Adapter verifier check it.
 * No A2A/model/MCP request can invoke the signing callback. In particular,
 * this is NOT operational epoch admission or a replacement for Gateway's
 * live trusted original-root intake and Rust child issuance.
 */
import {randomBytes} from "node:crypto";
import type {Permission,VerifierPort} from "./types.ts";
import {RUST_OPERATIONS} from "./operation-catalog.ts";

const OPS=new Set<string>(RUST_OPERATIONS);
const DID=/^did:[A-Za-z0-9:._-]{3,250}$/u;
const ROOT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const deny=(m:string):never=>{throw Error("Trusted root VP NO-GO: "+m);};
const key=(p:Readonly<{resource:string;operation:string}>)=>
 JSON.stringify([p.resource,p.operation]);

export interface TrustedRootPresentationSigner{
 present(input:Readonly<{
  credential_id:string;
  disclosed_permissions:ReadonlyArray<Permission>;
  audience:string;
  challenge:string;
 }>):Promise<string>;
}
export class TrustedGatewayRootVpVerifier{
 readonly #verifier:VerifierPort;
 readonly #signer:TrustedRootPresentationSigner;
 readonly #audience:string;
 constructor(config:{verifier:VerifierPort;signer:TrustedRootPresentationSigner;
  audience:string}){
  if(!config||typeof config.verifier?.verifyMultiple!=="function"||
     typeof config.signer?.present!=="function"||
     typeof config.audience!=="string"||
     config.audience.length<8||config.audience.length>256||
     !/^[A-Za-z0-9:._/-]+$/u.test(config.audience))
   deny("pinned Gateway verifier, private Orchestrator signer and audience required");
  this.#verifier=config.verifier;
  this.#signer=config.signer;
  this.#audience=config.audience;
 }
 async verifyRoot(input:Readonly<{
  credential_id:string;engineer_did:string;orchestrator_did:string;
  required_permissions:ReadonlyArray<Permission>;
 }>){
  if(!input||!ROOT.test(input.credential_id)||
     !DID.test(input.engineer_did)||!DID.test(input.orchestrator_did)||
     !Array.isArray(input.required_permissions)||
     input.required_permissions.length<1||input.required_permissions.length>128)
   deny("original root identity and nonempty bounded Rust grants required");
  const keys=new Set<string>();
  const permissions:Permission[]=[];
  for(const grant of input.required_permissions){
   if(!grant||typeof grant.resource!=="string"||
      !grant.resource.startsWith("gitea://")||grant.resource.length>2048||
      !OPS.has(grant.operation))
    deny("noncanonical requested Rust permission");
   const k=key(grant);
   if(keys.has(k))deny("duplicate original root permission");
   keys.add(k);permissions.push(Object.freeze({
    resource:grant.resource,operation:grant.operation
   }));
  }
  // Each verification gets an independent, unpredictable Gateway challenge,
  // even if the owner retries after a rejected presentation.
  const challenge=randomBytes(32).toString("hex");
  let signed:string;
  try{
   signed=await this.#signer.present(Object.freeze({
    credential_id:input.credential_id,
    disclosed_permissions:Object.freeze(permissions),
    audience:this.#audience,challenge
   }));
  }catch{deny("original Orchestrator failed to present root");}
  if(typeof signed!=="string"||signed.length<16||
     Buffer.byteLength(signed,"utf8")>256*1024)
   deny("missing or oversized signed root VP");
  // Rust Core verifies actual accumulator witnesses, trusted issuer
  // materials, signature, audience, challenge, expiry and revocation.
  const verified=await this.#verifier.verifyMultiple!({
   presenter:"orchestrator",audience:this.#audience,challenge,
   required_permissions:permissions,signed_vp:signed
  });
  if(!verified||verified.presenter_id!==input.orchestrator_did||
     verified.credential_id!==input.credential_id||
     verified.issuer_id!==input.engineer_did||
     verified.hierarchy_depth!==0||
     !Array.isArray(verified.permissions)||
     verified.permissions.length!==permissions.length)
   deny("verified Rust delegation is not exact Engineer root");
  const remaining=new Set(keys);
  for(const p of verified.permissions){
   const k=key(p);
   if(!remaining.delete(k))deny("Rust VP returned altered, duplicate or extra grant");
  }
  if(remaining.size)deny("Rust VP omitted an approved grant");
  let expiration:bigint;
  try{
   const value=verified.expiration;
   if(typeof value==="string"){
    if(!/^[1-9][0-9]{0,38}$/u.test(value))deny("invalid Rust VP expiration");
    expiration=BigInt(value);
   }else{
    // Rust's legacy u128 JSON serialization may arrive as an imprecise
    // JS number; this SECONDARY check is intentionally conservative.
    // Rust's verifier is authoritative for nanosecond-level validity.
    if(!Number.isFinite(value)||value<=0)deny("invalid Rust VP expiration");
    expiration=BigInt(Math.trunc(value));
   }
  }catch{deny("malformed Rust VP expiration");}
  if(expiration<=BigInt(Date.now())*1_000_000n)
   deny("verified Rust root VP expired");
  return Object.freeze({
   status:"rust_root_vp_verified_not_epoch_admitted" as const,
   credential_id:input.credential_id,
   presenter_id:input.orchestrator_did,
   issuer_id:input.engineer_did,
   verified_permission_count:permissions.length,
   proof_challenge_verified:true as const,
   cryptographic_presentation_verified:true as const,
   // Critical: even a genuine verified root VP alone cannot admit an
   // epoch, create a child DC, or run Gitea/Docker.
   gateway_epoch_admitted:false as const,
   execution_authorized:false as const,
   child_credential_issued:false as const
  });
 }
}
