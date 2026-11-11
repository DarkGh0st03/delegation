/**
 * Reads the local, gitignored configuration produced by the existing setup
 * scripts (poc/infra/.env and poc/infra/runtime/*.env). Values are parsed as
 * data only: nothing is evaluated or exported to child processes.
 */
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const POC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const INFRA_DIR = resolve(POC_ROOT, "infra");
export const RUNTIME_DIR = resolve(INFRA_DIR, "runtime");
export const CONSOLE_DIR = resolve(RUNTIME_DIR, "console");

/** Parse KEY=VALUE lines; supports optional single or double quotes. */
export function parseEnvFile(text) {
  const out = Object.create(null);
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 &&
        ((value.startsWith("\"") && value.endsWith("\"")) ||
         (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFile(path) {
  if (!existsSync(path)) return Object.create(null);
  return parseEnvFile(readFileSync(path, "utf8"));
}

/**
 * Local configuration. Two layouts are supported:
 *  - Docker Compose (CONFIG_DIR set): private files in the /config volume,
 *    services reached by their Compose names (GITEA_URL, OPA_URL, ANVIL_URL);
 *  - development on the host: poc/infra/.env and poc/infra/runtime/.
 */
export function loadLocalConfig(env = process.env) {
  const composeMode = typeof env.CONFIG_DIR === "string" && env.CONFIG_DIR !== "";
  const infraPath = composeMode ? resolve(env.CONFIG_DIR, "local.env") : resolve(INFRA_DIR, ".env");
  const infra = readEnvFile(infraPath);
  const trust = readEnvFile(composeMode ? resolve(env.CONFIG_DIR, "trust.env")
    : resolve(RUNTIME_DIR, "trust.env"));
  const port = (name, fallback) => {
    const value = Number(infra[name] ?? fallback);
    return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
  };
  const consolePort = Number(env.ENGINEER_CONSOLE_PORT ?? 8700);
  return Object.freeze({
    composeMode,
    configDir: composeMode ? resolve(env.CONFIG_DIR) : RUNTIME_DIR,
    infraEnvPresent: existsSync(infraPath),
    giteaUrl: env.GITEA_URL ?? `http://127.0.0.1:${port("GITEA_HOST_PORT", 3000)}`,
    opaUrl: env.OPA_URL ?? `http://127.0.0.1:${port("OPA_HOST_PORT", 8181)}`,
    anvilUrl: env.ANVIL_URL ?? `http://127.0.0.1:${port("ANVIL_HOST_PORT", 8545)}`,
    chainId: Number(infra.ANVIL_CHAIN_ID ?? env.CHAIN_ID ?? 31337),
    giteaAdminUser: infra.GITEA_ADMIN_USER ?? "",
    giteaAdminPassword: infra.GITEA_ADMIN_PASSWORD ?? "",
    giteaOrg: infra.GITEA_ORG ?? "thesis",
    giteaGatewayUser: infra.GITEA_GATEWAY_USER ?? "gateway",
    giteaRunnerUser: infra.GITEA_RUNNER_USER ?? "test-runner",
    didRegistryAddress: trust.DID_REGISTRY_ADDRESS ?? "",
    trustRegistryAddress: trust.ENTERPRISE_TRUST_REGISTRY_ADDRESS ?? "",
    issuerRegistryAddress: trust.ISSUER_REGISTRY_ADDRESS ?? "",
    consoleHost: env.ENGINEER_CONSOLE_HOST ?? "127.0.0.1",
    consolePort: Number.isInteger(consolePort) ? consolePort : 8700,
    usersPath: composeMode ? resolve(env.CONFIG_DIR, "console-users.json")
      : resolve(CONSOLE_DIR, "users.json"),
    stateDir: env.CONSOLE_STATE_DIR ?? (composeMode ? "/state" : CONSOLE_DIR),
    nativeGatewayAddon: resolve(POC_ROOT, "apps/gateway/src/native/delegation-core.node"),
    nativeEngineerAddon: resolve(POC_ROOT,
      "packages/orchestrator-runtime/src/native/delegation-engineer.node")
  });
}
