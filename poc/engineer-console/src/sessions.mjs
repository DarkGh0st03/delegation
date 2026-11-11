/**
 * Engineer sessions: Planning (preliminary read-only Root) → review →
 * operational Root. Composes the EXISTING canonical components:
 *  - GatewayRuntime (real HTTP Gateway: prepare/VP/Rust verifier/OPA/Gitea),
 *  - TrustedPlanningRevisions shared by Gateway and Engineer session,
 *  - createTrustedAuthorityOnlyReviewHost (Engineer session, Planner,
 *    signed Planning checkpoint, durable journals, Root transitions).
 * The console itself never builds ResourceURIs or decides permissions.
 */
import {createServer} from "node:http";
import {randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync} from "node:fs";
import {join} from "node:path";
import {readEnvFile} from "./env.mjs";
import {defaultPolicy, validatePolicy} from "./policy.mjs";
import {ScriptedPlannerModel} from "./scripted-planner-model.mjs";

const SESSION_ID = /^s-[a-f0-9]{12}$/u;
const AUTHORITY = "gitea.local";
const STATUS_LIST = "https://status.delegation.local/engineer/revocation";
const isoSeconds = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/u, "Z");

function writeJson(path, value, mode = 0o600) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {mode});
  renameSync(tmp, path);
}

export class EngineerSessions {
  #config; #core; #gitea; #store; #opa; #dir; #live = new Map(); #nextStatus;

