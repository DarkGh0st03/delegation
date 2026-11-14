/**
 * The ONE registry of specialist agent roles.
 *
 * Every layer (Gateway, Orchestrator runtime, agent runtime, console,
 * wallets) reads the roster from here instead of keeping its own list.
 * A role is an identity with its own DID, MCP-wallet signing key and Agent
 * Card; it gets authority ONLY through a per-Task Child credential derived
 * from the Engineer-signed Root (Rust DC/VP + OPA at the Gateway).
 *
 *  - application roles change project files (never the project's tests);
 *  - the test role changes only the project's test sources and runs tests.
 */
export const APPLICATION_ROLES = Object.freeze(["backend", "frontend", "docs", "data", "devops"]);
export const TEST_ROLE = "test";
export const SPECIALIST_ROLES = Object.freeze([...APPLICATION_ROLES, TEST_ROLE]);

/** Always provisioned (the original roster). */
export const REQUIRED_SPECIALISTS = Object.freeze(["backend", "frontend", TEST_ROLE]);
/** Provisioned when the owner configures them (DID, wallet, A2A endpoint);
 * the console always does. Same authority model as Backend/Frontend. */
export const OPTIONAL_SPECIALISTS = Object.freeze(["docs", "data", "devops"]);

/** A provisioned roster: every required role, optional roles only once each. */
export function isValidSpecialistRoster(roles) {
  return Array.isArray(roles) && new Set(roles).size === roles.length &&
    REQUIRED_SPECIALISTS.every(role => roles.includes(role)) &&
    roles.every(role => SPECIALIST_ROLES.includes(role));
}

/** Roles that delegate or verify, never receive a Child credential. */
export const NON_SPECIALIST_PRINCIPALS = Object.freeze(["orchestrator", "engineer", "gateway"]);

/** Human labels (console, logs). */
export const ROLE_LABELS = Object.freeze({
  orchestrator: "Orchestrator", backend: "Backend", frontend: "Frontend", test: "Test",
  docs: "Documentation", data: "Data", devops: "DevOps"
});

/** Permanent skill of each specialist (Agent Card / system prompt). */
export const ROLE_SKILLS = Object.freeze({
  backend: "Backend application logic, server-side APIs, data contracts and integration",
  frontend: "Frontend user interface, accessibility and API integration in the browser",
  docs: "Project documentation: README, user and developer guides, API and change notes kept consistent with the code",
  data: "Application data: seed and fixture data, data files, schemas and migrations, kept consistent with the code that reads them",
  devops: "Build and delivery configuration: Dockerfile, container and CI workflow files, package scripts and environment configuration",
  test: "Automated tests, validation evidence and controlled test execution"
});

export const isSpecialistRole = role => typeof role === "string" && SPECIALIST_ROLES.includes(role);
export const isApplicationRole = role => typeof role === "string" && APPLICATION_ROLES.includes(role);

/** Upper-case key used in environment variables and local.env. */
export const roleEnvKey = role => role.toUpperCase();

/** Registry-ordered roster provisioned by an owner-held map (endpoints,
 * DIDs, tokens...): every required role plus the optional roles present. */
export function provisionedSpecialists(record) {
  const has = role => !!record && typeof record === "object" && Object.hasOwn(record, role);
  return SPECIALIST_ROLES.filter(role => REQUIRED_SPECIALISTS.includes(role) || has(role));
}
