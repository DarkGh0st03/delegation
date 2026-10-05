import {
  VerificationRejectedError,
  VerificationUnavailableError
} from "./errors.ts";
import type {
  Permission,
  VerificationRequest,
  VerifiedDelegation,
  VerifierPort
} from "./types.ts";

type FetchLike = typeof fetch;

export interface AdapterVerifierClientConfig {
  baseUrl: string;
  gatewayToken: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

function permission(value: unknown): Permission {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Verified permission is not an object");
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.resource !== "string" || typeof entry.operation !== "string") {
    throw new Error("Verified permission is malformed");
  }
  return {
    resource: entry.resource,
    operation: entry.operation as Permission["operation"]
  };
}

function verifiedDelegation(value: unknown): VerifiedDelegation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Delegation Adapter returned a non-object response");
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.presenter_id !== "string" ||
    typeof body.credential_id !== "string" ||
    typeof body.issuer_id !== "string" ||
    !Array.isArray(body.permissions) ||
    typeof body.hierarchy_depth !== "number" ||
    !Number.isSafeInteger(body.hierarchy_depth) ||
    body.hierarchy_depth < 0 ||
    !(
      typeof body.expiration === "string" ||
      typeof body.expiration === "number"
    )
  ) {
    throw new Error("Delegation Adapter returned malformed VerifiedDelegation");
  }

  return {
    presenter_id: body.presenter_id,
    credential_id: body.credential_id,
    issuer_id: body.issuer_id,
    permissions: body.permissions.map(permission),
    hierarchy_depth: body.hierarchy_depth,
    expiration: body.expiration
  };
}

export class AdapterVerifierClient implements VerifierPort {
  readonly #baseUrl: string;
  readonly #gatewayToken: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: AdapterVerifierClientConfig) {
    if (config.baseUrl.trim().length === 0) {
      throw new Error("Delegation Adapter base URL cannot be empty");
    }
    if (config.gatewayToken.trim().length === 0) {
      throw new Error("Gateway Adapter credential cannot be empty");
    }
    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#gatewayToken = config.gatewayToken;
    this.#timeoutMs = config.timeoutMs ?? 5_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  async verify(request: VerificationRequest): Promise<VerifiedDelegation> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/verify`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#gatewayToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new VerificationUnavailableError(
        `Delegation Adapter is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    let body: unknown;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      throw new VerificationUnavailableError(
        "Delegation Adapter returned invalid JSON"
      );
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Delegation Adapter rejected verification with HTTP ${response.status}`;

      if (response.status >= 500) {
        throw new VerificationUnavailableError(message);
      }
      throw new VerificationRejectedError(message);
    }

    try {
      return verifiedDelegation(body);
    } catch (error) {
      throw new VerificationUnavailableError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
