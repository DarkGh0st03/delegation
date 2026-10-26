/**
 * R5 read-only, owner-side precondition before consuming a ONE-USE
 * GitHub scripted_offline admission. This does not authorize Execution:
 * the protected Host rechecks the authentic signed approval, active job,
 * root permissions and signed DAG after consuming its HMAC receipt.
 *
 * Inputs come solely from the originally assembled private Coordinator.
 * The exported helper cannot grant any authority or accept network input.
 */
import {isDeepStrictEqual} from "node:util";
import {planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
function deny(reason){throw Error("R5 signed-review readiness denied: "+reason);}

export async function assertR5AuthenticSignedReviewReady({
  coordinator,reviewGate,checkpointStore,expectedSessionId,expectedBaseRevision
}={}){
  if(!coordinator||coordinator.phase!=="planning"||
     !reviewGate||!checkpointStore||
     typeof reviewGate.reviewPacket!=="function"||
     typeof reviewGate.loadAuthenticatedApproval!=="function"||
     typeof checkpointStore.load!=="function"||
     typeof coordinator.trustedPlanningAuthority!=="function"||
     typeof expectedSessionId!=="string"||
     !SHA.test(expectedBaseRevision??""))
    deny("original active Planning and owner-pinned signed checkpoint required");
  // Load Backend signature and independently PIN the first human Ed25519
  // decision to this original review gate BEFORE a receipt is consumed.
  // This never fabricates an approval or signs using the backend's key.
  const [checkpoint,packet]=await Promise.all([
    checkpointStore.load(),Promise.resolve().then(()=>reviewGate.reviewPacket())
  ]);
  const root=coordinator.trustedPlanningAuthority();
  if(checkpoint?.snapshot?.session_id!==expectedSessionId||
     checkpoint?.snapshot?.base_revision!==expectedBaseRevision||
     root?.session_id!==expectedSessionId||
     root?.base_revision!==expectedBaseRevision||
     packet?.session_id!==expectedSessionId||
     packet?.base_revision!==expectedBaseRevision||
     !DIGEST.test(packet?.plan_digest??"")||
     packet.plan_digest!==checkpoint?.proposal?.digest||
     packet.work_branch!==checkpoint?.expected_work_branch||
     !isDeepStrictEqual(packet.plan,checkpoint?.proposal?.plan))
    deny("original Planning root and Backend-signed immutable proposal disagree");
  // The real TrustedPlanningReviewGate verifies the independent Engineer
  // signature, DID, expiration, exact plan and approved permission subset.
  // If no receipt exists, this fails BEFORE an OIDC admission is consumed.
  const verified=await reviewGate.loadAuthenticatedApproval(expectedSessionId);
  if(!verified?.authenticated_engineer_did?.startsWith("did:")||
     !isDeepStrictEqual(verified.plan,packet.plan)||
     planDigest(verified.plan)!==packet.plan_digest||
     verified.approval?.session_id!==expectedSessionId||
     verified.approval?.approved_by!==verified.authenticated_engineer_did||
     coordinator.phase!=="planning")
    deny("human-approved Ed25519 plan changed or Planning authority retired");
  return Object.freeze({
    status:"signed_human_review_verified_only_not_oidc_admitted",
    session_id:expectedSessionId,
    base_revision:expectedBaseRevision,
    plan_digest:packet.plan_digest,
    authenticated_engineer_did:verified.authenticated_engineer_did,
    operational_root_issued:false,
    dag_executed:false,
    source_sha_verified_here:false
  });
}
