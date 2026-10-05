import type {
  ModelFunctionCall,
  ModelFunctionTool
} from "./llm-client.ts";
import { ControlledToolError } from "./controlled-errors.ts";
import {
  GatewayControlledToolClient,
  SPECIALIZED_TOOL_NAMES,
  type SpecializedToolName
} from "./gateway-tool-client.ts";

const FEATURE_BRANCH = "feature/account-suspension";

const TOOL_DEFINITIONS: Record<SpecializedToolName, ModelFunctionTool> = {
  read_file: {
    type: "function",
    name: "read_file",
    description:
      "Read one UTF-8 repository file from the controlled feature branch.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", enum: [FEATURE_BRANCH] },
        path: { type: "string", minLength: 1 }
      },
      required: ["branch", "path"],
      additionalProperties: false
    }
  },
  update_file: {
    type: "function",
    name: "update_file",
    description:
      "Update one existing UTF-8 repository file on the controlled feature branch.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", enum: [FEATURE_BRANCH] },
        path: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      required: ["branch", "path", "content"],
      additionalProperties: false
    }
  },
  create_file: {
    type: "function",
    name: "create_file",
    description:
      "Create one new UTF-8 repository file on the controlled feature branch.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", enum: [FEATURE_BRANCH] },
        path: { type: "string", minLength: 1 },
        content: { type: "string" }
      },
      required: ["branch", "path", "content"],
      additionalProperties: false
    }
  },
  run_tests: {
    type: "function",
    name: "run_tests",
    description:
      "Run the fixed controlled test profile against the controlled feature branch.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", enum: [FEATURE_BRANCH] },
        profile: { type: "string", enum: ["poc-default"] }
      },
      required: ["branch", "profile"],
      additionalProperties: false
    }
  }
};

function objectArguments(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ControlledToolError(
      "invalid_tool_call",
      "Model tool arguments are not valid JSON"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ControlledToolError(
      "invalid_tool_call",
      "Model tool arguments must be a JSON object"
    );
  }
  return parsed as Record<string, unknown>;
}

export class ControlledToolRegistry {
  readonly #gateway: GatewayControlledToolClient;
  readonly #allowed: Set<SpecializedToolName>;

  constructor(
    gateway: GatewayControlledToolClient,
    allowedTools: readonly SpecializedToolName[]
  ) {
    if (allowedTools.length === 0) {
      throw new Error("Tool Registry requires at least one controlled tool");
    }
    for (const tool of allowedTools) {
      if (!(SPECIALIZED_TOOL_NAMES as readonly string[]).includes(tool)) {
        throw new Error(`Unsupported specialized tool: ${tool}`);
      }
    }

    this.#gateway = gateway;
    this.#allowed = new Set(allowedTools);
  }

  get modelTools(): ModelFunctionTool[] {
    return [...this.#allowed].map((tool) => structuredClone(TOOL_DEFINITIONS[tool]));
  }

  async execute(call: ModelFunctionCall): Promise<unknown> {
    if (
      !(SPECIALIZED_TOOL_NAMES as readonly string[]).includes(call.name) ||
      !this.#allowed.has(call.name as SpecializedToolName)
    ) {
      throw new ControlledToolError(
        "invalid_tool_call",
        `Tool ${call.name} is not registered for this Agent runtime`
      );
    }

    return this.#gateway.invoke(
      call.name as SpecializedToolName,
      objectArguments(call.arguments)
    );
  }
}
