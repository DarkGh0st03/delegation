/**
 * GENERATED from src/delegation/authorization/operation.rs.
 * Run: node poc/scripts/sync-rust-operation-catalog.mjs --write
 * Never treat catalog membership as a permission or as provider support.
 */
export const RUST_OPERATIONS = [
  "read_repository",
  "read_file",
  "list_directory",
  "write_file",
  "create_file",
  "update_file",
  "delete_file",
  "read_branch",
  "create_branch",
  "delete_branch",
  "read_commit_history",
  "create_commit",
  "read_pull_request",
  "create_pull_request",
  "update_pull_request",
  "merge_pull_request",
  "close_pull_request",
  "read_issue",
  "create_issue",
  "update_issue",
  "close_issue",
  "create_tag",
  "delete_tag",
  "read_release",
  "create_release",
  "update_release",
  "delete_release",
  "run_tests",
  "read_test_results",
  "trigger_workflow",
  "read_workflow_status",
] as const;

export type Operation = (typeof RUST_OPERATIONS)[number];

export function isRustOperation(value: unknown): value is Operation {
  return typeof value === "string" &&
    (RUST_OPERATIONS as readonly string[]).includes(value);
}
