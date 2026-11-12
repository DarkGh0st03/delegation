/**
 * FREE, deterministic stand-ins for the Execution models (no AI, no provider).
 *
 * They drive the REAL operational chain: Orchestrator Tasks, one signed Child
 * DC per Task, VPs verified by the Rust core, OPA, read -> CAS update on Gitea,
 * Docker Runner and Draft PR. They do NOT implement the requirement: each
 * worker appends one comment marked SIMULATED to the file it was assigned, so
 * that a real, reviewable diff goes through every authorization step.
 *
 * Models are untrusted input for the owner: the review host re-checks every
 * Task against the Engineer-signed grant whatever these models answer.
 */
import {BaseLlm} from "@google/adk";
import {isProjectTestSource} from "../../packages/plan-contracts/src/gitea-permission-containment.mjs";

const SLASH = /^gitea:\/\/[^/]+\/[^/]+\/[^/]+\/branches\/[^/]+\/files\/(.+)$/u;

/** Path of a file ResourceURI, or undefined for branch/repository scopes. */
export function permissionPath(resource) {
  const m = SLASH.exec(resource ?? "");
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : undefined;
}

/**
 * Fixed role routing for the free modes. The Test role may edit only the
 * project test sources of the canonical profile (same function the owner
 * uses to admit Tasks); other test-like files (e.g. e2e specs) belong to a
 * file specialist.
 */
