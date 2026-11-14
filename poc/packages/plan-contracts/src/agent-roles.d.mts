/** Types of agent-roles.mjs (the single specialist roster). */
export type ApplicationRole = "backend" | "frontend" | "docs" | "data" | "devops";
export type SpecialistRole = ApplicationRole | "test";
export declare const APPLICATION_ROLES: readonly ApplicationRole[];
export declare const TEST_ROLE: "test";
export declare const SPECIALIST_ROLES: readonly SpecialistRole[];
export declare const NON_SPECIALIST_PRINCIPALS: readonly ("orchestrator" | "engineer" | "gateway")[];
export declare const ROLE_LABELS: Readonly<Record<SpecialistRole | "orchestrator", string>>;
export declare const ROLE_SKILLS: Readonly<Record<SpecialistRole, string>>;
export declare function isSpecialistRole(role: unknown): role is SpecialistRole;
export declare function isApplicationRole(role: unknown): role is ApplicationRole;
export declare function roleEnvKey(role: string): string;
export declare const REQUIRED_SPECIALISTS: readonly ("backend" | "frontend" | "test")[];
export declare const OPTIONAL_SPECIALISTS: readonly ("docs" | "data" | "devops")[];
export declare function isValidSpecialistRoster(roles: unknown): boolean;
export declare function provisionedSpecialists(record: unknown): SpecialistRole[];
