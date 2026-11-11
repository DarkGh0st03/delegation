/**
 * R406.2 — owner-private, type-only contract for an admitted repair DAG.
 * These are port shapes, NEVER a permission grant, signed plan, Child DC,
 * tool schema or model authority. The legacy execution controller stays
 * a separately gated/dynamic runtime while its caller is migrated.
 *
 * Type-only imports are stripped at runtime. No old controller/HTTP client
 * may become a dependency merely by referring to this contract.
 */
import type {TrustedRunnerTypecheckContext}
 from "./trusted-runner-typecheck-context.ts";
import type {TrustedRunnerAssertionContext}
 from "./trusted-runner-assertion-context.ts";
import type {ProtectedA2AClientPort} from "./a2a-workflow.ts";
import type {ChildIssuanceInput}
 from "./trusted-credential-contracts.ts";
import type {TrustedOperationalEpochIntake}
 from "./trusted-operational-epoch-intake.ts";
import type {TrustedPlanIpcClient}
 from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {TrustedChildIssuanceJournal}
 from "./trusted-child-issuance-journal.mjs";
import type {TrustedExecutionCoordinator}
 from "./trusted-execution-coordinator.ts";

type Role="backend"|"frontend"|"test";
type Credential=Pick<ChildIssuanceInput,
 "credential_id"|"valid_from"|"validity_seconds"|"credential_status">;

export type TrustedAdmittedRepairDagConfig=Readonly<{
 sessionId:string;epoch:number;planDigest:string;
 coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 intake:TrustedOperationalEpochIntake;
 gateway:TrustedPlanIpcClient;
 journal:TrustedChildIssuanceJournal;
 engineerDid:string;
 adapterBaseUrl?:string;orchestratorToken:string;
 fetchFn?:typeof fetch;
 agentBaseUrls:Readonly<Record<Role,string>>;
 a2a:ProtectedA2AClientPort;
 failureContext?:Readonly<{testedSha:string;loadForRole:(role:Role)=>Promise<TrustedRunnerAssertionContext|null>;loadTypecheckForRole?:(role:Role)=>Promise<TrustedRunnerTypecheckContext|null>}>;
 /** R138: independent original GitHub run check; never a model port. */
 verifyLiveRun?:()=>Promise<void>;
 /** Local trusted owner supplies unique native child ID/status per task;
  * NO model or agent may supply or override these values. */
 credentialForTask:(task:Readonly<{id:string;role:Role;ordinal:number}>)
  =>Credential;
 /** R151.10: trusted original owner may bind the just-issued native
  * child to its already-running role Agent BEFORE protected A2A send.
  * No plan or authority is accepted from the role/model callback. */
 beforeProtectedSend?:(issued:Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;epoch:number
 }>)=>Promise<void>;
 /** R151.10: progress only after the same Gateway independently confirms
  * signed VP/OPA and actual provider effects; owner can pin exact Gitea
  * SHA for a subsequent signed Test. No completion may be inferred from
  * the model or A2A result alone. */
 afterGatewayConfirmed?:(task:Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;epoch:number
 }>)=>Promise<void>;
}>;
