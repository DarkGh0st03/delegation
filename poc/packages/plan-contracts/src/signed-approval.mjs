/**
 * Domain-separated, short-lived Ed25519 Engineer approval receipt.
 * The signing function belongs ONLY in a trusted Engineer-side operator
 * process. Gateway/Orchestrator verifiers need pinned public keys only.
 *
 * An Ed25519 signature authenticates an authorized KEY, not by itself a
 * human GUI click, identity-provider session or informed human consent.
 */
import {createPrivateKey,createPublicKey,sign,verify} from "node:crypto";
import {assertApprovedPlanScope,planDigest} from "./plan.mjs";

const DOMAIN="delegation.engineer.approval.v1";
const VERSION=1;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DID=/^did:[a-z0-9]+:.+$/u;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/u; // Ed25519 64-byte base64url
const MAX_LIFETIME_MS=24*60*60*1000;

function reject(message){throw new Error("Signed Engineer approval: "+message);}
function exactObject(obj,required,label){
  if(!obj||typeof obj!=="object"||Array.isArray(obj))reject(label+" must be an object");
  if(Object.keys(obj).length!==required.length||
     required.some(key=>!Object.hasOwn(obj,key)))reject(label+" has invalid fields");
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  }
  return value;
}
function serializeUnsigned(envelope){
  return Buffer.from(JSON.stringify(canonical({
    domain:DOMAIN,
    version:VERSION,
    key_id:envelope.key_id,
    engineer_did:envelope.engineer_did,
    issued_at:envelope.issued_at,
    expires_at:envelope.expires_at,
    plan_digest:planDigest(envelope.plan),
    approval:envelope.approval
  })),"utf8");
}
function validateFields(value,nowMs){
  exactObject(value,["version","key_id","engineer_did","issued_at",
    "expires_at","plan","approval","signature"],"receipt");
  if(value.version!==VERSION||typeof value.key_id!=="string"||
     !ID.test(value.key_id)||typeof value.engineer_did!=="string"||
     !DID.test(value.engineer_did))reject("untrusted version or signer identifier");
  if(typeof value.issued_at!=="string"||typeof value.expires_at!=="string"||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value.issued_at)||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value.expires_at)){
    reject("timestamps must be absolute UTC ISO strings");
  }
  const issued=Date.parse(value.issued_at),expires=Date.parse(value.expires_at);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||
     expires<=issued||expires-issued>MAX_LIFETIME_MS||
     issued>nowMs+60_000||nowMs>=expires){
    reject("receipt is expired, premature or outside maximum lifetime");
  }
  if(typeof value.signature!=="string"||!SIGNATURE.test(value.signature)||
     Buffer.from(value.signature,"base64url").length!==64)reject("invalid Ed25519 signature encoding");
}

/** Create a receipt using an Engineer-controlled private key, never an AI tool. */
export function signEngineerApproval({
  plan,approval,engineerDid,keyId,privateKeyPem,
  issuedAt=new Date().toISOString(),expiresAt
}){
  if(typeof privateKeyPem!=="string"||!privateKeyPem.trim())reject("private key required for offline signing");
  // This command does not authenticate the operator; an external Engineer
  // authentication/consent boundary must control possession/use of this key.
  const unsigned={
    version:VERSION,key_id:keyId,engineer_did:engineerDid,
    issued_at:issuedAt,expires_at:expiresAt,
    plan:structuredClone(plan),approval:structuredClone(approval)
  };
  const key=createPrivateKey(privateKeyPem);
  if(key.asymmetricKeyType!=="ed25519")reject("only Ed25519 keys are allowed");
  const signature=sign(null,serializeUnsigned(unsigned),key).toString("base64url");
  const result={...unsigned,signature};
  validateFields(result,Date.parse(issuedAt));
  return result;
}

/** Validate against an OUT-OF-BAND pinned DID→key allowlist. */
export function verifyEngineerApproval(
  raw,{trustedKeys,expectedEngineerDid,allowedOperations,nowMs=Date.now()}
){
  validateFields(raw,nowMs);
  if(typeof expectedEngineerDid!=="string"||raw.engineer_did!==expectedEngineerDid){
    reject("signer does not match expected trusted Engineer DID");
  }
  const authorized=trustedKeys?.[raw.key_id];
  if(!authorized||authorized.engineer_did!==expectedEngineerDid||
     typeof authorized.public_key_pem!=="string"){
    reject("signing key not pinned in Engineer trust store");
  }
  const publicKey=createPublicKey(authorized.public_key_pem);
  if(publicKey.asymmetricKeyType!=="ed25519")reject("public key must be Ed25519");
  if(!verify(null,serializeUnsigned(raw),publicKey,Buffer.from(raw.signature,"base64url"))){
    reject("invalid approval signature or modified plan");
  }
  assertApprovedPlanScope(raw.plan,raw.approval,{
    allowedOperations,expectedEngineerDid
  });
  if(raw.plan.session_id!==raw.approval.session_id ||
     raw.approval.approved_by!==raw.engineer_did){
    reject("session or Engineer in receipt differs from approved plan");
  }
  const approvalTime=Date.parse(raw.approval.approved_at);
  if(!Number.isFinite(approvalTime)||approvalTime>Date.parse(raw.issued_at)+60_000){
    reject("approval time postdates Engineer receipt");
  }
  return Object.freeze({
    plan:structuredClone(raw.plan),
    approval:structuredClone(raw.approval),
    authenticated_engineer_did:expectedEngineerDid
  });
}
