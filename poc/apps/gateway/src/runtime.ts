import { AdapterVerifierClient } from "./adapter-client.ts";
import type { GatewayRuntimeConfig } from "./config.ts";
import { executeAuthorization } from "./execute.ts";
import { MockExecutor } from "./mock-executor.ts";
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
  executor?: ExecutionPort;
}

export class GatewayRuntime {
  readonly #config: GatewayRuntimeConfig;
  readonly #store: InMemoryRequestStore;
  readonly #audit: AuditSink;
  readonly #verifier: VerifierPort;
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
    this.#executor = dependencies.executor ?? new MockExecutor();
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
      executor: this.#executor
    });
  }
}
