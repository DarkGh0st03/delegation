import { AdapterVerifierClient } from "./adapter-client.ts";
import {loadDirectCoreRustVerifier} from "./direct-core-loader.ts";
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";
import {
  InMemoryCompositeStore,
  prepareCompositeAuthorization,
  verifyCompositeAuthorization,
  prepareReadCompositeAuthorization,
  executeReadCompositeAuthorization
} from "./composite-authorization.ts";
import type { GatewayRuntimeConfig } from "./config.ts";
import { executeAuthorization } from "./execute.ts";
import { GiteaClient } from "./gitea-client.ts";
import { GiteaExecutor } from "./gitea-executor.ts";
import { GiteaReadOnlyExecutor } from "./gitea-read-executor.ts";
import { MockExecutor } from "./mock-executor.ts";
import { OpaPolicyClient } from "./policy-client.ts";
import type { TrustedPlanningRevisions } from "./planning-revisions.ts";
import type { TrustedApprovedExecutionPlans } from "./approved-execution-plans.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import type {TrustedAuthorityOnlyGiteaMutationExecutor}
 from "./trusted-authority-only-mutation-executor.ts";
import type {TrustedAuthorityOnlyRunnerExecutor}
 from "./trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "./trusted-authority-only-pull-request-executor.ts";
import { RunnerClient } from "./runner-client.ts";
import {
  InMemoryAuditSink,
  InMemoryRequestStore,
  prepareAuthorization
} from "./prepare.ts";
import type {
  AuditEvent,
  AuditSink,
  ExecuteAuthorizationResponse,
  ExecutionPort,
  PolicyPort,
  PreparedAuthorizationResponse,
  VerifierPort
} from "./types.ts";

