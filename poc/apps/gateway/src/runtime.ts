import {TrustedAuthorityOnlyBranchExecutor} from './trusted-authority-only-branch-executor.ts';
import {loadDirectCoreRustVerifier} from "./direct-core-loader.ts";
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";
import {
  InMemoryCompositeStore,
  prepareReadCompositeAuthorization,
  executeReadCompositeAuthorization
} from "./composite-authorization.ts";
import { executeAuthorization } from "./execute.ts";
import { GiteaClient } from "./gitea-client.ts";
import { GiteaExecutor } from "./gitea-executor.ts";
import { OpaPolicyClient } from "./policy-client.ts";
import type { TrustedPlanningRevisions } from "./planning-revisions.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "./trusted-authority-only-gitea-publisher.ts";
import type {TrustedAuthorityOnlyGiteaMutationExecutor}
 from "./trusted-authority-only-mutation-executor.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor}
 from "./trusted-authority-only-create-executor.ts";
import type {TrustedAuthorityOnlyRunnerExecutor}
 from "./trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "./trusted-authority-only-pull-request-executor.ts";
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
  GatewayPrepareConfig,
  PolicyPort,
  PreparedAuthorizationResponse,
  VerifierPort
} from "./types.ts";

/** Gateway of one console session: Gitea provider, native Rust verifier. */
export interface GatewayRuntimeConfig {
  bind_host: string;
  bind_port: number;
  prepare: GatewayPrepareConfig;
  verifier_mode?: "core-rust";
  opa_url: string;
  opa_timeout_ms: number;
  provider_mode: "gitea";
  gitea_base_url?: string;
  gitea_gateway_token?: string;
  gitea_timeout_ms: number;
}

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
  authorityOnlyAdmissions?: TrustedAuthorityOnlyGatewayAdmissions;
  /** Explicit owner-only source-read publication, never enabled by public config. */
  authorityOnlyReadEnabled?: boolean;
  authorityOnlyReceiptWriter?: TrustedGatewayGiteaReadEvidencePublisher;
  /** Canonical runtime only: owner-prestaged HEAD-CAS, never legacy PUT. */
  authorityOnlyMutationEnabled?: boolean;
  authorityOnlyMutationExecutor?: TrustedAuthorityOnlyGiteaMutationExecutor;
  /** Explicit owner-only CREATE_FILE HEAD-CAS; absent means deny. */
  authorityOnlyCreateEnabled?:boolean;
  authorityOnlyCreateExecutor?:TrustedAuthorityOnlyGiteaCreateExecutor;
  /** Canonical runtime only: owner-prestaged native Docker Test. */
  authorityOnlyRunnerEnabled?: boolean;
  authorityOnlyRunnerExecutor?: TrustedAuthorityOnlyRunnerExecutor;
  authorityOnlyBranchEnabled?:boolean;
  authorityOnlyBranchExecutor?:TrustedAuthorityOnlyBranchExecutor;
  authorityOnlyPullRequestEnabled?:boolean;
  authorityOnlyPullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
}

function defaultExecutor(config: GatewayRuntimeConfig): ExecutionPort {
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

  return new GiteaExecutor(client);
}

export class GatewayRuntime {
  readonly #config: GatewayRuntimeConfig;
  readonly #store: InMemoryRequestStore;
  readonly #compositeStore = new InMemoryCompositeStore();
  readonly #audit: AuditSink;
  readonly #verifier: VerifierPort;
  readonly #policy: PolicyPort;
  readonly #executor: ExecutionPort;
  readonly #planningRevisions?: TrustedPlanningRevisions;
  readonly #authorityOnlyAdmissions?: TrustedAuthorityOnlyGatewayAdmissions;
  readonly #authorityOnlyReadEnabled:boolean;
  readonly #authorityOnlyReceiptWriter?:TrustedGatewayGiteaReadEvidencePublisher;
  readonly #authorityOnlyMutationExecutor?: TrustedAuthorityOnlyGiteaMutationExecutor;
  readonly #authorityOnlyCreateExecutor?:TrustedAuthorityOnlyGiteaCreateExecutor;
  readonly #authorityOnlyCreateEnabled:boolean;
  readonly #authorityOnlyRunnerExecutor?: TrustedAuthorityOnlyRunnerExecutor;
  readonly #authorityOnlyMutationEnabled:boolean;
  readonly #authorityOnlyRunnerEnabled:boolean;
  readonly #authorityOnlyPullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
  readonly #authorityOnlyBranchEnabled:boolean;
  readonly #authorityOnlyBranchExecutor?:TrustedAuthorityOnlyBranchExecutor;
  readonly #authorityOnlyPullRequestEnabled:boolean;

