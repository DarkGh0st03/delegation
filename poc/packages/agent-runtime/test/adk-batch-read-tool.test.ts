/** Phase R: the read_files model tool (one VP for all signed reads). */
import assert from "node:assert/strict";
import test from "node:test";
import {BaseLlm, InMemorySessionService, Runner,
  type BaseLlmConnection, type LlmRequest, type LlmResponse} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";

const BRANCH = "feature/session-work";
const EDIT = "apps/backend/src/users/user.service.ts";
const CTX = "apps/backend/src/users/user.types.ts";
const hints = {
  trustedBranch: BRANCH, trustedTaskPaths: [CTX, EDIT],
  trustedFilePermissions: [
    {operation: "read_file" as const, path: CTX},
    {operation: "read_file" as const, path: EDIT},
    {operation: "update_file" as const, path: EDIT}
  ]
};

class OneCall extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  readonly tool: string; readonly args: Record<string, unknown>;
  constructor(tool: string, args: Record<string, unknown>) {
    super({model: "phase-r-scripted"}); this.tool = tool; this.args = args;
  }
  override async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    if (this.requests.length <= 2)
      yield {content: {role: "model", parts: [{functionCall: {id: "c" + this.requests.length,
        name: this.tool, args: this.args}}]}};
    else yield {content: {role: "model", parts: [{text: "done"}]}};
  }
  override async connect(_r: LlmRequest): Promise<BaseLlmConnection> { throw Error("no live"); }
}

function client(supportsBatchReads: boolean, batchCalls: unknown[][]) {
  return {
    supportsBatchReads,
    invoke: async () => ({provider: "gitea"}),
    readFiles: async (branch: string, paths: readonly string[]) => {
      batchCalls.push([branch, [...paths]]);
      return {files: paths.map(path => ({provider: "gitea", performed: true, tool: "read_file",
        branch, path, revision: "a".repeat(40), content: "src " + path}))};
    }
  };
}

async function run(batchReads: boolean, supportsBatchReads: boolean, tool = "read_files") {
  const batchCalls: unknown[][] = [];
  const outcomes: {name: string; arguments: Record<string, unknown>}[] = [];
  const model = new OneCall(tool, {branch: BRANCH});
  const built = createAdkSpecializedAgent({role: "backend", model,
    gatewayClient: client(supportsBatchReads, batchCalls) as never, ...hints,
    ...(batchReads ? {batchReads: true} : {}),
    onToolOutcome: e => outcomes.push(e)});
  const sessionService = new InMemorySessionService();
  const runner = new Runner({appName: "phase_r", agent: built.agent, sessionService});
  await sessionService.createSession({appName: "phase_r", userId: "u", sessionId: "s"});
  for await (const _ of runner.runAsync({userId: "u", sessionId: "s",
    newMessage: {role: "user", parts: [{text: "do the task"}]}})) { /* drain */ }
  return {built, batchCalls, outcomes};
}

test("with batchReads the model gets read_files instead of read_file, reading exactly the signed paths", async () => {
  const {built, batchCalls, outcomes} = await run(true, true);
  assert.deepEqual(built.agent.tools.map(t => t.name), ["update_file", "read_files"]);
  assert.match(built.profile.system_prompt, /Call read_files exactly ONCE/u);
  // Called once despite the model trying twice; paths come from the signed Task.
  assert.deepEqual(batchCalls, [[BRANCH, [CTX, EDIT]]]);
  // One read_file outcome per file, then the refused repeat.
  assert.deepEqual(outcomes.slice(0, 2).map(o => o.arguments.path), [CTX, EDIT]);
  assert.equal(outcomes.length, 3);
});

test("without batchReads (baseline) only read_file is offered", async () => {
  const {built, batchCalls} = await run(false, true, "read_file");
  assert.deepEqual(built.agent.tools.map(t => t.name), ["read_file", "update_file"]);
  assert.equal(batchCalls.length, 0);
});

test("batchReads is ignored when the Task is not an owner-staged reads+write Task", async () => {
  const {built} = await run(true, false, "read_file");
  assert.deepEqual(built.agent.tools.map(t => t.name), ["read_file", "update_file"]);
});
