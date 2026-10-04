import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const pocRoot = resolve(here, "..");
const envPath = resolve(pocRoot, "infra", ".env");
const force = process.argv.includes("--force");

if (existsSync(envPath) && !force) {
  console.log(`Local Phase 1 environment already exists: ${envPath}`);
  process.exit(0);
}

mkdirSync(resolve(pocRoot, "infra", "runtime"), { recursive: true });

const randomHex = (bytes = 24) => randomBytes(bytes).toString("hex");

const env = [
  "# Generated local-only Phase 1 configuration.",
  "# This file is gitignored. Regenerate it instead of committing secrets.",
  "GITEA_IMAGE=docker.gitea.com/gitea:28.0.0",
  "OPA_IMAGE=openpolicyagent/opa:1.21.1",
  "FOUNDRY_IMAGE=ghcr.io/foundry-rs/foundry:v1.8.4",
  "GITEA_HOST_PORT=3000",
  "OPA_HOST_PORT=8181",
  "ANVIL_HOST_PORT=8545",
  "ANVIL_CHAIN_ID=31337",
  "ANVIL_MNEMONIC=\"test test test test test test test test test test test junk\"",
  "ANVIL_DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "GITEA_ADMIN_USER=thesis-admin",
  `GITEA_ADMIN_PASSWORD=${randomHex()}`,
  "GITEA_ADMIN_EMAIL=thesis-admin@example.invalid",
  "GITEA_GATEWAY_USER=gateway",
  `GITEA_GATEWAY_PASSWORD=${randomHex()}`,
  "GITEA_GATEWAY_EMAIL=gateway@example.invalid",
  "GITEA_ORG=thesis",
  "GITEA_REPOSITORY=iam-console-poc",
  "GITEA_SOURCE_REPO=https://github.com/DarkGh0st03/iam-console-poc.git",
  "GITEA_BASELINE_SHA=ea9984fa15098771fc451f9ae51c82824b6a40fd",
  `ADAPTER_CALLER_GATEWAY=${randomHex(32)}`,
  `ADAPTER_CALLER_ORCHESTRATOR=${randomHex(32)}`,
  `ADAPTER_CALLER_BACKEND=${randomHex(32)}`,
  `ADAPTER_CALLER_FRONTEND=${randomHex(32)}`,
  `ADAPTER_CALLER_TEST=${randomHex(32)}`,
  ""
].join("\n");

writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Generated local Phase 1 environment: ${envPath}`);
