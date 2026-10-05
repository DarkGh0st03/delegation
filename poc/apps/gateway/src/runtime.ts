import { AdapterVerifierClient } from "./adapter-client.ts";
import type { GatewayRuntimeConfig } from "./config.ts";
import { executeAuthorization } from "./execute.ts";
import { GiteaClient } from "./gitea-client.ts";
import { GiteaExecutor } from "./gitea-executor.ts";
import { GiteaReadOnlyExecutor } from "./gitea-read-executor.ts";
import { MockExecutor } from "./mock-executor.ts";
import { OpaPolicyClient } from "./policy-client.ts";
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

  return config.provider_mode === "gitea-readonly"
    ? new GiteaReadOnlyExecutor(client)
    : new GiteaExecutor(client);
}

export class GatewayRuntime {
  readonly #config: GatewayRuntimeConfig;
  readonly #store: InMemoryRequestStore;
  readonly #audit: AuditSink;
  readonly #verifier: VerifierPort;
  readonly #policy: PolicyPort;
  readonly #executor: ExecutionPort;

  constructor(config: GatewayRuntimeConfig, dependencies: GatewayRuntimeDependencies = {}) {
    this.#config = config;
    this.#store = dependencies.store ?? new InMemoryRequestStore();
    this.#audit = dependencies.audit ?? new JsonLineAuditSink();
    this.#verifier =
      dependencies.verifier ??
      new AdapterVerifierClient({
        baseUrl: config.adapter_url,
        gatewayToken: config.adapter_gateway_token
      });
    this.#policy =
      dependencies.policy ??
      new OpaPolicyClient({
        baseUrl: config.opa_url,
        timeoutMs: config.opa_timeout_ms
      });
    this.#executor = dependencies.executor ?? defaultExecutor(config);
  }

  get providerLabel(): "mock" | "gitea" {
    return this.#executor.provider;
  }

  prepare(raw: unknown): PreparedAuthorizationResponse {
    return prepareAuthorization(raw, this.#config.prepare, {
      store: this.#store,
      audit: this.#audit
    });
  }

  async execute(raw: unknown): Promise<ExecuteAuthorizationResponse> {
    return executeAuthorization(raw, {
      store: this.#store,
      audit: this.#audit,
      verifier: this.#verifier,
      policy: this.#policy,
      repository: this.#config.prepare.repository,
      executor: this.#executor
    });
  }
}
