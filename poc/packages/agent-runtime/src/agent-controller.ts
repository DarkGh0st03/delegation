import type {
  AgentTaskContext,
  DeterministicSubtask,
  SpecializedAgentRole
} from "./contracts.ts";
import {
  ControlledToolError,
  controlledToolErrorPayload,
  type ControlledToolErrorKind
} from "./controlled-errors.ts";
import type {
  ModelClient,
  ModelFunctionOutput
} from "./llm-client.ts";
import { ControlledToolRegistry } from "./tool-registry.ts";

export interface AgentRuntimeAuditEvent {
  event: "model_turn" | "tool_result";
  iteration: number;
  model_id?: string;
  response_id?: string;
  tool?: string;
  outcome?: "success" | "controlled_failure";
  failure_kind?: ControlledToolErrorKind;
}

export interface AgentRuntimeAuditSink {
  emit(event: AgentRuntimeAuditEvent): void;
}

export class InMemoryAgentRuntimeAuditSink implements AgentRuntimeAuditSink {
  readonly events: AgentRuntimeAuditEvent[] = [];

  emit(event: AgentRuntimeAuditEvent): void {
    this.events.push(structuredClone(event));
  }
}

export interface AgentControllerConfig {
  modelClient: ModelClient;
  toolRegistry: ControlledToolRegistry;
  maxIterations?: number;
  audit?: AgentRuntimeAuditSink;
  instructions?: string;
}

export interface AgentControllerRunInput {
  task_id: string;
  role: SpecializedAgentRole;
  subtask: DeterministicSubtask;
}

export interface AgentControllerFailureRecord {
  iteration: number;
  tool: string;
  kind: ControlledToolErrorKind;
  message: string;
}

export interface AgentControllerRunResult {
  status: "completed" | "failed";
  summary: string;
  model_id: string | null;
  iterations: number;
  tool_calls: number;
  controlled_failures: AgentControllerFailureRecord[];
}

const DEFAULT_INSTRUCTIONS = [
  "You are a controlled software-engineering Agent in a delegated-authorization thesis PoC.",
  "Use only the function tools provided by the runtime.",
  "Never claim a repository operation succeeded unless the corresponding tool result says it succeeded.",
  "If a controlled tool reports authorization_denied, do not attempt to bypass the boundary.",
  "If tests fail, inspect the structured result and decide whether another permitted edit is appropriate.",
  "Finish with a concise summary of work actually completed."
].join("\n");

export function modelVisibleTaskContext(
  context: AgentTaskContext
): AgentControllerRunInput {
  return {
    task_id: context.task_id,
    role: context.role,
    subtask: structuredClone(context.subtask)
  };
}

export class AgentController {
  readonly #model: ModelClient;
  readonly #registry: ControlledToolRegistry;
  readonly #maxIterations: number;
  readonly #audit: AgentRuntimeAuditSink;
  readonly #instructions: string;

  constructor(config: AgentControllerConfig) {
    this.#model = config.modelClient;
    this.#registry = config.toolRegistry;
    this.#maxIterations = config.maxIterations ?? 8;
    this.#audit = config.audit ?? { emit: () => undefined };
    this.#instructions = config.instructions ?? DEFAULT_INSTRUCTIONS;

    if (!Number.isSafeInteger(this.#maxIterations) || this.#maxIterations <= 0) {
      throw new Error("Agent Controller maxIterations must be a positive safe integer");
    }
  }

  async run(input: AgentControllerRunInput): Promise<AgentControllerRunResult> {
    let previousResponseId: string | undefined;
    let nextInput: string | ModelFunctionOutput[] = JSON.stringify({
      task: input
    });
    let modelId: string | null = null;
    let toolCalls = 0;
    const controlledFailures: AgentControllerFailureRecord[] = [];

    for (let iteration = 1; iteration <= this.#maxIterations; iteration += 1) {
      const response = await this.#model.respond({
        instructions: this.#instructions,
        input: nextInput,
        tools: this.#registry.modelTools,
        ...(previousResponseId === undefined
          ? {}
          : { previous_response_id: previousResponseId })
      });

      modelId = response.model_id;
      previousResponseId = response.response_id;
      this.#audit.emit({
        event: "model_turn",
        iteration,
        model_id: response.model_id,
        response_id: response.response_id
      });

      if (response.function_calls.length === 0) {
        return {
          status: "completed",
          summary: response.output_text,
          model_id: modelId,
          iterations: iteration,
          tool_calls: toolCalls,
          controlled_failures: controlledFailures
        };
      }

      const outputs: ModelFunctionOutput[] = [];
      for (const call of response.function_calls) {
        toolCalls += 1;
        try {
          const result = await this.#registry.execute(call);
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({ ok: true, result })
          });
          this.#audit.emit({
            event: "tool_result",
            iteration,
            tool: call.name,
            outcome: "success"
          });
        } catch (error) {
          const payload = controlledToolErrorPayload(error);
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(payload)
          });

          const kind =
            error instanceof ControlledToolError
              ? error.kind
              : payload.error.kind;
          controlledFailures.push({
            iteration,
            tool: call.name,
            kind,
            message: payload.error.message
          });
          this.#audit.emit({
            event: "tool_result",
            iteration,
            tool: call.name,
            outcome: "controlled_failure",
            failure_kind: kind
          });
        }
      }

      nextInput = outputs;
    }

    return {
      status: "failed",
      summary: "Agent Controller reached the configured iteration limit.",
      model_id: modelId,
      iterations: this.#maxIterations,
      tool_calls: toolCalls,
      controlled_failures: [
        ...controlledFailures,
        {
          iteration: this.#maxIterations,
          tool: "controller",
          kind: "iteration_limit",
          message: "Agent Controller reached the configured iteration limit."
        }
      ]
    };
  }
}
