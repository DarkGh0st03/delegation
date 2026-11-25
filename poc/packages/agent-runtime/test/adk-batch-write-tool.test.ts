/** Phase W (W3): the write_files model tool (one VP and one commit for all signed writes). */
import assert from "node:assert/strict";
import test from "node:test";
import {BaseLlm, InMemorySessionService, Runner,
  type BaseLlmConnection, type LlmRequest, type LlmResponse} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";

const BRANCH = "feature/session-work";
const A = "apps/backend/src/a.ts", B = "apps/backend/src/b.ts", N = "apps/backend/src/n.ts";
const hints = {
  trustedBranch: BRANCH, trustedTaskPaths: [A, B, N],
  trustedFilePermissions: [
    {operation: "read_file" as const, path: A}, {operation: "read_file" as const, path: B},
    {operation: "update_file" as const, path: A}, {operation: "update_file" as const, path: B},
    {operation: "create_file" as const, path: N}
  ]
};
const full = [{path: A, operation: "update_file", content: "a2"}, {path: B, operation: "update_file", content: "b2"},
  {path: N, operation: "create_file", content: "n"}];

class Calls extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  readonly calls: {name: string; args: Record<string, unknown>}[];
  constructor(calls: {name: string; args: Record<string, unknown>}[]) { super({model: "phase-w-scripted"}); this.calls = calls; }
  override async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    const c = this.calls[this.requests.length - 1];
    if (c) yield {content: {role: "model", parts: [{functionCall: {id: "c" + this.requests.length, name: c.name, args: c.args}}]}};
    else yield {content: {role: "model", parts: [{text: "done"}]}};
  }
  override async connect(_r: LlmRequest): Promise<BaseLlmConnection> { throw Error("no live"); }
}
function client(supportsBatchWrites: boolean, writeCalls: unknown[][]) {
  return {
    supportsBatchReads: false, supportsBatchWrites,
    invoke: async () => ({provider: "gitea"}),
    writeFiles: async (branch: string, changes: {path: string; operation: string}[]) => {
      writeCalls.push([branch, changes.map(c => [c.path, c.operation])]);
      return {commit_sha: "c".repeat(40), files: changes.map(c => ({path: c.path, operation: c.operation}))};
    }
  };
}
async function run(opts: {batchWrites: boolean; supports: boolean; calls: {name: string; args: Record<string, unknown>}[]}) {
  const writeCalls: unknown[][] = [];
  const outcomes: {name: string; arguments: Record<string, unknown>; payload: {ok: boolean}}[] = [];
  const model = new Calls(opts.calls);
  const built = createAdkSpecializedAgent({role: "backend", model,
    gatewayClient: client(opts.supports, writeCalls) as never, ...hints,
    ...(opts.batchWrites ? {batchWrites: true} : {}),
    onToolOutcome: e => outcomes.push(e as never)});
  const sessionService = new InMemorySessionService();
  const runner = new Runner({appName: "phase_w", agent: built.agent, sessionService});
  await sessionService.createSession({appName: "phase_w", userId: "u", sessionId: "s"});
  for await (const _ of runner.runAsync({userId: "u", sessionId: "s",
    newMessage: {role: "user", parts: [{text: "do the task"}]}})) { /* drain */ }
  const tools = Object.keys(model.requests[0]?.toolsDict ?? {});
  return {writeCalls, outcomes, tools, instruction: String(built.profile.system_prompt)};
}

test("write_files: offered only in a write-set Task, hides update/create, ONE call with the exact signed set", async () => {
  const r = await run({batchWrites: true, supports: true,
    calls: [{name: "write_files", args: {branch: BRANCH, changes: full}}]});
  assert.ok(r.tools.includes("write_files"));
  assert.equal(r.tools.includes("update_file"), false);
  assert.equal(r.tools.includes("create_file"), false);
  assert.match(r.instruction, /write_files exactly ONCE with ALL the approved writes/u);
  assert.deepEqual(r.writeCalls, [[BRANCH, [[A, "update_file"], [B, "update_file"], [N, "create_file"]]]]);
  // One outcome per file, as the single-write path.
  assert.deepEqual(r.outcomes.map(o => [o.name, o.arguments.path, o.payload.ok]),
    [["update_file", A, true], ["update_file", B, true], ["create_file", N, true]]);
});

test("write_files: a partial set, a wrong operation or a second call is refused before the Gateway", async () => {
  for (const changes of [full.slice(0, 2), [{...full[0], operation: "create_file"}, full[1], full[2]]]) {
    const r = await run({batchWrites: true, supports: true, calls: [{name: "write_files", args: {branch: BRANCH, changes}}]});
    assert.deepEqual(r.writeCalls, []);
    assert.ok(r.outcomes.length > 0 && r.outcomes.every(o => !o.payload.ok));
  }
  const twice = await run({batchWrites: true, supports: true, calls: [
    {name: "write_files", args: {branch: BRANCH, changes: full}},
    {name: "write_files", args: {branch: BRANCH, changes: full}}]});
  assert.equal(twice.writeCalls.length, 1);
});

test("write_files absent without the option or without an owner write-set stager (baseline tools)", async () => {
  for (const [batchWrites, supports] of [[false, true], [true, false]] as const) {
    const r = await run({batchWrites, supports, calls: []});
    assert.equal(r.tools.includes("write_files"), false);
    assert.ok(r.tools.includes("update_file") && r.tools.includes("create_file"));
  }
});
