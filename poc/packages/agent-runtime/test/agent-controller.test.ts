import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentController,
  ControlledToolError,
  ControlledToolRegistry,
  InMemoryAgentRuntimeAuditSink,
  modelVisibleTaskContext,
  type AgentTaskContext,
  type ModelClient,
  type ModelTurnRequest,
  type ModelTurnResponse
} from "../src/index.ts";

class ScriptedModelClient implements ModelClient {
  readonly requests: ModelTurnRequest[] = [];
  readonly #responses: ModelTurnResponse[];

  constructor(responses: ModelTurnResponse[]) {
    this.#responses = [...responses];
  }

  async respond(request: ModelTurnRequest): Promise<ModelTurnResponse> {
    this.requests.push(structuredClone(request));
    const response = this.#responses.shift();
    if (!response) throw new Error("Scripted model has no response left");
    return response;
  }
}

const taskContext: AgentTaskContext = {
  task_id: "task-phase8a-controller",
  context_id: "context-phase8a-controller",
  role: "backend",
  subtask: {
    subtask_id: "subtask-phase8a-controller",
    instruction: "Inspect the backend service through controlled tools.",
    branch: "feature/account-suspension",
    relevant_paths: ["apps/backend/src/users/user.service.ts"]
  },
  delegation_evidence: {
    credential: "phase8a-child-credential-payload",
    credential_id: "urn:phase8a:backend",
    presenter_id: "did:thesis:backend-agent"
  }
};

test("Agent Controller runs a bounded Responses function loop and records effective model id", async () => {
  const model = new ScriptedModelClient([
    {
      response_id: "resp_1",
      model_id: "gpt-5.6-sol-2026-09-30",
      output_text: "",
      function_calls: [
        {
          call_id: "call_read",
          name: "read_file",
          arguments: JSON.stringify({
            branch: "feature/account-suspension",
            path: "apps/backend/src/users/user.service.ts"
          })
        }
      ]
    },
    {
      response_id: "resp_2",
      model_id: "gpt-5.6-sol-2026-09-30",
      output_text: "Inspected the permitted backend file.",
      function_calls: []
    }
  ]);

  const gateway = {
    invoke: async () => ({
      provider: "gitea",
      tool: "read_file",
      content: "export class UserService {}"
    })
  };
  const registry = new ControlledToolRegistry(gateway as never, ["read_file"]);
  const audit = new InMemoryAgentRuntimeAuditSink();
  const controller = new AgentController({
    modelClient: model,
    toolRegistry: registry,
    maxIterations: 4,
    audit
  });

  const result = await controller.run(modelVisibleTaskContext(taskContext));

  assert.equal(result.status, "completed");
  assert.equal(result.model_id, "gpt-5.6-sol-2026-09-30");
  assert.equal(result.iterations, 2);
  assert.equal(result.tool_calls, 1);
  assert.equal(result.controlled_failures.length, 0);
  assert.equal(model.requests[1]?.previous_response_id, "resp_1");

  const modelVisible = JSON.stringify(model.requests);
  assert.equal(modelVisible.includes("phase8a-child-credential-payload"), false);
  assert.equal(modelVisible.includes("urn:phase8a:backend"), false);
  assert.equal(JSON.stringify(audit.events).includes("phase8a-child-credential-payload"), false);
  assert.equal(audit.events[0]?.model_id, "gpt-5.6-sol-2026-09-30");
});

test("Agent Controller returns authorization denial to the model as a controlled tool outcome", async () => {
  const model = new ScriptedModelClient([
    {
      response_id: "resp_deny_1",
      model_id: "gpt-5.6-sol",
      output_text: "",
      function_calls: [
        {
          call_id: "call_update",
          name: "update_file",
          arguments: JSON.stringify({
            branch: "feature/account-suspension",
            path: "security/out-of-scope.ts",
            content: "must not be written"
          })
        }
      ]
    },
    {
      response_id: "resp_deny_2",
      model_id: "gpt-5.6-sol",
      output_text: "The requested write was denied by delegated authorization.",
      function_calls: []
    }
  ]);

  const gateway = {
    invoke: async () => {
      throw new ControlledToolError(
        "authorization_denied",
        "Permission is not delegated"
      );
    }
  };
  const registry = new ControlledToolRegistry(gateway as never, ["update_file"]);
  const controller = new AgentController({
    modelClient: model,
    toolRegistry: registry,
    maxIterations: 3
  });

  const result = await controller.run(modelVisibleTaskContext(taskContext));

  assert.equal(result.status, "completed");
  assert.equal(result.controlled_failures.length, 1);
  assert.equal(result.controlled_failures[0]?.kind, "authorization_denied");

  const secondInput = JSON.stringify(model.requests[1]?.input);
  assert.match(secondInput, /authorization_denied/u);
  assert.match(secondInput, /Permission is not delegated/u);
});

test("Agent Controller fails closed at the configured iteration limit", async () => {
  const responses = Array.from({ length: 2 }, (_, index) => ({
    response_id: `resp_loop_${index}`,
    model_id: "gpt-5.6-sol",
    output_text: "",
    function_calls: [
      {
        call_id: `call_loop_${index}`,
        name: "read_file",
        arguments: JSON.stringify({
          branch: "feature/account-suspension",
          path: "apps/backend/src/users/user.service.ts"
        })
      }
    ]
  }));

  const model = new ScriptedModelClient(responses);
  const registry = new ControlledToolRegistry(
    {
      invoke: async () => ({ provider: "gitea", tool: "read_file", content: "x" })
    } as never,
    ["read_file"]
  );
  const controller = new AgentController({
    modelClient: model,
    toolRegistry: registry,
    maxIterations: 2
  });

  const result = await controller.run(modelVisibleTaskContext(taskContext));
  assert.equal(result.status, "failed");
  assert.equal(result.iterations, 2);
  assert.equal(result.controlled_failures.at(-1)?.kind, "iteration_limit");
});
