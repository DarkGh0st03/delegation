import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECIALIZED_AGENT_PROFILES,
  createSpecializedAgentController,
  type ModelClient,
  type ModelTurnRequest,
  type ModelTurnResponse,
  type SpecializedAgentRole
} from "../src/index.ts";

class CaptureModel implements ModelClient {
  readonly requests: ModelTurnRequest[] = [];

  async respond(request: ModelTurnRequest): Promise<ModelTurnResponse> {
    this.requests.push(structuredClone(request));
    return {
      response_id: "resp_specialized",
      model_id: "gpt-5.6-sol-specialized-test",
      output_text: "done",
      function_calls: []
    };
  }
}

const cases: Array<{
  role: SpecializedAgentRole;
  expectedTools: string[];
  expectedWritable: string;
  forbiddenTool?: string;
}> = [
  {
    role: "backend",
    expectedTools: ["read_file", "update_file"],
    expectedWritable: "apps/backend/src/users/user.service.ts",
    forbiddenTool: "create_file"
  },
  {
    role: "frontend",
    expectedTools: ["read_file", "update_file"],
    expectedWritable: "apps/frontend/src/pages/UserDetailPage.tsx",
    forbiddenTool: "run_tests"
  },
  {
    role: "test",
    expectedTools: ["read_file", "update_file", "create_file", "run_tests"],
    expectedWritable: "tests/backend/user.service.test.ts"
  }
];

for (const entry of cases) {
  test(`${entry.role} Agent exposes the frozen role-specific prompt and tool set`, async () => {
    const model = new CaptureModel();
    const gateway = {
      invoke: async () => ({ ok: true })
    };

    const { profile, registry, controller } = createSpecializedAgentController({
      role: entry.role,
      modelClient: model,
      gatewayClient: gateway as never,
      maxIterations: 2
    });

    assert.deepEqual(
      registry.modelTools.map((tool) => tool.name),
      entry.expectedTools
    );
    assert.ok(profile.writable_paths.includes(entry.expectedWritable));
    assert.ok(profile.system_prompt.includes(entry.expectedWritable));
    assert.match(
      profile.system_prompt,
      /guidance, not the security boundary/u
    );

    if (entry.forbiddenTool) {
      assert.equal(
        registry.modelTools.some((tool) => tool.name === entry.forbiddenTool),
        false
      );
    }

    const result = await controller.run({
      task_id: `task-${entry.role}`,
      role: entry.role,
      subtask: {
        subtask_id: `subtask-${entry.role}`,
        instruction: "Complete a small role-specific sandbox task.",
        branch: "feature/account-suspension",
        relevant_paths: [entry.expectedWritable]
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(model.requests.length, 1);
    assert.equal(model.requests[0]?.instructions, profile.system_prompt);
  });
}

test("Test Agent profile keeps application source read-only in prompt semantics", () => {
  const profile = SPECIALIZED_AGENT_PROFILES.test;

  assert.ok(
    profile.read_only_paths.includes(
      "apps/backend/src/users/user.service.ts"
    )
  );
  assert.equal(
    profile.writable_paths.includes(
      "apps/backend/src/users/user.service.ts"
    ),
    false
  );
  assert.deepEqual(profile.creatable_paths, [
    "tests/e2e/account-suspension.spec.ts"
  ]);
  assert.equal(profile.can_run_tests, true);
});

test("Backend and Frontend writable sets do not overlap", () => {
  const backend = new Set(SPECIALIZED_AGENT_PROFILES.backend.writable_paths);
  const frontend = new Set(SPECIALIZED_AGENT_PROFILES.frontend.writable_paths);

  assert.deepEqual(
    [...backend].filter((path) => frontend.has(path)),
    []
  );
});
