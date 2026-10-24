/**
 * Historical Phase 9B Account Suspension Gateway branch/PR writer ONLY.
 * This module is not exported by the canonical signed Planning/DAG API.
 */
import {
  OrchestratorGatewayTransport,OrchestratorGatewayClientError,nonEmptyString
} from "./orchestrator-gateway-transport.ts";
import type {OrchestratorGatewayTransportConfig}
  from "./orchestrator-gateway-transport.ts";
export type {OrchestratorGatewayTransportConfig as OrchestratorProtectedGatewayClientConfig}
  from "./orchestrator-gateway-transport.ts";

const FEATURE_BRANCH = "feature/account-suspension" as const;
const MAIN_BRANCH = "main" as const;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;


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


function commitSha(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label);
  if (!SHA_PATTERN.test(parsed)) {
    throw new OrchestratorGatewayClientError(
      `${label} must be a lowercase 40-character Git SHA`
    );
  }
  return parsed;
}


export class OrchestratorProtectedGatewayClient {
  readonly #transport:OrchestratorGatewayTransport;
  constructor(config:OrchestratorGatewayTransportConfig){
    this.#transport=new OrchestratorGatewayTransport(config);
  }

  async createFeatureBranch(
    taskId: string
  ): Promise<OrchestratorCreateBranchResult> {
    const execution = await this.#transport.invoke(
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
    const execution = await this.#transport.invoke(
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
