/**
 * R1 migration contract: an Engineer signs an authority boundary, never a DAG.
 *
 * This is a side-effect-free authenticated approval / scope preflight, NOT an
 * operational root, a Gateway task registration, or a replacement for the
 * existing signed-plan runtime. An independently authenticated Engineer must
 * control use of the private key; a valid signature alone proves no GUI click.
 *
 * R299 accepts canonical directory grants for file operations; containment
 * is independently checked during Task binding, Rust VP verification and OPA.
 */
import {createHash,createPrivateKey,createPublicKey,sign,verify}
  from "node:crypto";
import {validateAuthorizationEnvelope} from "./authorization-envelope.mjs";
import {validatePlan} from "./plan.mjs";
import {approvedWorkBranch} from "./approved-work-branch.mjs";

export const AUTHORITY_ONLY_SCHEMA="1.0.0";
const DOMAIN="delegation.engineer.authority-only.v1";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DID=/^did:[a-z0-9]+:.+$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/u;
const MAX_LIFETIME=24*60*60*1000;
// A caller cannot forge a verified authorization by constructing an object.
// Cross-process consumers MUST verify the signed receipt again locally.
const authenticatedReceipts=new WeakSet();
function deny(reason){throw Error("Authority-only approval: "+reason);}
function exact(obj,fields){
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||
    Object.keys(obj).length!==fields.length||
    fields.some(k=>!Object.hasOwn(obj,k)))deny("invalid fields");
}
function canonical(x){
 if(Array.isArray(x))return x.map(canonical);
 if(x&&typeof x==="object")return Object.fromEntries(
   Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
 return x;
}
function encode(x){return Buffer.from(JSON.stringify(canonical(x)),"utf8");}
function digest(x){return createHash("sha256").update(encode(x)).digest("hex");}
function requirementDigest(s){return createHash("sha256").update(s,"utf8").digest("hex");}
const pair=(p)=>JSON.stringify([p.resource,p.operation]);
function pairsUnique(list){
 if(!Array.isArray(list)||list.length<1||list.length>256)deny("invalid permission count");
 const seen=new Set();
 for(const row of list){
  exact(row,["resource","operation"]);
  const k=pair(row);
  if(seen.has(k))deny("duplicate permission pair");
  seen.add(k);
 }
}
function sortedPairs(list){return [...list].map(p=>({resource:p.resource,
 operation:p.operation})).sort((a,b)=>pair(a).localeCompare(pair(b),"en"));}
function envelope(repository,branch,permissions){
 return {schema_version:"1.0.0",repository,branch,permissions};
}
function validSessionContext(value){
 if(typeof value.session_id!=="string"||!ID.test(value.session_id)||
    typeof value.base_revision!=="string"||!SHA40.test(value.base_revision))
   deny("invalid session or pinned revision");
}
function validatePermissionKinds(rows,repo,branch){
 // Operation must match resource *kind*. Crypto containment is NOT inferred.
 const root="gitea://"+repo.authority+"/"+encodeURIComponent(repo.owner)+
   "/"+encodeURIComponent(repo.repository);
 const branchUri=root+"/branches/"+encodeURIComponent(branch);
 for(const p of rows){
  const op=p.operation,r=p.resource;
  if(["create_branch","create_pull_request","read_repository"].includes(op)){
   if(r!==root)deny("repository operation has wrong resource kind");
  }else if(op==="run_tests"){
   if(r!==branchUri)deny("runner operation has wrong resource kind");
  }else if(["read_file","update_file","create_file"].includes(op)){
   // A directory grant is a recursive maximum scope, never an operation
   // executed against a directory. The Gateway derives a concrete file URI.
   if(!r.startsWith(branchUri+"/files/")&&
      r!==branchUri+"/directories"&&
      !r.startsWith(branchUri+"/directories/"))
    deny("file operation has wrong resource kind");
  }else if(op==="list_directory"){
   if(r!==branchUri+"/directories"&&
      !r.startsWith(branchUri+"/directories/"))
    deny("directory operation has wrong resource kind");
  }else deny("unimplemented operation cannot be approved by this migration contract");
 }
}
/** Optional binding of the Engineer-approved project profile (what "the
 * tests pass" means). When present it is part of the signed grant. */
const PROFILE_FIELD="project_profile_sha256";
function profileFields(x,base){
 if(x&&typeof x==="object"&&Object.hasOwn(x,PROFILE_FIELD)){
  if(typeof x[PROFILE_FIELD]!=="string"||!SHA64.test(x[PROFILE_FIELD]))
   deny("invalid project profile binding");
  return [...base,PROFILE_FIELD];
 }
 return base;
}
export function validateAuthorityProposal(proposal,{allowedOperations}={}){
 exact(proposal,profileFields(proposal,["schema_version","session_id","repository","branch",
  "base_revision","requirement","requested_permissions"]));
 if(proposal.schema_version!==AUTHORITY_ONLY_SCHEMA)deny("unsupported schema");
 validSessionContext(proposal);
 if(typeof proposal.requirement!=="string"||
    !proposal.requirement.trim()||proposal.requirement.length>8000)
   deny("invalid requirement");
 pairsUnique(proposal.requested_permissions);
 validateAuthorizationEnvelope(envelope(proposal.repository,proposal.branch,
  proposal.requested_permissions),{allowedOperations});
 validatePermissionKinds(proposal.requested_permissions,
  proposal.repository,proposal.branch);
 return proposal;
}
/**
 * Engineer decision from an independently pinned proposal and a selected
 * subset. Neither proposed Task IDs nor candidate agents enter this object.
 * Selected pairs (not caller-supplied roles) are the full maximum authority.
 */
export function selectAuthorityOnlyGrant(proposal,approvedPairs,{allowedOperations}={}){
 validateAuthorityProposal(proposal,{allowedOperations});
 pairsUnique(approvedPairs);
 const requested=new Set(proposal.requested_permissions.map(pair));
 if(approvedPairs.some(p=>!requested.has(pair(p))))deny("selection exceeds proposal");
 const grant={
  schema_version:AUTHORITY_ONLY_SCHEMA,
  session_id:proposal.session_id,
  repository:structuredClone(proposal.repository),
  branch:proposal.branch,
  base_revision:proposal.base_revision,
  requirement_sha256:requirementDigest(proposal.requirement),
  ...(Object.hasOwn(proposal,PROFILE_FIELD)?{[PROFILE_FIELD]:proposal[PROFILE_FIELD]}:{}),
  permissions:sortedPairs(approvedPairs)
 };
 validateAuthorityOnlyGrant(grant,{allowedOperations});
 return grant;
}
export function validateAuthorityOnlyGrant(grant,{allowedOperations}={}){
 exact(grant,profileFields(grant,["schema_version","session_id","repository","branch",
  "base_revision","requirement_sha256","permissions"]));
 if(grant.schema_version!==AUTHORITY_ONLY_SCHEMA)deny("unsupported schema");
 validSessionContext(grant);
 if(typeof grant.requirement_sha256!=="string"||
    !SHA64.test(grant.requirement_sha256))deny("invalid requirement binding");
 pairsUnique(grant.permissions);
 validateAuthorizationEnvelope(envelope(grant.repository,grant.branch,
  grant.permissions),{allowedOperations});
 validatePermissionKinds(grant.permissions,grant.repository,grant.branch);
 if(JSON.stringify(sortedPairs(grant.permissions))!==JSON.stringify(grant.permissions))
   deny("noncanonical permission order");
 return grant;
}
export function authorityOnlyDigest(grant,{allowedOperations}={}){
 validateAuthorityOnlyGrant(grant,{allowedOperations});
 return digest({domain:DOMAIN,grant});
}
function signBytes(receipt){
 return encode({domain:DOMAIN,version:receipt.version,
  key_id:receipt.key_id,engineer_did:receipt.engineer_did,
  issued_at:receipt.issued_at,expires_at:receipt.expires_at,
  authority_digest:digest({domain:DOMAIN,grant:receipt.authorization})});
}
function receiptFields(receipt,allowedOperations,nowMs){
 exact(receipt,["version","key_id","engineer_did","issued_at","expires_at",
  "authorization","signature"]);
 if(receipt.version!==1||typeof receipt.key_id!=="string"||
    !ID.test(receipt.key_id)||typeof receipt.engineer_did!=="string"||
    !DID.test(receipt.engineer_did))deny("invalid signer");
 validateAuthorityOnlyGrant(receipt.authorization,{allowedOperations});
 if(typeof receipt.issued_at!=="string"||!UTC.test(receipt.issued_at)||
    typeof receipt.expires_at!=="string"||!UTC.test(receipt.expires_at))
   deny("invalid UTC timestamps");
 const from=Date.parse(receipt.issued_at),to=Date.parse(receipt.expires_at);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||
    to-from>MAX_LIFETIME||from>nowMs+60000||nowMs>=to)
   deny("expired or invalid authority lifetime");
 if(typeof receipt.signature!=="string"||!SIGNATURE.test(receipt.signature)||
    Buffer.from(receipt.signature,"base64url").length!==64)
   deny("invalid Ed25519 signature encoding");
}
/** Trusted Engineer-only signing boundary. Never expose to ADK/A2A/MCP. */
export function signAuthorityOnlyGrant({authorization,engineerDid,keyId,
 privateKeyPem,issuedAt,expiresAt,allowedOperations}){
 validateAuthorityOnlyGrant(authorization,{allowedOperations});
 if(typeof privateKeyPem!=="string"||!privateKeyPem.trim())
   deny("trusted private key required");
 const privateKey=createPrivateKey(privateKeyPem);
 if(privateKey.asymmetricKeyType!=="ed25519")deny("Ed25519 required");
 const receipt={
  version:1,key_id:keyId,engineer_did:engineerDid,
  issued_at:issuedAt,expires_at:expiresAt,
  authorization:structuredClone(authorization),
  signature:"A".repeat(86)
 };
 receiptFields(receipt,allowedOperations,Date.parse(issuedAt));
 receipt.signature=sign(null,signBytes(receipt),privateKey).toString("base64url");
 return receipt;
}
/** Trust is external to the signed payload; the public key is pre-pinned. */
export function verifyAuthorityOnlyGrant(receipt,{trustedKeys,
 expectedEngineerDid,allowedOperations,nowMs=Date.now()}={}){
 receiptFields(receipt,allowedOperations,nowMs);
 if(receipt.engineer_did!==expectedEngineerDid)deny("wrong Engineer");
 const pinned=trustedKeys?.[receipt.key_id];
 if(!pinned||pinned.engineer_did!==expectedEngineerDid||
    typeof pinned.public_key_pem!=="string")deny("untrusted Engineer key");
 const key=createPublicKey(pinned.public_key_pem);
 if(key.asymmetricKeyType!=="ed25519")deny("Ed25519 required");
 if(!verify(null,signBytes(receipt),key,
    Buffer.from(receipt.signature,"base64url")))
   deny("invalid signature");
 const verified=Object.freeze({
  authorization:structuredClone(receipt.authorization),
  authority_digest:authorityOnlyDigest(receipt.authorization,{allowedOperations}),
  authenticated_engineer_did:expectedEngineerDid,
  expires_at:receipt.expires_at,
  authenticated:true
 });
 authenticatedReceipts.add(verified);
 return verified;
}
/**
 * Trusted-root preflight of an already VERIFIED signature receipt.
 * Only a locally verified, non-expired object is admitted; raw JSON with
 * authenticated:true is never proof. This does NOT issue any credential.
 */