  constructor(config: GatewayRuntimeConfig, dependencies: GatewayRuntimeDependencies = {}) {
    const gate=dependencies.authorityOnlyAdmissions;
    const readWriter=dependencies.authorityOnlyReceiptWriter;
    const mutation=dependencies.authorityOnlyMutationExecutor;
    const create=dependencies.authorityOnlyCreateExecutor;
    const runner=dependencies.authorityOnlyRunnerExecutor;
    const pr=dependencies.authorityOnlyPullRequestExecutor;
    const branch=dependencies.authorityOnlyBranchExecutor;
    if(gate&&
       (!(gate instanceof TrustedAuthorityOnlyGatewayAdmissions)||
        dependencies.planningRevisions))
      throw Error("Authority-only Gateway requires distinct trusted runtime without legacy gates");
    if((dependencies.authorityOnlyReadEnabled===true)!==Boolean(readWriter)||
       (dependencies.authorityOnlyMutationEnabled===true)!==Boolean(mutation)||
       (dependencies.authorityOnlyCreateEnabled===true)!==Boolean(create)||
       (dependencies.authorityOnlyRunnerEnabled===true)!==Boolean(runner)||
       (dependencies.authorityOnlyPullRequestEnabled===true)!==Boolean(pr)||
       (dependencies.authorityOnlyBranchEnabled===true)!==Boolean(branch))
      throw Error("Authority-only Gateway effects require matching explicit enablement and owner executor");
    if((readWriter||mutation||create||runner||pr||branch)&&!gate)
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
    if(readWriter&&(!(readWriter instanceof TrustedGatewayGiteaReadEvidencePublisher)||
       !readWriter.isForAdmissions(gate!)))
      throw Error("Authority-only read publisher differs from enrolled owner");
    if(mutation&&(!mutation.isForAdmissions||!mutation.isForAdmissions(gate!)))
      throw Error("Authority-only Gateway CAS executor differs from enrolled owner");
    if(create&&(!(create instanceof TrustedAuthorityOnlyGiteaCreateExecutor)||
       !TrustedAuthorityOnlyGiteaCreateExecutor.prototype.isForAdmissions.call(create,gate!)))
      throw Error("Authority-only create executor differs from enrolled native owner");
    if(runner&&(!runner.isForAdmissions||!runner.isForAdmissions(gate!)))
      throw Error("Authority-only Gateway Runner executor differs from enrolled owner");
    if(pr&&!TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(pr,gate!))
      throw Error("Authority-only PR executor differs from enrolled owner");
    if(branch&&!TrustedAuthorityOnlyBranchExecutor.isNativeForAdmissions(branch,gate!))
      throw Error("Authority-only branch executor differs from enrolled owner");
    this.#authorityOnlyBranchEnabled=dependencies.authorityOnlyBranchEnabled===true;
    this.#authorityOnlyBranchExecutor=branch;
    this.#authorityOnlyPullRequestEnabled=dependencies.authorityOnlyPullRequestEnabled===true;
    this.#authorityOnlyPullRequestExecutor=pr;
    this.#config = config;
    this.#planningRevisions = dependencies.planningRevisions;
    this.#authorityOnlyAdmissions = gate;
    this.#authorityOnlyReadEnabled=dependencies.authorityOnlyReadEnabled===true;
    this.#authorityOnlyReceiptWriter=readWriter;
    this.#authorityOnlyMutationEnabled=dependencies.authorityOnlyMutationEnabled===true;
    this.#authorityOnlyMutationExecutor=mutation;
    this.#authorityOnlyCreateEnabled=dependencies.authorityOnlyCreateEnabled===true;
    this.#authorityOnlyCreateExecutor=create;
    this.#authorityOnlyRunnerEnabled=dependencies.authorityOnlyRunnerEnabled===true;
    this.#authorityOnlyRunnerExecutor=runner;
    this.#store = dependencies.store ?? new InMemoryRequestStore();
    this.#audit = dependencies.audit ?? new JsonLineAuditSink();
    if (dependencies.verifier) {
      // Test-only or explicitly trusted embedded verifier injection.
      this.#verifier = dependencies.verifier;
    } else {
      // Fail at startup if native Core Rust and independent trust/status
      // resolvers have not been deployed.
      this.#verifier = loadDirectCoreRustVerifier();
    }
    this.#policy =
      dependencies.policy ??
      new OpaPolicyClient({
        baseUrl: config.opa_url,
        timeoutMs: config.opa_timeout_ms
      });
    this.#executor = dependencies.executor ?? defaultExecutor(config);
  }

