import { fileURLToPath } from "node:url";
import type { RunnerContractConfig } from "./types.ts";
import { MAX_RUN_TOTAL_MS, type IsolatedRunnerConfig } from "./isolated-executor.ts";

export interface RunnerServiceConfig {
  bind_host: string;
  bind_port: number;
  gateway_token: string;
  contract: RunnerContractConfig;
  execution?: IsolatedRunnerConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function bindAddress(value: string): { host: string; port: number } {
  const match = /^(.*):(\d+)$/u.exec(value);
  if (!match || match[1].trim().length === 0) {
    throw new Error("TEST_RUNNER_BIND_ADDR must use host:port form");
  }
  return {
    host: match[1],
    port: positiveInteger(match[2], "Test Runner port")
  };
}

function branchPrefix(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,30}\/$/u.test(value)) {
    throw new Error("TEST_RUNNER_BRANCH_PREFIX must look like 'feature/'");
  }
  return value;
}

export function runnerConfigFromEnv(): RunnerServiceConfig {
  const bind = bindAddress(process.env.TEST_RUNNER_BIND_ADDR ?? "0.0.0.0:8095");
  return {
    bind_host: bind.host,
    bind_port: bind.port,
    gateway_token: required("TEST_RUNNER_GATEWAY_TOKEN"),
    contract: {
      repository:
        process.env.TEST_RUNNER_REPOSITORY_URI ??
        "gitea://gitea.local/thesis/iam-console-poc",
      branch:
        process.env.TEST_RUNNER_BRANCH ??
        "feature/account-suspension",
      ...(process.env.TEST_RUNNER_BRANCH_PREFIX
        ? {branch_prefix: branchPrefix(process.env.TEST_RUNNER_BRANCH_PREFIX)} : {})
    },
    execution: {
      gitea_base_url: required("GITEA_RUNNER_BASE_URL").replace(/\/$/u, ""),
      gitea_owner: process.env.GITEA_OWNER ?? "thesis",
      gitea_repository: process.env.GITEA_REPOSITORY ?? "iam-console-poc",
      gitea_token: required("GITEA_RUNNER_TOKEN"),
      docker_image:
        process.env.TEST_RUNNER_DOCKER_IMAGE ?? "node:22.15.0-bookworm",
      phase_timeout_ms: positiveInteger(
        process.env.TEST_RUNNER_PHASE_TIMEOUT_MS ?? "600000",
        "Runner phase timeout"
      ),
      total_timeout_ms: positiveInteger(
        process.env.TEST_RUNNER_TOTAL_TIMEOUT_MS ?? String(MAX_RUN_TOTAL_MS),
        "Runner total timeout"
      ),
      failure_evidence_dir: process.env.TEST_RUNNER_FAILURE_EVIDENCE_DIR || undefined,
      log_dir:
        process.env.TEST_RUNNER_LOG_DIR ?? "/tmp/delegation-runner-logs",
      acceptance_enabled:
        (process.env.TEST_RUNNER_ACCEPTANCE_ENABLED ?? "true").toLowerCase() !== "false",
      ...(process.env.TEST_RUNNER_ACCEPTANCE_VOLUME
        ? {acceptance_volume: process.env.TEST_RUNNER_ACCEPTANCE_VOLUME} : {}),
      acceptance_dir:
        process.env.TEST_RUNNER_ACCEPTANCE_DIR ??
        fileURLToPath(new URL("../../../runner/acceptance/", import.meta.url))
    }
  };
}
