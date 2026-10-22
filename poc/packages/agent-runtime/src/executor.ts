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
  type AgentTaskContext,
  type DelegationEvidence,
  type DeterministicSubtask,
  type ApprovedTaskFilePermission,
  type SpecializedAgentRole
} from "./contracts.ts";
import { buildDeterministicArtifactPayload } from "./artifact-builder.ts";
import { InMemoryAgentTaskContextStore } from "./task-context.ts";
import {LEGACY_A2A_BRANCH,validatePrivateApprovedBranch} from "./approved-branch.ts";

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

function trustedGatewayTaskId(message:Message):string|undefined{
  const metadata=object(message.metadata??{},"Message.metadata");
  const id=metadata.trusted_gateway_task_id;
  if(id===undefined)return undefined;
  if(typeof id!=="string"||!/^dispatch_[A-Za-z0-9_-]{22}$/u.test(id)){
    throw new Error("Invalid private Gateway dispatch binding");
  }
  // This ID is only a candidate: the Gateway still requires its separate
  // approved plan binding, role, verified DC/VP and OPA authorization.
  return id;
}

function subtask(message: Message): DeterministicSubtask {
  const dataPart = message.parts.find((part) => part.content?.$case === "data");
  if (dataPart?.content?.$case !== "data") {
    throw new Error("Protected A2A message requires an application/json data part");
  }
  const raw = object(dataPart.content.value, "subtask");
  // Backward compatible legacy endpoint. A different branch is allowed
  // ONLY with a private, preallocated Gateway Task binding. This does not
  // authenticate the caller; subsequent Gateway Rust/VP/OPA checks do.
  const privateId=trustedGatewayTaskId(message);
  const branch=privateId
    ? validatePrivateApprovedBranch(raw.branch)
    : raw.branch;
  if(!privateId && branch!==LEGACY_A2A_BRANCH) {
    throw new Error("Legacy unbound A2A task must use feature/account-suspension");
  }
  if (
    !Array.isArray(raw.relevant_paths) ||
    !raw.relevant_paths.every((entry) => typeof entry === "string")
  ) {
    throw new Error("subtask.relevant_paths must be an array of strings");
  }

  // This metadata is NOT a source of delegated authority. Gateway
  // independently checks the actual Engineer-approved Task and signed VP.
  // Reject malformed/forged additions before allocating any model runtime.
  let approvedFilePermissions:ApprovedTaskFilePermission[]|undefined;
  if(raw.approved_file_permissions!==undefined){
    if(!privateId || !Array.isArray(raw.approved_file_permissions) ||
       raw.approved_file_permissions.length>32){
      throw new Error("File permission hints require trusted Gateway Task binding");
    }
    const keys=new Set<string>();
    approvedFilePermissions=raw.approved_file_permissions.map(value=>{
      const row=object(value,"approved_file_permissions entry");
      if(Object.keys(row).sort().join(",")!=="operation,path" ||
         !["read_file","update_file","create_file"].includes(String(row.operation))||
         typeof row.path!=="string"||
         !(raw.relevant_paths as string[]).includes(row.path)||
         row.path.length===0 || row.path.length>240 ||
         row.path.startsWith("/")||row.path.includes("\\")||
         row.path.includes("//")||row.path.split("/").some(x=>
           !x||x==="."||x==="..")){
        throw new Error("Invalid private Task file permission hint");
      }
      const key=row.operation+"\0"+row.path;
      if(keys.has(key))throw new Error("Duplicate Task file permission hint");
      keys.add(key);
      return {operation:row.operation,path:row.path} as ApprovedTaskFilePermission;
    });
  }
  return {
    subtask_id: string(raw.subtask_id, "subtask.subtask_id"),
    instruction: string(raw.instruction, "subtask.instruction"),
    branch:branch as string,
    relevant_paths: raw.relevant_paths as string[],
    ...(approvedFilePermissions!==undefined
       ? {approved_file_permissions:approvedFilePermissions}:{})
  };
}

export type DeterministicArtifactPayloadBuilder = (
  role: SpecializedAgentRole,
  task: DeterministicSubtask
) => AgentArtifactPayload;

export type DeterministicTaskHandler = (
  context: AgentTaskContext,
  signal?: AbortSignal
) => AgentArtifactPayload | Promise<AgentArtifactPayload>;

export class DeterministicSpecializedAgentExecutor implements AgentExecutor {
  readonly #role: SpecializedAgentRole;
  readonly #contexts: InMemoryAgentTaskContextStore;
  readonly #artifactBuilder: DeterministicArtifactPayloadBuilder;
  readonly #taskHandler?: DeterministicTaskHandler;
  #executionCount = 0;
  readonly #running = new Map<string, AbortController>();

  constructor(
    role: SpecializedAgentRole,
    contexts: InMemoryAgentTaskContextStore = new InMemoryAgentTaskContextStore(),
    artifactBuilder: DeterministicArtifactPayloadBuilder =
      buildDeterministicArtifactPayload,
    taskHandler?: DeterministicTaskHandler
  ) {
    this.#role = role;
    this.#contexts = contexts;
    this.#artifactBuilder = artifactBuilder;
    this.#taskHandler = taskHandler;
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
    const trustedGatewayId=trustedGatewayTaskId(message);

    requestContext.context.addActivatedExtension(
      DELEGATED_AUTHORIZATION_EXTENSION_URI
    );

    const taskContext: AgentTaskContext = {
      task_id: requestContext.taskId,
      ...(trustedGatewayId?{trusted_gateway_task_id:trustedGatewayId}:{}),
      context_id: requestContext.contextId,
      role: this.#role,
      subtask: taskInput,
      delegation_evidence: evidence
    };
    this.#contexts.save(taskContext);
    this.#executionCount += 1;
    const controller = new AbortController();
    this.#running.set(taskContext.task_id, controller);

    // Never publish the authority-bearing incoming Message in A2A history.
    // The original DC lives exclusively in the private task-context store.
    const taskSnapshot: Task = {
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined
      },
      artifacts: [],
      history: [],
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

    try {
      const artifactPayload =
        this.#taskHandler === undefined
          ? this.#artifactBuilder(this.#role, taskInput)
          : await this.#taskHandler(structuredClone(taskContext), controller.signal);

      // Cancellation is terminal even if a slow LLM returns a late result.
      if (controller.signal.aborted) return;

      const artifact: Artifact = {
        artifactId: crypto.randomUUID(),
        name: `${this.#role}-deterministic-result`,
        description:
          "Phase 7 deterministic result. Delegation Evidence is intentionally excluded.",
        parts: [
          {
            content: {
              $case: "data",
              value: artifactPayload
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
    } catch {
      if (!controller.signal.aborted) {
        // The SDK also synthesizes FAILED on thrown errors, but its default
        // fallback may echo raw error text. Publish a fixed safe failure here.
        eventBus.publish(AgentEvent.statusUpdate({
          taskId: taskContext.task_id,
          contextId: taskContext.context_id,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            timestamp: new Date().toISOString(),
            message: undefined
          },
          metadata: {agent_role: this.#role}
        }));
      }
    } finally {
      this.#running.delete(taskContext.task_id);
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const context = this.#contexts.get(taskId);
    if (!context) {
      throw new Error(`Unknown task ${taskId}`);
    }

    const controller = this.#running.get(taskId);
    if (!controller) throw new Error("A2A task is no longer running");
    controller.abort();
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
