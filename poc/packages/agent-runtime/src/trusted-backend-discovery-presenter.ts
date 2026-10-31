/**
 * R151.28 — Backend-holder-only native Rust discovery presentation.
 *
 * The Backend Adapter bearer is owned by the trusted Backend runtime, never
 * by Gemini, A2A payloads, MCP, the Orchestrator, or the Gateway. This port
 * signs ONLY the one journal-selected read_file Child DC when asked by a
 * private trusted caller. The Gateway must independently verify the resulting
 * VP (R151.27); signing does not admit a Task or read any source.
 */
import type {Permission} from "../../../apps/gateway/src/types.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const AUDIENCE=/^[A-Za-z0-9:._/-]{8,256}$/u;
const CHALLENGE=/^[a-f0-9]{64}$/u;
const MAX_VP_BYTES=256*1024;
const MAX_CHALLENGES=32;
const deny=(why:string):never=>{
 throw Error("Trusted Backend discovery presenter NO-GO: "+why);
};

export class TrustedBackendDiscoveryChildPresenter {
 readonly #url:string;
 readonly #backendToken:string;
 readonly #credentialId:string;
 readonly #resource:string;
 readonly #audience:string;
 readonly #fetch:typeof fetch;
 readonly #timeoutMs:number;
 readonly #isTaskActive:()=>boolean;
 readonly #seen=new Set<string>();
 #fenced=false;

 constructor(config:Readonly<{
  adapterBaseUrl:string;
  backendToken:string;
  childCredentialId:string;
  resource:string;
  audience:string;
  isTaskActive:()=>boolean;
  timeoutMs?:number;
  fetchFn?:typeof fetch;
 }>){
  let url:URL;
  try{url=new URL(config?.adapterBaseUrl);}catch{deny("invalid Rust Adapter URL");}
  if(!["http:","https:"].includes(url.protocol)||!url.hostname||
     url.username||url.password||url.search||url.hash||url.pathname!=="/"||
     typeof config.backendToken!=="string"||!config.backendToken.trim()||
     !ID.test(config.childCredentialId)||
     typeof config.resource!=="string"||
     !config.resource.startsWith("gitea://")||
     config.resource.length>2048||
     !AUDIENCE.test(config.audience)||
     typeof config.isTaskActive!=="function"||
     (config.timeoutMs!==undefined&&
      (!Number.isSafeInteger(config.timeoutMs)||
       config.timeoutMs<100||config.timeoutMs>5000))||
     (config.fetchFn!==undefined&&typeof config.fetchFn!=="function"))
   deny("private Backend identity, exact Child read, audience and lifecycle required");
  this.#url=url.origin+"/v1/presentations";
  this.#backendToken=config.backendToken;
  this.#credentialId=config.childCredentialId;
  this.#resource=config.resource;
  this.#audience=config.audience;
  this.#fetch=config.fetchFn??fetch;
  this.#timeoutMs=config.timeoutMs??3000;
  this.#isTaskActive=config.isTaskActive;
  this.#assertActive();
 }

 #assertActive(){
  if(this.#fenced||!this.#isTaskActive())
   deny("Backend task closed or cancelled");
 }

 /** Called on cancellation, root retirement, session shutdown or failure. */
 fence(){this.#fenced=true;}

 async present(input:Readonly<{
  credential_id:string;
  audience:string;
  challenge:string;
  disclosed_permissions:ReadonlyArray<Permission>;
 }>):Promise<string>{
  this.#assertActive();
  if(!input||
     input.credential_id!==this.#credentialId||
     input.audience!==this.#audience||
     !CHALLENGE.test(input.challenge)||
     !Array.isArray(input.disclosed_permissions)||
     input.disclosed_permissions.length!==1)
   deny("presentation must pin one original discovery Child and Gateway challenge");
  const [grant]=input.disclosed_permissions;
  if(!grant||Object.keys(grant).sort().join(",")!=="operation,resource"||
     grant.resource!==this.#resource||grant.operation!=="read_file")
   deny("disclosure must be the exact read-only Child permission");
  if(this.#seen.has(input.challenge)||this.#seen.size>=MAX_CHALLENGES)
   deny("replayed challenge or bounded signing budget exhausted");
  // Consume BEFORE the external request. Ambiguous Adapter failures cannot
  // make this holder sign the same Gateway challenge again.
  this.#seen.add(input.challenge);
  this.#assertActive();
  let response:Response;
  try{
   response=await this.#fetch(this.#url,{
    method:"POST",
    headers:{
     authorization:"Bearer "+this.#backendToken,
     "content-type":"application/json",
     accept:"application/json"
    },
    body:JSON.stringify({
     credential_id:this.#credentialId,
     disclosed_permissions:[{resource:this.#resource,operation:"read_file"}],
     audience:this.#audience,
     challenge:input.challenge
    }),
    signal:AbortSignal.timeout(this.#timeoutMs)
   });
  }catch{deny("Backend Rust Adapter presentation unavailable");}
  this.#assertActive();
  if(!response.ok)deny("Rust refused Backend Child presentation");
  let result:unknown;
  try{
   const length=Number(response.headers.get("content-length")??"0");
   if(!Number.isSafeInteger(length)||length<0||length>MAX_VP_BYTES)
    deny("oversized Rust VP response");
   const data=await response.text();
   if(Buffer.byteLength(data,"utf8")>MAX_VP_BYTES)
    deny("oversized Rust VP response");
   result=JSON.parse(data);
  }catch{deny("malformed Backend VP response");}
  this.#assertActive();
  if(!result||typeof result!=="object"||Array.isArray(result)||
     Object.keys(result).sort().join(",")!=="signed_vp"||
     typeof (result as {signed_vp?:unknown}).signed_vp!=="string"||
     (result as {signed_vp:string}).signed_vp.length<16||
     Buffer.byteLength((result as {signed_vp:string}).signed_vp,"utf8")>MAX_VP_BYTES)
   deny("Rust did not return one bounded signed VP");
  // This is evidence, not permission. Gateway must independently verify
  // signature, holder DID, issuer, root, attenuation, challenge and status.
  return (result as {signed_vp:string}).signed_vp;
 }
}
