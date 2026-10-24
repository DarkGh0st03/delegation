/**
 * Shared, authorization-neutral permission shape.
 *
 * This type does NOT grant authority. The active Engineer-signed plan,
 * scoped Rust DC/VP, Gateway and OPA independently enforce authorization.
 * Static Account Suspension matrices live only in permission-templates.ts.
 */
export type TemplateOperation =
  | "read_repository"
  | "list_directory"
  | "read_file"
  | "update_file"
  | "create_file"
  | "create_branch"
  | "create_pull_request"
  | "run_tests";

export interface DelegatedPermission {
  resource: string;
  operation: TemplateOperation;
}

