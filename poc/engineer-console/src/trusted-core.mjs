/**
 * Trusted native Rust components hosted by the console process (stage 1):
 *  - the Engineer CryptoRuntime (issues/revokes Roots, Child/VP socket),
 *    which on start enrols every role identity on the local chain;
 *  - the independent public-only Gateway verifier.
 *
 * Configuration comes only from the private /config volume. It is copied
 * into this process' environment because the native addons read their
 * configuration from the environment; nothing is passed to any agent.
 */
import {mkdirSync, rmSync, existsSync, chmodSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readEnvFile} from "./env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROLES = ["ENGINEER", "ORCHESTRATOR", "BACKEND", "FRONTEND", "TEST"];
export const OWNER_DIR = "/tmp/delegation-owner";
export const PUBLIC_ARTIFACT_DIR = "/tmp/delegation-public";

/** Build the environment for the native addons (pure function, testable). */
export function nativeEnvironment({local, trust, anvilUrl, chainId = 31337}) {
  const need = (source, key) => {
    const value = source[key];
    if (typeof value !== "string" || !value) throw Error("Configurazione mancante: " + key);
    return value;
  };
  const env = {
    DELEGATION_GATEWAY_ARCHITECTURE: "authority-only",
    APPROVED_RUNNER_NATIVE_MCP: "1",
    ENGINEER_CORE_NATIVE_MODE: "1",
    ADAPTER_ENGINEER_NATIVE_SOCKET: join(OWNER_DIR, "engineer.sock"),
    ADAPTER_TRUST_PROFILE: "evm",
    RPC_URL: anvilUrl,
    CHAIN_ID: String(chainId),
    DID_REGISTRY_ADDRESS: need(trust, "DID_REGISTRY_ADDRESS"),
    ENTERPRISE_TRUST_REGISTRY_ADDRESS: need(trust, "ENTERPRISE_TRUST_REGISTRY_ADDRESS"),
    ISSUER_REGISTRY_ADDRESS: need(trust, "ISSUER_REGISTRY_ADDRESS"),
    GOVERNANCE_PRIVATE_KEY: need(local, "ANVIL_DEPLOYER_PRIVATE_KEY"),
    ADAPTER_ID_GATEWAY: "urn:thesis:service:gateway",
    ADAPTER_CALLER_GATEWAY: need(local, "ADAPTER_CALLER_GATEWAY"),
    ADAPTER_DID_RESOLVER_SCRIPT: join(ROOT, "blockchain/did-client/resolve-did-json.mjs"),
    ADAPTER_DID_PUBLISHER_SCRIPT: join(ROOT, "blockchain/did-client/publish-ed25519.mjs"),
    ADAPTER_PUBLIC_ARTIFACT_DIR: PUBLIC_ARTIFACT_DIR,
    CORE_RUST_RPC_URL: anvilUrl,
    CORE_RUST_CHAIN_ID: String(chainId),
    CORE_RUST_DID_REGISTRY_ADDRESS: need(trust, "DID_REGISTRY_ADDRESS"),
    CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS: need(trust, "ENTERPRISE_TRUST_REGISTRY_ADDRESS"),
    CORE_RUST_ISSUER_REGISTRY_ADDRESS: need(trust, "ISSUER_REGISTRY_ADDRESS"),
    CORE_RUST_DID_RESOLVER_SCRIPT: join(ROOT, "blockchain/did-client/resolve-did-json.mjs"),
    CORE_RUST_PUBLIC_ARTIFACT_DIR: PUBLIC_ARTIFACT_DIR
  };
  for (const role of ROLES) {
    env[`ADAPTER_EVM_PRIVATE_KEY_${role}`] = need(local, `ROLE_EVM_PRIVATE_KEY_${role}`);
    env[`ADAPTER_ID_${role}`] = need(local, `ROLE_DID_${role}`);
    env[`ADAPTER_CALLER_${role}`] = need(local, `ADAPTER_CALLER_${role}`);
  }
  return env;
}

/**
 * Start both native components once. Never throws: returns a status per
 * component so the console can show what failed and why.
 */
export async function startTrustedCore(config) {
  const status = {
    engineer: {ok: false, detail: "non avviato"},
    verifier: {ok: false, detail: "non avviato"},
    credentials: undefined, verifierInstance: undefined
  };
  let env;
  try {
    env = nativeEnvironment({
      local: readEnvFile(join(config.configDir, "local.env")),
      trust: readEnvFile(join(config.configDir, "trust.env")),
      anvilUrl: config.anvilUrl, chainId: config.chainId
    });
  } catch (error) {
    status.engineer.detail = status.verifier.detail = error.message;
    return status;
  }
  Object.assign(process.env, env);
  // Owner-private socket directory; a stale socket from a previous run of
  // this container would make the native core refuse to start.
  mkdirSync(OWNER_DIR, {recursive: true, mode: 0o700});
  chmodSync(OWNER_DIR, 0o700);
  if (existsSync(env.ADAPTER_ENGINEER_NATIVE_SOCKET)) rmSync(env.ADAPTER_ENGINEER_NATIVE_SOCKET);
  mkdirSync(PUBLIC_ARTIFACT_DIR, {recursive: true, mode: 0o755});

  try {
    const {createTrustedEngineerCredentialPort} = await import(
      "../../packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
    status.credentials = createTrustedEngineerCredentialPort({
      bearerToken: env.ADAPTER_CALLER_ENGINEER, timeoutMs: 60000});
    status.engineer = {ok: true,
      detail: "avviato; identità dei 5 ruoli registrate sulla blockchain"};
  } catch (error) {
    status.engineer = {ok: false, detail: "avvio fallito: " + (error?.message ?? error) +
      ". Se Anvil non è stato riavviato insieme all'app, usa: docker compose down && docker compose up -d"};
    return status;
  }
  try {
    const {loadDirectCoreRustVerifier} = await import("../../apps/gateway/src/direct-core-loader.ts");
    status.verifierInstance = loadDirectCoreRustVerifier({allowGiteaScopeCoverage: true});
    status.verifier = {ok: true, detail: "pronto (catena, registri e artefatti pubblici verificati)"};
  } catch (error) {
    status.verifier = {ok: false, detail: "non pronto: " + (error?.message ?? error)};
  }
  return status;
}
