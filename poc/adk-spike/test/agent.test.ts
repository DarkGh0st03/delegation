import assert from "node:assert/strict";
import test from "node:test";

import { BaseLlm, InMemorySessionService, LlmAgent, Runner } from "@google/adk";
import type { BaseLlmConnection, LlmRequest, LlmResponse } from "@google/adk";
import { rootAgent } from "../agent.ts";

test("Phase 1 ADK agent is constructed with no privileged tools", () => {
  assert.ok(rootAgent instanceof LlmAgent);
  assert.equal(rootAgent.name, "thesis_adk_spike");
  assert.deepEqual(rootAgent.tools, []);
});

test("Phase 1 ADK Runner can create an isolated in-memory session without any API key", async () => {
  const appName = "thesis_adk_phase1";
  const userId = "phase1_smoke_user";
  const sessionId = "phase1_smoke_session";
  const sessionService = new InMemorySessionService();
  const runner = new Runner({ agent: rootAgent, appName, sessionService });

  assert.ok(runner);
  const session = await sessionService.createSession({ appName, userId, sessionId });
  assert.equal(session.id, sessionId);
  assert.equal(session.userId, userId);
  assert.equal(session.appName, appName);
});

class FixedResponseLlm extends BaseLlm {
  constructor() {
    super({ model: "phase1-deterministic-llm" });
  }

  override async *generateContentAsync(
    _request: LlmRequest
  ): AsyncGenerator<LlmResponse, void> {
    yield { content: { role: "model", parts: [{ text: "PHASE1_ADK_TURN_OK" }] } };
  }

  override async connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("Live streaming is not supported by the deterministic Phase 1 stub");
  }
}

test("Phase 1 executes a complete ADK model turn without keys or network calls", async () => {
  const appName = "thesis_adk_phase1_turn";
  const userId = "phase1_turn_user";
  const sessionId = "phase1_turn_session";
  const sessionService = new InMemorySessionService();
  const agent = new LlmAgent({
    name: "thesis_deterministic_turn",
    description: "Keyless ADK Runner integration test.",
    model: new FixedResponseLlm(),
    instruction: "Return the deterministic response.",
    tools: []
  });
  const runner = new Runner({ agent, appName, sessionService });
  await sessionService.createSession({ appName, userId, sessionId });

  const observed: string[] = [];
  for await (const event of runner.runAsync({
    userId,
    sessionId,
    newMessage: { role: "user", parts: [{ text: "Hello, ADK" }] }
  })) {
    for (const part of event.content?.parts ?? []) {
      if (typeof part.text === "string") observed.push(part.text);
    }
  }

  assert.ok(observed.includes("PHASE1_ADK_TURN_OK"), JSON.stringify(observed));
});
