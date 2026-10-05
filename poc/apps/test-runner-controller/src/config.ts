import type { RunnerContractConfig } from "./types.ts";
import type { IsolatedRunnerConfig } from "./isolated-executor.ts";

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
        "feature/account-suspension"
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
      log_dir:
        process.env.TEST_RUNNER_LOG_DIR ?? "/tmp/delegation-runner-logs"
    }
  };
}
