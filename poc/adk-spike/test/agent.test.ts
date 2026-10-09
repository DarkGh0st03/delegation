import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySessionService, LlmAgent, Runner } from "@google/adk";
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