  constructor({config, core, gitea, store, opa}) {
    this.#config = config; this.#core = core; this.#gitea = gitea;
    this.#store = store; this.#opa = opa;
    this.#dir = join(config.stateDir, "sessions");
    mkdirSync(this.#dir, {recursive: true, mode: 0o700});
    // Status-list indexes must never repeat on one chain; Anvil restarts
    // empty, so a random start per process is sufficient and simple. The
    // EVM status list holds 16 KiB * 8 = 131072 entries: start low enough
    // to leave room for many sessions (each uses 2 + Child indexes).
    this.#nextStatus = 1000 + randomBytes(2).readUInt16BE(0) % 60000;
  }

  #path(id, ...rest) { return join(this.#dir, id, ...rest); }

  #save(session) { writeJson(this.#path(session.id, "session.json"), session); }

  get(id) {
    if (!SESSION_ID.test(id) || !existsSync(this.#path(id, "session.json"))) return undefined;
    const session = JSON.parse(readFileSync(this.#path(id, "session.json"), "utf8"));
    if (this.#live.has(id)) session.live = true;
    return session;
  }

  list() {
    return [...this.#live.keys()].map(id => this.get(id)).filter(Boolean);
  }

  #log(session, text) {
    session.log.push({at: new Date().toISOString(), text});
    this.#save(session);
  }

  /** Start Planning for a saved requirement. Returns immediately. */
  start({request, mode, geminiConsent, username, userRecord}) {
    if (!this.#core.engineer?.ok || !this.#core.verifierInstance || !this.#core.credentials)
      throw Error("Il core Rust dell'Engineer o il verificatore del Gateway non sono pronti");
    if (mode !== "scripted" && mode !== "gemini") throw Error("Modalità di Planning non valida");
    if (mode === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw Error("GEMINI_API_KEY non configurata nel file .env");
      if (geminiConsent !== true)
        throw Error("Per usare Gemini serve il consenso esplicito ai costi");
    }
    const id = "s-" + randomBytes(6).toString("hex");
    mkdirSync(this.#path(id), {recursive: true, mode: 0o700});
    const session = {
      id, phase: "planning", mode, created_at: new Date().toISOString(), created_by: username,
      request_id: request.id, requirement: request.requirement,
      repository: request.repository, base_sha: request.base_sha,
      work_branch: "feature/" + id, log: [], gateway_decisions: [], proposal: null, error: null
    };
    this.#save(session);
    this.#runPlanning(session, userRecord).catch(error => {
      session.phase = "failed";
      session.error = error?.message ?? String(error);
      this.#log(session, "Errore: " + session.error);
    });
    return session;
  }

  async #runPlanning(session, userRecord) {
    const {owner, name} = session.repository;
    const repo = await this.#gitea.repositoryDetail(name);
    if (repo.default_branch !== "main")
      throw Error(`Il branch principale di ${owner}/${name} è "${repo.default_branch}": ` +
        "per ora il Planning supporta solo repository con branch principale \"main\"");
    if (repo.head_sha !== session.base_sha)
      throw Error("Il branch main è cambiato dopo il salvataggio della richiesta: crea una nuova richiesta");

    // 1. Repository policy (saved or default) must be enforced by OPA.
    const stored = this.#store.loadPolicy(owner, name);
    let policy;
    if (stored) {
      const {saved_at: _s, ...raw} = stored;
      try { policy = validatePolicy(raw, repo); } catch (error) {
        throw Error("La policy salvata per questa repository non è più valida (" +
          error.message + "): correggila e salvala di nuovo dalla pagina Policy");
      }
    } else {
      // The default becomes the saved policy, so later re-publications
      // (environment page, OPA restart) keep enforcing it for this session.
      policy = defaultPolicy(repo);
      this.#store.savePolicy(policy);
    }
    await this.#opa.publish(this.#store.listPolicies());
    this.#log(session, "Policy della repository applicata da OPA");

    // 2. Trusted owner snapshot of every path at the pinned commit.
    const tree = await this.#gitea.repositoryTree(name, session.base_sha);
    const snapshot = {
      session_id: session.id,
      repository: {authority: AUTHORITY, owner, repository: name},
      base_revision: session.base_sha,
      hierarchical_preliminary_read: true,
      directories: tree.directories, files: tree.files
    };
    this.#log(session, `Snapshot di ${tree.files.length} file e ${tree.directories.length} cartelle alla commit ${session.base_sha.slice(0, 12)}`);

    // 3. Real Gateway for this repository (in-process HTTP on loopback).
    const local = readEnvFile(join(this.#config.configDir, "local.env"));
    const giteaEnv = readEnvFile(join(this.#config.configDir, "gitea.env"));
    const {GiteaClient} = await import("../../apps/gateway/src/gitea-client.ts");
    const {TrustedPlanningRevisions} = await import("../../apps/gateway/src/planning-revisions.ts");
    const {GatewayRuntime} = await import("../../apps/gateway/src/runtime.ts");
    const {createGatewayHttpServer} = await import("../../apps/gateway/src/http.ts");
    const repository = {authority: AUTHORITY, owner, repository: name};
    const gatewayConfig = {
      bind_host: "127.0.0.1", bind_port: 0,
      prepare: {audience: "cloud-access-gateway", request_ttl_ms: 120000, repository},
      verifier_mode: "core-rust", opa_url: this.#config.opaUrl, opa_timeout_ms: 5000,
      provider_mode: "gitea", gitea_base_url: this.#config.giteaUrl,
      gitea_gateway_token: giteaEnv.GITEA_GATEWAY_TOKEN, gitea_timeout_ms: 30000
    };
    const revisions = new TrustedPlanningRevisions(new GiteaClient({
      baseUrl: this.#config.giteaUrl, token: giteaEnv.GITEA_GATEWAY_TOKEN,
      owner, repository: name, timeoutMs: 30000}));
    const audit = {emit: event => {
      if (event.event !== "authorization_executed") return;
      session.gateway_decisions.push({at: event.timestamp, agent: event.agent_role,
        tool: event.tool, resource: event.resource_uri, decision: event.decision,
        reason: event.reason ?? null, verification_ms: event.verification_ms,
        opa_ms: event.opa_ms, vp_size_bytes: event.vp_size_bytes});
      this.#save(session);
    }};
    const runtime = new GatewayRuntime(gatewayConfig, {
      verifier: this.#core.verifierInstance, planningRevisions: revisions, audit});
    const gatewayServer = createGatewayHttpServer(runtime);
    await new Promise(resolve => gatewayServer.listen(0, "127.0.0.1", resolve));
    const gatewayBaseUrl = `http://127.0.0.1:${gatewayServer.address().port}`;
    this.#log(session, "Gateway avviato (verifica Rust + OPA + Gitea)");

    // 4. Keys and durable stores of this session (private directories).
    const dirs = {};
    for (const d of ["checkpoints", "approvals", "activation", "tasks", "recovery", "op-sessions", "keys"]) {
      dirs[d] = this.#path(session.id, d);
      mkdirSync(dirs[d], {recursive: true, mode: 0o700});
      chmodSync(dirs[d], 0o700);
    }
    const engineerKey = createPrivateKey({key: Buffer.from(local.ENGINEER_APPROVAL_PRIVATE_KEY_B64, "base64"),
      format: "der", type: "pkcs8"});
    const engineerKeyFile = join(dirs.keys, "engineer.pem");
    writeFileSync(engineerKeyFile, engineerKey.export({format: "pem", type: "pkcs8"}), {mode: 0o600});
    const engineerPublicPem = createPublicKey(engineerKey).export({format: "pem", type: "spki"}).toString();
    const checkpointKey = generateKeyPairSync("ed25519");

    const {AuthorityPlanningCheckpointStore} = await import(
      "../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts");
    const {DurableAuthorityOnlyActivationJournal} = await import(
      "../../packages/orchestrator-runtime/src/authority-only-activation-journal.ts");
    const {DurableAuthorityTaskJournal} = await import(
      "../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts");
    const {TrustedOperationalRecoveryStore} = await import(
      "../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts");
    const {TrustedOperationalSessionStore} = await import(
      "../../apps/gateway/src/trusted-operational-session-store.ts");
    const {createTrustedAuthorityOnlyReviewHost} = await import(
      "../../apps/orchestrator/src/trusted-authority-only-review-host.mjs");

    const checkpointStore = new AuthorityPlanningCheckpointStore({
      directory: dirs.checkpoints, trust: {
        trustedKeys: {owner: {public_key_pem: checkpointKey.publicKey.export({format: "pem", type: "spki"}).toString()}},
        expectedSessionId: session.id, expectedRepository: snapshot.repository,
        expectedBaseRevision: session.base_sha, expectedWorkBranch: session.work_branch,
        expectedRequirement: session.requirement}});

    // 5. Planning model: free scripted stand-in, or Gemini with consent.
    let model;
    if (session.mode === "gemini") {
      const {createGeminiAdkModel} = await import("../../packages/agent-runtime/src/gemini-adk-model.ts");
      model = createGeminiAdkModel({apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash"});
      this.#log(session, "Planner: Gemini (" + (process.env.GEMINI_MODEL || "gemini-3.8-flash") + ")");
    } else {
      model = new ScriptedPlannerModel({snapshotFiles: tree.files, requirement: session.requirement});
      this.#log(session, "Planner: SIMULATO (nessuna IA, nessun costo)");
    }

    const roleDid = role => local[`ROLE_DID_${role}`];
    const statusIndex = () => String(this.#nextStatus++);
    const now = Date.now();
    const preliminaryRoot = {
      credential_id: `urn:delegation:${session.id}:preliminary`,
      valid_from: isoSeconds(now), validity_seconds: 40 * 60,
      credential_status: {type: "BitstringStatusListEntry", statusPurpose: "revocation",
        statusListIndex: statusIndex(), statusListCredential: STATUS_LIST}
    };
    session.operational_status_index = statusIndex();
    this.#log(session, "Emissione della Root preliminare di sola lettura...");

    const host = await createTrustedAuthorityOnlyReviewHost({
      snapshot, requirement: session.requirement, workBranch: session.work_branch, preliminaryRoot,
      checkpoint: {store: checkpointStore, backendKeyId: "owner",
        backendPrivateKeyPem: checkpointKey.privateKey.export({format: "pem", type: "pkcs8"}).toString()},
      activationJournal: new DurableAuthorityOnlyActivationJournal(dirs.activation),
      taskJournal: new DurableAuthorityTaskJournal(dirs.tasks),
      operationalRecoveryStore: new TrustedOperationalRecoveryStore(dirs.recovery),
      operationalSessionStore: new TrustedOperationalSessionStore(dirs["op-sessions"]),
      approval: {engineerDid: roleDid("ENGINEER"), keyId: "engineer-console",
        publicKeyPem: engineerPublicPem, privateKeyFile: engineerKeyFile,
        receiptDirectory: dirs.approvals,
        passwordSaltHex: userRecord.salt, passwordScryptHex: userRecord.hash},
      planner: session.mode === "gemini"
        ? {model, planId: session.id, maxModelTurns: 24, maxProposalRevisions: 1,
           thinkingLevel: "LOW", maxModelCallMs: 180000, maxOutputTokens: 12288, maxPlanningMs: 600000}
        : {model, planId: session.id, maxModelTurns: 3, maxProposalRevisions: 0},
      trustedAgentRegistry: {
        backend: {did: roleDid("BACKEND"), card_ref: "trusted:backend",
          capabilities: ["read_file", "update_file", "create_file"]},
        frontend: {did: roleDid("FRONTEND"), card_ref: "trusted:frontend",
          capabilities: ["read_file", "update_file", "create_file"]},
        test: {did: roleDid("TEST"), card_ref: "trusted:test",
          capabilities: ["read_file", "update_file", "create_file", "run_tests"]},
        orchestrator: {did: roleDid("ORCHESTRATOR"), card_ref: "trusted:orchestrator",
          capabilities: ["create_branch", "create_pull_request"]}
      },
      credentials: this.#core.credentials,
      planningRevisions: revisions,
      gateway: {gatewayBaseUrl, adapterToken: local.ADAPTER_CALLER_ORCHESTRATOR,
        fetchFn: fetch, timeoutMs: 60000}
    });

    const checkpoint = await checkpointStore.load();
    session.proposal = {
      permissions: checkpoint.proposal.requested_permissions,
      assumptions: checkpoint.assumptions ?? [], uncertainties: checkpoint.uncertainties ?? [],
      verified_source_reads: checkpoint.verified_source_reads ?? null
    };
    session.phase = "awaiting_review";
    this.#live.set(session.id, {host, gatewayServer, revisions, checkpointStore, snapshot, dirs,
      engineerKeyFile, engineerPublicPem});
    this.#log(session, `Proposta pronta: ${session.proposal.permissions.length} permessi da rivedere`);
  }
}

export {SESSION_ID};