export function assertVerifiedAuthorityOnlyGrant(verified,{allowedOperations,
 nowMs=Date.now()}={}){
 if(!verified||typeof verified!=="object"||
    !authenticatedReceipts.has(verified)||verified.authenticated!==true||
    typeof verified.authenticated_engineer_did!=="string"||
    !verified.authenticated_engineer_did.startsWith("did:")||
    typeof verified.authority_digest!=="string"||
    !SHA64.test(verified.authority_digest))
   deny("unverified Engineer authority");
 if(!Number.isFinite(nowMs)||typeof verified.expires_at!=="string"||
    !Number.isFinite(Date.parse(verified.expires_at))||
    nowMs>=Date.parse(verified.expires_at))
   deny("authenticated authority expired");
 const grant=verified.authorization;
 validateAuthorityOnlyGrant(grant,{allowedOperations});
 if(verified.authority_digest!==authorityOnlyDigest(grant,{allowedOperations}))
   deny("authority digest mismatch");
 return Object.freeze({authorization:structuredClone(grant),
   authority_digest:verified.authority_digest,
   authenticated_engineer_did:verified.authenticated_engineer_did,
   expires_at:verified.expires_at});
}
/**
 * Candidate Executor preflight only. A Task DAG may evolve after signing,
 * but its permissions must be a STRICT exact-pair subset. No root issuance,
 * branch writes or Gateway registration occurs here.
 */
