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
