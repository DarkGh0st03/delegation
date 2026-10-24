/**
 * Internal shared Gateway prepare -> signed VP -> execute transport.
 * Never handed to ADK and never re-exported by the canonical runtime index.
 * Source encapsulation does not replace native Rust DC/VP and OPA policy.
 */
type FetchLike = typeof fetch;


interface RequiredPermission {
  resource: string;
  operation: string;
}

interface PreparedAuthorization {
  request_id: string;
  audience: string;
  challenge: string;
  required_permission: RequiredPermission;
}

export interface OrchestratorGatewayTransportConfig {
  gatewayBaseUrl: string;
  adapterBaseUrl: string;
  adapterToken: string;
  rootCredentialId: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}


export class OrchestratorGatewayClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OrchestratorGatewayClientError";
    this.statusCode = statusCode;
  }
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrchestratorGatewayClientError(
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    if (
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
    ) {
      return (body as { message: string }).message;
    }
    if (
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  }
  return fallback;
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new OrchestratorGatewayClientError(
      `${label} returned invalid JSON`,
      response.status
    );
  }
}


export class OrchestratorGatewayTransport {
  readonly #gatewayBaseUrl: string;
  readonly #adapterBaseUrl: string;
  readonly #adapterToken: string;
  readonly #rootCredentialId: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: OrchestratorGatewayTransportConfig) {
    this.#gatewayBaseUrl = nonEmptyString(
      config.gatewayBaseUrl,
      "Gateway base URL"
    ).replace(/\/+$/u, "");
    this.#adapterBaseUrl = nonEmptyString(
      config.adapterBaseUrl,
      "Delegation Adapter base URL"
    ).replace(/\/+$/u, "");
    this.#adapterToken = nonEmptyString(
      config.adapterToken,
      "Orchestrator Adapter token"
    );
    this.#rootCredentialId = nonEmptyString(
      config.rootCredentialId,
      "Orchestrator root credential id"
    );
    this.#timeoutMs = config.timeoutMs ?? 10_000;
    this.#fetch = config.fetchFn ?? fetch;
  }


  async invoke(
    taskId: string,
    tool: "create_branch" | "create_pull_request" |
      "read_repository"|"list_directory"|"read_file",
    args: Record<string, unknown>,
    expectedPermission?:RequiredPermission
  ): Promise<unknown> {
    const prepared = await this.#prepare(taskId, tool, args);
    // Fail before the Adapter can sign an unexpected permission. The trusted
    // Planning caller derives expectedPermission from its pinned snapshot.
    if(expectedPermission && (prepared.required_permission.operation !==
         expectedPermission.operation ||
       prepared.required_permission.resource!==expectedPermission.resource)){
      throw new OrchestratorGatewayClientError(
        "Gateway Planning challenge does not match trusted resource"
      );
    }
    const signedVp = await this.#createPresentation(prepared);
    return this.#execute(prepared.request_id, signedVp);
  }

  async #prepare(
    taskId: string,
    tool: "create_branch" | "create_pull_request" |
      "read_repository"|"list_directory"|"read_file",
    args: Record<string, unknown>
  ): Promise<PreparedAuthorization> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/prepare`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            task_id: taskId,
            agent_role: "orchestrator",
            tool,
            arguments: args
          }),
          signal: AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Gateway prepare is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const body = await parseJson(response, "Gateway prepare");
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Gateway prepare failed with HTTP ${response.status}`
        ),
        response.status
      );
    }

    if (typeof body !== "object" || body === null) {
      throw new OrchestratorGatewayClientError(
        "Gateway prepare returned a malformed authorization challenge"
      );
    }
    const raw = body as Record<string, unknown>;
    if (
      typeof raw.required_permission !== "object" ||
      raw.required_permission === null
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway prepare response is missing required_permission"
      );
    }
    const required = raw.required_permission as Record<string, unknown>;

    return {
      request_id: nonEmptyString(raw.request_id, "request_id"),
      audience: nonEmptyString(raw.audience, "audience"),
      challenge: nonEmptyString(raw.challenge, "challenge"),
      required_permission: {
        resource: nonEmptyString(
          required.resource,
          "required_permission.resource"
        ),
        operation: nonEmptyString(
          required.operation,
          "required_permission.operation"
        )
      }
    };
  }

  async #createPresentation(
    prepared: PreparedAuthorization
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#adapterBaseUrl}/v1/presentations`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#adapterToken}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            credential_id: this.#rootCredentialId,
            disclosed_permissions: [prepared.required_permission],
            audience: prepared.audience,
            challenge: prepared.challenge
          }),
          signal: AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Delegation Adapter presentation is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const body = await parseJson(
      response,
      "Delegation Adapter presentation"
    );
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Delegation Adapter rejected presentation with HTTP ${response.status}`
        ),
        response.status
      );
    }
    if (typeof body !== "object" || body === null) {
      throw new OrchestratorGatewayClientError(
        "Delegation Adapter returned a malformed presentation response"
      );
    }

    return nonEmptyString(
      (body as Record<string, unknown>).signed_vp,
      "signed_vp"
    );
  }

  async #execute(requestId: string, signedVp: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/execute`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            request_id: requestId,
            signed_vp: signedVp
          }),
          signal: AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Gateway execute is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const body = await parseJson(response, "Gateway execute");
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Gateway execute failed with HTTP ${response.status}`
        ),
        response.status
      );
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("execution" in body)
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway execute response is missing execution result"
      );
    }
    return (body as { execution: unknown }).execution;
  }


}
