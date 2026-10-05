import type { DelegationEvidence } from "./contracts.ts";
import { ControlledToolError } from "./controlled-errors.ts";

type FetchLike = typeof fetch;

export interface PreparedGatewayAuthorization {
  request_id: string;
  audience: string;
  challenge: string;
  required_permission: {
    resource: string;
    operation: string;
  };
  expires_at: string;
}

export interface DelegationEvidenceHandlerConfig {
  adapterBaseUrl: string;
  adapterToken: string;
  evidence: DelegationEvidence;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

export class DelegationEvidenceHandler {
  readonly #adapterBaseUrl: string;
  readonly #adapterToken: string;
  readonly #evidence: DelegationEvidence;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: DelegationEvidenceHandlerConfig) {
    if (config.adapterBaseUrl.trim().length === 0) {
      throw new Error("Delegation Adapter base URL cannot be empty");
    }
    if (config.adapterToken.trim().length === 0) {
      throw new Error("Delegation Adapter token cannot be empty");
    }
    if (config.evidence.credential_id.trim().length === 0) {
      throw new Error("Delegation credential id cannot be empty");
    }

    this.#adapterBaseUrl = config.adapterBaseUrl.replace(/\/+$/u, "");
    this.#adapterToken = config.adapterToken;
    this.#evidence = structuredClone(config.evidence);
    this.#timeoutMs = config.timeoutMs ?? 5_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  get credentialId(): string {
    return this.#evidence.credential_id;
  }

  get presenterId(): string {
    return this.#evidence.presenter_id;
  }

  async createPresentation(
    prepared: PreparedGatewayAuthorization
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#adapterBaseUrl}/v1/presentations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#adapterToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          credential_id: this.#evidence.credential_id,
          disclosed_permissions: [prepared.required_permission],
          audience: prepared.audience,
          challenge: prepared.challenge
        }),
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ControlledToolError(
        "tool_unavailable",
        `Delegation Adapter is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    let body: unknown = {};
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ControlledToolError(
          "tool_unavailable",
          "Delegation Adapter returned invalid JSON"
        );
      }
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Delegation Adapter rejected presentation with HTTP ${response.status}`;

      throw new ControlledToolError(
        response.status >= 500 ? "tool_unavailable" : "authorization_denied",
        message,
        { statusCode: response.status }
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("signed_vp" in body) ||
      typeof (body as { signed_vp?: unknown }).signed_vp !== "string" ||
      (body as { signed_vp: string }).signed_vp.trim().length === 0
    ) {
      throw new ControlledToolError(
        "tool_unavailable",
        "Delegation Adapter response is missing signed_vp"
      );
    }

    return (body as { signed_vp: string }).signed_vp;
  }
}
