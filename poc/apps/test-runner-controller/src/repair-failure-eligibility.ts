import {safeAcceptanceFailureSummary} from "../../../runner/acceptance/failure-catalog.mjs";
import type {RunnerRunResult} from "./types.ts";
export type AcceptanceFailureSummary = NonNullable<RunnerRunResult["acceptance_failure"]>;

/** Diagnostic eligibility only. A live original root, pinned SHA and independently
 * checked target/grants remain mandatory before source reads or repair execution. */
export function isActionableRepairFailure(phase: unknown, codes: unknown, acceptance: unknown): boolean {
  if (phase === "typecheck") return Array.isArray(codes) && codes.length > 0 &&
    codes.length <= 16 && codes.every(code => typeof code === "string" && /^TS[0-9]{4}$/u.test(code));
  if (phase !== "researcher_acceptance" || !Array.isArray(codes) || codes.length !== 0) return false;
  const safe = safeAcceptanceFailureSummary(acceptance);
  return !!safe && safe.failed_checks.length > 0 && !safe.timed_out && !safe.unclassified_failure;
}
