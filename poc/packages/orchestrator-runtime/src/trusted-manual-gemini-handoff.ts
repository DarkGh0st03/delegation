/**
 * Trusted host-side manual Gemini entry.
 *
 * THIS IS NOT a GitHub Actions entrypoint: CI files and CLI environment
 * variables cannot reconstruct or impersonate active Planning authority.
 * The host must already possess the real Rust-verified preliminary root,
 * an immutable session/Gitea SHA, the pinned backend signature key, and a
 * separately signed Engineer receipt in the protected approval store.
 *
 * No model inference happens here. When a later host executes signed A2A
 * tasks it must use the returned exact endpoints with the trusted
 * ApprovedA2ADispatcher and Gateway/Core Rust/OPA.
 */
import {isDeepStrictEqual} from "node:util";
import {assertApprovedPlanScope}
  from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";

import {preliminaryReadPermissions,
  type RootParameters}
  from "./trusted-engineer-authority.ts";
import {
  createReviewedGeminiA2ARoleRuntime,
  startReviewedGeminiA2AServers,
  type ManualGeminiExecutionReadinessInput,
  type ReviewedGeminiAgentRole,
  type TrustedGeminiAgentTransport
} from "./trusted-gemini-execution-readiness.ts";

function fail(reason:string):never{
  throw new Error("Trusted manual Gemini handoff: "+reason);
}

/**
 * One-use transition: authenticated Planning root + independently pinned
 * backend checkpoint + separate Engineer signature + manual bill consent
 * -> independently scoped operational root -> 3 local ADK/A2A servers.
 *
 * On failure after activation the operational root is revoked, and the
 * error is propagated. The caller must close servers AND the Coordinator
 * after running the separately authenticated plan dispatcher.
 */
export async function startPersistedReviewedGeminiHandoff(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  checkpointStore:SignedPlanningCheckpointFileStore;
  manual:Omit<ManualGeminiExecutionReadinessInput,
    "reviewGate"|"trustedPhase">;
  transports:Readonly<Record<ReviewedGeminiAgentRole,
    TrustedGeminiAgentTransport>>;
  maxModelCallMs:number;
  operationalRoot:RootParameters;
  ports:Readonly<Record<ReviewedGeminiAgentRole,number>>;
}){
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !(input.checkpointStore instanceof SignedPlanningCheckpointFileStore))
    fail("real trusted Coordinator, checkpoint store and Engineer review required");
  // Do not accept a caller's fabricated phase callback or pasted receipt.
  const root=input.coordinator.trustedPlanningAuthority();
  const ticket=await input.checkpointStore.load();
  if(root.session_id!==ticket.snapshot.session_id||
     root.base_revision!==ticket.snapshot.base_revision||
     !isDeepStrictEqual(root.permissions,preliminaryReadPermissions(ticket.snapshot)))
    fail("active preliminary Rust root differs from signed Planning snapshot");
  // A Planning proposal is one-shot. It may have been staged BEFORE the
  // Engineer signed it, so re-entry after the signature must compare the
  // complete previously staged proposal, never silently replace/restage it.
  let staged:ReturnType<TrustedPlanningReviewGate["reviewPacket"]>|undefined;
  try{staged=input.reviewGate.reviewPacket();}
  catch(error){
    if(!String(error).includes("no staged proposal available"))
      throw error;
  }
  if(staged){
    if(staged.plan_digest!==ticket.proposal.digest||
       staged.session_id!==ticket.snapshot.session_id||
       staged.base_revision!==ticket.snapshot.base_revision||
       staged.work_branch!==ticket.expected_work_branch||
       staged.verified_source_reads!==ticket.proposal.verified_source_reads||
       !isDeepStrictEqual(staged.plan,ticket.proposal.plan))
      fail("staged Engineer review does not match signed backend checkpoint");
  }else{
    staged=input.checkpointStore.stageVerified(input.reviewGate,ticket);
  }
  const reviewed=await createReviewedGeminiA2ARoleRuntime({
    ...input.manual,
    trustedPhase:()=>input.coordinator.phase,
    reviewGate:input.reviewGate,
    transports:input.transports,
    maxModelCallMs:input.maxModelCallMs
  });
  if(staged.plan_digest!==reviewed.readiness.plan_digest||
     reviewed.readiness.session_id!==root.session_id||
     reviewed.readiness.base_revision!==root.base_revision)
    fail("signed manual review differs from activated Planning root");
  let activated=false;
  try{
    const operational=await input.coordinator.beginExecution(
      input.operationalRoot);
    activated=true;
    if(operational.plan_digest!==reviewed.readiness.plan_digest)
      fail("new operational root does not match signed Engineer grant");
    // Do not merely compare plan digests: two distinct Engineer decisions
    // can approve DIFFERENT subsets of the same signed Plan. Compare the
    // exact independently issued operational root against the selection
    // authenticated in the review store, in signed approval-ID order.
    const signed=await input.reviewGate.loadAuthenticatedApproval(
      root.session_id);
    const approvedRows=assertApprovedPlanScope(
      signed.plan,signed.approval,{
        allowedOperations:new Set<string>(RUST_OPERATIONS),
        expectedEngineerDid:reviewed.readiness.authenticated_engineer_did
      }
    ) as Array<{operation:string;resource:string}>;
    const expectedPermissions:Array<{operation:string;resource:string}>=[];
    const seen=new Set<string>();
    for(const row of approvedRows){
      const permission={resource:row.resource,operation:row.operation};
      const key=JSON.stringify(permission);
      if(!seen.has(key))expectedPermissions.push(permission);
      seen.add(key);
    }
    if(!isDeepStrictEqual(
      input.coordinator.trustedOperationalAuthority().permissions,
      expectedPermissions))
      fail("operational root does not match exact signed permission subset");
    const servers=await startReviewedGeminiA2AServers({
      coordinator:input.coordinator,reviewed,ports:input.ports
    });
    return Object.freeze({
      readiness:reviewed.readiness,
      operational_root_id:operational.credential_id,
      endpoints:servers.endpoints,
      servers:servers.servers,
      // High-level lifecycle: closing local A2A listeners alone would leave
      // operational authority alive. Revoke even when server teardown fails.
      close:async()=>{
        let teardownError:unknown;
        try{await servers.close();}
        catch(error){teardownError=error;}
        if(input.coordinator.phase==="execution")
          await input.coordinator.closeExecution();
        if(teardownError)throw teardownError;
      }
    });
  }catch(error){
    if(activated&&input.coordinator.phase==="execution"){
      try{await input.coordinator.closeExecution();}
      catch{
        throw new Error("Trusted Gemini handoff failed; operational root revocation requires reconciliation",
          {cause:error});
      }
    }
    throw error;
  }
}
