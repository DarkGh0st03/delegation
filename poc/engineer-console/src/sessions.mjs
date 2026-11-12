/**
 * Engineer sessions: Planning (preliminary read-only Root) → review →
 * operational Root. Composes the EXISTING canonical components:
 *  - GatewayRuntime (real HTTP Gateway: prepare/VP/Rust verifier/OPA/Gitea),
 *  - TrustedPlanningRevisions shared by Gateway and Engineer session,
 *  - createTrustedAuthorityOnlyReviewHost (Engineer session, Planner,
 *    signed Planning checkpoint, durable journals, Root transitions).
 * The console itself never builds ResourceURIs or decides permissions.
 */
import {createServer as createNetServer} from "node:net";
import {randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, chmodSync} from "node:fs";
import {join} from "node:path";
import {readEnvFile} from "./env.mjs";
import {MAX_PRELIMINARY_ROOT_SECONDS} from "../../packages/plan-contracts/src/planning-limits.mjs";
import {defaultPolicy, validatePolicy} from "./policy.mjs";
import {ScriptedPlannerModel} from "./scripted-planner-model.mjs";
import {preflightGemini, createSessionGeminiModels} from "./gemini-models.mjs";

const geminiModelName = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from "../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT} from "../../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs";

/** Free modes: no AI provider is ever called. */
const FREE_MODES = new Set(["scripted", "reference"]);
import {simulatedExecutionPlan, ScriptedWorkerModel, ScriptedTestModel, ScriptedTestFileWorker,
  ScriptedDecisionModel, ScriptedRootTaskModel} from "./scripted-execution-models.mjs";

const SESSION_ID = /^s-[a-f0-9]{12}$/u;
/** How long the Engineer may review a proposal (canonical maximum is 1 h). */
const PROPOSAL_REVIEW_MS = 25 * 60 * 1000;
const PERMISSION_ID = /^permission-[1-9][0-9]{0,2}$/u;
// Phases that only exist while this process holds the session's host. After
// an app restart the chain is new and every earlier Root is gone with it.
const LIVE_PHASES = new Set(["planning", "awaiting_review", "approving", "executing", "stopping"]);
const AUTHORITY = "gitea.local";
const STATUS_LIST = "https://status.delegation.local/engineer/revocation";
const isoSeconds = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/u, "Z");

async function freePort() {
  const server = createNetServer();
  await new Promise((ok, bad) => { server.once("error", bad); server.listen(0, "127.0.0.1", ok); });
  const {port} = server.address();
  await new Promise(ok => server.close(ok));
  return port;
}

/** Plain-language reason for the canonical fail-closed stops. */
export function friendlyExecutionError(error) {
  const text = String(error?.message ?? error);
  if (/not independently actionable/u.test(text))
    return "i test sono falliti per un problema dell'ambiente di test (ad esempio l'installazione " +
      "delle dipendenze senza rete), non per il codice. L'esecuzione si è fermata in sicurezza e la " +
      "Root è stata revocata. Dettagli: docker compose logs runner";
  if (/private Gemini request budget NO-GO/u.test(text))
    return "il limite di sicurezza su Gemini ha scartato una chiamata (budget esaurito, risposta " +
      "troncata o bloccata, oppure errore di Google). La Root è stata revocata. Vedi la tabella " +
      "\"Chiamate a Gemini\" della sessione";
  if (/PR forbidden without latest independently completed Test/u.test(text))
    return "i test non sono stati completati con successo, quindi la Draft PR non è stata " +
      "creata e la Root è stata revocata";
  if (/runner-?fail|runnerFailureReceipts/iu.test(text) && /ENOENT/u.test(text))
    return "il Runner non ha restituito un esito verificabile (servizio non raggiungibile o errore " +
      "interno). L'esecuzione si è fermata in sicurezza e la Root è stata revocata. Dettagli: " +
      "docker compose logs runner";
  return text;
}

