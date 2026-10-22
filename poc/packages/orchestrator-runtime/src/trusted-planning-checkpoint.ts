/**
 * Portable Planning provenance for a MANUAL execution host.
 *
 * The trusted Planning backend signs the independently observed snapshot,
 * grounded read-only proposal, pinned Gitea SHA and exact work branch. The
 * Engineer uses a DIFFERENT Ed25519 key to sign the permission decision.
 *
 * This ticket alone never resumes provisional/root authority and NEVER
 * authorizes Gemini inference. Rehydration MUST be performed only within an
 * authenticated trusted coordinator with active Planning authority and then
 * checked against SignedEngineerApprovalFileStore and the paid consent gate.
 *
 * Keep signing private keys out of any A2A/ADK/Gateway model tool or CI
 * source checkout. Trusted operator integration owns signing and persistence.
 */
import {createPrivateKey,createPublicKey,sign,verify} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {planDigest,validatePlan}
  from "../../plan-contracts/src/plan.mjs";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {preliminaryReadPermissions,
  type TrustedPlanningSnapshot} from "./trusted-engineer-authority.ts";
import type {UnapprovedPlanProposal} from "./trusted-adk-planner.ts";
import {TrustedPlanningReviewGate,
  type PlanningReviewPacket} from "./trusted-planning-review-gate.ts";

const DOMAIN="delegation.trusted.planning-checkpoint.v1";
const KEY=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/u;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const MAX_LIFETIME_MS=60*60*1000;

function refuse(reason:string):never{
  throw new Error("Signed Planning checkpoint: "+reason);
}
function canonical(value:any):any{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")
    return Object.fromEntries(
      Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function message(payload:Omit<SignedPlanningCheckpoint,"signature">):Buffer{
  return Buffer.from(JSON.stringify(canonical({domain:DOMAIN,...payload})),"utf8");
}
function exactly(value:unknown,fields:readonly string[]):boolean{
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&
    Object.keys(value).length===fields.length&&
    fields.every(field=>Object.hasOwn(value,field));
}
export interface PlanningCheckpointKey{
  public_key_pem:string;
}
export interface SignedPlanningCheckpoint{
  version:1;
  key_id:string;
  issued_at:string;
  expires_at:string;
  snapshot:TrustedPlanningSnapshot;
  expected_work_branch:string;
  proposal:UnapprovedPlanProposal;
  signature:string;
}
export interface VerifiedPlanningCheckpoint{
  readonly snapshot:TrustedPlanningSnapshot;
  readonly expected_work_branch:string;
  readonly proposal:UnapprovedPlanProposal;
  readonly key_id:string;
}
function validateScope(
  snapshot:TrustedPlanningSnapshot,branch:string,
  proposal:UnapprovedPlanProposal
):void{
  preliminaryReadPermissions(snapshot);
  if(!proposal||proposal.status!=="unapproved_proposal"||
     !Number.isSafeInteger(proposal.verified_source_reads)||
     proposal.verified_source_reads<1||proposal.verified_source_reads>16)
    refuse("no authentic grounded read-only proposal");
  const plan=validatePlan(proposal.plan,{allowedOperations:OPERATIONS});
  if(plan.session_id!==snapshot.session_id||
     plan.base_revision!==snapshot.base_revision||
     !isDeepStrictEqual(plan.repository,snapshot.repository)||
     plan.version!==1||
     planDigest(plan)!==proposal.digest||
     approvedWorkBranch(plan)!==branch)
    refuse("proposal, pinned repository snapshot, branch or digest mismatch");
}
function validateTicket(
  value:SignedPlanningCheckpoint, nowMs:number
):void{
  if(!exactly(value,["version","key_id","issued_at","expires_at",
    "snapshot","expected_work_branch","proposal","signature"])||
     value.version!==1||typeof value.key_id!=="string"||
     !KEY.test(value.key_id)||
     typeof value.issued_at!=="string"||
     typeof value.expires_at!=="string"||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value.issued_at)||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value.expires_at))
    refuse("invalid signed checkpoint fields");
  const issued=Date.parse(value.issued_at),expires=Date.parse(value.expires_at);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||
     !Number.isFinite(nowMs)||issued>nowMs+60_000||nowMs>=expires||
     expires<=issued||expires-issued>MAX_LIFETIME_MS)
    refuse("checkpoint expired, premature or exceeds one-hour lifetime");
  if(!value.snapshot||!SHA.test(value.snapshot.base_revision)||
     typeof value.expected_work_branch!=="string"||
     typeof value.signature!=="string"||
     !SIGNATURE.test(value.signature)||
     Buffer.from(value.signature,"base64url").length!==64)
    refuse("invalid pinned SHA, branch or Ed25519 signature");
  validateScope(value.snapshot,value.expected_work_branch,value.proposal);
}

