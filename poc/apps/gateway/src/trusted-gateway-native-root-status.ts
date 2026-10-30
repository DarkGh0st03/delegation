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
 /** R128: root issuer's own grant array, lifetime and anchored current status;
  * NOT a cryptographically verified signed presentation or permission grant.
  * The request body carries ONLY the root ID taken from the R126 journal. */
 async readIssuedRoot(rootCredentialId:string){
  if(typeof rootCredentialId!=="string"||!ID.test(rootCredentialId))
   reject("bounded journal root credential ID required");
  let response:Response;
  try{
   response=await this.#fetch(this.#baseUrl+"/v1/credentials/root/inspect",{
    method:"POST",
    headers:{authorization:"Bearer "+this.#token,
     "content-type":"application/json"},
    body:JSON.stringify({credential_id:rootCredentialId}),
    signal:AbortSignal.timeout(this.#timeout)
   });
  }catch{reject("authenticated native issuance registry unavailable");}
  if(!response.ok)reject("Rust Adapter denied issuance registry inspection");
  let p:Record<string,unknown>;
  try{
   if(Number(response.headers.get("content-length")??"0")>32768)
    reject("issued root record exceeds bounded response");
   const body=await response.text();
   if(Buffer.byteLength(body,"utf8")>32768)
    reject("issued root record exceeds bounded response");
   const decoded:unknown=JSON.parse(body);
   if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))
    reject("malformed native issued root record");
   p=decoded as Record<string,unknown>;
  }catch{reject("malformed or oversized native issued root response");}
  if(Object.keys(p).sort().join(",")!==
    "credential_id,delegatee_id,exp_ns,iat_ns,issuer_id,permissions,source,status"||
     p.credential_id!==rootCredentialId||
     p.source!=="adapter_local_issued_root"||
     typeof p.issuer_id!=="string"||!p.issuer_id.startsWith("did:")||
     typeof p.delegatee_id!=="string"||!p.delegatee_id.startsWith("did:")||
     typeof p.iat_ns!=="string"||!/^[1-9][0-9]{0,38}$/u.test(p.iat_ns)||
     typeof p.exp_ns!=="string"||!/^[1-9][0-9]{0,38}$/u.test(p.exp_ns))
    reject("native issuance identity or lifetime invalid");
  const now=BigInt(Date.now())*1_000_000n;
  if(BigInt(p.iat_ns)>now||BigInt(p.exp_ns)<=now||
     BigInt(p.exp_ns)<=BigInt(p.iat_ns))
   reject("issued root expired or not yet valid");
  if(!Array.isArray(p.permissions)||!p.permissions.length||
     p.permissions.length>128)
   reject("native issued root grant count invalid");
  const set=new Set<string>();
  const permissions=p.permissions.map((g:unknown)=>{
   if(!g||typeof g!=="object"||Array.isArray(g)||
      Object.keys(g).sort().join(",")!=="operation,resource")
    reject("malformed Rust issued grant");
   const v=g as Record<string,unknown>;
   if(typeof v.resource!=="string"||!v.resource.startsWith("gitea://")||
      v.resource.length>2048||
      typeof v.operation!=="string"||v.operation.length>64)
    reject("invalid issued grant resource or operation");
   const pair=JSON.stringify([v.resource,v.operation]);
   if(set.has(pair))reject("duplicate native issued grant");
   set.add(pair);
   return Object.freeze({resource:v.resource,operation:v.operation});
  });
  const status=p.status;
  if(!status||typeof status!=="object"||Array.isArray(status)||
     Object.keys(status).sort().join(",")!==
      "anchor_version,credential_id,source,status_purpose,status_set")
   reject("malformed issued root revocation status");
  const entry=status as Record<string,unknown>;
  if(entry.credential_id!==rootCredentialId||
     entry.status_purpose!=="revocation"||
     entry.status_set!==false||entry.source!=="evm_anchored_signed_jwt"||
     !Number.isSafeInteger(entry.anchor_version)||
     (entry.anchor_version as number)<0)
   reject("root revocation is stale, unanchored or set");
  return Object.freeze({
   status:"native_adapter_issued_root_claims_observed" as const,
   credential_id:rootCredentialId,
   issuer_id:p.issuer_id as string,
   delegatee_id:p.delegatee_id as string,
   iat_ns:p.iat_ns as string,
   exp_ns:p.exp_ns as string,
   permissions:Object.freeze(permissions),
   anchor_version:entry.anchor_version as number,
   cryptographic_presentation_verified:false as const,
   execution_authorized:false as const
  });
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
