import assert from "node:assert/strict";
import test from "node:test";
import { TaskState } from "@a2a-js/sdk";
import {
  DelegatedA2ARoleRunner,
  type ChildAuthorityIssuerPort,
  type ProtectedA2AClientPort
} from "../src/index.ts";

const revision = "b".repeat(40);

function credential(role: "backend" | "frontend" | "test") {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "DelegationCredential"],
    id: `urn:phase9b:${role}`,
    issuer: "did:thesis:orchestrator",
    validFrom: "2026-10-05T00:00:00Z",
    credentialSubject: {
      sub: `did:thesis:${role}-agent`,
      per: []
    }
  };
}

function completedTask(
  role: "backend" | "frontend" | "test",
  artifactRevision = revision
) {
  return {
    id: `task-${role}`,
    contextId: "context-1",
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      timestamp: "2026-10-05T00:00:00Z",
      message: undefined
    },
    artifacts: [
      {
        artifactId: `artifact-${role}`,
        name: `${role}-result`,
        description: "",
        parts: [
          {
            content: {
              $case: "data" as const,
              value: {
                role,
                summary: `${role} completed`,
                files_modified: [],
                files_created: [],
                branch: "feature/account-suspension",
                revision: artifactRevision,
                commit_sha: artifactRevision,
                test_outcome: role === "test" ? "pass" : "not_run",
                errors: []
              }
            },
            metadata: undefined,
            filename: "",
            mediaType: "application/json"
          }
        ],
        metadata: undefined,
        extensions: []
      }
    ],
    history: [],
    metadata: undefined
  };
}

test("child authority is issued immediately before the protected Backend A2A task", async () => {
  const events: string[] = [];
  let issuedInput: unknown;
  let a2aRequest: unknown;

  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild(input) {
      events.push("issue");
      issuedInput = structuredClone(input);
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };

  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask(request) {
      events.push("send");
      a2aRequest = structuredClone(request);
      return {
        card: { name: "Backend Development Agent" },
        task: completedTask("backend") as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  const result = await runner.issueAndRun({
    role: "backend",
    parent_credential_id: "urn:phase9b:root",
    credential_id: "urn:phase9b:backend",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9301",
      statusListCredential:
        "https://status.example/lists/phase9b"
    },
    agent_base_url: "http://backend.local",
    subtask: {
      subtask_id: "backend-task",
      instruction: "Validate Backend delegation.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "apps/backend/src/users/user.service.ts"
      ]
    },
    expected_revision: revision
  });

  assert.deepEqual(events, ["issue", "send"]);
  assert.deepEqual(
    (issuedInput as { selection: unknown }).selection,
    { role: "backend" }
  );
  assert.equal(
    (a2aRequest as {
      delegation_evidence: { credential_id: string };
    }).delegation_evidence.credential_id,
    "urn:phase9b:backend"
  );
  assert.match(
    (a2aRequest as {
      delegation_evidence: { credential: string };
    }).delegation_evidence.credential,
    /DelegationCredential/u
  );
  assert.equal(result.artifact.role, "backend");
  assert.equal(result.artifact.revision, revision);
  assert.equal(
    result.remote_agent_name,
    "Backend Development Agent"
  );
});

test("role runner rejects an Artifact for a different revision", async () => {
  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild() {
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };
  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask() {
      return {
        card: { name: "Backend Development Agent" },
        task: completedTask(
          "backend",
          "c".repeat(40)
        ) as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  await assert.rejects(
    () =>
      runner.issueAndRun({
        role: "backend",
        parent_credential_id: "urn:phase9b:root",
        credential_id: "urn:phase9b:backend",
        valid_from: "2026-10-05T00:00:00Z",
        validity_seconds: 1800,
        credential_status: {
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "9301",
          statusListCredential:
            "https://status.example/lists/phase9b"
        },
        agent_base_url: "http://backend.local",
        subtask: {
          subtask_id: "backend-task",
          instruction: "Validate Backend delegation.",
          branch: "feature/account-suspension",
          relevant_paths: []
        },
        expected_revision: revision
      }),
    /does not match expected branch revision/u
  );
});

test("role runner rejects a non-completed A2A Task before accepting its Artifact", async () => {
  const issuer: ChildAuthorityIssuerPort = {
    async issueSpecializedChild() {
      return {
        role: "backend",
        credential: credential("backend")
      };
    }
  };
  const a2a: ProtectedA2AClientPort = {
    async sendProtectedTask() {
      const task = completedTask("backend");
      task.status.state = TaskState.TASK_STATE_FAILED;
      return {
        card: { name: "Backend Development Agent" },
        task: task as never
      };
    }
  };

  const runner = new DelegatedA2ARoleRunner({
    authorityIssuer: issuer,
    a2a
  });

  await assert.rejects(
    () =>
      runner.issueAndRun({
        role: "backend",
        parent_credential_id: "urn:phase9b:root",
        credential_id: "urn:phase9b:backend",
        valid_from: "2026-10-05T00:00:00Z",
        validity_seconds: 1800,
        credential_status: {
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "9301",
          statusListCredential:
            "https://status.example/lists/phase9b"
        },
        agent_base_url: "http://backend.local",
        subtask: {
          subtask_id: "backend-task",
          instruction: "Validate Backend delegation.",
          branch: "feature/account-suspension",
          relevant_paths: []
        },
        expected_revision: revision
      }),
    /is not completed/u
  );
});
