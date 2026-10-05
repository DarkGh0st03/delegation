import { ProviderUnavailableError } from "./errors.ts";
import type { RunnerPhaseExecutionResult } from "./types.ts";

type FetchLike = typeof fetch;
type JsonObject = Record<string, unknown>;

export interface RunnerClientConfig {
  baseUrl: string;
  gatewayToken: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

export interface RunnerClientRequest {
  request_id: string;
  repository: string;
  branch: string;
  commit_sha: string;
  profile: "poc-default";
}

export interface RunnerClientResult {
  request_id: string;
  repository: string;
  branch: string;
  tested_commit_sha: string;
  runner_profile: "poc-default";
  status: "pass" | "fail";
  phases: RunnerPhaseExecutionResult[];
  log_reference?: string;
}

const PHASES = new Set([
  "dependency_install",
  "typecheck",
  "backend_tests",
  "frontend_tests",
  "build",
  "playwright_e2e",
  "researcher_acceptance"
]);

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderUnavailableError(`${label} is not an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderUnavailableError(`Runner response is missing ${label}`);
  }
  return value;
}

function parsePhases(value: unknown): RunnerPhaseExecutionResult[] {
  if (!Array.isArray(value)) {
    throw new ProviderUnavailableError("Runner response is missing phases");
  }
  return value.map((raw, index) => {
    const phase = object(raw, `Runner phase ${index}`);
    const name = string(phase.phase, `phases[${index}].phase`);
    const status = string(phase.status, `phases[${index}].status`);
    if (!PHASES.has(name)) {
      throw new ProviderUnavailableError(`Runner returned unknown phase ${name}`);
    }
    if (!["pass", "fail", "skipped"].includes(status)) {
      throw new ProviderUnavailableError(`Runner returned invalid phase status ${status}`);
    }
    return {
      phase: name as RunnerPhaseExecutionResult["phase"],
      status: status as RunnerPhaseExecutionResult["status"],
      ...(typeof phase.passed === "number" ? { passed: phase.passed } : {}),
      ...(typeof phase.failed === "number" ? { failed: phase.failed } : {}),
      ...(Array.isArray(phase.errors) &&
      phase.errors.every((entry) => typeof entry === "string")
        ? { errors: phase.errors as string[] }
        : {})
    };
  });
}

export class RunnerClient {
  readonly #baseUrl: string;
  readonly #gatewayToken: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: RunnerClientConfig) {
    if (config.baseUrl.trim().length === 0) {
      throw new Error("Runner base URL cannot be empty");
    }
    if (config.gatewayToken.trim().length === 0) {
      throw new Error("Runner Gateway token cannot be empty");
    }
    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#gatewayToken = config.gatewayToken;
    this.#timeoutMs = config.timeoutMs ?? 900_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  async run(request: RunnerClientRequest): Promise<RunnerClientResult> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#gatewayToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ProviderUnavailableError(
        `Controlled Test Runner request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `Controlled Test Runner returned HTTP ${response.status}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderUnavailableError("Controlled Test Runner returned invalid JSON");
    }
    const body = object(parsed, "Runner response");

    const status = string(body.status, "status");
    if (status !== "pass" && status !== "fail") {
      throw new ProviderUnavailableError(`Runner returned invalid status ${status}`);
    }
    const profile = string(body.runner_profile, "runner_profile");
    if (profile !== "poc-default") {
      throw new ProviderUnavailableError("Runner returned an unexpected profile");
    }

    const result: RunnerClientResult = {
      request_id: string(body.request_id, "request_id"),
      repository: string(body.repository, "repository"),
      branch: string(body.branch, "branch"),
      tested_commit_sha: string(body.tested_commit_sha, "tested_commit_sha"),
      runner_profile: "poc-default",
      status,
      phases: parsePhases(body.phases),
      ...(typeof body.log_reference === "string" && body.log_reference.length > 0
        ? { log_reference: body.log_reference }
        : {})
    };

    if (
      result.request_id !== request.request_id ||
      result.repository !== request.repository ||
      result.branch !== request.branch ||
      result.tested_commit_sha !== request.commit_sha
    ) {
      throw new ProviderUnavailableError(
        "Controlled Test Runner response does not match the authorized request"
      );
    }

    return result;
  }
}
