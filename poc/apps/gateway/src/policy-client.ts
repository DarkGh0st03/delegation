import { PolicyUnavailableError } from "./errors.ts";
import type { PolicyDecision, PolicyInput, PolicyPort } from "./types.ts";

type FetchLike = typeof fetch;

export interface OpaPolicyClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

function parseDecision(value: unknown): PolicyDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("OPA result is not an object");
  }
  const result = value as Record<string, unknown>;
  if (typeof result.allow !== "boolean") {
    throw new Error("OPA decision is missing boolean allow");
  }
  if (typeof result.policy_version !== "string" || result.policy_version.trim().length === 0) {
    throw new Error("OPA decision is missing policy_version");
  }
  return {
    allow: result.allow,
    policy_version: result.policy_version
  };
}

export class OpaPolicyClient implements PolicyPort {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: OpaPolicyClientConfig) {
    if (config.baseUrl.trim().length === 0) {
      throw new Error("OPA base URL cannot be empty");
    }
    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#timeoutMs = config.timeoutMs ?? 2_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/v1/data/thesis/gateway/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input }),
          signal: AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new PolicyUnavailableError(
        `OPA is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new PolicyUnavailableError(
        `OPA returned HTTP ${response.status}${raw ? `: ${raw}` : ""}`
      );
    }

    let body: unknown;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      throw new PolicyUnavailableError("OPA returned invalid JSON");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body) || !("result" in body)) {
      throw new PolicyUnavailableError("OPA response is missing result");
    }

    try {
      return parseDecision((body as { result: unknown }).result);
    } catch (error) {
      throw new PolicyUnavailableError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
