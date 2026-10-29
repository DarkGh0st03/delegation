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

export interface RunnerProjectTestsResult {
  status: "pass" | "fail";
  phases: RunnerPhaseResult[];
}

export interface RunnerResearcherAcceptanceResult extends RunnerPhaseResult {
  phase: "researcher_acceptance";
}

import type {TypecheckLocation} from "./typecheck-diagnostics.ts";
export interface RunnerRunResult {
  request_id: string;
  repository: string;
  branch: string;
  tested_commit_sha: string;
  runner_profile: RunnerProfile;
  status: "pass" | "fail";
  phases: RunnerPhaseResult[];
  project_tests?: RunnerProjectTestsResult;
  researcher_acceptance?: RunnerResearcherAcceptanceResult;
  log_reference?: string;
  /** Trusted metadata only; agents must filter by approved read paths. */
  typecheck_diagnostics?: TypecheckLocation[];
  /** Vitest FAIL paths only; no assertion text. Filter through signed read grants. */
  failing_test_files?: string[];
}

export interface RunnerExecutor {
  run(request: RunnerRunRequest, signal?: AbortSignal): Promise<RunnerRunResult>;
}

export interface RunnerContractConfig {
  repository: string;
  branch: string;
}
