/**
 * Full original Account Suspension Backend task, driven by a real Gemini
 * LlmAgent. No substituted decisions, fixed file contents or mock model.
 * The role still uses the existing Gateway/OPA/Rust/Gitea enforcement path.
 * The 4-file task below matches the original baseline's Backend scope.
 */
export const BACKEND_LIVE_PROBE_PATHS = [
  "packages/shared/src/account-status.ts",
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts"
] as const;

export const BACKEND_LIVE_PROBE_MAX_TURNS = 16 as const;
export const BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS = 4096 as const;
export const BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS = 60_000 as const;

export const BACKEND_LIVE_PROBE_INSTRUCTION =
  "Implement the backend Account Suspension lifecycle and shared status contract.";

export function verifyBackendLiveProbe(input: {
  initialRevision: string;
  reportedRevision: string | null | undefined;
  repositoryRevision: string | null | undefined;
  filesModified: readonly string[];
  verifiedFilePaths: readonly string[];
}): void {
  const sha = /^[0-9a-f]{40}$/u;
  if (!sha.test(input.initialRevision) ||
      !input.reportedRevision || !sha.test(input.reportedRevision) ||
      input.reportedRevision === input.initialRevision ||
      input.repositoryRevision !== input.reportedRevision) {
    throw new Error("Backend probe did not produce a verified new Gitea branch revision");
  }
  const expected = new Set<string>(BACKEND_LIVE_PROBE_PATHS);
  const reported = new Set(input.filesModified);
  const inspected = new Set(input.verifiedFilePaths);
  if (reported.size !== expected.size ||
      inspected.size !== expected.size ||
      input.filesModified.length !== expected.size ||
      input.verifiedFilePaths.length !== expected.size ||
      [...expected].some(path => !reported.has(path) || !inspected.has(path))) {
    throw new Error("Full Backend task must modify and verify exactly the four delegated paths");
  }
}
