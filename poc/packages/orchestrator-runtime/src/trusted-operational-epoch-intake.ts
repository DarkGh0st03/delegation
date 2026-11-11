/**
 * R101 owner-only intake: bind durable epochs to the REAL Coordinator
 * operational DC and the authenticated original Engineer approval.
 * This is NOT a Gateway Task admission, a model API or a child DC issuer.
 */
import {TrustedOperationalEpochJournal} from "./trusted-operational-epoch-journal.mjs";
import {SignedEngineerApprovalFileStore} from "./signed-approval-store.ts";
import {assertApprovedPlanScope,planDigest} from "../../plan-contracts/src/plan.mjs";
import {preflightNextOperationalEpoch} from "../../plan-contracts/src/operational-epoch-scope.mjs";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalBranchUri} from "../../../apps/gateway/src/canonical.ts";
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
 /**
  * R106 owner-private, PURE scope check for a future repair epoch.
  * Source-of-truth history/Engineer approval/issued DC are re-read from
  * private trusted state; no model-supplied root or replay ledger accepted.
  * This method never reserves, issues credentials, or authorizes execution.
  */
 /** Host-private snapshot of REAL Coordinator-issued grants, not
  * an application-only approval or a model-provided permissions list.
  * Validates the original Engineer signature and every persisted epoch. */
 async trustedRootReadGrants():Promise<ReadonlyArray<Readonly<{
  resource:string;operation:string
 }>>>{
  await this.verifiedEpochHistory();
  const root=this.#coordinator.trustedOperationalAuthority();
  return Object.freeze(root.permissions.map(p=>
    Object.freeze({resource:p.resource,operation:p.operation})));
 }
 /**
  * R109: owner-only read-scoped discovery preflight before the next DAG
  * exists. Source is the actual issued Rust root, not a model plan,
  * application envelope or reconstructed role template.
  * NO credential issuance / Gateway admission / provider read occurs here.
  */
 async preflightRepairDiscovery(input:{
   sessionId:string;taskId:string;agentId:"backend"|"frontend"|"test";
   resource:string;
 }):Promise<Readonly<{
  session_id:string;task_id:string;agent_id:string;agent_did:string;resource:string;
  operation:"read_file";root_credential_id:string;
  root_plan_digest:string;epoch:number;work_branch:string;
  execution_authorized:false;
 }>>{
  if(!input||input.sessionId!==this.#session||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.taskId??"")||
     !["backend","frontend","test"].includes(input.agentId)||
     typeof input.resource!=="string"||
     !/^gitea:\/\/[^/]+\/[^/]+\/[^/]+\/branches\/[^/]+\/files\/[^?\s#]+$/u.test(input.resource))
   deny("noncanonical discovery task or resource");
  const history=await this.verifiedEpochHistory();
  if(history.some(e=>e.plan.tasks.some(t=>t.id===input.taskId))||
     !this.#agents.some(a=>a.agent_id===input.agentId&&
       a.did.startsWith("did:")&&a.card_ref.trim()))
   deny("discovery Task replay or unregistered Agent identity");
  const agent=this.#agents.find(a=>a.agent_id===input.agentId);
  if(!agent)deny("missing pinned Agent DID");
  const current=history.at(-1);
  const root=this.#coordinator.trustedOperationalAuthority();
  const branch=history[0]?.plan?.repository;
  if(!current||!root||!branch)
   deny("missing active root or operational epoch");
  // R151.22: exactly the canonical Gateway branch encoding, including
  // owner/repository path segments. Hand-built URI prefixes can reject an
  // Engineer-signed grant that Gateway itself canonicalizes differently.
  const expectedPrefix=canonicalBranchUri(
    branch,approvedWorkBranch(current.plan))+"/files/";
  if(!input.resource.startsWith(expectedPrefix)||
     !root.permissions.some(p=>p.resource===input.resource&&
       p.operation==="read_file"))
   deny("discovery read grant outside exact issued Rust root");
  const again=await this.verifiedEpochHistory();
  const reissued=this.#coordinator.trustedOperationalAuthority();
  if(again.length!==history.length||
     again.at(-1)?.plan_digest!==current.plan_digest||
     reissued.credential_id!==root.credential_id||
     reissued.plan_digest!==root.plan_digest)
   deny("root or epoch changed during discovery preflight");
  return Object.freeze({
   session_id:this.#session,task_id:input.taskId,
   agent_id:input.agentId,agent_did:agent.did,resource:input.resource,
   operation:"read_file" as const,
   root_credential_id:root.credential_id,
   root_plan_digest:root.plan_digest,
   epoch:history.length,
   work_branch:approvedWorkBranch(current.plan),
   execution_authorized:false as const
  });
 }
 async preflightRepairEpoch(candidatePlan:unknown){
  const history=await this.verifiedEpochHistory();
  const root=this.#coordinator.trustedOperationalAuthority();
  const first=history[0],previous=history.at(-1);
  if(!first||!previous)deny("original epoch is not durably reserved");
  return preflightNextOperationalEpoch({
   originalSignedPlan:first.plan,previousEpochPlan:previous.plan,
   candidatePlan,operationalRoot:root,
   pinnedAgentRegistry:this.#agents,
   priorTaskIds:history.flatMap(x=>x.plan.tasks.map(t=>t.id)),
   priorPlanIds:history.map(x=>x.plan.plan_id)
  },{allowedOperations:OPS});
 }
 async reserveRepairEpoch(candidatePlan:unknown){
  const {root,plan}=await this.#rootAndPlan();
  const records=await this.#journal.records();
  if(!records.length||planDigest(records[0].plan)!==planDigest(plan))
   deny("first epoch not linked to authenticated Engineer receipt");
  return this.#journal.reserveNext(candidatePlan,root,this.#agents);
 }
 /** A separately constructed Coordinator may never impersonate this root. */
 assertSameCoordinator(other:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">):void{
  if(other!==this.#coordinator)deny("Coordinator instance differs from epoch owner");
 }
 async verifiedEpochHistory(){
  const {root,plan}=await this.#rootAndPlan();
  const history=await this.#journal.records();
  if(!history.length||planDigest(history[0].plan)!==planDigest(plan))
   deny("signed initial epoch differs from Engineer approval");
  for(let i=1;i<history.length;i++){
   preflightNextOperationalEpoch({
    originalSignedPlan:plan,
    previousEpochPlan:history[i-1].plan,
    candidatePlan:history[i].plan,
    operationalRoot:root,pinnedAgentRegistry:this.#agents,
    priorTaskIds:history.slice(0,i).flatMap(x=>x.plan.tasks.map(t=>t.id)),
    priorPlanIds:history.slice(0,i).map(x=>x.plan.plan_id)
   },{allowedOperations:OPS});
  }
  return history;
 }
}
