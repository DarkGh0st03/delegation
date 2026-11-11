/**
 * One-shot: create the private local configuration in the /config volume.
 *
 * - /config/local.env      random service passwords and caller secrets,
 *                          generated ONCE and then kept (mode 0600);
 * - /config/console-users.json  the Engineer login, re-hashed from
 *                          ENGINEER_USERNAME / ENGINEER_PASSWORD on every start.
 *
 * Nothing here is ever sent to an agent or a model.
 */
import {randomBytes} from "node:crypto";
import {existsSync, writeFileSync, chmodSync} from "node:fs";
import {join} from "node:path";
import {hashPassword, validateUsername, writeUserFile} from "../../poc/engineer-console/src/auth.mjs";

const CONFIG = process.env.CONFIG_DIR ?? "/config";
const hex = (bytes = 24) => randomBytes(bytes).toString("hex");

const localEnv = join(CONFIG, "local.env");
if (!existsSync(localEnv)) {
  const lines = [
    "# Generated once by deploy/bootstrap/setup.mjs. Private: never commit or share.",
    // Well-known Anvil development account #0: local test chain only.
    "ANVIL_DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "GITEA_ADMIN_USER=thesis-admin",
    `GITEA_ADMIN_PASSWORD=${hex()}`,
    "GITEA_ADMIN_EMAIL=thesis-admin@example.invalid",
    "GITEA_GATEWAY_USER=gateway",
    `GITEA_GATEWAY_PASSWORD=${hex()}`,
    "GITEA_GATEWAY_EMAIL=gateway@example.invalid",
    "GITEA_RUNNER_USER=test-runner",
    `GITEA_RUNNER_PASSWORD=${hex()}`,
    "GITEA_RUNNER_EMAIL=test-runner@example.invalid",
    "GITEA_ORG=thesis",
    "GITEA_REPOSITORY=iam-console-poc",
    "GITEA_SOURCE_REPO=https://github.com/DarkGh0st03/iam-console-poc.git",
    "GITEA_BASELINE_SHA=405748b1e77992b6bd8630a3ab6f990658d32f6b",
    `ADAPTER_CALLER_ENGINEER=${hex(32)}`,
    `ADAPTER_CALLER_GATEWAY=${hex(32)}`,
    `ADAPTER_CALLER_ORCHESTRATOR=${hex(32)}`,
    `ADAPTER_CALLER_BACKEND=${hex(32)}`,
    `ADAPTER_CALLER_FRONTEND=${hex(32)}`,
    `ADAPTER_CALLER_TEST=${hex(32)}`,
    ""
  ];
  writeFileSync(localEnv, lines.join("\n"), {mode: 0o600});
  chmodSync(localEnv, 0o600);
  console.log("Generated private local configuration.");
} else {
  console.log("Private local configuration already present: kept.");
}

const username = validateUsername(process.env.ENGINEER_USERNAME ?? "engineer");
const password = process.env.ENGINEER_PASSWORD ?? "";
if (password.length < 8) {
  console.error("ENGINEER_PASSWORD must be set in .env (at least 8 characters). Copy .env.example to .env.");
  process.exit(1);
}
writeUserFile(join(CONFIG, "console-users.json"),
  {[username]: {...hashPassword(password), created_at: new Date().toISOString()}});
console.log(`Engineer login configured for "${username}".`);
