import { TaskState, type Task } from "@a2a-js/sdk";
import type {
  DelegationEvidence,
  DeterministicSubtask,
  SpecializedAgentRole
} from "@thesis/agent-runtime";
import type {
  ChildIssuanceInput,
  IssuedDelegationCredential
} from "./authority-client.ts";
import {
  validateWorkflowArtifact,
  type ValidatedWorkflowArtifact
} from "./artifact-validation.ts";

export interface ChildAuthorityIssuerPort {
  issueSpecializedChild(input: ChildIssuanceInput): Promise<{
    role: SpecializedAgentRole;
    credential: IssuedDelegationCredential;
  }>;
}

export interface ProtectedA2AClientPort {
  sendProtectedTask(request: {
    agent_base_url: string;
    subtask: DeterministicSubtask;
    delegation_evidence: DelegationEvidence;
  }): Promise<{
    card: { name: string };
    task: Task;
  }>;
}

export interface DelegatedA2ARoleTaskInput {
  role: SpecializedAgentRole;
  parent_credential_id: string;
  credential_id: string;
  valid_from: string;
  validity_seconds: number;
  credential_status: ChildIssuanceInput["credential_status"];
  agent_base_url: string;
  subtask: DeterministicSubtask;
  expected_revision: string;
}

export interface DelegatedA2ARoleTaskResult {
  role: SpecializedAgentRole;
  credential: IssuedDelegationCredential;
  delegation_evidence: DelegationEvidence;
  remote_agent_name: string;
  task_id: string;
  artifact: ValidatedWorkflowArtifact;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function nonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return value;
}

function expectedRevision(value: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(
      "Expected branch revision must be a lowercase 40-character Git SHA"
    );
  }
  return value;
}

function artifactPayload(task: Task): unknown {
  if (task.status?.state !== TaskState.TASK_STATE_COMPLETED) {
    throw new Error(
      `Remote A2A Task ${task.id} is not completed`
    );
  }
  if (task.artifacts.length !== 1) {
    throw new Error(
      `Remote A2A Task ${task.id} must return exactly one Artifact`
    );
  }

  const artifact = task.artifacts[0]!;
  const dataParts = artifact.parts.filter(
    (part) => part.content?.$case === "data"
  );
  if (dataParts.length !== 1 || dataParts[0]?.content?.$case !== "data") {
    throw new Error(
      "Remote A2A Artifact must contain exactly one JSON data part"
    );
  }
  return dataParts[0].content.value;
}

export class DelegatedA2ARoleRunner {
  readonly #authorityIssuer: ChildAuthorityIssuerPort;
  readonly #a2a: ProtectedA2AClientPort;

  constructor(config: {
    authorityIssuer: ChildAuthorityIssuerPort;
    a2a: ProtectedA2AClientPort;
  }) {
    this.#authorityIssuer = config.authorityIssuer;
    this.#a2a = config.a2a;
  }

  async issueAndRun(
    input: DelegatedA2ARoleTaskInput
  ): Promise<DelegatedA2ARoleTaskResult> {
    nonEmpty(input.parent_credential_id, "Parent credential id");
    nonEmpty(input.credential_id, "Child credential id");
    nonEmpty(input.agent_base_url, "Agent base URL");
    const revision = expectedRevision(input.expected_revision);

    const issued = await this.#authorityIssuer.issueSpecializedChild({
      parent_credential_id: input.parent_credential_id,
      credential_id: input.credential_id,
      valid_from: input.valid_from,
      validity_seconds: input.validity_seconds,
      credential_status: input.credential_status,
      selection: { role: input.role }
    });

    if (issued.role !== input.role) {
      throw new Error(
        `Authority issuer returned role ${issued.role}, expected ${input.role}`
      );
    }
    if (issued.credential.id !== input.credential_id) {
      throw new Error(
        "Authority issuer returned an unexpected child credential id"
      );
    }

    const delegationEvidence: DelegationEvidence = {
      credential: JSON.stringify(issued.credential),
      credential_id: issued.credential.id,
      presenter_id: issued.credential.credentialSubject.sub
    };

    const result = await this.#a2a.sendProtectedTask({
      agent_base_url: input.agent_base_url,
      subtask: structuredClone(input.subtask),
      delegation_evidence: delegationEvidence
    });

    const artifact = validateWorkflowArtifact(
      artifactPayload(result.task),
      input.role,
      {
        requireTestPass: input.role === "test"
      }
    );

    if (artifact.revision !== revision) {
      throw new Error(
        `Artifact revision ${artifact.revision} does not match expected branch revision ${revision}`
      );
    }

    return {
      role: input.role,
      credential: issued.credential,
      delegation_evidence: delegationEvidence,
      remote_agent_name: result.card.name,
      task_id: result.task.id,
      artifact
    };
  }
}