  get providerLabel(): string {
    return this.#executor.provider;
  }

  prepare(raw: unknown): PreparedAuthorizationResponse {
    return prepareAuthorization(raw, this.#config.prepare, {
      store: this.#store,
      audit: this.#audit,
      ...(this.#planningRevisions ? {planningRevisions:this.#planningRevisions} : {}),
      ...(this.#authorityOnlyAdmissions ? {authorityOnlyAdmissions:this.#authorityOnlyAdmissions} : {})
    });
  }

  /** Planning: one signed VP for a bundle of 2-12 reads of the pinned commit. */
  async prepareReadComposite(raw:unknown){
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway reads unavailable in authority-only staging");
    return prepareReadCompositeAuthorization(raw,{
      store:this.#compositeStore,audit:this.#audit,verifier:this.#verifier,
      policy:this.#policy,config:this.#config.prepare,executor:this.#executor,
      ...(this.#planningRevisions?{planningRevisions:this.#planningRevisions}:{})
    });
  }

  async executeReadComposite(raw:unknown,signal?:AbortSignal){
    if(this.#authorityOnlyAdmissions)
      throw Error("Composite Gateway reads unavailable in authority-only staging");
    return executeReadCompositeAuthorization(raw,{
      store:this.#compositeStore,audit:this.#audit,verifier:this.#verifier,
      policy:this.#policy,config:this.#config.prepare,executor:this.#executor,
      ...(this.#planningRevisions?{planningRevisions:this.#planningRevisions}:{}),
      ...(signal?{signal}:{})
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
      ...(this.#authorityOnlyAdmissions ? {authorityOnlyAdmissions:this.#authorityOnlyAdmissions} : {}),
      ...(this.#authorityOnlyReadEnabled ? {
        authorityOnlyReadEnabled:true,
        authorityOnlyReceiptWriter:this.#authorityOnlyReceiptWriter
      } : {}),
      ...(this.#authorityOnlyMutationEnabled ? {
        authorityOnlyMutationEnabled:true,
        authorityOnlyMutationExecutor:this.#authorityOnlyMutationExecutor
      } : {}),
      ...(this.#authorityOnlyCreateEnabled ? {
        authorityOnlyCreateEnabled:true,
        authorityOnlyCreateExecutor:this.#authorityOnlyCreateExecutor
      } : {}),
      ...(this.#authorityOnlyRunnerEnabled ? {
        authorityOnlyRunnerEnabled:true,
        authorityOnlyRunnerExecutor:this.#authorityOnlyRunnerExecutor
      } : {}),
      ...(this.#authorityOnlyBranchEnabled?{authorityOnlyBranchEnabled:true,
       authorityOnlyBranchExecutor:this.#authorityOnlyBranchExecutor}:{}),
      ...(this.#authorityOnlyPullRequestEnabled?{
       authorityOnlyPullRequestEnabled:true,
       authorityOnlyPullRequestExecutor:this.#authorityOnlyPullRequestExecutor
      }:{}),
      ...(signal ? {signal} : {})
    });
  }
}
