import assert from "node:assert/strict";
import { TaskState } from "@a2a-js/sdk";
import {
  DeterministicA2AOrchestrator,
  IncompatibleAgentError,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";

const roles = [
  { role: "backend", port: 43211 },
  { role: "frontend", port: 43212 },
  { role: "test", port: 43213 }
];

const servers = [];
const orchestrator = new DeterministicA2AOrchestrator();

try {
  for (const entry of roles) {
    const server = await startSpecializedAgentServer(entry);
    servers.push(server);

    const credential = JSON.stringify({
      id: `urn:thesis:dc:phase7-${entry.role}`,
      type: ["VerifiableCredential", "DelegationCredential"],
      subject: `did:thesis:${entry.role}-agent`
    });

    const result = await orchestrator.sendProtectedTask({
      agent_base_url: server.baseUrl,
      subtask: {
        subtask_id: `phase7-${entry.role}`,
        instruction: `Deterministically validate the ${entry.role} A2A role.`,
        branch: "feature/account-suspension",
        relevant_paths: []
      },
      delegation_evidence: {
        credential,
        credential_id: `urn:thesis:dc:phase7-${entry.role}`,
        presenter_id:
          entry.role === "test"
            ? "did:thesis:test-agent"
            : `did:thesis:${entry.role}-agent`
      }
    });

    assert.equal(result.task.status?.state, TaskState.TASK_STATE_COMPLETED);
    assert.equal(result.task.artifacts.length, 1);
    assert.equal(result.task.history.length, 0);
    assert.equal(server.executor.executionCount, 1);

    const context = server.executor.taskContexts.get(result.task.id);
    assert.ok(context);
    assert.equal(context.role, entry.role);
    assert.equal(context.delegation_evidence.credential, credential);

    const artifactJson = JSON.stringify(result.task.artifacts);
    assert.equal(artifactJson.includes(credential), false);
    assert.equal(artifactJson.includes("delegation_evidence"), false);
  }

  const incompatible = await startSpecializedAgentServer({
    role: "backend",
    port: 43214,
    delegatedAuthorization: false
  });
  servers.push(incompatible);

  await assert.rejects(
    () =>
      orchestrator.sendProtectedTask({
        agent_base_url: incompatible.baseUrl,
        subtask: {
          subtask_id: "phase7-incompatible-card",
          instruction: "Protected task must be rejected before SendMessage.",
          branch: "feature/account-suspension",
          relevant_paths: []
        },
        delegation_evidence: {
          credential: "{}",
          credential_id: "urn:thesis:dc:phase7-incompatible",
          presenter_id: "did:thesis:backend-agent"
        }
      }),
    IncompatibleAgentError
  );
  assert.equal(incompatible.executor.executionCount, 0);

  process.stdout.write(
    JSON.stringify(
      {
        result: "phase7-a2a-smoke-pass",
        roles: roles.map((entry) => entry.role),
        flow: ["discovery", "Message", "Task", "Artifact"],
        incompatible_agent_rejected_before_execution: true
      },
      null,
      2
    ) + "\n"
  );
} finally {
  for (const server of servers.reverse()) {
    await server.close().catch(() => undefined);
  }
}
