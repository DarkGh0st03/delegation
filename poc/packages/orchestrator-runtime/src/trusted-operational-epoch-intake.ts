/**
 * R101 owner-only intake: bind durable epochs to the REAL Coordinator
 * operational DC and the authenticated original Engineer approval.
 * This is NOT a Gateway Task admission, a model API or a child DC issuer.
 */
import {TrustedOperationalEpochJournal} from "./trusted-operational-epoch-journal.mjs";
import {SignedEngineerApprovalFileStore} from "./signed-approval-store.ts";
import {assertApprovedPlanScope,planDigest} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
const OPS=new Set<string>(RUST_OPERATIONS);
const deny=(msg:string):never=>{throw Error("Trusted epoch intake: "+msg);};
export class TrustedOperationalEpochIntake {
 readonly #coordinator:Pick<TrustedExecutionCoordinator,"phase"|"trustedOperationalAuthority">;
 readonly #store:SignedEngineerApprovalFileStore;
 readonly #journal:TrustedOperationalEpochJournal;
 readonly #session:string;
 readonly #did:string;
 readonly #agents:ReadonlyArray<Readonly<{agent_id:string;did:string;card_ref:string}>>;
 private constructor(c:{
  coordinator:Pick<TrustedExecutionCoordinator,"phase"|"trustedOperationalAuthority">;
  approvals:SignedEngineerApprovalFileStore;
  journal:TrustedOperationalEpochJournal;
  sessionId:string;engineerDid:string;
  pinnedAgentRegistry:readonly {agent_id:string;did:string;card_ref:string}[];
 }){
  this.#coordinator=c.coordinator;this.#store=c.approvals;
  this.#journal=c.journal;this.#session=c.sessionId;
  this.#did=c.engineerDid;this.#agents=structuredClone(c.pinnedAgentRegistry);
 }
 static create(config:{
  coordinator:Pick<TrustedExecutionCoordinator,"phase"|"trustedOperationalAuthority">;
  approvals:SignedEngineerApprovalFileStore;
  journal:TrustedOperationalEpochJournal;
  sessionId:string;engineerDid:string;
  pinnedAgentRegistry:readonly {agent_id:string;did:string;card_ref:string}[];
 }):TrustedOperationalEpochIntake{
  if(!(config.approvals instanceof SignedEngineerApprovalFileStore)||
     !(config.journal instanceof TrustedOperationalEpochJournal)||
     !config.coordinator||typeof config.coordinator.trustedOperationalAuthority!=="function"||
     !config.engineerDid?.startsWith("did:")||
     !config.sessionId||!Array.isArray(config.pinnedAgentRegistry)||
     !config.pinnedAgentRegistry.length)
   deny("private signed approval and Coordinator-bound journal required");
  return new TrustedOperationalEpochIntake(config);
 }
 async #rootAndPlan(){
  if(this.#coordinator.phase!=="execution")
   deny("operational root is not active");
  const root=this.#coordinator.trustedOperationalAuthority();
  const original=await this.#store.loadAuthenticatedApproval(this.#session);
  if(original.authenticated_engineer_did!==this.#did||
     planDigest(original.plan)!==root.plan_digest||
     original.plan.session_id!==this.#session)
   deny("signed Engineer plan does not match issued operational root");
  const rows=assertApprovedPlanScope(original.plan,original.approval,{
   allowedOperations:OPS,expectedEngineerDid:this.#did
  }) as Array<{resource:string;operation:string}>;
  const issued=new Set(root.permissions.map(p=>JSON.stringify([p.resource,p.operation])));
  const approved=new Set(rows.map(p=>JSON.stringify([p.resource,p.operation])));
  if(issued.size!==root.permissions.length||
     issued.size!==approved.size||
     [...approved].some(p=>!issued.has(p)))
   deny("issued parent privileges differ from authenticated Engineer subset");
  this.#journal.assertBound({
   sessionId:this.#session,baseRevision:original.plan.base_revision,
   rootCredentialId:root.credential_id,originalPlanDigest:root.plan_digest
  });
  return {root,plan:original.plan};
 }
 async reserveInitialEpoch(){
  const {plan}=await this.#rootAndPlan();
  return this.#journal.reserveInitial(plan);
 }
 async reserveRepairEpoch(candidatePlan:unknown){
  const {root,plan}=await this.#rootAndPlan();
  const records=await this.#journal.records();
  if(!records.length||planDigest(records[0].plan)!==planDigest(plan))
   deny("first epoch not linked to authenticated Engineer receipt");
  return this.#journal.reserveNext(candidatePlan,root,this.#agents);
 }
 async verifiedEpochHistory(){
  await this.#rootAndPlan();
  return this.#journal.records();
 }
}