export class JsonLineAuditSink implements AuditSink {
  emit(event: AuditEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

export interface GatewayRuntimeDependencies {
  store?: InMemoryRequestStore;
  audit?: AuditSink;
  verifier?: VerifierPort;
  policy?: PolicyPort;
  executor?: ExecutionPort;
  /** Trusted in-process Planning coordinator supplies this optional guard. */
  planningRevisions?: TrustedPlanningRevisions;
  /** Opt-in trusted Engineer-approved execution plan gate (no public mutation API). */
  approvedPlans?: TrustedApprovedExecutionPlans;
  authorityOnlyAdmissions?: TrustedAuthorityOnlyGatewayAdmissions;
  /** Canonical runtime only: owner-prestaged HEAD-CAS, never legacy PUT. */
  authorityOnlyMutationEnabled?: boolean;
  authorityOnlyMutationExecutor?: TrustedAuthorityOnlyGiteaMutationExecutor;
  /** Canonical runtime only: owner-prestaged native Docker Test. */
  authorityOnlyRunnerEnabled?: boolean;
  authorityOnlyRunnerExecutor?: TrustedAuthorityOnlyRunnerExecutor;
  authorityOnlyPullRequestEnabled?:boolean;
  authorityOnlyPullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
}

function defaultExecutor(config: GatewayRuntimeConfig): ExecutionPort {
  if (config.provider_mode === "mock") return new MockExecutor();

  if (!config.gitea_base_url || !config.gitea_gateway_token) {
    throw new Error("Gitea provider mode requires Gitea URL and Gateway token");
  }

  const client = new GiteaClient({
    baseUrl: config.gitea_base_url,
    token: config.gitea_gateway_token,
    owner: config.prepare.repository.owner,
    repository: config.prepare.repository.repository,
    timeoutMs: config.gitea_timeout_ms
  });

  if (config.provider_mode === "gitea-readonly") {
    return new GiteaReadOnlyExecutor(client);
  }

  const runnerClient =
    config.runner_url && config.runner_gateway_token
      ? new RunnerClient({
          baseUrl: config.runner_url,
          gatewayToken: config.runner_gateway_token,
          timeoutMs: config.runner_timeout_ms
        })
      : undefined;
  const repositoryUri =
    `gitea://${config.prepare.repository.authority}/` +
    `${config.prepare.repository.owner}/${config.prepare.repository.repository}`;

  return new GiteaExecutor(client, runnerClient, repositoryUri);
}

export class GatewayRuntime {
  readonly #config: GatewayRuntimeConfig;
  readonly #store: InMemoryRequestStore;
  readonly #compositeStore: InMemoryCompositeStore;
  readonly #audit: AuditSink;
  readonly #verifier: VerifierPort;
  readonly #policy: PolicyPort;
  readonly #executor: ExecutionPort;
  readonly #planningRevisions?: TrustedPlanningRevisions;
  readonly #approvedPlans?: TrustedApprovedExecutionPlans;
  readonly #authorityOnlyAdmissions?: TrustedAuthorityOnlyGatewayAdmissions;
  readonly #authorityOnlyMutationExecutor?: TrustedAuthorityOnlyGiteaMutationExecutor;
  readonly #authorityOnlyRunnerExecutor?: TrustedAuthorityOnlyRunnerExecutor;
  readonly #authorityOnlyMutationEnabled:boolean;
  readonly #authorityOnlyRunnerEnabled:boolean;
  readonly #authorityOnlyPullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
  readonly #authorityOnlyPullRequestEnabled:boolean;

  constructor(config: GatewayRuntimeConfig, dependencies: GatewayRuntimeDependencies = {}) {
    const gate=dependencies.authorityOnlyAdmissions;
    const mutation=dependencies.authorityOnlyMutationExecutor;
    const runner=dependencies.authorityOnlyRunnerExecutor;
    const pr=dependencies.authorityOnlyPullRequestExecutor;
    if(gate&&
       (!(gate instanceof TrustedAuthorityOnlyGatewayAdmissions)||
        dependencies.approvedPlans||dependencies.planningRevisions))
      throw Error("Authority-only Gateway requires distinct trusted runtime without legacy gates");
    if((dependencies.authorityOnlyMutationEnabled===true)!==Boolean(mutation)||
       (dependencies.authorityOnlyRunnerEnabled===true)!==Boolean(runner)||
       (dependencies.authorityOnlyPullRequestEnabled===true)!==Boolean(pr))
      throw Error("Authority-only Gateway effects require matching explicit enablement and owner executor");
    if((mutation||runner||pr)&&!gate)
      throw Error("Authority-only Gateway effects require enrolled native authority");
    if(gate&&(config.provider_mode!=="gitea"||config.verifier_mode!=="core-rust"))
      throw Error("Authority-only Gateway requires mutable Gitea and explicit independent Core Rust verification");
    // Owner-only integration must never substitute an arbitrary verifier or
    // provider executor when the public HTTP runtime is authority-only.
    // The actual native Rust binding is still loaded by the trusted owner.
    if(gate&&dependencies.verifier&&
       !(dependencies.verifier instanceof DirectCoreRustVerifier))
      throw Error("Authority-only Gateway rejects non-native verifier injection");
    if(gate&&dependencies.executor&&
       !(dependencies.executor instanceof GiteaExecutor))
      throw Error("Authority-only Gateway rejects non-Gitea executor injection");
    if(mutation&&(!mutation.isForAdmissions||!mutation.isForAdmissions(gate!)))
      throw Error("Authority-only Gateway CAS executor differs from enrolled owner");
    if(runner&&(!runner.isForAdmissions||!runner.isForAdmissions(gate!)))
      throw Error("Authority-only Gateway Runner executor differs from enrolled owner");
    if(pr&&!TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(pr,gate!))
      throw Error("Authority-only PR executor differs from enrolled owner");
    this.#authorityOnlyPullRequestEnabled=dependencies.authorityOnlyPullRequestEnabled===true;
    this.#authorityOnlyPullRequestExecutor=pr;
    this.#config = config;
    this.#planningRevisions = dependencies.planningRevisions;
    this.#approvedPlans = dependencies.approvedPlans;
    this.#authorityOnlyAdmissions = gate;
    this.#authorityOnlyMutationEnabled=dependencies.authorityOnlyMutationEnabled===true;
    this.#authorityOnlyMutationExecutor=mutation;
    this.#authorityOnlyRunnerEnabled=dependencies.authorityOnlyRunnerEnabled===true;
    this.#authorityOnlyRunnerExecutor=runner;
    this.#store = dependencies.store ?? new InMemoryRequestStore();
    this.#compositeStore = new InMemoryCompositeStore();
    this.#audit = dependencies.audit ?? new JsonLineAuditSink();
    if (dependencies.verifier) {
      // Test-only or explicitly trusted embedded verifier injection.
      this.#verifier = dependencies.verifier;
    } else if (config.verifier_mode === "core-rust") {
      // Fail at startup if native Core Rust and independent trust/status
      // resolvers have not been deployed. NEVER fall back to Adapter.
      this.#verifier = loadDirectCoreRustVerifier();
    } else {
      if (!config.adapter_url || !config.adapter_gateway_token) {
        throw new Error("Adapter verifier mode requires URL and Gateway caller secret");
      }
      this.#verifier = new AdapterVerifierClient({
        baseUrl: config.adapter_url,
        gatewayToken: config.adapter_gateway_token
      });
    }
    this.#policy =
      dependencies.policy ??
      new OpaPolicyClient({
        baseUrl: config.opa_url,
        timeoutMs: config.opa_timeout_ms
      });
    this.#executor = dependencies.executor ?? defaultExecutor(config);
  }

