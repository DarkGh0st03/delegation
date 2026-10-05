type FetchLike = typeof fetch;

const FEATURE_BRANCH = "feature/account-suspension" as const;
const MAIN_BRANCH = "main" as const;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

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

export interface OrchestratorProtectedGatewayClientConfig {
  gatewayBaseUrl: string;
  adapterBaseUrl: string;
  adapterToken: string;
  rootCredentialId: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

export interface OrchestratorCreateBranchResult {
  provider: "gitea";
  performed: true;
  tool: "create_branch";
  branch: typeof FEATURE_BRANCH;
  base_branch: typeof MAIN_BRANCH;
  revision: string;
  commit_sha: string;
}

export interface OrchestratorCreatePullRequestResult {
  provider: "gitea";
  performed: true;
  tool: "create_pull_request";
  pull_request_id: number;
  pull_request_number: number;
  url?: string;
  head_branch: typeof FEATURE_BRANCH;
  base_branch: typeof MAIN_BRANCH;
  revision: string;
}

export class OrchestratorGatewayClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OrchestratorGatewayClientError";
    this.statusCode = statusCode;
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrchestratorGatewayClientError(
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function commitSha(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label);
  if (!SHA_PATTERN.test(parsed)) {
    throw new OrchestratorGatewayClientError(
      `${label} must be a lowercase 40-character Git SHA`
    );
  }
  return parsed;
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

export class OrchestratorProtectedGatewayClient {
  readonly #gatewayBaseUrl: string;
  readonly #adapterBaseUrl: string;
  readonly #adapterToken: string;
  readonly #rootCredentialId: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: OrchestratorProtectedGatewayClientConfig) {
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

  async createFeatureBranch(
    taskId: string
  ): Promise<OrchestratorCreateBranchResult> {
    const execution = await this.#invoke(
      nonEmptyString(taskId, "Task id"),
      "create_branch",
      {
        base_branch: MAIN_BRANCH,
        branch: FEATURE_BRANCH
      }
    );
    return this.#parseCreateBranch(execution);
  }

  async createAccountSuspensionPullRequest(
    taskId: string
  ): Promise<OrchestratorCreatePullRequestResult> {
    const execution = await this.#invoke(
      nonEmptyString(taskId, "Task id"),
      "create_pull_request",
      {
        head_branch: FEATURE_BRANCH,
        base_branch: MAIN_BRANCH,
        title: "Account Suspension Feature",
        body:
          "PoC changes produced under delegated authorization. Final merge requires Software Engineer review."
      }
    );
    return this.#parseCreatePullRequest(execution);
  }

  async #invoke(
    taskId: string,
    tool: "create_branch" | "create_pull_request",
    args: Record<string, unknown>
  ): Promise<unknown> {
    const prepared = await this.#prepare(taskId, tool, args);
    const signedVp = await this.#createPresentation(prepared);
    return this.#execute(prepared.request_id, signedVp);
  }

  async #prepare(
    taskId: string,
    tool: "create_branch" | "create_pull_request",
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

  #parseCreateBranch(value: unknown): OrchestratorCreateBranchResult {
    if (typeof value !== "object" || value === null) {
      throw new OrchestratorGatewayClientError(
        "Gateway returned malformed create_branch execution"
      );
    }
    const raw = value as Record<string, unknown>;
    if (
      raw.provider !== "gitea" ||
      raw.performed !== true ||
      raw.tool !== "create_branch" ||
      raw.branch !== FEATURE_BRANCH ||
      raw.base_branch !== MAIN_BRANCH
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway create_branch result violates the frozen workflow contract"
      );
    }
    const revision = commitSha(raw.revision, "create_branch revision");
    const commit = commitSha(raw.commit_sha, "create_branch commit_sha");
    if (revision !== commit) {
      throw new OrchestratorGatewayClientError(
        "create_branch revision and commit_sha must match"
      );
    }

    return {
      provider: "gitea",
      performed: true,
      tool: "create_branch",
      branch: FEATURE_BRANCH,
      base_branch: MAIN_BRANCH,
      revision,
      commit_sha: commit
    };
  }

  #parseCreatePullRequest(
    value: unknown
  ): OrchestratorCreatePullRequestResult {
    if (typeof value !== "object" || value === null) {
      throw new OrchestratorGatewayClientError(
        "Gateway returned malformed create_pull_request execution"
      );
    }
    const raw = value as Record<string, unknown>;
    if (
      raw.provider !== "gitea" ||
      raw.performed !== true ||
      raw.tool !== "create_pull_request" ||
      raw.head_branch !== FEATURE_BRANCH ||
      raw.base_branch !== MAIN_BRANCH
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway create_pull_request result violates the frozen workflow contract"
      );
    }
    if (
      !Number.isSafeInteger(raw.pull_request_id) ||
      (raw.pull_request_id as number) <= 0 ||
      !Number.isSafeInteger(raw.pull_request_number) ||
      (raw.pull_request_number as number) <= 0
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway create_pull_request result is missing valid PR identifiers"
      );
    }

    const result: OrchestratorCreatePullRequestResult = {
      provider: "gitea",
      performed: true,
      tool: "create_pull_request",
      pull_request_id: raw.pull_request_id as number,
      pull_request_number: raw.pull_request_number as number,
      head_branch: FEATURE_BRANCH,
      base_branch: MAIN_BRANCH,
      revision: commitSha(
        raw.revision,
        "create_pull_request revision"
      )
    };
    if (typeof raw.url === "string" && raw.url.trim().length > 0) {
      result.url = raw.url;
    }
    return result;
  }
}
