import type { AgentTaskContext } from "./contracts.ts";

export class InMemoryAgentTaskContextStore {
  readonly #contexts = new Map<string, AgentTaskContext>();

  save(context: AgentTaskContext): void {
    this.#contexts.set(context.task_id, structuredClone(context));
  }

  get(taskId: string): AgentTaskContext | undefined {
    const context = this.#contexts.get(taskId);
    return context === undefined ? undefined : structuredClone(context);
  }

  delete(taskId: string): void {
    this.#contexts.delete(taskId);
  }
}
