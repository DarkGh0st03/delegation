import type { SpecializedAgentRole } from "@thesis/agent-runtime";

export type TemplateOperation =
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

export const POC_REPOSITORY = Object.freeze({
  authority: "gitea.local",
  owner: "thesis",
  repository: "iam-console-poc",
  branch: "feature/account-suspension"
} as const);

function repositoryUri(): string {
  return `gitea://${POC_REPOSITORY.authority}/${encodeURIComponent(POC_REPOSITORY.owner)}/${encodeURIComponent(POC_REPOSITORY.repository)}`;
}

function branchUri(): string {
  return `${repositoryUri()}/branches/${encodeURIComponent(POC_REPOSITORY.branch)}`;
}

function fileUri(path: string): string {
  return `${branchUri()}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function permission(
  resource: string,
  operation: TemplateOperation
): DelegatedPermission {
  return Object.freeze({ resource, operation });
}

function read(path: string): DelegatedPermission {
  return permission(fileUri(path), "read_file");
}

function update(path: string): DelegatedPermission {
  return permission(fileUri(path), "update_file");
}

function create(path: string): DelegatedPermission {
  return permission(fileUri(path), "create_file");
}

function freezeTemplate(
  permissions: readonly DelegatedPermission[]
): readonly DelegatedPermission[] {
  return Object.freeze([...permissions]);
}

const BACKEND_READ_UPDATE = [
  "packages/shared/src/account-status.ts",
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts"
] as const;

const BACKEND_READ_ONLY = [
  "apps/backend/src/users/user.model.ts",
  "apps/backend/src/users/user.repository.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/backend/src/app.ts"
] as const;

const FRONTEND_READ_UPDATE = [
  "apps/frontend/src/api/users-api.ts",
  "apps/frontend/src/pages/UserDetailPage.tsx",
  "apps/frontend/src/styles.css"
] as const;

const FRONTEND_READ_ONLY = [
  "packages/shared/src/account-status.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/frontend/src/components/UserStatusBadge.tsx"
] as const;

const TEST_READ_UPDATE = [
  "tests/backend/user.service.test.ts",
  "tests/backend/user.routes.test.ts",
  "tests/frontend/UserDetailPage.test.tsx"
] as const;

const TEST_READ_ONLY = [
  "tests/e2e/user-profile.spec.ts",
  "packages/shared/src/account-status.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/backend/src/users/user.model.ts",
  "apps/backend/src/users/user.repository.ts",
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts",
  "apps/frontend/src/api/users-api.ts",
  "apps/frontend/src/pages/UserDetailPage.tsx",
  "apps/frontend/src/styles.css",
  "apps/frontend/src/components/UserStatusBadge.tsx"
] as const;

export const DC_BACKEND = freezeTemplate([
  ...BACKEND_READ_UPDATE.flatMap((path) => [read(path), update(path)]),
  ...BACKEND_READ_ONLY.map(read)
]);

export const DC_FRONTEND = freezeTemplate([
  ...FRONTEND_READ_UPDATE.flatMap((path) => [read(path), update(path)]),
  ...FRONTEND_READ_ONLY.map(read)
]);

export const DC_TEST = freezeTemplate([
  ...TEST_READ_UPDATE.flatMap((path) => [read(path), update(path)]),
  create("tests/e2e/account-suspension.spec.ts"),
  ...TEST_READ_ONLY.map(read),
  permission(branchUri(), "run_tests")
]);

export const ORCHESTRATOR_WORKFLOW_PERMISSIONS = freezeTemplate([
  permission(repositoryUri(), "create_branch"),
  permission(repositoryUri(), "create_pull_request")
]);

function permissionKey(value: DelegatedPermission): string {
  return `${value.operation}\u0000${value.resource}`;
}

function unionPermissions(
  templates: readonly (readonly DelegatedPermission[])[]
): readonly DelegatedPermission[] {
  const seen = new Set<string>();
  const result: DelegatedPermission[] = [];
  for (const template of templates) {
    for (const item of template) {
      const key = permissionKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return freezeTemplate(result);
}

export const ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY = unionPermissions([
  DC_BACKEND,
  DC_FRONTEND,
  DC_TEST,
  ORCHESTRATOR_WORKFLOW_PERMISSIONS
]);

export const DELEGATION_TEMPLATES: Readonly<
  Record<SpecializedAgentRole, readonly DelegatedPermission[]>
> = Object.freeze({
  backend: DC_BACKEND,
  frontend: DC_FRONTEND,
  test: DC_TEST
});

export const SKILL_TO_ROLE = Object.freeze({
  "backend-account-lifecycle": "backend",
  "frontend-account-lifecycle": "frontend",
  "test-account-lifecycle": "test"
} as const);

export type SpecializedSkill = keyof typeof SKILL_TO_ROLE;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clonePermissions(
  permissions: readonly DelegatedPermission[]
): DelegatedPermission[] {
  return permissions.map((item) => ({ ...item }));
}

export interface ResolvedDelegationTemplate {
  role: SpecializedAgentRole;
  permissions: DelegatedPermission[];
}

export function resolveDelegationTemplate(
  selection: unknown
): ResolvedDelegationTemplate {
  if (!isObject(selection)) {
    throw new Error("Delegation template selection must be an object");
  }

  const allowed = new Set(["role", "skill"]);
  const unexpected = Object.keys(selection).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Delegation template selection contains unsupported fields: ${unexpected.join(", ")}`
    );
  }

  const hasRole = selection.role !== undefined;
  const hasSkill = selection.skill !== undefined;
  if (hasRole === hasSkill) {
    throw new Error("Select exactly one deterministic role or skill");
  }

  let role: SpecializedAgentRole;
  if (hasRole) {
    if (
      selection.role !== "backend" &&
      selection.role !== "frontend" &&
      selection.role !== "test"
    ) {
      throw new Error("Unsupported specialized Agent role");
    }
    role = selection.role;
  } else {
    if (
      typeof selection.skill !== "string" ||
      !(selection.skill in SKILL_TO_ROLE)
    ) {
      throw new Error("Unsupported specialized Agent skill");
    }
    role = SKILL_TO_ROLE[selection.skill as SpecializedSkill];
  }

  return {
    role,
    permissions: clonePermissions(DELEGATION_TEMPLATES[role])
  };
}

export function rootAuthorityPermissions(): DelegatedPermission[] {
  return clonePermissions(ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY);
}

export function repositoryPermissionUris(): {
  repository: string;
  branch: string;
} {
  return {
    repository: repositoryUri(),
    branch: branchUri()
  };
}

export function templatePermissionKey(value: DelegatedPermission): string {
  return permissionKey(value);
}