/** Only non-secret status fields of the canonical workflow result. */
function summarizeResult(result) {
  const a = result?.adaptive ?? {};
  return {status: result?.status ?? null, pr_created: !!result?.pr_created,
    executed_tasks: a.executed_tasks ?? null, adaptive_status: a.status ?? result?.adaptive_status ?? null,
    reason: typeof a.reason === "string" ? a.reason.slice(0, 300) : null};
}

function writeJson(path, value, mode = 0o600) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {mode});
  renameSync(tmp, path);
}

export class EngineerSessions {
  #config; #core; #gitea; #store; #opa; #dir; #live = new Map(); #owned = new Set(); #nextStatus;

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
    session.live = this.#live.has(id);
    // Started by an earlier process: its Roots died with that chain.
    if (!this.#owned.has(id) && LIVE_PHASES.has(session.phase)) {
      session.phase = "interrupted";
      session.error = session.error ?? "La console è stata riavviata: la sessione non è più attiva " +
        "(la blockchain locale riparte da zero a ogni avvio). Avvia un nuovo Planning.";
    }
    return session;
  }

  /** Most recent sessions first (live or finished). */
  list(limit = 20) {
    let ids = [];
    try { ids = readdirSync(this.#dir).filter(id => SESSION_ID.test(id)); } catch { /* none */ }
    return ids.map(id => this.get(id)).filter(Boolean)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  #requireLive(id, phases) {
    const session = this.get(id);
    if (!session) throw Error("Sessione non trovata");
    const live = this.#live.get(id);
    if (!live || !phases.includes(session.phase))
      throw Error(`Operazione non permessa nella fase "${session.phase}"`);
    return {session, live};
  }

  /**
   * Engineer decision on the proposal. The console never signs by itself:
   * it opens the canonical password-protected Engineer approval server of
   * this session's review host (loopback only) and submits the selected
   * permission IDs with the password the Engineer has just re-entered.
   * That server re-checks the scrypt verifier, signs the subset with the
   * Engineer Ed25519 key and writes the receipt. Then the host re-verifies
   * the receipt, revokes the preliminary Root and issues the operational one.
   */
  async approve({id, password, permissionIds}) {
    const {session, live} = this.#requireLive(id, ["awaiting_review"]);
    if (!Array.isArray(permissionIds) || !permissionIds.length ||
        permissionIds.length > 128 || permissionIds.some(x => !PERMISSION_ID.test(x)) ||
        new Set(permissionIds).size !== permissionIds.length)
      throw Error("Seleziona almeno un permesso valido");
    const known = new Set(session.proposal.permissions.map(p => p.id));
    if (permissionIds.some(x => !known.has(x))) throw Error("Permesso non presente nella proposta");
    if (typeof password !== "string" || !password) throw Error("Password richiesta");
    if (session.proposal.expires_at && Date.parse(session.proposal.expires_at) <= Date.now() + 5000)
      throw Error("La proposta è scaduta (si può firmare per " + PROPOSAL_REVIEW_MS / 60000 +
        " minuti dopo il Planning): premi \"Rifiuta\" e avvia un nuovo Planning");

    session.phase = "approving"; this.#save(session);
    try {
      const signed = await this.#signViaApprovalServer(live.host.server, password, permissionIds);
      session.approval = {at: new Date().toISOString(), permission_ids: [...permissionIds],
        proposal_digest: signed.proposal_digest, permission_count: signed.permission_count};
      this.#log(session, `Firma Ed25519 dell'Engineer registrata su ${signed.permission_count} ` +
        `permessi di ${session.proposal.permissions.length}`);
    } catch (error) {
      // Nothing was signed: the Engineer can retry (e.g. wrong password).
      session.phase = "awaiting_review"; this.#save(session);
      throw error;
    }
    session.phase = "executing"; this.#save(session);
    if (live.sessionRef) live.sessionRef.current = session;
    this.#log(session, "Avvio dell'esecuzione: la Root operativa sarà emessa con i soli permessi firmati");
    this.#runExecution(session, live).catch(error => {
      if (live.stopRequested) return; // the Engineer's stop records the outcome
      session.phase = "failed";
      // The canonical launcher's last error can hide the first cause (e.g.
      // "PR forbidden" after a failed test): show the recorded cause too.
      const cause = [...session.log].reverse()
        .find(l => /^(Gateway: |Il Runner non ha|Esito del Runner)/u.test(l.text))?.text;
      session.error = "Esecuzione interrotta: " + friendlyExecutionError(error) +
        (cause ? " — Causa: " + cause : "");
      this.#log(session, "Errore: " + session.error);
      this.#shutdown(session.id).catch(() => {});
    });
    return session;
  }

  /**
   * Execution through the canonical reviewed handoff of THIS session's host:
   * provision -> operational Root (re-verified signed grant) -> Child DCs per
   * Task -> Gateway (VP/Rust/OPA) -> Gitea CAS / Docker Runner -> Draft PR.
   * The console only assembles owner configuration and chooses the models.
   */
  async #runExecution(session, live) {
    const local = readEnvFile(join(this.#config.configDir, "local.env"));
    const giteaEnv = readEnvFile(join(this.#config.configDir, "gitea.env"));
    const approvedIds = new Set(session.approval.permission_ids);
    const approved = session.proposal.permissions.filter(p => approvedIds.has(p.id));
    if (!approved.some(p => p.operation === "create_branch"))
      throw Error("Il permesso create_branch non è stato approvato: senza branch di lavoro non si può eseguire");
    const scripted = FREE_MODES.has(session.mode);
    const reference = session.mode === "reference";
    const plan = simulatedExecutionPlan(approved, session.id);
    if (scripted && !plan.tasks.length)
      throw Error("Nessun file approvato con lettura e modifica: niente da eseguire");

    // Owner-private files (0600 in 0700 directories), as the canonical
    // assembler requires for every secret it reads.
    const execDir = this.#path(session.id, "execution");
    const sub = [...["gateway-tasks", "issuer-children", "gateway-children", "effect-fences",
      "sequences"].map(d => join("journals", d)), "status-reservations", "secrets",
      "mutationIntent", "giteaReceipts", "runnerIntent", "runnerFailureReceipts",
      "runnerPassReceipts", "createIntent", "createReceipts"];
    for (const d of ["", "journals", ...sub]) {
      mkdirSync(join(execDir, d), {recursive: true, mode: 0o700}); chmodSync(join(execDir, d), 0o700);
    }
    const secret = (name, value) => {
      if (!value) throw Error("Configurazione privata incompleta: " + name);
      const file = join(execDir, "secrets", name);
      writeFileSync(file, value, {mode: 0o600}); chmodSync(file, 0o600);
      return file;
    };
    const roles = ["backend", "frontend", "test"];
    const childCount = scripted ? plan.tasks.length : 24;
    const childIndices = Array.from({length: childCount}, () => String(this.#nextStatus++));
    const workerPorts = {};
    for (const role of roles) workerPorts[role] = await freePort();
    const createEnabled = approved.some(p => p.operation === "create_file");

    const {assembleCanonicalOperationalDeployment} = await import(
      "../../apps/orchestrator/src/canonical-owner-deployment.mjs");
    const {createProtectedCanonicalOperationalProvision} = await import(
      "../../apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs");
    const operational = await assembleCanonicalOperationalDeployment({
      pins: {snapshot: live.snapshot, preliminaryRoot: live.preliminaryRoot,
        workBranch: session.work_branch, gateway: {gatewayBaseUrl: live.gatewayBaseUrl}},
      config: {
        directory: execDir,
        giteaUrl: this.#config.giteaUrl, opaUrl: this.#config.opaUrl, runnerUrl: this.#config.runnerUrl,
        internalHttpHosts: [...new Set([this.#config.giteaUrl, this.#config.opaUrl, this.#config.runnerUrl]
          .map(u => new URL(u).hostname).filter(h => /^[a-z][a-z0-9-]*$/u.test(h)))],
        giteaWriterFile: secret("writer.token", giteaEnv.GITEA_GATEWAY_TOKEN),
        giteaReaderFile: secret("reader.token", giteaEnv.GITEA_RUNNER_TOKEN),
        runnerTokenFile: secret("runner.token", local.RUNNER_GATEWAY_TOKEN),
        evidenceKeyFile: secret("evidence.key", local.EXECUTION_EVIDENCE_KEY_HEX),
        orchestratorTokenFile: secret("orchestrator.token", local.ADAPTER_CALLER_ORCHESTRATOR),
        workerTokens: Object.fromEntries(roles.map(role =>
          [role, secret(role + ".token", local[`ADAPTER_CALLER_${role.toUpperCase()}`])])),
        workerPorts, rootIndex: session.operational_status_index, childIndices,
        executionBudget: {maxDecisions: Math.min(childCount + 1, 25), maxVerifiedFailures: 1},
        ...(createEnabled ? {enableNativeCreateFile: true} : {}),
        draftTitle: (reference ? "[RIFERIMENTO] " : scripted ? "[SIMULATA] " : "") + session.requirement.slice(0, 120),
        draftBody: `Sessione ${session.id}, requisito approvato dall'Engineer.\n\n` +
          `${session.requirement}\n\n` + (reference
          ? "Codice: SOLUZIONE DI RIFERIMENTO del ricercatore, scritta dagli agenti senza IA attraverso " +
            "l'intera catena di autorizzazione (Child DC, Gateway, OPA). Non è codice generato da un modello.\n"
          : scripted
          ? "Esecuzione SIMULATA senza IA: ogni file autorizzato riceve solo un commento marcato; il requisito NON è implementato.\n"
          : "Modifiche generate dagli agenti entro i permessi firmati dall'Engineer.\n") +
          "Gli agenti non possono fare merge: la decisione resta umana."
      },
      // Placeholders only: every model is replaced below, per role.
      loadModelFactory: async () => () => new ScriptedRootTaskModel({})
    });

    // Owner-side diagnostics: the Gateway hides provider errors from agents
    // (by design), but the Engineer must see why a test run failed.
    const runner = operational.nativeEffects.runnerClient;
    const runTests = runner.run.bind(runner);
    runner.run = async (request, signal) => {
      this.#log(session, "Test avviati nel Runner sul commit " + String(request?.commit_sha).slice(0, 12));
      try {
        const result = await runTests(request, signal);
        const failed = (result.phases ?? []).find(p => p.status === "fail")?.phase;
        this.#log(session, "Esito del Runner: " + result.status.toUpperCase() +
          (failed ? " (prima fase fallita: " + failed + ")" : ""));
        return result;
      } catch (error) {
        this.#log(session, "Il Runner non ha dato un esito: " + String(error?.message ?? error).slice(0, 300));
        throw error;
      }
    };

    // The operational Root may not outlive the signed approval.
    const receipt = JSON.parse(readFileSync(join(live.dirs.approvals, session.id + ".json"), "utf8"));
    const validity = Math.floor((Date.parse(receipt.expires_at) - Date.now()) / 1000) - 120;
    if (!(validity >= 300)) throw Error("Approvazione firmata troppo vicina alla scadenza: ripeti il Planning");
    operational.rootReservation.validitySeconds = Math.min(validity, 7200);

    if (scripted) {
      const files = role => plan.tasks.filter(t => t.agent_id === role && t.path)
        .map(t => ({path: t.path, op: t.op}));
      const contents = reference ? ACCOUNT_SUSPENSION_REFERENCE_FILES : undefined;
      const w = operational.localWorkers.workers, branch = session.work_branch;
      const common = {branch, sessionId: session.id, contents};
      w.backend.adk.model = new ScriptedWorkerModel({role: "backend", files: files("backend"), ...common});
      w.frontend.adk.model = new ScriptedWorkerModel({role: "frontend", files: files("frontend"), ...common});
      w.test.adk.model = new ScriptedTestModel({branch, worker: new ScriptedTestFileWorker(
        {role: "test", files: files("test"), ...common})});
      operational.workflow.createBranch.model = new ScriptedRootTaskModel({task_id: "branch",
        agent_id: "orchestrator", depends_on: [], permissions: [plan.branch],
        instruction: "Crea il branch di lavoro approvato a partire da main"});
      operational.workflow.adaptive.model = new ScriptedDecisionModel({plan, branchTaskId: "branch"});
      if (plan.pullRequest && plan.runsTests)
        operational.workflow.draftPullRequest.model = new ScriptedRootTaskModel({task_id: "draft-pr",
          agent_id: "orchestrator", depends_on: ["t99-test"], permissions: [plan.pullRequest],
          instruction: "Crea la Draft PR sul commit testato; non fare mai merge"});
      else delete operational.workflow.draftPullRequest;
    } else {
      if (!live.gemini) throw Error("Modelli Gemini della sessione non disponibili");
      const m = live.gemini.execution(), w = operational.localWorkers.workers;
      w.backend.adk.model = m.backend; w.frontend.adk.model = m.frontend; w.test.adk.model = m.test;
      // One Orchestrator model: Branch proposal, every Task decision, PR proposal.
      operational.workflow.createBranch.model = m.orchestrator;
      operational.workflow.adaptive.model = m.orchestrator;
      if (operational.workflow.draftPullRequest) operational.workflow.draftPullRequest.model = m.orchestrator;
      if (!approved.some(p => p.operation === "create_pull_request")) delete operational.workflow.draftPullRequest;
    }

    // Live view of every Gateway decision of the agents (VP, Rust, OPA).
    const events = operational.rootGateway.audit.events;
    let seen = 0;
    live.auditTimer = setInterval(() => {
      if (events.length === seen) return;
      for (const event of events.slice(seen)) this.#recordDecision(session, event);
      seen = events.length; this.#save(session);
    }, 1500);

    const authority = {snapshot: live.snapshot, workBranch: session.work_branch,
      preliminaryRoot: live.preliminaryRoot, operationalSessionStore: live.operationalSessionStore,
      trustedAgentRegistry: live.trustedAgentRegistry};
    const provision = await createProtectedCanonicalOperationalProvision(authority, operational);
    live.handoff = live.host.createReviewedCanonicalHandoff({provision});
    this.#log(session, reference ? "Agenti senza IA con la SOLUZIONE DI RIFERIMENTO: " + plan.tasks.length + " Task pianificati"
      : scripted ? "Agenti SIMULATI (nessuna IA): " + plan.tasks.length + " Task pianificati"
      : "Agenti con Gemini: l'Orchestrator sceglie i Task entro i permessi firmati");
    let result;
    try { result = await live.handoff.runApprovedCanonical(); }
    finally {
      clearInterval(live.auditTimer);
      for (const event of events.slice(seen)) this.#recordDecision(session, event);
    }
    session.result = summarizeResult(result);
    if (live.gemini) {
      const g = live.gemini.summary();
      this.#log(session, `Gemini: ${g.calls_started} chiamate, ${g.reported_tokens ?? g.reported_total_tokens ?? "?"} token riportati nella sessione`);
    }
    if (result?.pr_created) {
      session.pull_request = await this.#gitea.pullRequestFor(session.repository.name, session.work_branch)
        .catch(() => null);
    }
    session.phase = "completed";
    this.#log(session, result?.pr_created
      ? "Completata: Draft PR creata. Il merge resta una decisione umana."
      : "Completata senza Draft PR: " + (session.result.reason ?? session.result.status));
    // Retire the operational Root now: nothing else may run under it.
    await this.#shutdown(session.id);
    this.#log(session, "Root operativa revocata a fine esecuzione");
  }

  #recordModelCall(session, entry) {
    session.model_calls ??= [];
    if (session.model_calls.length < 400) session.model_calls.push({at: new Date().toISOString(), ...entry});
    if (!entry.ok) session.log.push({at: new Date().toISOString(),
      text: `Gemini (${entry.phase}${entry.layer === "budget" ? ", limite di sicurezza" : ""}): ${entry.error}`});
    else if (entry.finish && entry.finish !== "STOP") session.log.push({at: new Date().toISOString(),
      text: `Gemini (${entry.phase}): risposta terminata con ${entry.finish} (verrà scartata)`});
    this.#save(session);
  }

  #recordDecision(session, event) {
    if (event.event !== "authorization_executed" && event.event !== "authorization_denied") return;
    const detail = typeof event.provider_error_detail === "string" ? event.provider_error_detail : null;
    session.gateway_decisions.push({at: event.timestamp, agent: event.agent_role,
      tool: event.tool, resource: event.resource_uri, decision: event.decision,
      reason: event.reason ?? null, detail, verification_ms: event.verification_ms, opa_ms: event.opa_ms});
    if (detail) session.log.push({at: new Date().toISOString(),
      text: `Gateway: ${event.tool} di ${event.agent_role} non riuscito: ${detail}`});
  }

  async #signViaApprovalServer(server, password, permissionIds) {
    if (!server.listening)
      await new Promise((ok, bad) => {
        server.once("error", bad);
        server.listen(0, "127.0.0.1", () => { server.off("error", bad); ok(); });
      });
    const origin = "http://127.0.0.1:" + server.address().port;
    const call = async (method, path, body, extra = {}) => {
      const response = await fetch(origin + path, {method, redirect: "error",
        headers: {...(body ? {"content-type": "application/json"} : {}),
          ...(method === "POST" ? {origin} : {}), ...extra},
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(60_000)});
      const data = await response.json().catch(() => ({}));
      return {response, data};
    };
    const login = await call("POST", "/api/login", {password});
    if (login.response.status === 401) throw Error("Password non corretta");
    if (!login.response.ok) throw Error(login.data.error ?? "Accesso alla firma non riuscito");
    const cookie = String(login.response.headers.get("set-cookie") ?? "").split(";")[0];
    const review = await call("GET", "/api/authorization", undefined, {cookie});
    if (!review.response.ok) throw Error(review.data.error ?? "Proposta non più valida");
    const digest = review.data.proposal_digest;
    const approved = await call("POST", "/api/approve", {proposal_digest: digest,
      approved_permission_ids: permissionIds, confirmation: "APPROVE " + digest},
      {cookie, "x-csrf-token": review.data.csrf_token});
    if (approved.response.status !== 201)
      throw Error(approved.response.status === 500
        ? "Il server di approvazione ha rifiutato la firma (proposta scaduta o non più valida): rifai il Planning"
        : approved.data.error ?? "Firma non riuscita");
    return approved.data;
  }

  /** Stop: retires the live Root (preliminary or operational) and the Gateway. */
  async stop(id) {
    const {session, live} = this.#requireLive(id, ["awaiting_review", "executing"]);
    live.stopRequested = true;
    const previous = session.phase;
    session.phase = "stopping"; this.#save(session);
    try {
      await this.#shutdown(id);
      session.phase = "stopped";
      this.#log(session, previous !== "awaiting_review"
        ? "Sessione chiusa: Root operativa revocata, agenti fermati"
        : "Proposta rifiutata: Root preliminare revocata, nessuna Root operativa emessa");
    } catch (error) {
      session.phase = "failed";
      session.error = "Revoca non confermata, serve una verifica manuale: " + (error?.message ?? error);
      this.#log(session, "Errore: " + session.error);
      throw Error(session.error);
    }
    return session;
  }

  async #shutdown(id) {
    const live = this.#live.get(id);
    if (!live) return;
    this.#live.delete(id);
    clearInterval(live.auditTimer);
    try { live.gemini?.cancel(); } catch { /* already fenced */ }
    try { await (live.handoff ?? live.host).close(); }
    finally { await new Promise(ok => live.gatewayServer.close(() => ok())); }
  }

  #log(session, text) {
    session.log.push({at: new Date().toISOString(), text});
    this.#save(session);
  }

  /** Start Planning for a saved requirement. Returns immediately. */
  start({request, mode, geminiConsent, username, userRecord}) {
    if (!this.#core.engineer?.ok || !this.#core.verifierInstance || !this.#core.credentials)
      throw Error("Il core Rust dell'Engineer o il verificatore del Gateway non sono pronti");
    if (!FREE_MODES.has(mode) && mode !== "gemini") throw Error("Modalità di Planning non valida");
    if (mode === "reference" && (request.repository.name !== "iam-console-poc" ||
        request.base_sha !== ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT))
      throw Error("La soluzione di riferimento esiste solo per iam-console-poc al commit di base " +
        ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT.slice(0, 8));
    if (mode === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw Error("GEMINI_API_KEY non configurata nel file .env");
      if (geminiConsent !== true)
        throw Error("Per usare Gemini serve il consenso esplicito ai costi");
    }
    const id = "s-" + randomBytes(6).toString("hex");
    mkdirSync(this.#path(id), {recursive: true, mode: 0o700});
    this.#owned.add(id);
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
    // 0. Paid mode: free, read-only check of key and model before anything starts.
    if (session.mode === "gemini") {
      this.#log(session, `Controllo gratuito di chiave e modello Gemini (${geminiModelName()})...`);
      await preflightGemini({apiKey: process.env.GEMINI_API_KEY, model: geminiModelName()});
      this.#log(session, "Chiave e modello Gemini accettati da Google");
    }
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
    // Paid-call records must go to the CURRENT in-memory session object: the
    // Execution phase works on a fresh copy loaded at approval time.
    const sessionRef = {current: session};
    let gemini;
    if (session.mode === "gemini") {
      gemini = await createSessionGeminiModels({apiKey: process.env.GEMINI_API_KEY,
        model: geminiModelName(), record: entry => this.#recordModelCall(sessionRef.current, entry)});
      model = gemini.planning();
      this.#log(session, `Planner: Gemini (${geminiModelName()}), con limiti di chiamate e token per sessione`);
    } else if (session.mode === "reference") {
      model = new ScriptedPlannerModel({snapshotFiles: tree.files, requirement: session.requirement,
        referencePaths: Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES)});
      this.#log(session, "Planner: SOLUZIONE DI RIFERIMENTO (nessuna IA, nessun costo)");
    } else {
      model = new ScriptedPlannerModel({snapshotFiles: tree.files, requirement: session.requirement});
      this.#log(session, "Planner: SIMULATO (nessuna IA, nessun costo)");
    }

    const roleDid = role => local[`ROLE_DID_${role}`];
    const statusIndex = () => String(this.#nextStatus++);
    const now = Date.now();
    const preliminaryRoot = {
      credential_id: `urn:delegation:${session.id}:preliminary`,
      // Canonical maximum: it must outlive Planning plus the review window.
      valid_from: isoSeconds(now), validity_seconds: MAX_PRELIMINARY_ROOT_SECONDS,
      credential_status: {type: "BitstringStatusListEntry", statusPurpose: "revocation",
        statusListIndex: statusIndex(), statusListCredential: STATUS_LIST}
    };
    session.operational_status_index = statusIndex();
    this.#log(session, "Emissione della Root preliminare di sola lettura...");

    const operationalSessionStore = new TrustedOperationalSessionStore(dirs["op-sessions"]);
    const trustedAgentRegistry = {
      backend: {did: roleDid("BACKEND"), card_ref: "trusted:backend",
        capabilities: ["read_file", "update_file", "create_file"]},
      frontend: {did: roleDid("FRONTEND"), card_ref: "trusted:frontend",
        capabilities: ["read_file", "update_file", "create_file"]},
      test: {did: roleDid("TEST"), card_ref: "trusted:test",
        capabilities: ["read_file", "update_file", "create_file", "run_tests"]},
      orchestrator: {did: roleDid("ORCHESTRATOR"), card_ref: "trusted:orchestrator",
        capabilities: ["create_branch", "create_pull_request"]}
    };
    let host;
    try {
    host = await createTrustedAuthorityOnlyReviewHost({
      snapshot, requirement: session.requirement, workBranch: session.work_branch, preliminaryRoot,
      checkpoint: {store: checkpointStore, backendKeyId: "owner", lifetimeMs: PROPOSAL_REVIEW_MS,
        backendPrivateKeyPem: checkpointKey.privateKey.export({format: "pem", type: "pkcs8"}).toString()},
      activationJournal: new DurableAuthorityOnlyActivationJournal(dirs.activation),
      taskJournal: new DurableAuthorityTaskJournal(dirs.tasks),
      operationalRecoveryStore: new TrustedOperationalRecoveryStore(dirs.recovery),
      operationalSessionStore,
      approval: {engineerDid: roleDid("ENGINEER"), keyId: "engineer-console",
        publicKeyPem: engineerPublicPem, privateKeyFile: engineerKeyFile,
        receiptDirectory: dirs.approvals,
        passwordSaltHex: userRecord.salt, passwordScryptHex: userRecord.hash},
      planner: session.mode === "gemini"
        ? {model, planId: session.id, maxModelTurns: 24, maxProposalRevisions: 1,
           thinkingLevel: "LOW", maxModelCallMs: 180000, maxOutputTokens: 12288, maxPlanningMs: 600000}
        : {model, planId: session.id, maxModelTurns: 3, maxProposalRevisions: 0},
      trustedAgentRegistry,
      credentials: this.#core.credentials,
      planningRevisions: revisions,
      gateway: {gatewayBaseUrl, adapterToken: local.ADAPTER_CALLER_ORCHESTRATOR,
        fetchFn: fetch, timeoutMs: 60000}
    });
    } catch (error) {
      // The host retires its own preliminary Root on failure; close the Gateway.
      await new Promise(ok => gatewayServer.close(() => ok()));
      throw error;
    }

    const checkpoint = await checkpointStore.load();
    session.proposal = {
      // Same IDs as the canonical approval server: permission-<n> in order.
      permissions: checkpoint.proposal.requested_permissions
        .map((p, i) => ({id: "permission-" + (i + 1), ...p})),
      assumptions: checkpoint.assumptions ?? [], uncertainties: checkpoint.uncertainties ?? [],
      verified_source_reads: checkpoint.verified_source_reads ?? null,
      // After this instant the signed proposal can no longer be approved.
      expires_at: checkpoint.expires_at
    };
    session.phase = "awaiting_review";
    this.#live.set(session.id, {host, gatewayServer, gatewayBaseUrl, revisions, checkpointStore,
      snapshot, dirs, preliminaryRoot, operationalSessionStore, trustedAgentRegistry, gemini, sessionRef,
      engineerKeyFile, engineerPublicPem});
    this.#log(session, `Proposta pronta: ${session.proposal.permissions.length} permessi da rivedere`);
    if (gemini) {
      const g = gemini.summary();
      this.#log(session, `Gemini nel Planning: ${g.calls_started} chiamate, ${g.reported_total_tokens} token riportati`);
    }
  }
}

export {SESSION_ID};
