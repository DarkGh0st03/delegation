import type {
  AgentArtifactPayload,
  SpecializedAgentRole
} from "@thesis/agent-runtime";

export const ACCOUNT_SUSPENSION_ARTIFACT_BRANCH =
  "feature/account-suspension" as const;

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VALID_ROLES = new Set<SpecializedAgentRole>([
  "backend",
  "frontend",
  "test"
]);
const VALID_TEST_OUTCOMES = new Set(["not_run", "pass", "fail"]);

export interface WorkflowArtifactValidationOptions {
  requireTestPass?: boolean;
}

export interface ValidatedWorkflowArtifact extends AgentArtifactPayload {
  revision: string;
  commit_sha: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    )
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value] as string[];
}

function commitSha(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label);
  if (!SHA_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA`);
  }
  return parsed;
}

export function validateWorkflowArtifact(
  value: unknown,
  expectedRole: SpecializedAgentRole,
  options: WorkflowArtifactValidationOptions = {}
): ValidatedWorkflowArtifact {
  const raw = object(value, "Agent Artifact payload");
  const role = nonEmptyString(raw.role, "Artifact role");
  if (!VALID_ROLES.has(role as SpecializedAgentRole)) {
    throw new Error(`Artifact contains unsupported role ${role}`);
  }
  if (role !== expectedRole) {
    throw new Error(
      `Artifact role ${role} does not match expected role ${expectedRole}`
    );
  }

  if (raw.branch !== ACCOUNT_SUSPENSION_ARTIFACT_BRANCH) {
    throw new Error(
      `Artifact branch must be ${ACCOUNT_SUSPENSION_ARTIFACT_BRANCH}`
    );
  }

  const revision = commitSha(raw.revision, "Artifact revision");
  const commitShaValue = commitSha(raw.commit_sha, "Artifact commit_sha");
  if (revision !== commitShaValue) {
    throw new Error(
      "Artifact revision and commit_sha must identify the same branch head"
    );
  }

  const testOutcome = nonEmptyString(
    raw.test_outcome,
    "Artifact test_outcome"
  );
  if (!VALID_TEST_OUTCOMES.has(testOutcome)) {
    throw new Error(`Artifact has invalid test_outcome ${testOutcome}`);
  }

  const requireTestPass = options.requireTestPass ?? false;
  if (requireTestPass && testOutcome !== "pass") {
    throw new Error(
      "Test Agent Artifact is not acceptable until test_outcome is pass"
    );
  }
  if (expectedRole !== "test" && testOutcome !== "not_run") {
    throw new Error(
      "Backend and Frontend Artifacts must not claim a test execution outcome"
    );
  }

  const runnerFields = [
    raw.tested_commit_sha,
    raw.runner_profile,
    raw.project_tests,
    raw.researcher_acceptance
  ];
  if (
    expectedRole !== "test" &&
    runnerFields.some((value) => value !== undefined)
  ) {
    throw new Error(
      "Backend and Frontend Artifacts must not contain Runner verdict fields"
    );
  }

  let testedCommitSha: string | undefined;
  let runnerProfile: "poc-default" | undefined;
  let projectTests: "pass" | "fail" | undefined;
  let researcherAcceptance: "pass" | "fail" | "skipped" | undefined;

  if (expectedRole === "test" && requireTestPass) {
    testedCommitSha = commitSha(
      raw.tested_commit_sha,
      "Artifact tested_commit_sha"
    );
    if (testedCommitSha !== revision) {
      throw new Error(
        "Test Artifact tested_commit_sha must match the Artifact revision"
      );
    }
    if (raw.runner_profile !== "poc-default") {
      throw new Error(
        "Test Artifact runner_profile must be poc-default"
      );
    }
    runnerProfile = "poc-default";

    if (raw.project_tests !== "pass") {
      throw new Error(
        "Test Artifact is not acceptable until project_tests is pass"
      );
    }
    projectTests = "pass";

    if (raw.researcher_acceptance !== "pass") {
      throw new Error(
        "Test Artifact is not acceptable until researcher_acceptance is pass"
      );
    }
    researcherAcceptance = "pass";
  }

  if (!Array.isArray(raw.errors)) {
    throw new Error("Artifact errors must be an array");
  }
  const errors = raw.errors.map((entry) =>
    nonEmptyString(entry, "Artifact error")
  );
  if (errors.length > 0) {
    throw new Error("Artifact contains execution errors");
  }

  const parsed: ValidatedWorkflowArtifact = {
    role: expectedRole,
    summary: nonEmptyString(raw.summary, "Artifact summary"),
    files_modified: stringArray(
      raw.files_modified,
      "Artifact files_modified"
    ),
    files_created: stringArray(raw.files_created, "Artifact files_created"),
    branch: ACCOUNT_SUSPENSION_ARTIFACT_BRANCH,
    revision,
    commit_sha: commitShaValue,
    test_outcome: testOutcome as AgentArtifactPayload["test_outcome"],
    errors: [],
    ...(testedCommitSha === undefined
      ? {}
      : { tested_commit_sha: testedCommitSha }),
    ...(runnerProfile === undefined
      ? {}
      : { runner_profile: runnerProfile }),
    ...(projectTests === undefined
      ? {}
      : { project_tests: projectTests }),
    ...(researcherAcceptance === undefined
      ? {}
      : { researcher_acceptance: researcherAcceptance })
  };

  if (raw.model_id !== undefined) {
    parsed.model_id = nonEmptyString(raw.model_id, "Artifact model_id");
  }
  if (raw.model_iterations !== undefined) {
    if (
      !Number.isSafeInteger(raw.model_iterations) ||
      (raw.model_iterations as number) < 0
    ) {
      throw new Error(
        "Artifact model_iterations must be a non-negative safe integer"
      );
    }
    parsed.model_iterations = raw.model_iterations as number;
  }

  return parsed;
}
