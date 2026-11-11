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

const SLASH = /^gitea:\/\/[^/]+\/[^/]+\/[^/]+\/branches\/[^/]+\/files\/(.+)$/u;

/** Path of a file ResourceURI, or undefined for branch/repository scopes. */
export function permissionPath(resource) {
  const m = SLASH.exec(resource ?? "");
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : undefined;
}

/** Fixed role routing for the simulated run (the Engineer sees it in the UI). */
export function roleForPath(path) {
  if (/^(tests?|e2e|spec)\//u.test(path) || /\.(test|spec)\.[a-z]+$/u.test(path)) return "test";
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
    if (!path || !["read_file", "update_file"].includes(p.operation)) continue;
    const entry = byPath.get(path) ?? {};
    entry[p.operation] = p;
    byPath.set(path, entry);
  }
  const tasks = [];
  for (const [path, entry] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) {
    if (!entry.read_file || !entry.update_file) continue;
    const role = roleForPath(path);
    tasks.push({task_id: `t${String(tasks.length + 1).padStart(2, "0")}-${role}`, agent_id: role,
      path, permissions: [pick(entry.read_file), pick(entry.update_file)],
      instruction: `Leggi ${path} e aggiungi il commento SIMULATO della sessione ${sessionId}`});
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

class Scripted extends BaseLlm {
  calls = 0;
  connect() { throw Error("Scripted model has no live connection"); }
}

/** One Task per assigned file: read_file -> update_file -> short report. */
export class ScriptedWorkerModel extends Scripted {
  #branch; #queue; #sessionId; #turn = 0;
  constructor({role, branch, files, sessionId}) {
    super({model: `scripted-${role}-no-ai`});
    this.#branch = branch; this.#queue = [...files]; this.#sessionId = sessionId;
  }
  async *generateContentAsync(request) {
    this.calls++;
    const path = this.#queue[0];
    if (!path) { yield say("Nessun file assegnato a questo ruolo."); return; }
    const turn = ++this.#turn;
    if (turn === 1) { yield call(`read-${this.calls}`, "read_file", {branch: this.#branch, path}); return; }
    if (turn === 2) {
      const previous = lastReadContent(request);
      if (typeof previous !== "string") throw Error("Scripted worker: read result not found for " + path);
      const content = previous + (previous.endsWith("\n") || !previous ? "" : "\n") +
        simulatedMarker(path, this.#sessionId) + "\n";
      yield call(`update-${this.calls}`, "update_file", {branch: this.#branch, path, content});
      return;
    }
    this.#queue.shift(); this.#turn = 0;
    yield say(`Aggiornato ${path} (modifica SIMULATA).`);
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
    if (!this.#plan.runsTests)
      yield say(JSON.stringify({action: "blocked",
        reason: "I test non sono stati autorizzati: senza un esito PASS del Runner non si crea la Draft PR"}));
    else if (/independent_runner_failure/u.test(context))
      yield say(JSON.stringify({action: "blocked",
        reason: "Il Runner ha riportato un FAIL verificato: esecuzione simulata, nessuna correzione automatica"}));
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
