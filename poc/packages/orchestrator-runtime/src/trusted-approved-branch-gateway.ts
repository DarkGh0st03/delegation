/**
 * Private, owner-only Orchestrator effects for an immutable approved plan:
 * create_branch followed optionally by create_pull_request AFTER trusted
 * Runner acceptance. Never expose this provider or Adapter bearer to ADK,
 * MCP, A2A or public HTTP.
 *
 * The branch, PR description, session and permissions derive ONLY from an
 * authenticated Ed25519 Engineer receipt. The Gateway separately enforces
 * each signed Task binding, Rust VC/VP scope, OPA and exact-SHA Runner
 * acceptance before the PR reaches Gitea. No merge operation is supported.
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
  approvedTaskId:string;
  approvedPullRequestTaskId?:string;
  approvedBranch:string;
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
  const own=approvals.filter(x=>x.agent_id==="orchestrator");
  const branchGrants=own.filter(x=>x.operation==="create_branch");
  const prGrants=own.filter(x=>x.operation==="create_pull_request");
  const branchTask=tasks.find(t=>t.id===branchGrants[0]?.task_id);
  const prTask=tasks.find(t=>t.id===prGrants[0]?.task_id);
  // No arbitrary callback, extra Orchestrator Task or hidden permission.
  // Existing branch-only plans remain supported.
  if(branchGrants.length!==1||
     prGrants.length>1||own.length!==branchGrants.length+prGrants.length||
     tasks.length!==1+prGrants.length||
     !branchTask||branchTask.depends_on.length!==0||
     branchTask.resources.length!==1||branchTask.resources[0]!==repoRoot||
     branchGrants[0]!.resource!==repoRoot)
    fail("Orchestrator Task does not have exact Engineer-granted create_branch");
  if(prTask){
    const tests=plan.tasks.filter(t=>t.agent_id==="test");
    if(prGrants[0]!.resource!==repoRoot||
       prTask.id===branchTask.id||
       prTask.resources.length!==1||prTask.resources[0]!==repoRoot||
       tests.length===0||
       tests.some(t=>!prTask.depends_on.includes(t.id)))
      fail("Pull Request Task requires signed completion of every approved Test Task");
  }
  if(prGrants.length!==Number(Boolean(prTask)))
    fail("Orchestrator Pull Request lacks the exact Engineer grant");
  const supported=new Set(["create_branch",...(prTask?["create_pull_request"]:[])]);
  if([...supported].some(operation=>!root.permissions.some(
    (x:{operation:string;resource:string})=>
      x.operation===operation&&x.resource===repoRoot)))
    fail("active Rust operational root lacks signed branch or PR permission");
  const branch=approvedWorkBranch(plan);
  const credentialId=root.credential_id;
  const digest=root.plan_digest;
  const title="Approved software changes: "+plan.plan_id.slice(0,80);
  const body="Created for signed Engineer-approved plan "+
    plan.plan_id+" ("+digest+"). Merge requires separate human review.";
  const transport=new OrchestratorGatewayTransport({
    ...input.transport,rootCredentialId:credentialId
  });
  const attempted=new Set<string>();
  let completedBranch=false;
  return Object.freeze({
    approvedTaskId:branchTask.id,
    ...(prTask?{approvedPullRequestTaskId:prTask.id}:{}),
    approvedBranch:branch,
    async invokeOrchestratorTask(planTaskId:string,gatewayTaskId:string){
      // Distinct one-shot attempts prevent network ambiguity from being
      // retried or reinterpreted as an independent signed Task.
      if(attempted.has(planTaskId))
        fail("approved branch provider Task is one-shot");
      if(!DISPATCH.test(gatewayTaskId??"")||
         (planTaskId!==branchTask.id&&planTaskId!==prTask?.id))
        fail("unapproved branch Task or Gateway binding");
      const operation=planTaskId===branchTask.id
        ?"create_branch":"create_pull_request";
      if(operation==="create_pull_request"&&!completedBranch)
        fail("Pull Request requires a confirmed approved branch");
      const current=input.coordinator.trustedOperationalAuthority();
      if(current.credential_id!==credentialId||
         current.plan_digest!==digest||
         !current.permissions.some(x=>
           x.operation===operation&&x.resource===repoRoot))
        fail("operational root expired or no longer grants approved operation");
      attempted.add(planTaskId); // Before any Gateway/Adapter side effect
      if(operation==="create_branch"){
        const result=await transport.invoke(gatewayTaskId,"create_branch",
          {base_branch:"main",branch},
          {operation:"create_branch",resource:repoRoot});
        if(!result||typeof result!=="object"||
           (result as {provider?:unknown}).provider!=="gitea"||
           (result as {performed?:unknown}).performed!==true||
           (result as {tool?:unknown}).tool!=="create_branch"||
           (result as {branch?:unknown}).branch!==branch||
           (result as {base_branch?:unknown}).base_branch!=="main")
          fail("Gateway did not corroborate the exact approved branch write");
        completedBranch=true;
      }else{
        // The Gateway MUST independently require exact-SHA test completion
        // and Researcher Acceptance at Prepare AND Execute, rather than
        // trusting this local branchCompleted boolean.
        const result=await transport.invoke(
          gatewayTaskId,"create_pull_request",
          {head_branch:branch,base_branch:"main",title,body},
          {operation:"create_pull_request",resource:repoRoot});
        if(!result||typeof result!=="object"||
           (result as {provider?:unknown}).provider!=="gitea"||
           (result as {performed?:unknown}).performed!==true||
           (result as {tool?:unknown}).tool!=="create_pull_request"||
           (result as {head_branch?:unknown}).head_branch!==branch||
           (result as {base_branch?:unknown}).base_branch!=="main"||
           !Number.isSafeInteger((result as {pull_request_id?:unknown}).pull_request_id)||
           Number((result as {pull_request_id?:unknown}).pull_request_id)<=0||
           !Number.isSafeInteger((result as {pull_request_number?:unknown}).pull_request_number)||
           Number((result as {pull_request_number?:unknown}).pull_request_number)<=0||
           !SHA.test((result as {revision?:string}).revision??""))
          fail("Gateway did not corroborate exact approved Pull Request");
      }
      // The signed dispatcher independently corroborates the bound Task
      // against Gateway-owned provider evidence before releasing descendants.
    }
  });
}
