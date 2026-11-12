/**
 * Runner service entrypoint (the ONLY container with the Docker socket).
 * Reads the private bearer and the read-only Gitea token from the config
 * volume, then starts the existing test-runner-controller. The Runner can
 * only test an exact commit of a work branch; it never writes to Gitea.
 */
import {readFileSync} from "node:fs";
import {parseEnvFile} from "../../poc/engineer-console/src/env.mjs";

const local = parseEnvFile(readFileSync("/config/local.env", "utf8"));
const gitea = parseEnvFile(readFileSync("/config/gitea.env", "utf8"));
for (const [key, value] of Object.entries({
  TEST_RUNNER_BIND_ADDR: "0.0.0.0:8095",
  TEST_RUNNER_GATEWAY_TOKEN: local.RUNNER_GATEWAY_TOKEN,
  TEST_RUNNER_REPOSITORY_URI: `gitea://gitea.local/${local.GITEA_ORG}/${local.GITEA_REPOSITORY}`,
  // Any repository of the organization (the console makes the Runner a
  // read-only collaborator of each imported repository).
  TEST_RUNNER_REPOSITORY_PREFIX: `gitea://gitea.local/${local.GITEA_ORG}/`,
  TEST_RUNNER_BRANCH_PREFIX: "feature/",
  GITEA_RUNNER_BASE_URL: process.env.GITEA_URL ?? "http://gitea:3000",
  GITEA_RUNNER_TOKEN: gitea.GITEA_RUNNER_TOKEN,
  // No separate researcher acceptance suite: a PASS means that every phase
  // of the project's own tests passed (including the tests written by the
  // Test agent). The Runner reports acceptance as "skipped".
  TEST_RUNNER_ACCEPTANCE_ENABLED: "false"
})) {
  if (!value) { console.error(`Runner: missing ${key} in /config`); process.exit(1); }
  process.env[key] = value;
}
await import("../../poc/apps/test-runner-controller/src/main.ts");
