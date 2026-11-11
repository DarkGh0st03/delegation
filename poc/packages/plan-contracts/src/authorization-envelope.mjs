/**
 * Engineer-signed maximum delegation scope, independent of operational Tasks.
 * A signature is never itself a Gateway authorization or evidence of human
 * authentication: the caller must verify an independently pinned Engineer key.
 * Existing signed-DAG runtime remains unchanged until new enforcement ships.
 */
import {createHash,createPrivateKey,createPublicKey,sign,verify} from "node:crypto";
import {validatePlan} from "./plan.mjs";
import {approvedWorkBranch} from "./approved-work-branch.mjs";

export const ENVELOPE_SCHEMA_VERSION="1.0.0";
const DOMAIN="delegation.engineer.resource-envelope.v1";
const HOST=/^[a-z0-9][a-z0-9.-]*$/u;
const SEG=/^[A-Za-z0-9_@.-]+$/u;
const BRANCH=/^feature\/[a-z0-9][a-z0-9./_-]*$/u;
const OP=/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DID=/^did:[a-z0-9]+:.+$/u;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u;
const MAX_MS=24*60*60*1000;
function fail(msg){throw Error("Engineer resource envelope: "+msg);}
function exact(obj,fields){
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||
   Object.keys(obj).length!==fields.length||
   fields.some(k=>!Object.hasOwn(obj,k)))fail("invalid fields");
}
function canonical(x){
 if(Array.isArray(x))return x.map(canonical);
 if(x&&typeof x==="object")return Object.fromEntries(
   Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
 return x;
}
function json(x){return Buffer.from(JSON.stringify(canonical(x)),"utf8");}
function segment(x){return typeof x==="string"&&x.length>0&&x.length<=120&&
 SEG.test(x)&&x!=="."&&x!==".."&&!x.includes("..");}
function uriRoot(r){return "gitea://"+r.authority+"/"+encodeURIComponent(r.owner)+"/"+encodeURIComponent(r.repository);}
function canonicalResource(uri,r,branch){
 if(typeof uri!=="string"||uri.length>1024)return false;
 const root=uriRoot(r),prefix=root+"/branches/"+encodeURIComponent(branch);
 if(uri===root||uri===prefix||uri===prefix+"/directories")return true;
 let relative;
 if(uri.startsWith(prefix+"/files/"))relative=uri.slice((prefix+"/files/").length);
 else if(uri.startsWith(prefix+"/directories/"))relative=uri.slice((prefix+"/directories/").length);
 else return false;
 if(!relative)return false;
 return relative.split("/").every(part=>{
   try{const decoded=decodeURIComponent(part);
     return segment(decoded)&&encodeURIComponent(decoded)===part;
   }catch{return false;}
 });
}
function catalog(ops){if(!(ops instanceof Set)||!ops.size)fail("trusted operation catalog required");}
export function validateAuthorizationEnvelope(envelope,{allowedOperations}={}){
 catalog(allowedOperations);
 exact(envelope,["schema_version","repository","branch","permissions"]);
 if(envelope.schema_version!==ENVELOPE_SCHEMA_VERSION)fail("unsupported schema");
 const r=envelope.repository;
 exact(r,["authority","owner","repository"]);
 if(typeof r.authority!=="string"||r.authority!==r.authority.toLowerCase()||
  !HOST.test(r.authority)||!segment(r.owner)||!segment(r.repository))fail("invalid repository");
 const b=envelope.branch;
 if(typeof b!=="string"||b.length>120||!BRANCH.test(b)||b.includes("..")||
   b.includes("//")||b.endsWith("/")||b.endsWith(".")||
   b.endsWith(".lock")||b.includes("@{"))fail("invalid work branch");
 if(!Array.isArray(envelope.permissions)||envelope.permissions.length<1||
    envelope.permissions.length>256)fail("invalid permission count");
 const seen=new Set();
 for(const row of envelope.permissions){
  exact(row,["resource","operation"]);
  if(!canonicalResource(row.resource,r,b))fail("resource outside repository or branch");
  if(typeof row.operation!=="string"||!OP.test(row.operation)||
     !allowedOperations.has(row.operation))fail("operation not in trusted catalog");
  const key=JSON.stringify([row.resource,row.operation]);
  if(seen.has(key))fail("duplicate pair");seen.add(key);
 }
 return envelope;
}
export function authorizationEnvelopeDigest(envelope){
 return createHash("sha256").update(json({domain:DOMAIN,envelope})).digest("hex");
}
function signingMessage(r){
 return json({domain:DOMAIN,version:r.version,key_id:r.key_id,
  engineer_did:r.engineer_did,issued_at:r.issued_at,expires_at:r.expires_at,
  envelope_digest:authorizationEnvelopeDigest(r.envelope)});
}
function validateReceipt(r,ops,now){
 exact(r,["version","key_id","engineer_did","issued_at","expires_at","envelope","signature"]);
 if(r.version!==1||typeof r.key_id!=="string"||!ID.test(r.key_id)||
  typeof r.engineer_did!=="string"||!DID.test(r.engineer_did))fail("invalid signer");
 validateAuthorizationEnvelope(r.envelope,{allowedOperations:ops});
 if(typeof r.issued_at!=="string"||!UTC.test(r.issued_at)||
  typeof r.expires_at!=="string"||!UTC.test(r.expires_at))fail("invalid UTC timestamps");
 const issued=Date.parse(r.issued_at),expires=Date.parse(r.expires_at);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||
   expires-issued>MAX_MS||issued>now+60000||now>=expires)fail("expired or excessive validity");
 if(typeof r.signature!=="string"||!/^[A-Za-z0-9_-]{86}$/u.test(r.signature)||
  Buffer.from(r.signature,"base64url").length!==64)fail("invalid signature encoding");
}
/** Private trusted Engineer signing boundary, never an LLM tool. */
export function signAuthorizationEnvelope({envelope,engineerDid,keyId,privateKeyPem,
 issuedAt,expiresAt,allowedOperations}){
 validateAuthorizationEnvelope(envelope,{allowedOperations});
 if(typeof privateKeyPem!=="string"||!privateKeyPem.trim())fail("private key required");
 const key=createPrivateKey(privateKeyPem);
 if(key.asymmetricKeyType!=="ed25519")fail("Ed25519 key required");
 const out={version:1,key_id:keyId,engineer_did:engineerDid,
  issued_at:issuedAt,expires_at:expiresAt,
  envelope:structuredClone(envelope),signature:"A".repeat(86)};
 validateReceipt(out,allowedOperations,Date.parse(issuedAt));
 out.signature=sign(null,signingMessage(out),key).toString("base64url");
 return Object.freeze(out);
}
/** Trusted key mapping must be pinned independently of the Orchestrator. */
export function verifyAuthorizationEnvelope(receipt,{trustedKeys,expectedEngineerDid,
 allowedOperations,nowMs=Date.now()}={}){
 validateReceipt(receipt,allowedOperations,nowMs);
 if(receipt.engineer_did!==expectedEngineerDid)fail("wrong Engineer");
 const trusted=trustedKeys?.[receipt.key_id];
 if(!trusted||trusted.engineer_did!==expectedEngineerDid||
   typeof trusted.public_key_pem!=="string")fail("untrusted Engineer key");
 const key=createPublicKey(trusted.public_key_pem);
 if(key.asymmetricKeyType!=="ed25519")fail("Ed25519 key required");
 if(!verify(null,signingMessage(receipt),key,
    Buffer.from(receipt.signature,"base64url")))fail("invalid signature");
 return Object.freeze({
  envelope:structuredClone(receipt.envelope),
  scope_digest:authorizationEnvelopeDigest(receipt.envelope),
  authenticated_engineer_did:expectedEngineerDid,
  expires_at:receipt.expires_at
 });
}
/**
 * Subset preflight only: does not authorize execution, attest an Orchestrator,
 * mint a DC, or relax the existing Task/role Gateway checks.
 */
export function assertPlanWithinEnvelope(plan,authenticatedScope,{allowedOperations}={}){
 validatePlan(plan,{allowedOperations});
 const envelope=authenticatedScope?.envelope;
 validateAuthorizationEnvelope(envelope,{allowedOperations});
 if(["authority","owner","repository"].some(k=>plan.repository[k]!==envelope.repository[k])||
    approvedWorkBranch(plan)!==envelope.branch)fail("plan outside authorized repository or branch");
 const pairs=new Set(envelope.permissions.map(x=>JSON.stringify([x.resource,x.operation])));
 for(const p of plan.requested_permissions){
  if(!pairs.has(JSON.stringify([p.resource,p.operation])))fail("plan outside granted pairs");
 }
 return Object.freeze({scope_digest:authorizationEnvelopeDigest(envelope),
  plan_within_scope:true,execution_authorized:false});
}