/** ONLY the actual trusted Planning coordinator may call this signing step. */
export function signTrustedPlanningCheckpoint(input:{
  snapshot:TrustedPlanningSnapshot;
  expectedWorkBranch:string;
  proposal:UnapprovedPlanProposal;
  keyId:string;
  privateKeyPem:string;
  issuedAt:string;
  expiresAt:string;
}):SignedPlanningCheckpoint{
  if(!input.keyId||!KEY.test(input.keyId)||
     typeof input.privateKeyPem!=="string"||!input.privateKeyPem.trim())
    refuse("trusted backend signing key and id required");
  const payload={
    version:1 as const,key_id:input.keyId,
    issued_at:input.issuedAt,expires_at:input.expiresAt,
    snapshot:structuredClone(input.snapshot),
    expected_work_branch:input.expectedWorkBranch,
    proposal:structuredClone(input.proposal)
  };
  const key=createPrivateKey(input.privateKeyPem);
  if(key.asymmetricKeyType!=="ed25519")refuse("backend signing key must be Ed25519");
  const result={...payload,signature:sign(null,message(payload),key)
    .toString("base64url")};
  validateTicket(result,Date.parse(input.issuedAt));
  return result;
}

/**
 * Verify against PINNED, out-of-band backend public keys and an independent
 * trusted session/Gitea SHA, not against expectations copied from this file.
 */
export function verifyTrustedPlanningCheckpoint(
  candidate:unknown, config:{
    trustedKeys:Readonly<Record<string,PlanningCheckpointKey>>;
    expectedSessionId:string;
    expectedRepository:TrustedPlanningSnapshot["repository"];
    expectedBaseRevision:string;
    expectedWorkBranch:string;
    nowMs?:number;
  }
):VerifiedPlanningCheckpoint{
  const value=candidate as SignedPlanningCheckpoint;
  validateTicket(value,config.nowMs??Date.now());
  if(value.snapshot.session_id!==config.expectedSessionId||
     value.snapshot.base_revision!==config.expectedBaseRevision||
     value.expected_work_branch!==config.expectedWorkBranch||
     !isDeepStrictEqual(value.snapshot.repository,config.expectedRepository))
    refuse("checkpoint not pinned to independently selected session or Gitea SHA");
  const publicPem=config.trustedKeys?.[value.key_id]?.public_key_pem;
  if(!publicPem)refuse("untrusted backend signing key");
  const key=createPublicKey(publicPem);
  if(key.asymmetricKeyType!=="ed25519"||
     !verify(null,message((({signature,...payload})=>payload)(value)),
       key,Buffer.from(value.signature,"base64url")))
    refuse("invalid Planning backend Ed25519 provenance signature");
  return Object.freeze({
    snapshot:structuredClone(value.snapshot),
    expected_work_branch:value.expected_work_branch,
    proposal:structuredClone(value.proposal),
    key_id:value.key_id
  });
}

/**
 * Stage only verified backend output. The review gate itself still insists on
 * an ACTUAL active Planning coordinator and an independent Engineer signature
 * before any root can become operational.
 */
export function stageVerifiedPlanningCheckpoint(
  gate:TrustedPlanningReviewGate,
  ticket:unknown,
  config:Parameters<typeof verifyTrustedPlanningCheckpoint>[1]
):PlanningReviewPacket{
  if(!(gate instanceof TrustedPlanningReviewGate))
    refuse("authenticated trusted review gate required");
  const checked=verifyTrustedPlanningCheckpoint(ticket,config);
  return gate.stageTrustedProposal(checked.proposal);
}
