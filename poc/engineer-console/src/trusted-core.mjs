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
import {spawn} from "node:child_process";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readEnvFile} from "./env.mjs";
import {SPECIALIST_ROLES, roleEnvKey} from "../../packages/plan-contracts/src/agent-roles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROLES = ["ENGINEER", "ORCHESTRATOR", ...SPECIALIST_ROLES.map(roleEnvKey)];
export const OWNER_DIR = "/tmp/delegation-owner";
export const PUBLIC_ARTIFACT_DIR = "/tmp/delegation-public";

const need = (source, key) => {
  const value = source[key];
  if (typeof value !== "string" || !value) throw Error("Configurazione mancante: " + key);
  return value;
};

/** Roles that have their own MCP-wallet process (one signing key each). */
export const WALLET_ROLES = ["ORCHESTRATOR", ...SPECIALIST_ROLES.map(roleEnvKey)];
export const walletSocketPath = role => join(OWNER_DIR, `wallet-${role.toLowerCase()}.sock`);

/** Public, non-secret configuration shared by the Engineer core and wallets. */
function publicEnvironment({local, trust, anvilUrl, chainId}) {
  const env = {
    DELEGATION_GATEWAY_ARCHITECTURE: "authority-only",
    APPROVED_RUNNER_NATIVE_MCP: "1",
    ADAPTER_TRUST_PROFILE: "evm",
    RPC_URL: anvilUrl,
    CHAIN_ID: String(chainId),
    DID_REGISTRY_ADDRESS: need(trust, "DID_REGISTRY_ADDRESS"),
    ENTERPRISE_TRUST_REGISTRY_ADDRESS: need(trust, "ENTERPRISE_TRUST_REGISTRY_ADDRESS"),
    ISSUER_REGISTRY_ADDRESS: need(trust, "ISSUER_REGISTRY_ADDRESS"),
    ADAPTER_ID_GATEWAY: "urn:thesis:service:gateway",
    ADAPTER_DID_RESOLVER_SCRIPT: join(ROOT, "blockchain/did-client/resolve-did-json.mjs"),
    ADAPTER_DID_PUBLISHER_SCRIPT: join(ROOT, "blockchain/did-client/publish-ed25519.mjs"),
    ADAPTER_PUBLIC_ARTIFACT_DIR: PUBLIC_ARTIFACT_DIR
  };
  // Every role's DID is public: each runtime knows the others by DID only.
  for (const role of ROLES) env[`ADAPTER_ID_${role}`] = need(local, `ROLE_DID_${role}`);
  return env;
}

/**
 * Environment of the Engineer core (pure function, testable). It signs ONLY
 * as the Engineer (Roots, revocation) and serves the Gateway's inspection;
 * it holds the platform governance key to admit every identity on-chain. It
 * never receives the Orchestrator's or the agents' keys or tokens.
 */
export function nativeEnvironment({local, trust, anvilUrl, chainId = 31337}) {
  const env = {
    ...publicEnvironment({local, trust, anvilUrl, chainId}),
    ADAPTER_SIGNING_ROLE: "engineer",
    ENGINEER_CORE_NATIVE_MODE: "1",
    ADAPTER_ENGINEER_NATIVE_SOCKET: join(OWNER_DIR, "engineer.sock"),
    GOVERNANCE_PRIVATE_KEY: need(local, "ANVIL_DEPLOYER_PRIVATE_KEY"),
    ADAPTER_EVM_PRIVATE_KEY_ENGINEER: need(local, "ROLE_EVM_PRIVATE_KEY_ENGINEER"),
    ADAPTER_CALLER_ENGINEER: need(local, "ADAPTER_CALLER_ENGINEER"),
    ADAPTER_CALLER_GATEWAY: need(local, "ADAPTER_CALLER_GATEWAY"),
    CORE_RUST_RPC_URL: anvilUrl,
    CORE_RUST_CHAIN_ID: String(chainId),
    CORE_RUST_DID_REGISTRY_ADDRESS: need(trust, "DID_REGISTRY_ADDRESS"),
    CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS: need(trust, "ENTERPRISE_TRUST_REGISTRY_ADDRESS"),
    CORE_RUST_ISSUER_REGISTRY_ADDRESS: need(trust, "ISSUER_REGISTRY_ADDRESS"),
    CORE_RUST_DID_RESOLVER_SCRIPT: join(ROOT, "blockchain/did-client/resolve-did-json.mjs"),
    CORE_RUST_PUBLIC_ARTIFACT_DIR: PUBLIC_ARTIFACT_DIR
  };
  // Where the Orchestrator and each agent find THEIR wallet.
  for (const role of WALLET_ROLES) env[`DELEGATION_WALLET_SOCKET_${role}`] = walletSocketPath(role);
  return env;
}

