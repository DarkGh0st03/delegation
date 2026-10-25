/**
 * R5 NON-BILLABLE owner-only execution. Deliberately separate from every
 * Gemini readiness/admission/model constructor. No API key, model config,
 * artificial charge consent or GitHub event is accepted by this entry.
 *
 * This is the scripted provider half of the future private runner E2E, NOT
 * GitHub job authentication. A future production caller must first supply
 * independently verified OIDC admission + live job checks, and cannot
 * substitute this for the separately cost-authorized Gemini handoff.
 *
 * Only the original trusted in-process Engineer owner may provide handlers:
 * do not expose this function to HTTP, MCP, ADK tools or untrusted workflow
 * inputs. Gateway/Rust/OPA independently authorize every task effect.
 */
import {isDeepStrictEqual} from "node:util";
import {preliminaryReadPermissions,type RootParameters}
  from "./trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import {assertApprovedPlanScope}
  from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {startSpecializedAgentServer,
  type SpecializedAgentServer}
  from "../../agent-runtime/src/server.ts";
import type {DeterministicTaskHandler}
  from "../../agent-runtime/src/executor.ts";

const ROLES=["backend","frontend","test"] as const;
type Role=typeof ROLES[number];
const SHA=/^[a-f0-9]{40}$/u;
function fail(reason:string):never{
  throw Error("Trusted scripted offline handoff: "+reason);
}

export async function startPersistedReviewedScriptedHandoff(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  checkpointStore:SignedPlanningCheckpointFileStore;
  operationalRoot:RootParameters;
  ports:Readonly<Record<Role,number>>;
  /** Trusted local scripted provider implementation, never from plan/LLM. */
  handlers:Readonly<Record<Role,DeterministicTaskHandler>>;
}){
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !(input.checkpointStore instanceof SignedPlanningCheckpointFileStore))
    fail("same-process Coordinator, signed checkpoint and Engineer review required");
  if(input.coordinator.phase!=="planning")
    fail("active preliminary Planning root required");
  // Fix the entire set of role endpoints/handlers before issuing authority.
  const ports=ROLES.map(role=>input.ports?.[role]);
  if(ports.some(p=>!Number.isSafeInteger(p)||p<1024||p>65535)||
     new Set(ports).size!==3||
     ROLES.some(role=>typeof input.handlers?.[role]!=="function")||
     Object.keys(input.ports??{}).length!==3||
     Object.keys(input.handlers??{}).length!==3)
    fail("three distinct bound scripted role ports and handlers required");
  const root=input.coordinator.trustedPlanningAuthority();
  const checkpoint=await input.checkpointStore.load();
  if(root.session_id!==checkpoint.snapshot.session_id||
     root.base_revision!==checkpoint.snapshot.base_revision||
     !isDeepStrictEqual(root.permissions,
       preliminaryReadPermissions(checkpoint.snapshot)))
    fail("preliminary root differs from signed Planning snapshot");
  let staged:ReturnType<TrustedPlanningReviewGate["reviewPacket"]>|undefined;
  try{staged=input.reviewGate.reviewPacket();}
  catch(error){
    if(!String(error).includes("no staged proposal available"))throw error;
  }
  if(staged){
    if(staged.plan_digest!==checkpoint.proposal.digest||
       staged.session_id!==root.session_id||
       staged.base_revision!==root.base_revision||
       staged.work_branch!==checkpoint.expected_work_branch||
       staged.verified_source_reads!==checkpoint.proposal.verified_source_reads||
       !isDeepStrictEqual(staged.plan,checkpoint.proposal.plan))
      fail("staged approval differs from independently signed checkpoint");
  }else{
    staged=input.checkpointStore.stageVerified(input.reviewGate,checkpoint);
  }
  const verified=await input.reviewGate.loadAuthenticatedApproval(root.session_id);
  const rows=assertApprovedPlanScope(verified.plan,verified.approval,{
    allowedOperations:new Set<string>(RUST_OPERATIONS),
    expectedEngineerDid:verified.authenticated_engineer_did
  }) as Array<{operation:string;resource:string}>;
  // A signed plan/digest alone is not an Engineer signature. The review gate
  // has independently verified the Ed25519 receipt above.
  const expected:Array<{operation:string;resource:string}>=[];
  const seen=new Set<string>();
  for(const row of rows){
    const permission={operation:row.operation,resource:row.resource};
    const key=JSON.stringify(permission);
    if(!seen.has(key)){expected.push(permission);seen.add(key);}
  }
  let activated=false;
  const servers:SpecializedAgentServer[]=[];
  try{
    const issued=await input.coordinator.beginExecution(input.operationalRoot);
    activated=true;
    if(issued.plan_digest!==staged.plan_digest||
       !isDeepStrictEqual(input.coordinator
         .trustedOperationalAuthority().permissions,expected))
      fail("operational root is not identical to signed permission selection");
    for(const role of ROLES){
      if(input.coordinator.phase!=="execution")
        fail("root closed while starting scripted A2A servers");
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:input.ports[role],
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        taskHandler:input.handlers[role]
      });
      servers.push(server);
    }
    const endpoints=Object.freeze(Object.fromEntries(
      servers.map(s=>[s.role,s.baseUrl])
    ) as Record<Role,string>);
    let shutdown:Promise<void>|undefined;
    return Object.freeze({
      readiness:Object.freeze({
        status:"scripted_offline_no_model_or_charge_consent" as const,
        session_id:staged.session_id,
        base_revision:staged.base_revision,
        plan_digest:staged.plan_digest,
        authenticated_engineer_did:verified.authenticated_engineer_did
      }),
      operational_root_id:issued.credential_id,
      endpoints,servers:Object.freeze([...servers]),
      close:()=>{
        if(shutdown)return shutdown;
        // Authority is fenced/revoked BEFORE potentially slow server.close().
        shutdown=(async()=>{
          let authorityError:unknown,serverError:unknown;
          try{await input.coordinator.closeExecution();}
          catch(error){authorityError=error;}
          for(const server of [...servers].reverse()){
            try{await server.close();}
            catch(error){serverError??=error;}
          }
          if(authorityError)
            throw Error("Scripted operational root revocation unconfirmed",
              {cause:authorityError});
          if(serverError)
            throw Error("Scripted A2A server shutdown unconfirmed",
              {cause:serverError});
        })();
        return shutdown;
      }
    });
  }catch(error){
    let closeError:unknown;
    if(activated){
      try{await input.coordinator.closeExecution();}
      catch(e){closeError=e;}
    }
    for(const server of [...servers].reverse()){
      try{await server.close();}catch(e){closeError??=e;}
    }
    if(closeError)
      throw Error("Scripted startup failed with uncertain root/server closure",
        {cause:closeError});
    throw error;
  }
}
