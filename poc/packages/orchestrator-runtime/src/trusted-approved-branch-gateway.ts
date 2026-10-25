/**
 * Real, owner-only implementation for the immutable approved Orchestrator
 * create_branch Task. Never expose this factory or its Adapter token to ADK,
 * MCP, A2A or public HTTP. The branch, session and permission are loaded
 * from the authenticated Ed25519 Engineer receipt, NOT operator callback
 * parameters or untrusted model output.
 *
 * This explicitly supports the create_branch Task only. Any further
 * Orchestrator provider operation needs its own reviewed implementation.
 */
import {assertApprovedPlanScope,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {approvedWorkBranch}
  from "../../../packages/plan-contracts/src/approved-work-branch.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalRepositoryUri}
  from "../../../apps/gateway/src/canonical.ts";
import {OrchestratorGatewayTransport,
  type OrchestratorGatewayTransportConfig}
  from "./orchestrator-gateway-transport.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";

const SHA=/^[a-f0-9]{40}$/u;
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
function fail(message:string):never{
  throw Error("Trusted approved branch Gateway: "+message);
}

export async function createTrustedApprovedBranchGateway(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  sessionId:string;
  baseRevision:string;
  engineerDid:string;
  transport:Omit<OrchestratorGatewayTransportConfig,"rootCredentialId">;
}):Promise<Readonly<{
  approvedTaskId:string;approvedBranch:string;
  invokeOrchestratorTask:(planTaskId:string,gatewayTaskId:string)=>Promise<void>;
}>>{
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !TASK.test(input.sessionId??"")||
     !SHA.test(input.baseRevision??"")||
     !input.engineerDid?.startsWith("did:")||
     !input.transport?.gatewayBaseUrl||!input.transport.adapterBaseUrl||
     !input.transport.adapterToken)
    fail("original trusted Coordinator, Engineer approval and private transport required");
  const root=input.coordinator.trustedOperationalAuthority();
  const verified=await input.reviewGate.loadAuthenticatedApproval(input.sessionId);
  if(verified.authenticated_engineer_did!==input.engineerDid)
    fail("authenticated Engineer identity mismatch");
  const plan=verified.plan;
  if(plan.session_id!==input.sessionId||
     plan.base_revision!==input.baseRevision||
     planDigest(plan)!==root.plan_digest)
    fail("signed plan differs from activated operational authority");
  const approvals=assertApprovedPlanScope(plan,verified.approval,{
    allowedOperations:new Set<string>(RUST_OPERATIONS),
    expectedEngineerDid:input.engineerDid
  }) as Array<{task_id:string;agent_id:string;resource:string;operation:string}>;
  const repoRoot=canonicalRepositoryUri(plan.repository);
  const tasks=plan.tasks.filter((t:{agent_id:string})=>t.agent_id==="orchestrator");
  // No operator-supplied write callback for arbitrary extra Orchestrator Tasks.
  if(tasks.length!==1)fail("exactly one approved Orchestrator branch Task is supported");
  const task=tasks[0]!;
  const own=approvals.filter(x=>x.agent_id==="orchestrator");
  if(own.length!==1||own[0]!.task_id!==task.id||
     own[0]!.operation!=="create_branch"||
     own[0]!.resource!==repoRoot||
     task.resources.length!==1||task.resources[0]!==repoRoot)
    fail("Orchestrator Task does not have exact Engineer-granted create_branch");
  if(!root.permissions.some((x:{operation:string;resource:string})=>
    x.operation==="create_branch"&&x.resource===repoRoot))
    fail("active Rust operational root does not grant approved branch");
  const branch=approvedWorkBranch(plan);
  const credentialId=root.credential_id;
  const transport=new OrchestratorGatewayTransport({
    ...input.transport,rootCredentialId:credentialId
  });
  let attempted=false;
  return Object.freeze({
    approvedTaskId:task.id,
    approvedBranch:branch,
    async invokeOrchestratorTask(planTaskId:string,gatewayTaskId:string){
      if(attempted)fail("approved branch provider Task is one-shot");
      if(planTaskId!==task.id||!DISPATCH.test(gatewayTaskId??""))
        fail("unapproved branch Task or Gateway binding");
      const current=input.coordinator.trustedOperationalAuthority();
      if(current.credential_id!==credentialId||
         current.plan_digest!==root.plan_digest||
         !current.permissions.some(x=>
           x.operation==="create_branch"&&x.resource===repoRoot))
        fail("operational root expired or no longer grants branch");
      // Reserve before Gateway prepare/VP issuance: uncertain network
      // effects must never cause a silently retried branch write.
      attempted=true;
      const result=await transport.invoke(
        gatewayTaskId,"create_branch",
        {base_branch:"main",branch},
        {operation:"create_branch",resource:repoRoot}
      );
      if(!result||typeof result!=="object"||
         (result as {performed?:unknown}).performed!==true||
         (result as {tool?:unknown}).tool!=="create_branch"||
         (result as {branch?:unknown}).branch!==branch)
        fail("Gateway did not corroborate the exact approved branch write");
      // Dispatcher's trusted completion observer independently confirms
      // the same bound Task before releasing the Backend dependency.
    }
  });
}
