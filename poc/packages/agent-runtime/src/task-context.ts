import type { AgentTaskContext, DeterministicSubtask, SpecializedAgentRole } from "./contracts.ts";

/** The only Task fields given to the model. */
export interface ModelVisibleTaskInput {
  task_id: string;
  role: SpecializedAgentRole;
  subtask: Pick<DeterministicSubtask, "subtask_id" | "instruction" | "branch" | "relevant_paths">;
}


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

export function modelVisibleTaskContext(context: AgentTaskContext): ModelVisibleTaskInput {
  // Allowlist the Task fields given to the LLM. Delegation evidence, trusted
  // Gateway dispatch ID, private context ID and signed-plan permission hints
  // stay in the trusted runtime, where they configure the actual tools.
  // Repository paths remain non-authoritative context, not grants.
  return {
    task_id: context.task_id,
    role: context.role,
    subtask: {
      subtask_id: context.subtask.subtask_id,
      instruction: context.subtask.instruction,
      branch: context.subtask.branch,
      relevant_paths: [...context.subtask.relevant_paths]
    }
  };
}
