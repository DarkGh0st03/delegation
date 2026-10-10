import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Role,
  TaskState,
  type AgentCard,
  type Task
} from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  ServiceParameters,
  withA2AExtensions
} from "@a2a-js/sdk/client";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  type DelegationEvidence,
  type DeterministicSubtask
} from "./contracts.ts";

export class IncompatibleAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleAgentError";
  }
}

export function assertDelegatedAuthorizationSupport(card: AgentCard): void {
  const extension = card.capabilities?.extensions.find(
    (candidate) => candidate.uri === DELEGATED_AUTHORIZATION_EXTENSION_URI
  );
  if (!extension) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not advertise required delegated-authorization extension`
    );
  }

  const restInterface = card.supportedInterfaces.find(
    (candidate) =>
      candidate.protocolBinding.toUpperCase() === "HTTP+JSON" &&
      candidate.protocolVersion === "1.0"
  );
  if (!restInterface) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not expose A2A HTTP+JSON protocolVersion 1.0`
    );
  }

  if (
    !card.defaultInputModes.includes("application/json") ||
    !card.defaultOutputModes.includes("application/json")
  ) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not advertise application/json input/output modes`
    );
  }
}

export interface ProtectedA2ATaskRequest {
  agent_base_url: string;
  subtask: DeterministicSubtask;
  delegation_evidence: DelegationEvidence;
}

export interface ProtectedA2ATaskResult {
  card: AgentCard;
  task: Task;
}

export interface A2APollingOptions {
  /** Deadline for the entire role task (not a target latency). */
  deadlineMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
}
const FINISHED = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED
]);
function positiveSafe(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + " must be positive");
  return value;
}
function safeA2AMetric(phase: string, elapsedMs: number, polls: number,
  submitMs: number, pollingHttpMs: number): void {
  process.stdout.write(JSON.stringify({
    event: "a2a_timing", phase,
    wall_ms: Math.round(elapsedMs),
    submit_http_ms: Math.round(submitMs),
    polling_http_ms: Math.round(pollingHttpMs),
    polls
  }) + "\n");
}

export class DeterministicA2AOrchestrator {
  readonly #factory: ClientFactory;
  readonly #deadlineMs: number;
  readonly #initialIntervalMs: number;
  readonly #maxIntervalMs: number;

  constructor(options: A2APollingOptions = {}) {
    this.#deadlineMs = positiveSafe(options.deadlineMs ?? 12 * 60_000, "A2A deadline");
    this.#initialIntervalMs = positiveSafe(options.initialIntervalMs ?? 500, "A2A poll interval");
    this.#maxIntervalMs = positiveSafe(options.maxIntervalMs ?? 3000, "A2A max poll interval");
    if (this.#maxIntervalMs < this.#initialIntervalMs) {
      throw new Error("A2A max poll interval must not be smaller than initial");
    }
    this.#factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        preferredTransports: ["HTTP+JSON"]
      })
    );
  }

  async sendProtectedTask(
    request: ProtectedA2ATaskRequest
  ): Promise<ProtectedA2ATaskResult> {
    const client = await this.#factory.createFromUrl(request.agent_base_url);
    const card = await client.getAgentCard();
    assertDelegatedAuthorizationSupport(card);

    const start = performance.now();
    const result = await client.sendMessage(
      {
        tenant: "",
        message: {
          messageId: randomUUID(),
          contextId: "",
          taskId: "",
          role: Role.ROLE_USER,
          parts: [
            {
              content: {
                $case: "data",
                value: request.subtask
              },
              metadata: undefined,
              filename: "",
              mediaType: "application/json"
            }
          ],
          metadata: {
            delegation_evidence: request.delegation_evidence
          },
          extensions: [DELEGATED_AUTHORIZATION_EXTENSION_URI],
          referenceTaskIds: []
        },
        configuration: {
          acceptedOutputModes: ["application/json"],
          taskPushNotificationConfig: undefined,
          historyLength: 0,
          returnImmediately: true
        },
        metadata: {
          workflow: "account-suspension"
        }
      },
      {
        serviceParameters: ServiceParameters.create(
          withA2AExtensions(DELEGATED_AUTHORIZATION_EXTENSION_URI)
        )
      }
    );

    if (!("id" in result)) {
      throw new Error(
        `Protected deterministic A2A request returned a Message instead of a Task from ${card.name}`
      );
    }

    // The first HTTP request closes immediately; only the opaque task ID is
    // reused. Delegation Evidence never appears in getTask/cancelTask payloads.
    if (!result.id) throw new Error("A2A did not return a task id");
    const submitMs = performance.now() - start;
    let pollingHttpMs = 0;
    let task: Task = result;
    let polls = 0;
    let consecutiveFailures = 0;
    let interval = this.#initialIntervalMs;
    const cancelRemote = async (): Promise<void> => {
      try {
        await client.cancelTask({id: result.id}, {
          signal: AbortSignal.timeout(5000)
        });
      } catch {
        // A raced completion or temporarily unavailable server is not
        // evidence that the cancelled task successfully completed.
      }
    };
    while (true) {
      const state = task.status?.state;
      if (state !== undefined && FINISHED.has(state)) {
        safeA2AMetric("terminal", performance.now() - start, polls, submitMs, pollingHttpMs);
        if (state !== TaskState.TASK_STATE_COMPLETED) {
          throw new Error("Protected A2A task ended without completion");
        }
        return {card,task: {...task, history: []}};
      }
      // INPUT_REQUIRED and AUTH_REQUIRED cannot be fulfilled by this fixed
      // delegated workflow; fail instead of waiting indefinitely.
      if (state === TaskState.TASK_STATE_INPUT_REQUIRED ||
          state === TaskState.TASK_STATE_AUTH_REQUIRED) {
        throw new Error("Protected A2A task requires unsupported interaction");
      }
      const elapsed = performance.now() - start;
      if (elapsed >= this.#deadlineMs) {
        await cancelRemote();
        safeA2AMetric("deadline", performance.now() - start, polls, submitMs, pollingHttpMs);
        throw new Error("Protected A2A task deadline exceeded");
      }
      const remaining = this.#deadlineMs - elapsed;
      await sleep(Math.min(interval, remaining));
      polls++;
      // Every getTask request has its own short timeout; it does NOT share
      // the original long-running sendMessage HTTP connection.
      const requestMs = Math.max(1, Math.floor(Math.min(15_000, this.#deadlineMs - (performance.now() - start))));
      const pollHttpStart = performance.now();
      try {
        task = await client.getTask({id: result.id, historyLength: 0}, {
          signal: AbortSignal.timeout(requestMs)
        });
        consecutiveFailures = 0;
      } catch {
        // A poll timeout at the overall deadline is a DEADLINE failure,
        // not an unhandled HTTP AbortError. Transient polling failures get
        // at most two retries, with no retransmission of delegated evidence.
        if (performance.now() - start >= this.#deadlineMs) {
          await cancelRemote();
          safeA2AMetric("deadline", performance.now() - start, polls, submitMs, pollingHttpMs);
          throw new Error("Protected A2A task deadline exceeded");
        }
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          await cancelRemote();
          throw new Error("Protected A2A polling transport failed");
        }
      } finally {
        pollingHttpMs += performance.now() - pollHttpStart;
      }
      interval = Math.min(this.#maxIntervalMs, Math.ceil(interval * 1.5));
    }
  }
}
