import {ACCEPTANCE_FAILURE_PREFIX, safeAcceptanceFailureSummary}
  from "../../../runner/acceptance/failure-catalog.mjs";

/** Bounded diagnostic evidence only; absence never means acceptance passed. */
export function extractAcceptanceFailureSummary(stdout: string, stderr: string) {
  const lines = (stdout + "\n" + stderr).slice(-256 * 1024).split(/\r?\n/u);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith(ACCEPTANCE_FAILURE_PREFIX) || line.length > 2048) continue;
    try {
      const safe = safeAcceptanceFailureSummary(JSON.parse(line.slice(ACCEPTANCE_FAILURE_PREFIX.length)));
      if (safe) return safe;
    } catch { /* Raw app output is never re-exported. */ }
  }
  return null;
}
