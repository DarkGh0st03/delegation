import assert from "node:assert/strict";
import test from "node:test";
import type { SpecializedAgentRole } from "@thesis/agent-runtime";
import {
  AccountSuspensionSequentialCoordinator,
  type SequentialGatewayPort,
  type SequentialRoleRunnerPort
} from "../src/index.ts";

const branchRevision = "a".repeat(40);
const backendRevision = "b".repeat(40);
const frontendRevision = "c".repeat(40);

function artifact(role: SpecializedAgentRole) {
  const revision =
    role === "backend" ? backendRevision : frontendRevision;
  return {
    role,
    summary: `${role} completed`,
    files_modified: [],
    files_created: [],
    branch: "feature/account-suspension" as const,
    revision,
    commit_sha: revision,
    test_outcome:
      role === "test"
        ? ("pass" as const)
        : ("not_run" as const),
    errors: [],
    ...(role === "test"
      ? {
          tested_commit_sha: revision,
          runner_profile: "poc-default" as const,
          project_tests: "pass" as const,
          researcher_acceptance: "pass" as const
        }
      : {})
  };
}

function credential(role: SpecializedAgentRole) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "DelegationCredential"],
    id: `urn:thesis:dc:account-suspension:${role}`,
    issuer: "did:thesis:orchestrator",
    validFrom: "2026-10-05T00:00:00.000Z",
    credentialSubject: {
      sub: `did:thesis:${role}-agent`,
      per: []
    }
  };
}

test("sequential coordinator enforces branch -> Backend -> Frontend -> Test -> PR order", async () => {
  const events: string[] = [];

  const gateway: SequentialGatewayPort = {
    async createFeatureBranch() {
      events.push("branch");
      return {
        provider: "gitea",
        performed: true,
        tool: "create_branch",
        branch: "feature/account-suspension",
        base_branch: "main",
        revision: branchRevision,
        commit_sha: branchRevision
      };
    },
    async createAccountSuspensionPullRequest() {
      events.push("pr");
      assert.deepEqual(events, [
        "branch",
        "backend",
        "frontend",
        "test",
        "pr"
      ]);
      return {
        provider: "gitea",
        performed: true,
        tool: "create_pull_request",
        pull_request_id: 7,
        pull_request_number: 3,
        head_branch: "feature/account-suspension",
        base_branch: "main",
        revision: frontendRevision
      };
    }
  };

  const roleRunner: SequentialRoleRunnerPort = {
    async issueAndRun(input) {
      events.push(input.role);
      return {
        role: input.role,
        credential: credential(input.role),
        delegation_evidence: {
          credential: JSON.stringify(credential(input.role)),
          credential_id:
            `urn:thesis:dc:account-suspension:${input.role}`,
          presenter_id: `did:thesis:${input.role}-agent`
        },
        remote_agent_name: `${input.role} agent`,
        task_id: `task-${input.role}`,
        artifact: artifact(input.role)
      };
    }
  };

  const coordinator = new AccountSuspensionSequentialCoordinator({
    gateway,
    roleRunner,
    rootCredentialId: "urn:thesis:dc:orchestrator-root",
    agentBaseUrls: {
      backend: "http://backend.local",
      frontend: "http://frontend.local",
      test: "http://test.local"
    },
    statusListCredential:
      "https://status.example/lists/phase9b6",
    now: () => new Date("2026-10-05T00:00:00.000Z")
  });

  const result = await coordinator.run();

  assert.deepEqual(events, [
    "branch",
    "backend",
    "frontend",
    "test",
    "pr"
  ]);
  assert.equal(result.workflow.state, "pr_created");
  assert.deepEqual(result.workflow.completed_roles, [
    "backend",
    "frontend",
    "test"
  ]);
  assert.equal(result.workflow.pull_request?.number, 3);
  assert.equal(
    result.delegated_tasks.test.artifact.tested_commit_sha,
    frontendRevision
  );
});

test("sequential coordinator never creates a PR when the Test gate fails", async () => {
  let pullRequestCalls = 0;

  const gateway: SequentialGatewayPort = {
    async createFeatureBranch() {
      return {
        provider: "gitea",
        performed: true,
        tool: "create_branch",
        branch: "feature/account-suspension",
        base_branch: "main",
        revision: branchRevision,
        commit_sha: branchRevision
      };
    },
    async createAccountSuspensionPullRequest() {
      pullRequestCalls += 1;
      throw new Error("must not be called");
    }
  };

  const roleRunner: SequentialRoleRunnerPort = {
    async issueAndRun(input) {
      if (input.role === "test") {
        throw new Error("Controlled Runner gate failed");
      }
      return {
        role: input.role,
        credential: credential(input.role),
        delegation_evidence: {
          credential: JSON.stringify(credential(input.role)),
          credential_id:
            `urn:thesis:dc:account-suspension:${input.role}`,
          presenter_id: `did:thesis:${input.role}-agent`
        },
        remote_agent_name: `${input.role} agent`,
        task_id: `task-${input.role}`,
        artifact: artifact(input.role)
      };
    }
  };

  const coordinator = new AccountSuspensionSequentialCoordinator({
    gateway,
    roleRunner,
    rootCredentialId: "urn:thesis:dc:orchestrator-root",
    agentBaseUrls: {
      backend: "http://backend.local",
      frontend: "http://frontend.local",
      test: "http://test.local"
    },
    statusListCredential:
      "https://status.example/lists/phase9b6"
  });

  await assert.rejects(
    () => coordinator.run(),
    /Controlled Runner gate failed/u
  );
  assert.equal(pullRequestCalls, 0);
});
