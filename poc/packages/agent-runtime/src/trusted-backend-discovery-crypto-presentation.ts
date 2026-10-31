/**
 * R151.35 — trusted Backend holder adapter for normal Gateway Prepare.
 *
 * Never register this as a Gemini tool. The model can request read_file,
 * but the private holder decides whether to sign each fresh Gateway nonce.
 * This only supplies a VP to the ordinary Gateway Execute endpoint. The
 * Gateway must STILL independently check native Rust VP, OPA, exact bound
 * Task, issuer, child ID and source resource before contacting Gitea.
 */
import type {CryptoPresentationPort} from "./trusted-crypto-mcp-bridge.ts";
import type {PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";
import {TrustedBackendDiscoveryChildPresenter} from
 "./trusted-backend-discovery-presenter.ts";
import {isTrustedDiscoveryChallenge} from
 "./trusted-discovery-challenge.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const AUD=/^[A-Za-z0-9:._/-]{8,256}$/u;
const RESOURCE=/^gitea:\/\/[^/?#\s]+\/[^/?#\s]+\/[^/?#\s]+\/branches\/[^/?#\s]+\/files\/[^?#\s]+$/u;
const MAX_ATTEMPTS=4,MAX_TTL=120000;
const deny=(why:string):never=>{
 throw Error("Trusted Backend discovery crypto NO-GO: "+why);
};

export class TrustedBackendDiscoveryCryptoPresentation
 implements CryptoPresentationPort{
 readonly #holder:TrustedBackendDiscoveryChildPresenter;
 readonly #credential:string;
 readonly #resource:string;
 readonly #audience:string;
 readonly #isTaskActive:()=>boolean;
 readonly #seenRequests=new Set<string>();
 readonly #seenChallenges=new Set<string>();
 #fenced=false;
 #busy=false;
 constructor(config:Readonly<{
  holder:TrustedBackendDiscoveryChildPresenter;
  childCredentialId:string;resource:string;audience:string;
  isTaskActive:()=>boolean;
 }>){
  if(!(config?.holder instanceof TrustedBackendDiscoveryChildPresenter)||
     !ID.test(config.childCredentialId)||
     typeof config.resource!=="string"||
     !RESOURCE.test(config.resource)||config.resource.length>2048||
     !AUD.test(config.audience)||typeof config.isTaskActive!=="function")
   deny("private holder and exact Backend Child read required");
  this.#holder=config.holder;
  this.#credential=config.childCredentialId;
  this.#resource=config.resource;
  this.#audience=config.audience;
  this.#isTaskActive=config.isTaskActive;
  this.#assertActive();
 }
 #assertActive(){
  if(this.#fenced||!this.#isTaskActive())
   deny("Backend discovery Task closed or cancelled");
 }
 /** R151.36: trusted owner config cannot substitute another Child signer. */
 matchesPins(pins:Readonly<{childCredentialId:string;resource:string;audience:string}>){
  return !!pins&&pins.childCredentialId===this.#credential&&
   pins.resource===this.#resource&&pins.audience===this.#audience;
 }
 /** A canceled/retired Task cannot issue any additional proof. */
 fence(){this.#fenced=true;this.#holder.fence();}
 async createSignedPresentation(prepared:PreparedGatewayAuthorization){
  this.#assertActive();
  if(this.#busy)deny("concurrent challenge signing denied");
  if(!prepared||typeof prepared!=="object"||
     Object.keys(prepared).sort().join(",")!==
     "audience,challenge,expires_at,request_id,required_permission"||
     !ID.test(prepared.request_id)||
     prepared.audience!==this.#audience||
     !isTrustedDiscoveryChallenge(prepared.challenge)||
     !prepared.required_permission||
     Object.keys(prepared.required_permission).sort().join(",")!==
       "operation,resource"||
     prepared.required_permission.operation!=="read_file"||
     prepared.required_permission.resource!==this.#resource)
   deny("Gateway Prepare not bound to pinned Backend discovery Child");
  const expiry=Date.parse(prepared.expires_at);
  if(!Number.isFinite(expiry)||expiry<=Date.now()||
     expiry>Date.now()+MAX_TTL)
   deny("missing, expired or excessive Gateway challenge TTL");
  if(this.#seenRequests.has(prepared.request_id)||
     this.#seenChallenges.has(prepared.challenge)||
     this.#seenRequests.size>=MAX_ATTEMPTS)
   deny("replayed Gateway request/challenge or discovery read budget exhausted");
  // Consume before native signing: ambiguous errors never authorize retry.
  this.#seenRequests.add(prepared.request_id);
  this.#seenChallenges.add(prepared.challenge);
  this.#busy=true;
  try{
   this.#assertActive();
   const signed=await this.#holder.present({
    credential_id:this.#credential,audience:this.#audience,
    challenge:prepared.challenge,
    disclosed_permissions:[{resource:this.#resource,operation:"read_file"}]
   });
   this.#assertActive();
   if(typeof signed!=="string"||signed.length<16||
      Buffer.byteLength(signed,"utf8")>256*1024)
    deny("missing or oversized Rust Child VP");
   return signed;
  }finally{this.#busy=false;}
 }
}