  /**
   * Owner-only capability check. Operational repair source reads must NEVER
   * use a Gateway instance without the authenticated Task/epoch guard.
   */
  hasTrustedOperationalPlanGate():boolean{
    return this.#approvedPlans!==undefined;
  }
  /** Identity equality, not duck-typed metadata. */
  hasExactTrustedOperationalPlanGate(gate:TrustedApprovedExecutionPlans):boolean{
    return this.#approvedPlans===gate;
  }

  get providerLabel(): "mock" | "gitea" {
    return this.#executor.provider;
  }

  prepare(raw: unknown): PreparedAuthorizationResponse {
    return prepareAuthorization(raw, this.#config.prepare, {
      store: this.#store,
      audit: this.#audit,
      ...(this.#planningRevisions ? {planningRevisions:this.#planningRevisions} : {}),
      ...(this.#approvedPlans ? {approvedPlans:this.#approvedPlans} : {}),
      ...(this.#authorityOnlyAdmissions ? {authorityOnlyAdmissions:this.#authorityOnlyAdmissions} : {})
    });
  }

  /** Dry-run only: it never calls Gitea, Docker or the execution port. */
  prepareComposite(raw: unknown) {
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway operations unavailable in authority-only staging");
    return prepareCompositeAuthorization(raw, {
      store:this.#compositeStore,
      audit:this.#audit,
      verifier:this.#verifier,
      policy:this.#policy,
      config:this.#config.prepare
    });
  }

  /** One read-only executable composite pinned to a trusted revision. */
  async prepareReadComposite(raw:unknown){
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway reads unavailable in authority-only staging");
    return prepareReadCompositeAuthorization(raw,{
      store:this.#compositeStore,audit:this.#audit,verifier:this.#verifier,
      policy:this.#policy,config:this.#config.prepare,
      executor:this.#executor,
      ...(this.#planningRevisions?{planningRevisions:this.#planningRevisions}:{}),
      ...(this.#approvedPlans?{approvedPlans:this.#approvedPlans}:{})
    });
  }

  async executeReadComposite(raw:unknown,signal?:AbortSignal){
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway reads unavailable in authority-only staging");
    return executeReadCompositeAuthorization(raw,{
      store:this.#compositeStore,audit:this.#audit,verifier:this.#verifier,
      policy:this.#policy,config:this.#config.prepare,
      executor:this.#executor,
      ...(this.#planningRevisions?{planningRevisions:this.#planningRevisions}:{}),
      ...(this.#approvedPlans?{approvedPlans:this.#approvedPlans}:{}),
      ...(signal?{signal}:{})
    });
  }

  /** Returns a check result, never an executable capability or provider result. */
  async verifyComposite(raw: unknown) {
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway verification unavailable in authority-only staging");
    return verifyCompositeAuthorization(raw, {
      store:this.#compositeStore,
      audit:this.#audit,
      verifier:this.#verifier,
      policy:this.#policy,
      config:this.#config.prepare
    });
  }

  async execute(raw: unknown, signal?: AbortSignal): Promise<ExecuteAuthorizationResponse> {
    return executeAuthorization(raw, {
      store: this.#store,
      audit: this.#audit,
      verifier: this.#verifier,
      policy: this.#policy,
      repository: this.#config.prepare.repository,
      executor: this.#executor,
      ...(this.#planningRevisions ? {planningRevisions:this.#planningRevisions} : {}),
      ...(this.#approvedPlans ? {approvedPlans:this.#approvedPlans} : {}),
      ...(this.#authorityOnlyAdmissions ? {authorityOnlyAdmissions:this.#authorityOnlyAdmissions} : {}),
      ...(this.#authorityOnlyMutationEnabled ? {
        authorityOnlyMutationEnabled:true,
        authorityOnlyMutationExecutor:this.#authorityOnlyMutationExecutor
      } : {}),
      ...(this.#authorityOnlyRunnerEnabled ? {
        authorityOnlyRunnerEnabled:true,
        authorityOnlyRunnerExecutor:this.#authorityOnlyRunnerExecutor
      } : {}),
      ...(this.#authorityOnlyPullRequestEnabled?{
       authorityOnlyPullRequestEnabled:true,
       authorityOnlyPullRequestExecutor:this.#authorityOnlyPullRequestExecutor
      }:{}),
      ...(signal ? {signal} : {})
    });
  }
}
