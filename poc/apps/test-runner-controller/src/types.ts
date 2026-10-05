export const RUNNER_PROFILE = "poc-default" as const;
export type RunnerProfile = typeof RUNNER_PROFILE;

export interface RunnerRunRequest {
  request_id: string;
  repository: string;
  branch: string;
  commit_sha: string;
  profile: RunnerProfile;
}

export type RunnerPhaseName =
  | "dependency_install"
  | "typecheck"
  | "backend_tests"
  | "frontend_tests"
  | "build"
  | "playwright_e2e"
  | "researcher_acceptance";

export interface RunnerPhaseResult {
  phase: RunnerPhaseName;
  status: "pass" | "fail" | "skipped";
  passed?: number;
  failed?: number;
  errors?: string[];
}

export interface RunnerRunResult {
  request_id: string;
  repository: string;
  branch: string;
  tested_commit_sha: string;
  runner_profile: RunnerProfile;
  status: "pass" | "fail";
  phases: RunnerPhaseResult[];
  log_reference?: string;
}

export interface RunnerExecutor {
  run(request: RunnerRunRequest): Promise<RunnerRunResult>;
}

export interface RunnerContractConfig {
  repository: string;
  branch: string;
}