/**
 * Environment of ONE role's wallet process (pure function, testable): its
 * own EVM account key and caller token, public data, nothing else. No
 * governance key, no Engineer key, no other role's key or token.
 */
export function walletEnvironment({local, trust, anvilUrl, chainId = 31337, role}) {
  if (!WALLET_ROLES.includes(role)) throw Error("Ruolo del wallet non valido: " + role);
  return {
    ...publicEnvironment({local, trust, anvilUrl, chainId}),
    ADAPTER_SIGNING_ROLE: role.toLowerCase(),
    DELEGATION_WALLET_SOCKET: walletSocketPath(role),
    [`ADAPTER_EVM_PRIVATE_KEY_${role}`]: need(local, `ROLE_EVM_PRIVATE_KEY_${role}`),
    [`ADAPTER_CALLER_${role}`]: need(local, `ADAPTER_CALLER_${role}`),
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"
  };
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
  let env, local, trust;
  try {
    local = readEnvFile(join(config.configDir, "local.env"));
    trust = readEnvFile(join(config.configDir, "trust.env"));
    env = nativeEnvironment({local, trust, anvilUrl: config.anvilUrl, chainId: config.chainId});
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
    const engineerPort = createTrustedEngineerCredentialPort({
      bearerToken: env.ADAPTER_CALLER_ENGINEER, timeoutMs: 60000});
    // One MCP-wallet process per role, each with ONLY its own key. Started
    // after the Engineer core, which admitted every identity on-chain.
    await startRoleWallets({local, trust, config});
    status.credentials = deliverRootsToOrchestratorWallet(engineerPort,
      {socketPath: env.DELEGATION_WALLET_SOCKET_ORCHESTRATOR,
       token: need(local, "ADAPTER_CALLER_ORCHESTRATOR")});
    status.engineer = {ok: true,
      detail: `avviato; Engineer e un wallet per ciascuno dei ${WALLET_ROLES.length} ruoli registrati sulla blockchain`};
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

const wallets = new Set();
process.on("exit", () => { for (const child of wallets) child.kill("SIGTERM"); });

/** Start the wallet process of every role and wait until each is serving. */
async function startRoleWallets({local, trust, config}) {
  const script = join(dirname(fileURLToPath(import.meta.url)), "role-wallet.mjs");
  await Promise.all(WALLET_ROLES.map(role => new Promise((resolveStart, rejectStart) => {
    const socket = walletSocketPath(role);
    if (existsSync(socket)) rmSync(socket);
    const child = spawn(process.execPath, [script], {
      env: walletEnvironment({local, trust, anvilUrl: config.anvilUrl, chainId: config.chainId, role}),
      stdio: ["ignore", "pipe", "pipe"]
    });
    wallets.add(child);
    let output = "";
    const timer = setTimeout(() => rejectStart(Error(`wallet ${role}: avvio oltre il tempo massimo`)), 150000);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("WALLET_READY")) done(resolveStart);
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("exit", code => done(rejectStart,
      Error(`wallet ${role} terminato (codice ${code}): ${output.trim().slice(-300)}`)));
  })));
}

/**
 * The Engineer hands every Root it issues to the Orchestrator, which keeps it
 * in ITS wallet: the Orchestrator then issues Child DCs and its VPs there,
 * with its own key. The wallet refuses a credential not delegated to it.
 */
function deliverRootsToOrchestratorWallet(engineerPort, wallet) {
  return Object.freeze({
    async issueScopedOrchestratorRoot(request) {
      const issued = await engineerPort.issueScopedOrchestratorRoot(request);
      const {invokeNativeCrypto} = await import("../../packages/agent-runtime/src/native-crypto-ipc.ts");
      const stored = await invokeNativeCrypto({...wallet, timeoutMs: 60000},
        "store_credential", {credential: issued});
      if (stored?.credential_id !== issued?.id)
        throw Error("La Root non è stata consegnata al wallet dell'Orchestrator");
      return issued;
    },
    revokeRoot: credentialId => engineerPort.revokeRoot(credentialId)
  });
}