export function assertExecutionWithinAuthority(plan,verified,{allowedOperations,nowMs=Date.now()}={}){
 if(!verified||typeof verified!=="object"||
    !authenticatedReceipts.has(verified)||verified.authenticated!==true||
    typeof verified.authenticated_engineer_did!=="string"||
    !verified.authenticated_engineer_did.startsWith("did:")||
    typeof verified.authority_digest!=="string"||
    !SHA64.test(verified.authority_digest))deny("unverified Engineer authority");
 if(!Number.isFinite(nowMs)||typeof verified.expires_at!=="string"||
    !Number.isFinite(Date.parse(verified.expires_at))||
    nowMs>=Date.parse(verified.expires_at))deny("authenticated authority expired");
 const grant=verified.authorization;
 validateAuthorityOnlyGrant(grant,{allowedOperations});
 if(verified.authority_digest!==authorityOnlyDigest(grant,{allowedOperations}))
   deny("authority digest mismatch");
 validatePlan(plan,{allowedOperations});
 if(plan.session_id!==grant.session_id||
    plan.base_revision!==grant.base_revision||
    requirementDigest(plan.requirement)!==grant.requirement_sha256||
    ["authority","owner","repository"].some(k=>
      plan.repository[k]!==grant.repository[k])||
    approvedWorkBranch(plan)!==grant.branch)
   deny("execution escapes signed session, requirement, repository or branch");
 const permissionKeys=new Set(grant.permissions.map(pair));
 for(const row of plan.requested_permissions)
   if(!permissionKeys.has(pair(row)))deny("execution requests unapproved permission");
 return Object.freeze({
  status:"scope_preflight_only",authority_digest:verified.authority_digest,
  plan_within_authority:true,execution_authorized:false,
  root_credential_issued:false,task_binding_authorized:false
 });
}
