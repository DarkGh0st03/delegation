import type { SpecializedAgentRole } from "./contracts.ts";
import { ControlledToolError } from "./controlled-errors.ts";
import {
  DelegationEvidenceHandler,
  type PreparedGatewayAuthorization
} from "./delegation-evidence-handler.ts";

type FetchLike = typeof fetch;

export const SPECIALIZED_TOOL_NAMES = [
  "read_file",
  "update_file",
  "create_file",
  "run_tests"
] as const;
export type SpecializedToolName = (typeof SPECIALIZED_TOOL_NAMES)[number];

export interface GatewayControlledToolClientConfig {
  gatewayBaseUrl: string;
  agentRole: SpecializedAgentRole;
  taskId: string;
  evidenceHandler: DelegationEvidenceHandler;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  signal?: AbortSignal;
}

function errorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ControlledToolError(
      "tool_unavailable",
      `${label} returned invalid JSON`,
      { statusCode: response.status }
    );
  }
}

export class GatewayControlledToolClient {
  readonly #gatewayBaseUrl: string;
  readonly #agentRole: SpecializedAgentRole;
  readonly #taskId: string;
  readonly #evidenceHandler: DelegationEvidenceHandler;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #signal?: AbortSignal;

  constructor(config: GatewayControlledToolClientConfig) {
    if (config.gatewayBaseUrl.trim().length === 0) {
      throw new Error("Gateway base URL cannot be empty");
    }
    if (config.taskId.trim().length === 0) {
      throw new Error("Gateway task id cannot be empty");
    }

    this.#gatewayBaseUrl = config.gatewayBaseUrl.replace(/\/+$/u, "");
    this.#agentRole = config.agentRole;
    this.#taskId = config.taskId;
    this.#evidenceHandler = config.evidenceHandler;
    this.#timeoutMs = config.timeoutMs ?? 10_000;
    this.#fetch = config.fetchFn ?? fetch;
    this.#signal = config.signal;
  }

  async invoke(
    tool: SpecializedToolName,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.#signal?.throwIfAborted();
    let prepareResponse: Response;
    try {
      prepareResponse = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/prepare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: this.#taskId,
            agent_role: this.#agentRole,
            tool,
            arguments: args
          }),
          signal: this.#signal
            ? AbortSignal.any([this.#signal, AbortSignal.timeout(this.#timeoutMs)])
            : AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new ControlledToolError(
        "tool_unavailable",
        `Gateway prepare is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const preparedBody = await parseJson(prepareResponse, "Gateway prepare");
    if (!prepareResponse.ok) {
      throw new ControlledToolError(
        prepareResponse.status >= 500 ? "tool_unavailable" : "invalid_tool_call",
        errorMessage(
          preparedBody,
          `Gateway prepare failed with HTTP ${prepareResponse.status}`
        ),
        {
          statusCode: prepareResponse.status
        }
      );
    }

    const prepared = preparedBody as PreparedGatewayAuthorization;
    if (
      typeof prepared.request_id !== "string" ||
      typeof prepared.audience !== "string" ||
      typeof prepared.challenge !== "string" ||
      typeof prepared.expires_at !== "string" ||
      typeof prepared.required_permission !== "object" ||
      prepared.required_permission === null
    ) {
      throw new ControlledToolError(
        "tool_unavailable",
        "Gateway prepare returned a malformed authorization challenge"
      );
    }

    this.#signal?.throwIfAborted();
    const signedVp = await this.#evidenceHandler.createPresentation(prepared);
    this.#signal?.throwIfAborted();

    let executeResponse: Response;
    try {
      executeResponse = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/execute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request_id: prepared.request_id,
            signed_vp: signedVp
          }),
          signal: this.#signal
            ? AbortSignal.any([this.#signal, AbortSignal.timeout(this.#timeoutMs)])
            : AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch (error) {
      throw new ControlledToolError(
        "tool_unavailable",
        `Gateway execute is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.#signal?.throwIfAborted();
    const executeBody = await parseJson(executeResponse, "Gateway execute");
    if (!executeResponse.ok) {
      throw new ControlledToolError(
        executeResponse.status >= 500 ? "tool_unavailable" : "authorization_denied",
        errorMessage(
          executeBody,
          `Gateway execute failed with HTTP ${executeResponse.status}`
        ),
        {
          statusCode: executeResponse.status
        }
      );
    }

    if (
      typeof executeBody !== "object" ||
      executeBody === null ||
      !("execution" in executeBody)
    ) {
      throw new ControlledToolError(
        "tool_unavailable",
        "Gateway execute response is missing execution result"
      );
    }

    const execution = (executeBody as { execution: unknown }).execution;
    if (
      tool === "run_tests" &&
      typeof execution === "object" &&
      execution !== null &&
      "status" in execution &&
      (execution as { status?: unknown }).status === "fail"
    ) {
      throw new ControlledToolError(
        "tests_failed",
        "Controlled Test Runner reported a failing test outcome",
        { details: execution }
      );
    }

    return execution;
  }
}
