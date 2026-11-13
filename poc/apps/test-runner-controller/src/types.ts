export const RUNNER_PROFILE = "poc-default" as const;
export type RunnerProfile = typeof RUNNER_PROFILE;

/** Engineer-approved project profile (see plan-contracts/project-profile.mjs). */
export interface RunnerProjectProfile {
  readonly version: 1;
  readonly image: string;
  readonly phases: readonly {readonly name: string; readonly command: string;
    readonly failure_report?: "vitest"}[];
  readonly test_sources: {readonly roots: readonly string[]; readonly suffixes: readonly string[]};
}

export interface RunnerRunRequest {
  request_id: string;
  repository: string;
  branch: string;
  commit_sha: string;
  profile: RunnerProfile;
  /** Image and ordered test phases to run, fixed by the Engineer's profile. */
  project_profile: RunnerProjectProfile;
  /** SHA-256 of the canonical profile, as signed by the Engineer. */
  project_profile_sha256: string;
}

/** A phase name of the project profile, or the historical researcher suite. */
export type RunnerPhaseName = string;

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
  /** Digest of the profile whose phases were run (echo of the request). */
  project_profile_sha256: string;
  status: "pass" | "fail";
  phases: RunnerPhaseResult[];
  project_tests?: RunnerProjectTestsResult;
  researcher_acceptance?: RunnerResearcherAcceptanceResult;
  log_reference?: string;
  /** Fixed researcher check IDs only; diagnostic, never repair authorization. */
  acceptance_failure?: Readonly<{
    failed_checks: readonly string[];
    timed_out: boolean;
    unclassified_failure: boolean;
  }>;
  /** Trusted metadata only; agents must filter by approved read paths. */
  typecheck_diagnostics?: TypecheckLocation[];
  /** Fileless, source-free compiler error codes for diagnostics only. */
  typecheck_error_codes?: string[];
  /** Compiler errors with their cleaned message (untrusted data). */
  typecheck_errors?: import("./typecheck-diagnostics.ts").TypecheckError[];
  /** Vitest FAIL paths only; no assertion text. Filter through signed read grants. */
  failing_test_files?: string[];
  /** Failed tests of those files with their cleaned error message (untrusted data). */
  test_failures?: import("./test-failure-messages.ts").TestFailureMessage[];
  project_e2e_failure?: NonNullable<ReturnType<typeof import("../scripts/project-e2e-failure-diagnostic.mjs").safeProjectE2eFailureDiagnostic>>;
}

export interface RunnerExecutor {
  run(request: RunnerRunRequest, signal?: AbortSignal): Promise<RunnerRunResult>;
}

export interface RunnerContractConfig {
  repository: string;
  branch: string;
  /** Optional: accept any safe branch under this prefix instead of the
   * single fixed branch (one Runner serving per-session work branches).
   * The Gateway still binds every run_tests to the exact signed branch. */
  branch_prefix?: string;
  /** Optional: accept every repository of one Gitea organization, e.g.
   * "gitea://gitea.local/thesis/" (the Runner token is read-only). */
  repository_prefix?: string;
}
