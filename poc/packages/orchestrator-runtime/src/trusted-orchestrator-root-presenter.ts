/**
 * R129.3 — private Orchestrator-owned native root VP signing port.
 *
 * The Orchestrator caller token belongs ONLY in this trusted host process.
 * No Gateway process, A2A agent, model or MCP tool receives it. The actual
 * Rust Adapter checks the bearer role; this transport never signs locally.
 */
import type {Permission} from "../../../apps/gateway/src/types.ts";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const AUDIENCE=/^[A-Za-z0-9:._/-]{8,256}$/u;
const NONCE=/^[a-f0-9]{64}$/u;
const OPS=new Set<string>(RUST_OPERATIONS);
const fail=(message:string):never=>{
 throw Error("Trusted root presenter NO-GO: "+message);
};
const key=(p:Readonly<{resource:string;operation:string}>)=>
 JSON.stringify([p.resource,p.operation]);

export class TrustedOrchestratorRootPresenter{
 readonly #url:string;
 readonly #token:string;
 readonly #id:string;
 readonly #allowed:Set<string>;
 readonly #fetch:typeof fetch;
 readonly #timeout:number;
 constructor(options:Readonly<{
  adapterBaseUrl:string;
  orchestratorToken:string;
  rootCredentialId:string;
  rootPermissions:ReadonlyArray<Permission>;
  timeoutMs?:number;
  fetchFn?:typeof fetch;
 }>){
  let url:URL;
  try{url=new URL(options?.adapterBaseUrl);}catch{fail("invalid trusted Adapter URL");}
  if(!["http:","https:"].includes(url.protocol)||!url.hostname||
     url.username||url.password||url.search||url.hash||url.pathname!=="/"||
     typeof options.orchestratorToken!=="string"||
     !options.orchestratorToken.trim()||
     !ID.test(options.rootCredentialId)||
     !Array.isArray(options.rootPermissions)||
     options.rootPermissions.length<1||options.rootPermissions.length>128||
     (options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||
      options.timeoutMs<100||options.timeoutMs>5000)))
   fail("fixed root, private Orchestrator bearer and bounded Adapter required");
  const allowed=new Set<string>();
  for(const p of options.rootPermissions){
   if(!p||typeof p.resource!=="string"||
      !p.resource.startsWith("gitea://")||p.resource.length>2048||
      !OPS.has(p.operation))
    fail("invalid original signed root grant");
   const k=key(p);
   if(allowed.has(k))fail("duplicate original root grant");
   allowed.add(k);
  }
  this.#id=options.rootCredentialId;
  this.#url=url.origin+"/v1/presentations";
  this.#token=options.orchestratorToken;
  this.#allowed=allowed;
  this.#fetch=options.fetchFn??fetch;
  this.#timeout=options.timeoutMs??3000;
 }
 async present(input:Readonly<{
  credential_id:string;disclosed_permissions:ReadonlyArray<Permission>;
  audience:string;challenge:string;
 }>){
  if(input?.credential_id!==this.#id||
     !AUDIENCE.test(input.audience)||!NONCE.test(input.challenge)||
     !Array.isArray(input.disclosed_permissions)||
     input.disclosed_permissions.length<1||
     input.disclosed_permissions.length>this.#allowed.size)
   fail("root ID, Gateway challenge or disclosure not bound");
  const seen=new Set<string>();
  const grants:Permission[]=[];
  for(const g of input.disclosed_permissions){
   if(!g||typeof g.resource!=="string"||typeof g.operation!=="string")
    fail("malformed root disclosure");
   const k=key(g);
   if(seen.has(k)||!this.#allowed.has(k))
    fail("root VP disclosure not within previously issued grants");
   seen.add(k);
   grants.push({resource:g.resource,operation:g.operation});
  }
  let response:Response;
  try{
   response=await this.#fetch(this.#url,{
    method:"POST",
    headers:{authorization:"Bearer "+this.#token,
     "content-type":"application/json"},
    body:JSON.stringify({
     credential_id:this.#id,
     disclosed_permissions:grants,
     audience:input.audience,challenge:input.challenge
    }),
    signal:AbortSignal.timeout(this.#timeout)
   });
  }catch{fail("private Rust Orchestrator presentation signing unavailable");}
  if(!response.ok)fail("Rust refused Orchestrator root presentation");
  let body:unknown;
  try{
   if(Number(response.headers.get("content-length")??"0")>262144)
    fail("oversized native VP response");
   const data=await response.text();
   if(Buffer.byteLength(data,"utf8")>262144)
    fail("oversized native VP response");
   body=JSON.parse(data);
  }catch{fail("invalid native VP response");}
  if(!body||typeof body!=="object"||Array.isArray(body)||
     Object.keys(body).join(",")!=="signed_vp"||
     typeof (body as {signed_vp?:unknown}).signed_vp!=="string"||
     (body as {signed_vp:string}).signed_vp.length<16)
   fail("Rust did not return a bounded signed root presentation");
  return (body as {signed_vp:string}).signed_vp;
 }
}
