/**
 * R409 historical compatibility entry only.
 * All public interfaces, validators, and TrustedOperationalRepairPlanner
 * re-export the SAME owner-private implementation. Do not delete until
 * all external/computed consumers are independently accounted for.
 */
export * from "./trusted-owner-repair-planning-core.ts";
