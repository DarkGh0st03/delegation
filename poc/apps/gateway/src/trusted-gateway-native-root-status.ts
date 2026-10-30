/**
 * R127: Gateway-only observation against the ALREADY-EXISTING Rust Adapter
 * POST /v1/credentials/status/inspect. Only the Gateway bearer may call it.
 *
 * In EVM profile the Rust Adapter reads its own issued-credential registry
 * and verifies anchored signed Status List JWT revocation. This does NOT
 * return, verify or grant root DC permission contents or validity bounds.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const reject=(m:string):never=>{throw Error("Native Rust root status NO-GO: "+m);};
export class TrustedGatewayNativeRootStatusReader{
 readonly #baseUrl:string;
 readonly #token:string;
 readonly #timeout:number;
 readonly #fetch:typeof fetch;
 constructor(options:{baseUrl:string;gatewayToken:string;timeoutMs?:number;
  fetchFn?:typeof fetch}){
  let url:URL;
  try{url=new URL(options?.baseUrl);}catch{reject("invalid fixed Adapter URL");}
  if(!["http:","https:"].includes(url.protocol)||
     !url.hostname||url.username||url.password||url.search||url.hash||
     url.pathname!=="/"||
     typeof options.gatewayToken!=="string"||
     !options.gatewayToken.trim()||
     (options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||
       options.timeoutMs<100||options.timeoutMs>5000)))
   reject("trusted Adapter URL, private Gateway bearer and bounded timeout required");
  this.#baseUrl=url.origin;this.#token=options.gatewayToken;
  this.#timeout=options.timeoutMs??3000;
  this.#fetch=options.fetchFn??fetch;
 }
 async readActiveRoot(rootCredentialId:string){
  if(typeof rootCredentialId!=="string"||!ID.test(rootCredentialId))
   reject("bounded journal root credential ID required");
  let response:Response;
  try{
   response=await this.#fetch(this.#baseUrl+"/v1/credentials/status/inspect",{
    method:"POST",headers:{
     authorization:"Bearer "+this.#token,
     "content-type":"application/json"
    },body:JSON.stringify({credential_id:rootCredentialId}),
    signal:AbortSignal.timeout(this.#timeout)
   });
  }catch{reject("authenticated Adapter status unavailable");}
  if(!response.ok)reject("Rust Adapter denied native credential inspection");
  let payload:unknown;
  try{
   if(Number(response.headers.get("content-length")??"0")>2048)
    reject("oversized native credential status");
   const body=await response.text();
   if(Buffer.byteLength(body,"utf8")>2048)reject("oversized status response");
   payload=JSON.parse(body);
  }catch{reject("malformed native credential status response");}
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
   reject("native credential status is not an object");
  const p=payload as Record<string,unknown>;
  if(Object.keys(p).sort().join(",")!==
     "anchor_version,credential_id,source,status_purpose,status_set"||
     p.credential_id!==rootCredentialId||p.status_purpose!=="revocation"||
     p.status_set!==false||p.source!=="evm_anchored_signed_jwt"||
     !Number.isSafeInteger(p.anchor_version)||
     (p.anchor_version as number)<0)
   reject("root is missing, revoked, unanchored or not independently corroborated");
  return Object.freeze({
   status:"native_adapter_root_id_nonrevoked_evm_anchored" as const,
   root_credential_id:rootCredentialId,
   native_source:"evm_anchored_signed_jwt" as const,
   anchor_version:p.anchor_version as number,
   execution_authorized:false as const
  });
 }
}
