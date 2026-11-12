/** Trusted Owner-only lifetime ceilings for the two-phase workflow.
 *
 * The provisional Delegation Credential is strictly read-only and is never
 * renewed automatically. Planning inference can last up to 15 minutes, but
 * the independently authenticated Engineer must still have time to review.
 * These are maxima, NOT a guarantee that an issuer grants that lifetime.
 */
export const MAX_PRELIMINARY_ROOT_SECONDS = 45 * 60;
export const DEFAULT_PLANNER_SESSION_MS = 15 * 60 * 1000;
export const DEFAULT_ENGINEER_REVIEW_MS = 20 * 60 * 1000;
export const MAX_ENGINEER_REVIEW_MS = 20 * 60 * 1000;
/** Allows Gateway bootstrap, checkpoint persistence and handoff overhead. */
export const TRUSTED_PLANNING_HANDOFF_MARGIN_MS = 2 * 60 * 1000;
/** Verified read observations (each at most 4096 characters of source) that
 * the Owner passes to the Orchestrator's Task decisions in one session. Bounds
 * the decision context (and cost) while letting specialists receive the
 * definitions their edits depend on and the Test agent read the changed
 * application files before writing tests. 12 excerpts stay well inside the
 * per-decision token ceiling of the paid budget (48k per call). */
export const MAX_ADAPTIVE_SOURCE_OBSERVATIONS = 12;
