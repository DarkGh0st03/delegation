import assert from "node:assert/strict";
import test from "node:test";
import { TaskState } from "@a2a-js/sdk";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  DeterministicA2AOrchestrator,
  IncompatibleAgentError,
  createSpecializedAgentCard,
  startSpecializedAgentServer
} from "../src/index.ts";

test("specialized Agent Cards expose the frozen A2A 1.0 contract", () => {
  for (const role of ["backend", "frontend", "test"] as const) {
    const card = createSpecializedAgentCard(role, "http://127.0.0.1:9000");

    assert.equal(card.supportedInterfaces.length, 1);
    assert.equal(card.supportedInterfaces[0]?.protocolBinding, "HTTP+JSON");
    assert.equal(card.supportedInterfaces[0]?.protocolVersion, "1.0");
    assert.deepEqual(card.defaultInputModes, ["application/json"]);
    assert.deepEqual(card.defaultOutputModes, ["application/json"]);

    const extension = card.capabilities?.extensions.find(
      (candidate) => candidate.uri === DELEGATED_AUTHORIZATION_EXTENSION_URI
    );
    assert.ok(extension);
    assert.equal(extension.required, true);
  }
});

test("deterministic A2A flow performs discovery -> Message -> Task -> Artifact without leaking authority", async () => {
  const agent = await startSpecializedAgentServer({
    role: "backend",
    port: 43171
  });

  try {
    const orchestrator = new DeterministicA2AOrchestrator();
    const credential = JSON.stringify({
      id: "urn:thesis:dc:phase7-backend",
      type: ["VerifiableCredential", "DelegationCredential"]
    });

    const result = await orchestrator.sendProtectedTask({
      agent_base_url: agent.baseUrl,
      subtask: {
        subtask_id: "phase7-backend-subtask",
        instruction: "Prepare deterministic backend task context.",
        branch: "feature/account-suspension",
        relevant_paths: ["apps/backend/src/users/user.service.ts"]
      },
      delegation_evidence: {
        credential,
        credential_id: "urn:thesis:dc:phase7-backend",
        presenter_id: "did:thesis:backend-agent"
      }
    });

    assert.equal(result.task.status?.state, TaskState.TASK_STATE_COMPLETED);
    assert.equal(result.task.artifacts.length, 1);
    assert.equal(result.task.history.length, 0);
    assert.equal(agent.executor.executionCount, 1);

    const stored = agent.executor.taskContexts.get(result.task.id);
    assert.ok(stored);
    assert.equal(stored.delegation_evidence.credential, credential);

    const artifactJson = JSON.stringify(result.task.artifacts);
    assert.equal(artifactJson.includes(credential), false);
    assert.equal(artifactJson.includes("delegation_evidence"), false);

    const part = result.task.artifacts[0]?.parts[0]?.content;
    assert.equal(part?.$case, "data");
    if (part?.$case === "data") {
      assert.equal(part.value.role, "backend");
      assert.equal(part.value.branch, "feature/account-suspension");
      assert.equal(part.value.test_outcome, "not_run");
    }
  } finally {
    await agent.close();
  }
});

test("orchestrator rejects an Agent Card without delegated-authorization support before task execution", async () => {
  const agent = await startSpecializedAgentServer({
    role: "frontend",
    port: 43172,
    delegatedAuthorization: false
  });

  try {
    const orchestrator = new DeterministicA2AOrchestrator();

    await assert.rejects(
      () =>
        orchestrator.sendProtectedTask({
          agent_base_url: agent.baseUrl,
          subtask: {
            subtask_id: "phase7-incompatible",
            instruction: "This protected task must never execute.",
            branch: "feature/account-suspension",
            relevant_paths: ["apps/frontend/src/pages/UserDetailPage.tsx"]
          },
          delegation_evidence: {
            credential: "{}",
            credential_id: "urn:thesis:dc:incompatible",
            presenter_id: "did:thesis:frontend-agent"
          }
        }),
      IncompatibleAgentError
    );

    assert.equal(agent.executor.executionCount, 0);
  } finally {
    await agent.close();
  }
});
