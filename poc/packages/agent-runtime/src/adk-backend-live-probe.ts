/**
 * Manual, protected Gemini Backend probe. Only controls the subtask given to a
 * real Google ADK LlmAgent; never supplies a scripted function call or bypasses
 * the Delegation Evidence / Gateway / OPA enforcement path.
 *
 * Keep this deliberately separate from the frozen Phase 5 scripted baseline.
 */
export const BACKEND_LIVE_PROBE_PATH =
  "apps/backend/src/users/user.service.ts" as const;

export const BACKEND_LIVE_PROBE_MAX_TURNS = 8 as const;
export const BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS = 4096 as const;
export const BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS = 45_000 as const;

export const BACKEND_LIVE_PROBE_INSTRUCTION = [
  "Implement one real, backward-compatible Backend feature in the protected Gitea repository.",
  "Use the exposed read_file tool to read apps/backend/src/users/user.service.ts",
  "on branch feature/account-suspension. Do not guess the existing code.",
  "Inside the existing UserService class, add a public method",
  "countSuspendedUsers(): number that counts repository users whose status is",
  "ACCOUNT_STATUS.SUSPENDED, using the existing repository and status constant.",
  "Preserve all existing imports, methods, behavior, and valid TypeScript.",
  "Only modify apps/backend/src/users/user.service.ts. The update_file tool",
  "replaces the WHOLE file, so supply its complete updated content.",
  "Call update_file using branch feature/account-suspension. Never edit any",
  "other file or attempt to bypass an authorization denial.",
  "After the Gateway confirms a successful update and commit SHA, finish.",
  "Do not claim success from prose alone."
].join(" ");

export function verifyBackendLiveProbe(input: {
  initialRevision: string;
  reportedRevision: string | null | undefined;
  repositoryRevision: string | null | undefined;
  filesModified: readonly string[];
  repositorySource: string;
}): void {
  const sha=/^[0-9a-f]{40}$/u;
  if (!input.reportedRevision || !sha.test(input.reportedRevision) ||
      input.reportedRevision===input.initialRevision ||
      input.repositoryRevision!==input.reportedRevision) {
    throw new Error("Backend probe did not produce a verified new Gitea branch revision");
  }
  if (input.filesModified.length!==1 ||
      input.filesModified[0]!==BACKEND_LIVE_PROBE_PATH) {
    throw new Error("Backend probe must modify exactly the permitted Backend service file");
  }
  const found=/\bcountSuspendedUsers\s*\(\s*\)\s*:\s*number\s*\{([\s\S]*?)\n\s*\}/u
    .exec(input.repositorySource);
  if (!found || !found[1]?.includes("repository.findAll") ||
      !found[1]?.includes("ACCOUNT_STATUS.SUSPENDED")) {
    throw new Error("Gateway-confirmed Gitea content does not contain the requested Backend method");
  }
}
