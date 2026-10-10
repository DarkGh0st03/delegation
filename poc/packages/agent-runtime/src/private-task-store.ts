import type {Task} from "@a2a-js/sdk";
import {InMemoryTaskStore, type ServerCallContext} from "@a2a-js/sdk/server";

/**
 * A2A's default ResultManager automatically prepends the caller's Message
 * (including Delegation Evidence metadata) to Task.history, even when the
 * executor publishes history:[]. Strip that history at the persistence
 * boundary so later getTask/listTasks cannot disclose bearer credentials.
 *
 * DC/VP remains available only in the private InMemoryAgentTaskContextStore.
 */
export class PrivateEvidenceTaskStore extends InMemoryTaskStore {
  override async save(task: Task, context: ServerCallContext): Promise<void> {
    const clean: Task = {
      ...task,
      history: [],
      status: task.status ? {...task.status, message: undefined} : task.status
    };
    await super.save(clean, context);
  }
}
