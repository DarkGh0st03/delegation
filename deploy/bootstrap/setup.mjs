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
import {generateKeyPairSync, randomBytes} from "node:crypto";
import {existsSync, readFileSync, appendFileSync, writeFileSync, chmodSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {hashPassword, validateUsername, writeUserFile} from "../../poc/engineer-console/src/auth.mjs";
import {parseEnvFile} from "../../poc/engineer-console/src/env.mjs";
import {SPECIALIST_ROLES, roleEnvKey} from "../../poc/packages/plan-contracts/src/agent-roles.mjs";

const CONFIG = process.env.CONFIG_DIR ?? "/config";
const hex = (bytes = 24) => randomBytes(bytes).toString("hex");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// ethers is already a pinned dependency of the DID client.
const {Wallet} = createRequire(join(ROOT, "blockchain/did-client/package.json"))("ethers");
// Engineer, Orchestrator and every specialist of the shared role registry
// (Backend, Frontend, Documentation, Data, DevOps, Test).
export const ROLES = Object.freeze(["ENGINEER", "ORCHESTRATOR", ...SPECIALIST_ROLES.map(roleEnvKey)]);
const CHAIN_HEX = "0x7a69"; // 31337, the local Anvil chain

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

// Per-role EVM identities (random, generated once). Each role DID is
// did:ethr on the local chain; its key signs DID documents and anchors the
// role's accumulator material. Missing entries are appended to older configs.
{
  const current = parseEnvFile(readFileSync(localEnv, "utf8"));
  const added = [];
  for (const role of ROLES) {
    if (current[`ROLE_EVM_PRIVATE_KEY_${role}`]) continue;
    const wallet = Wallet.createRandom();
    added.push(`ROLE_EVM_PRIVATE_KEY_${role}=${wallet.privateKey}`,
      `ROLE_DID_${role}=did:ethr:${CHAIN_HEX}:${wallet.address}`);
  }
  // Engineer approval key (Ed25519): signs the reviewed permission scope.
  if (!current.ENGINEER_APPROVAL_PRIVATE_KEY_B64) {
    const {privateKey, publicKey} = generateKeyPairSync("ed25519");
    added.push(
      `ENGINEER_APPROVAL_PRIVATE_KEY_B64=${privateKey.export({format: "der", type: "pkcs8"}).toString("base64")}`,
      `ENGINEER_APPROVAL_PUBLIC_KEY_B64=${publicKey.export({format: "der", type: "spki"}).toString("base64")}`);
  }
  // Caller token of every role (agents added later get theirs here).
  for (const role of ["ENGINEER", "GATEWAY", "ORCHESTRATOR", ...SPECIALIST_ROLES.map(roleEnvKey)])
    if (!current[`ADAPTER_CALLER_${role}`]) added.push(`ADAPTER_CALLER_${role}=${hex(32)}`);
  // Bearer shared by the trusted Gateway owner (app) and the Runner service.
  if (!current.RUNNER_GATEWAY_TOKEN) added.push(`RUNNER_GATEWAY_TOKEN=${hex(32)}`);
  // HMAC key for independently re-checkable execution evidence receipts.
  if (!current.EXECUTION_EVIDENCE_KEY_HEX) added.push(`EXECUTION_EVIDENCE_KEY_HEX=${hex(32)}`);
  // Read-only Gitea account of the staging deployer (reads merged main only).
  if (!current.GITEA_DEPLOYER_USER) added.push("GITEA_DEPLOYER_USER=staging-deployer",
    `GITEA_DEPLOYER_PASSWORD=${hex()}`, "GITEA_DEPLOYER_EMAIL=staging-deployer@example.invalid");
  if (added.length) {
    appendFileSync(localEnv, "# Role identities generated by setup\n" + added.join("\n") + "\n");
    chmodSync(localEnv, 0o600);
    console.log(`Generated ${added.length} role identity entries.`);
  } else {
    console.log("Role identities already present: kept.");
  }
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
