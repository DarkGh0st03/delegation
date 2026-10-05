import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPENAI_MODEL,
  OpenAIResponsesClient,
  type ModelFunctionTool
} from "../src/index.ts";

const tool: ModelFunctionTool = {
  type: "function",
  name: "read_file",
  description: "read",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  }
};

test("OpenAI Responses client uses configurable model and normalizes function calls", async () => {
  const requests: unknown[] = [];
  const fakeClient = {
    responses: {
      create: async (request: unknown) => {
        requests.push(request);
        return {
          id: "resp_phase8a",
          model: "gpt-5.6-sol-2026-09-30",
          status: "completed",
          output_text: "",
          output: [
            {
              type: "function_call",
              call_id: "call_read",
              name: "read_file",
              arguments: JSON.stringify({
                branch: "feature/account-suspension",
                path: "apps/backend/src/users/user.service.ts"
              }),
              status: "completed"
            }
          ],
          error: null,
          incomplete_details: null
        };
      }
    }
  };

  const client = new OpenAIResponsesClient({
    client: fakeClient as never,
    model: "gpt-5.6-sol",
    maxOutputTokens: 2048
  });

  const result = await client.respond({
    instructions: "controlled",
    input: "task",
    tools: [tool]
  });

  assert.equal(result.response_id, "resp_phase8a");
  assert.equal(result.model_id, "gpt-5.6-sol-2026-09-30");
  assert.deepEqual(result.function_calls, [
    {
      call_id: "call_read",
      name: "read_file",
      arguments:
        '{"branch":"feature/account-suspension","path":"apps/backend/src/users/user.service.ts"}'
    }
  ]);

  const request = requests[0] as Record<string, unknown>;
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.parallel_tool_calls, false);
  assert.equal(request.max_output_tokens, 2048);
});

test("OpenAI Responses client defaults to the frozen Phase 8A target model", async () => {
  const previous = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL;

  let selectedModel: unknown;
  const fakeClient = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        selectedModel = request.model;
        return {
          id: "resp_default",
          model: DEFAULT_OPENAI_MODEL,
          status: "completed",
          output_text: "done",
          output: [],
          error: null,
          incomplete_details: null
        };
      }
    }
  };

  try {
    const client = new OpenAIResponsesClient({
      client: fakeClient as never
    });
    const result = await client.respond({
      instructions: "controlled",
      input: "task",
      tools: [tool]
    });
    assert.equal(selectedModel, DEFAULT_OPENAI_MODEL);
    assert.equal(result.model_id, DEFAULT_OPENAI_MODEL);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previous;
  }
});
