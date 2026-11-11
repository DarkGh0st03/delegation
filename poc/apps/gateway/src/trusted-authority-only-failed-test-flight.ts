/**
 * R340: check a trusted Gateway's original *incomplete* native Test flight.
 * This is a pure validator. Only the Gateway owner may supply its internal
 * flight, enrolled Child and completed-predecessor state.
 * A valid result does NOT prove Docker failure or authorize D1.
 */
import {giteaPermissionCovers}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import {canonicalBranchUri} from "./canonical.ts";
import type {TrustedTaskFlight}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-task-fence-journal.ts";
import type {RegisteredAuthorityOnlyTask}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts";
import type {VerifiedStagedChild}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts";
import type {TrustedCompletionExpectation}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import type {Permission} from "./types.ts";
type Root=Readonly<{
 session_id:string;authority_digest:string;root_credential_id:string;
 branch:string;repository:{authority:string;owner:string;repository:string};
 root_permissions:readonly Permission[];
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function deny(x:string):never{throw Error("Native Gateway failed Test flight NO-GO: "+x);}
export function assertOriginalIncompleteTestFlight(input:{
 root:Root;row:RegisteredAuthorityOnlyTask;
 child:VerifiedStagedChild;flight:TrustedTaskFlight;
 taskId:string;runtimeTaskId:string;
 approved:readonly Permission[];completed:boolean;
 predecessorsComplete:boolean;nowMs:number;
}):Readonly<TrustedCompletionExpectation & {
 status:"gateway_original_test_flight_preflight_only";
 gateway_task_completed:false;recovery_authorized:false;
 gateway_execution_authorized:false;
}>{
 const {root,row,child,flight,taskId,runtimeTaskId}=input;
 if(!root||!row||!child||!flight||
    !ID.test(taskId)||!ID.test(runtimeTaskId)||
    input.completed||!input.predecessorsComplete||
    !Number.isSafeInteger(input.nowMs)||input.nowMs<0||
    row.status!=="task_registered_preflight_only"||
    child.status!=="native_child_response_verified_staged"||
    row.agent_id!=="test"||child.agent_id!=="test"||
    row.task_id!==taskId||child.task_id!==taskId||
    flight.task_id!==taskId||flight.runtime_task_id!==runtimeTaskId||
    row.session_id!==root.session_id||
    child.session_id!==root.session_id||
    flight.session_id!==root.session_id||
    row.authority_digest!==root.authority_digest||
    child.authority_digest!==root.authority_digest||
    flight.authority_digest!==root.authority_digest||
    row.root_credential_id!==root.root_credential_id||
    child.root_credential_id!==root.root_credential_id||
    flight.root_credential_id!==root.root_credential_id||
    row.agent_did!==child.agent_did||
    child.credential_id!==flight.credential_id||
    child.epoch!==row.epoch||flight.epoch!==row.epoch||
    row.permissions.length!==1||child.permissions.length!==1||
    row.permissions[0]?.operation!=="run_tests"||
    child.permissions[0]?.operation!=="run_tests"||
    row.permissions[0].resource!==canonicalBranchUri(root.repository,root.branch)||
    child.permissions[0].resource!==row.permissions[0].resource||
    !input.approved?.some(p=>giteaPermissionCovers(p,row.permissions[0]!))||
    !root.root_permissions.some(p=>giteaPermissionCovers(p,row.permissions[0]!))||
    input.nowMs>=Date.parse(child.expires_at)||
    !ID.test(flight.request_id)||
    !/^[a-f0-9]{64}$/u.test(flight.request_fingerprint))
  deny("flight not original, incomplete, native Child-bound and signed Test-scoped");
 return Object.freeze({
  ...flight,agent_did:row.agent_did,
  status:"gateway_original_test_flight_preflight_only" as const,
  gateway_task_completed:false as const,
  recovery_authorized:false as const,
  gateway_execution_authorized:false as const
 });
}
