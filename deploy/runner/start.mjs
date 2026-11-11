/**
 * Runner service entrypoint (the ONLY container with the Docker socket).
 * Reads the private bearer and the read-only Gitea token from the config
 * volume, then starts the existing test-runner-controller. The Runner can
 * only test an exact commit of a work branch; it never writes to Gitea.
 */
import {cpSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {parseEnvFile} from "../../poc/engineer-console/src/env.mjs";

const local = parseEnvFile(readFileSync("/config/local.env", "utf8"));
const gitea = parseEnvFile(readFileSync("/config/gitea.env", "utf8"));
for (const [key, value] of Object.entries({
  TEST_RUNNER_BIND_ADDR: "0.0.0.0:8095",
  TEST_RUNNER_GATEWAY_TOKEN: local.RUNNER_GATEWAY_TOKEN,
  TEST_RUNNER_REPOSITORY_URI: `gitea://gitea.local/${local.GITEA_ORG}/${local.GITEA_REPOSITORY}`,
  TEST_RUNNER_BRANCH_PREFIX: "feature/",
  GITEA_RUNNER_BASE_URL: process.env.GITEA_URL ?? "http://gitea:3000",
  GITEA_OWNER: local.GITEA_ORG,
  GITEA_REPOSITORY: local.GITEA_REPOSITORY,
  GITEA_RUNNER_TOKEN: gitea.GITEA_RUNNER_TOKEN,
  // Researcher acceptance tests (account-suspension reference requirement).
  // Without their PASS the Gateway never authorizes a Draft PR.
  TEST_RUNNER_ACCEPTANCE_ENABLED: process.env.RUNNER_ACCEPTANCE ?? "true",
  TEST_RUNNER_ACCEPTANCE_VOLUME: "delegation-acceptance"
})) {
  if (!value) { console.error(`Runner: missing ${key} in /config`); process.exit(1); }
  process.env[key] = value;
}
// Refresh the shared read-only acceptance volume from this image.
for (const entry of readdirSync("/acceptance")) rmSync(`/acceptance/${entry}`, {recursive: true, force: true});
cpSync(new URL("../../poc/runner/acceptance/", import.meta.url), "/acceptance", {recursive: true});
await import("../../poc/apps/test-runner-controller/src/main.ts");
