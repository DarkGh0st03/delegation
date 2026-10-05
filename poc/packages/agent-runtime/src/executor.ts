import {
  TaskState,
  type Artifact,
  type Message,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskStatusUpdateEvent
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext
} from "@a2a-js/sdk/server";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  type AgentArtifactPayload,
  type DelegationEvidence,
  type DeterministicSubtask,
  type SpecializedAgentRole
} from "./contracts.ts";
import { InMemoryAgentTaskContextStore } from "./task-context.ts";

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function delegationEvidence(message: Message): DelegationEvidence {
  if (!message.extensions.includes(DELEGATED_AUTHORIZATION_EXTENSION_URI)) {
    throw new Error("Message does not declare delegated-authorization extension");
  }

  const metadata = object(message.metadata ?? {}, "Message.metadata");
  const raw = object(
    metadata.delegation_evidence,
    "Message.metadata.delegation_evidence"
  );

  return {
    credential: string(raw.credential, "delegation_evidence.credential"),
    credential_id: string(raw.credential_id, "delegation_evidence.credential_id"),
    presenter_id: string(raw.presenter_id, "delegation_evidence.presenter_id")
  };
}

function subtask(message: Message): DeterministicSubtask {
  const dataPart = message.parts.find((part) => part.content?.$case === "data");
  if (dataPart?.content?.$case !== "data") {
    throw new Error("Protected A2A message requires an application/json data part");
  }
  const raw = object(dataPart.content.value, "subtask");
  if (raw.branch !== "feature/account-suspension") {
    throw new Error("Phase 7 subtask must target feature/account-suspension");
  }
  if (
    !Array.isArray(raw.relevant_paths) ||
    !raw.relevant_paths.every((entry) => typeof entry === "string")
  ) {
    throw new Error("subtask.relevant_paths must be an array of strings");
  }

  return {
    subtask_id: string(raw.subtask_id, "subtask.subtask_id"),
    instruction: string(raw.instruction, "subtask.instruction"),
    branch: "feature/account-suspension",
    relevant_paths: raw.relevant_paths as string[]
  };
}

function artifactPayload(
  role: SpecializedAgentRole,
  task: DeterministicSubtask
): AgentArtifactPayload {
  return {
    role,
    summary: `${role} agent accepted deterministic subtask ${task.subtask_id}`,
    files_modified: [],
    files_created: [],
    branch: task.branch,
    revision: null,
    commit_sha: null,
    test_outcome: "not_run",
    errors: []
  };
}

export class DeterministicSpecializedAgentExecutor implements AgentExecutor {
  readonly #role: SpecializedAgentRole;
  readonly #contexts: InMemoryAgentTaskContextStore;
  #executionCount = 0;

  constructor(
    role: SpecializedAgentRole,
    contexts: InMemoryAgentTaskContextStore = new InMemoryAgentTaskContextStore()
  ) {
    this.#role = role;
    this.#contexts = contexts;
  }

  get executionCount(): number {
    return this.#executionCount;
  }

  get taskContexts(): InMemoryAgentTaskContextStore {
    return this.#contexts;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    if (
      !requestContext.context.requestedExtensions?.includes(
        DELEGATED_AUTHORIZATION_EXTENSION_URI
      )
    ) {
      throw new Error(
        "A2A-Extensions did not activate delegated-authorization extension"
      );
    }

    const message = requestContext.userMessage;
    const evidence = delegationEvidence(message);
    const taskInput = subtask(message);

    requestContext.context.addActivatedExtension(
      DELEGATED_AUTHORIZATION_EXTENSION_URI
    );

    this.#contexts.save({
      task_id: requestContext.taskId,
      context_id: requestContext.contextId,
      role: this.#role,
      subtask: taskInput,
      delegation_evidence: evidence
    });
    this.#executionCount += 1;

    const taskSnapshot: Task = requestContext.task ?? {
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined
      },
      artifacts: [],
      history: [message],
      metadata: {
        agent_role: this.#role
      }
    };
    eventBus.publish(AgentEvent.task(taskSnapshot));

    const working: TaskStatusUpdateEvent = {
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        timestamp: new Date().toISOString(),
        message: undefined
      },
      metadata: {
        agent_role: this.#role
      }
    };
    eventBus.publish(AgentEvent.statusUpdate(working));

    const artifact: Artifact = {
      artifactId: crypto.randomUUID(),
      name: `${this.#role}-deterministic-result`,
      description:
        "Phase 7 deterministic result. Delegation Evidence is intentionally excluded.",
      parts: [
        {
          content: {
            $case: "data",
            value: artifactPayload(this.#role, taskInput)
          },
          metadata: undefined,
          filename: "",
          mediaType: "application/json"
        }
      ],
      metadata: {
        agent_role: this.#role
      },
      extensions: []
    };

    const artifactUpdate: TaskArtifactUpdateEvent = {
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      artifact,
      append: false,
      lastChunk: true,
      metadata: undefined
    };
    eventBus.publish(AgentEvent.artifactUpdate(artifactUpdate));

    const completed: TaskStatusUpdateEvent = {
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state: TaskState.TASK_STATE_COMPLETED,
        timestamp: new Date().toISOString(),
        message: undefined
      },
      metadata: {
        agent_role: this.#role
      }
    };
    eventBus.publish(AgentEvent.statusUpdate(completed));
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const context = this.#contexts.get(taskId);
    if (!context) {
      throw new Error(`Unknown task ${taskId}`);
    }

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: context.context_id,
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          timestamp: new Date().toISOString(),
          message: undefined
        },
        metadata: {
          agent_role: this.#role
        }
      })
    );
  }
}