export function roleForPath(path) {
  if (isProjectTestSource(path)) return "test";
  if (/^(tests?|e2e)\//u.test(path) || /\.spec\.[a-z]+$/u.test(path)) return "frontend";
  if (/(^|\/)(frontend|client|web|ui)\//u.test(path) || /\.(tsx|jsx|vue|svelte|css|scss|html)$/u.test(path))
    return "frontend";
  return "backend";
}

export function simulatedMarker(path, sessionId) {
  const text = `[delegation ${sessionId}] Modifica SIMULATA: nessuna IA, il requisito non è implementato.`;
  if (/\.(css|scss)$/u.test(path)) return `/* ${text} */`;
  if (/\.(html|vue|svelte|md)$/u.test(path)) return `<!-- ${text} -->`;
  if (/\.(py|rb|sh|ya?ml|toml)$/u.test(path)) return `# ${text}`;
  return `// ${text}`;
}

/**
 * Pure plan from the APPROVED permissions only: one Task per file that has
 * both read_file and update_file, then one Test Task if run_tests is granted.
 */
export function simulatedExecutionPlan(approved, sessionId) {
  const byPath = new Map();
  let runTests, branch, pullRequest;
  for (const p of approved) {
    if (p.operation === "run_tests") runTests = p;
    else if (p.operation === "create_branch") branch = p;
    else if (p.operation === "create_pull_request") pullRequest = p;
    const path = permissionPath(p.resource);
    if (!path || !["read_file", "update_file", "create_file"].includes(p.operation)) continue;
    const entry = byPath.get(path) ?? {};
    entry[p.operation] = p;
    byPath.set(path, entry);
  }
  const tasks = [];
  for (const [path, entry] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) {
    const role = roleForPath(path);
    const id = `t${String(tasks.length + 1).padStart(2, "0")}-${role}`;
    if (entry.create_file)
      tasks.push({task_id: id, agent_id: role, path, op: "create",
        permissions: [pick(entry.create_file)], instruction: `Crea ${path}`});
    else if (entry.read_file && entry.update_file)
      tasks.push({task_id: id, agent_id: role, path, op: "update",
        permissions: [pick(entry.read_file), pick(entry.update_file)],
        instruction: `Leggi e aggiorna ${path} (sessione ${sessionId})`});
  }
  if (runTests) tasks.push({task_id: "t99-test", agent_id: "test",
    permissions: [pick(runTests)], instruction: "Esegui i test del progetto sul commit attuale del branch"});
  return {tasks, branch: branch && pick(branch), pullRequest: pullRequest && pick(pullRequest),
    runsTests: !!runTests};
}
const pick = p => ({resource: p.resource, operation: p.operation});

const say = text => ({content: {role: "model", parts: [{text}]}});
const call = (id, name, args) => ({content: {role: "model", parts: [{functionCall: {id, name, args}}]}});

/** Last read_file tool result content in an ADK request. */
export function lastReadContent(request) {
  const found = [];
  const walk = (value, depth) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (value.functionResponse && typeof value.functionResponse === "object") {
      const hit = findContent(value.functionResponse.response, 0);
      if (typeof hit === "string") found.push(hit);
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(request?.contents ?? request, 0);
  return found.at(-1);
}
function findContent(value, depth) {
  if (depth > 6 || !value || typeof value !== "object") return undefined;
  if (typeof value.content === "string") return value.content;
  for (const child of Object.values(value)) {
    const hit = typeof child === "string" && child.trim().startsWith("{")
      ? (() => { try { return findContent(JSON.parse(child), depth + 1); } catch { return undefined; } })()
      : findContent(child, depth + 1);
    if (typeof hit === "string") return hit;
  }
  return undefined;
}

/** Task IDs the owner reports as independently Gateway-completed. */
export function completedTaskIds(request) {
  const ids = new Set();
  const walk = (value, depth) => {
    if (depth > 10 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.length < 500000 && value.trim().startsWith("{"))
        try { walk(JSON.parse(value), depth + 1); } catch { /* plain text */ }
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value.independently_gateway_completed_tasks))
      for (const row of value.independently_gateway_completed_tasks)
        if (typeof row?.task_id === "string") ids.add(row.task_id);
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(request, 0);
  return ids;
}

class Scripted extends BaseLlm {
  calls = 0;
  connect() { throw Error("Scripted model has no live connection"); }
}

/** One Task per assigned file: read_file -> update_file -> short report. */
/**
 * One Task per assigned file. Update: read_file -> update_file -> report.
 * Create: create_file -> report. Content is the simulated marker appended to
 * what the Gateway returned, or the fixed REFERENCE content when given.
 */
export class ScriptedWorkerModel extends Scripted {
  #branch; #queue; #sessionId; #contents; #turn = 0;
  constructor({role, branch, files, sessionId, contents}) {
    super({model: contents ? `reference-${role}-no-ai` : `scripted-${role}-no-ai`});
    this.#branch = branch; this.#sessionId = sessionId; this.#contents = contents;
    this.#queue = files.map(f => typeof f === "string" ? {path: f, op: "update"} : f);
  }
  #content(path, previous) {
    if (this.#contents) {
      if (typeof this.#contents[path] !== "string") throw Error("No reference content for " + path);
      return this.#contents[path];
    }
    return previous + (previous.endsWith("\n") || !previous ? "" : "\n") +
      simulatedMarker(path, this.#sessionId) + "\n";
  }
  async *generateContentAsync(request) {
    this.calls++;
    const item = this.#queue[0];
    if (!item) { yield say("Nessun file assegnato a questo ruolo."); return; }
    const {path, op} = item, turn = ++this.#turn;
    const label = this.#contents ? "soluzione di RIFERIMENTO" : "modifica SIMULATA";
    if (op === "create") {
      if (turn === 1) {
        yield call(`create-${this.calls}`, "create_file",
          {branch: this.#branch, path, content: this.#content(path, "")});
        return;
      }
      this.#queue.shift(); this.#turn = 0;
      yield say(`Creato ${path} (${label}).`);
      return;
    }
    if (turn === 1) { yield call(`read-${this.calls}`, "read_file", {branch: this.#branch, path}); return; }
    if (turn === 2) {
      const previous = lastReadContent(request);
      if (typeof previous !== "string") throw Error("Scripted worker: read result not found for " + path);
      yield call(`update-${this.calls}`, "update_file", {branch: this.#branch, path, content: this.#content(path, previous)});
      return;
    }
    this.#queue.shift(); this.#turn = 0;
    yield say(`Aggiornato ${path} (${label}).`);
  }
}

/** run_tests on the work branch, then a short report. */
export class ScriptedTestModel extends Scripted {
  #branch; #turn = 0; #files;
  constructor({branch, worker}) {
    super({model: "scripted-test-no-ai"});
    this.#branch = branch; this.#files = worker;
  }
  async *generateContentAsync(request) {
    this.calls++;
    // Test files assigned to the Test role are edited first, like any worker.
    if (this.#files.pending) { yield* this.#files.generateContentAsync(request); return; }
    const turn = ++this.#turn;
    if (turn === 1) { yield call(`tests-${this.calls}`, "run_tests", {branch: this.#branch, profile: "poc-default"}); return; }
    this.#turn = 0;
    yield say("Risultato dei test ricevuto dal Runner.");
  }
}

/** Worker for the Test role that knows when its file queue is empty. */
export class ScriptedTestFileWorker extends ScriptedWorkerModel {
  #remaining;
  constructor(options) { super(options); this.#remaining = options.files.length; }
  get pending() { return this.#remaining > 0; }
  async *generateContentAsync(request) {
    for await (const event of super.generateContentAsync(request)) {
      if (event.content?.parts?.[0]?.text) this.#remaining--;
      yield event;
    }
  }
}

/** Orchestrator decisions: delegate the planned Tasks in order, then stop. */
export class ScriptedDecisionModel extends Scripted {
  #plan; #branchTaskId; #index = 0;
  constructor({plan, branchTaskId}) {
    super({model: "scripted-orchestrator-no-ai"});
    this.#plan = plan; this.#branchTaskId = branchTaskId;
  }
  async *generateContentAsync(request) {
    this.calls++;
    const tasks = this.#plan.tasks;
    if (this.#index < tasks.length) {
      const task = tasks[this.#index];
      const previous = this.#index ? tasks[this.#index - 1].task_id : this.#branchTaskId;
      this.#index++;
      yield say(JSON.stringify({action: "delegate", task: {task_id: task.task_id,
        agent_id: task.agent_id, depends_on: [previous], permissions: task.permissions,
        instruction: task.instruction}}));
      return;
    }
    const context = JSON.stringify(request);
    const completed = completedTaskIds(request);
    if (!this.#plan.runsTests)
      yield say(JSON.stringify({action: "blocked",
        reason: "I test non sono stati autorizzati: senza un esito PASS del Runner non si crea la Draft PR"}));
    else if (/independent_runner_failure/u.test(context))
      yield say(JSON.stringify({action: "blocked",
        reason: "Il Runner ha riportato un FAIL verificato: esecuzione simulata, nessuna correzione automatica"}));
    else if (!completed.has("t99-test"))
      yield say(JSON.stringify({action: "blocked",
        reason: "Il Runner non ha restituito un esito di test verificabile: nessuna Draft PR"}));
    else
      yield say(JSON.stringify({action: "ready_for_pr",
        reason: "Test PASS verificato dal Runner sul commit finale del branch"}));
  }
}

/** One-shot Task proposal for the Orchestrator's own root effects. */
export class ScriptedRootTaskModel extends Scripted {
  #task;
  constructor(task) { super({model: "scripted-root-task-no-ai"}); this.#task = task; }
  async *generateContentAsync() {
    this.calls++;
    yield say(JSON.stringify(this.#task));
  }
}
