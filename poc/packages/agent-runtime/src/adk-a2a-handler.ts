import {
  BaseLlm,
  InMemorySessionService,
  Runner,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import type { AgentTaskContext, AgentArtifactPayload } from "./contracts.ts";
import { modelVisibleTaskContext } from "./agent-controller.ts";
import { DelegationEvidenceHandler } from "./delegation-evidence-handler.ts";
import { GatewayControlledToolClient } from "./gateway-tool-client.ts";
import { createAdkSpecializedAgent, type AdkControlledToolOutcome } from "./adk-specialized-agents.ts";
import type { DeterministicTaskHandler } from "./executor.ts";

type FetchLike = typeof fetch;

export interface AdkA2ATaskHandlerConfig {
  model: BaseLlm;
  gatewayBaseUrl: string;
  adapterBaseUrl: string;
  adapterToken: string;
  maxModelTurns?: number;
  fetchFn?: FetchLike;
}

const SHA = /^[0-9a-f]{40}$/u;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function status(value: unknown): "pass" | "fail" | "skipped" | undefined {
  const obj = object(value);
  return obj?.status === "pass" || obj?.status === "fail" || obj?.status === "skipped"
    ? obj.status : undefined;
}

/** A new budget for every A2A task. The model cannot control this boundary. */
class BoundedModel extends BaseLlm {
  turns = 0;
  budgetExceeded = false;
  readonly delegate: BaseLlm;
  readonly limit: number;
  constructor(delegate: BaseLlm, limit: number) {
    super({model: delegate.model});
    this.delegate = delegate;
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("ADK maxModelTurns must be an integer between 1 and 100");
    }
  }
  override async *generateContentAsync(request: LlmRequest, stream?: boolean, signal?: AbortSignal):
    AsyncGenerator<LlmResponse, void> {
    if (this.turns >= this.limit) {
      this.budgetExceeded = true;
      throw new Error("ADK model turn budget exhausted");
    }
    this.turns += 1;
    yield* this.delegate.generateContentAsync(request, stream, signal);
  }
  override connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    return Promise.reject(new Error("Live model connections are not enabled for protected A2A tasks"));
  }
}

/**
 * Binds a delegated A2A request to a fresh ADK Runner, model turn budget, and
 * per-task Gateway client. Credential and Adapter service token stay in closures;
 * the ADK session sees only modelVisibleTaskContext, never Delegation Evidence.
 *
 * The reported Artifact is derived from successful Gateway results, NOT from
 * untrusted LLM claims or model-generated JSON.
 */
export function createAdkA2ATaskHandler(config: AdkA2ATaskHandlerConfig): DeterministicTaskHandler {
  // Reject bad configuration at server startup, before accepting any requests.
  if (!config.adapterToken?.trim() || !config.adapterBaseUrl?.trim() || !config.gatewayBaseUrl?.trim()) {
    throw new Error("ADK protected task handler requires Gateway and Adapter service configuration");
  }
  const turnLimit = config.maxModelTurns ?? 8;
  if (!Number.isSafeInteger(turnLimit) || turnLimit < 1 || turnLimit > 100) {
    throw new Error("ADK maxModelTurns must be an integer between 1 and 100");
  }

  return async (context: AgentTaskContext): Promise<AgentArtifactPayload> => {
    const model = new BoundedModel(config.model, turnLimit);
    const events: AdkControlledToolOutcome[] = [];
    const evidenceHandler = new DelegationEvidenceHandler({
      adapterBaseUrl: config.adapterBaseUrl,
      adapterToken: config.adapterToken,
      evidence: context.delegation_evidence,
      ...(config.fetchFn ? { fetchFn: config.fetchFn } : {})
    });
    const gatewayClient = new GatewayControlledToolClient({
      gatewayBaseUrl: config.gatewayBaseUrl,
      agentRole: context.role,
      taskId: context.task_id,
      evidenceHandler,
      ...(config.fetchFn ? { fetchFn: config.fetchFn } : {})
    });
    const agent = createAdkSpecializedAgent({
      role: context.role, model, gatewayClient,
      onToolOutcome: event => { events.push(event); }
    }).agent;
    const appName = "account_suspension_adk_" + context.role;
    const userId = "delegated_a2a";
    const sessionService = new InMemorySessionService();
    const runner = new Runner({agent, appName, sessionService});
    await sessionService.createSession({
      appName, userId, sessionId: context.task_id
    });
    // Never serialize context.delegation_evidence into ADK Runner input/session.
    const visible = modelVisibleTaskContext(context);
    let modelError = false;
    for await (const event of runner.runAsync({
      userId, sessionId: context.task_id,
      newMessage: {role: "user", parts: [{text: JSON.stringify({task:visible})}]}
    })) {
      // ADK may convert model errors to event payloads rather than throwing.
      // Ignore model prose, but do not ignore failed model invocations.
      if (event.errorCode || event.errorMessage) modelError = true;
    }
    if (model.budgetExceeded || modelError) {
      throw new Error("ADK model execution failed or exceeded its turn budget");
    }

    const filesModified = new Set<string>();
    const filesCreated = new Set<string>();
    const errors: string[] = [];
    let revision: string | null = null;
    let testedCommitSha: string | undefined;
    let runnerProfile: "poc-default" | undefined;
    let projectTests: "pass" | "fail" | undefined;
    let researcherAcceptance: "pass" | "fail" | "skipped" | undefined;
    for (const event of events) {
      if (!event.payload.ok) {
        errors.push(event.payload.error.kind);
        continue;
      }
      const result = object(event.payload.result);
      if (!result) {
        if (event.name !== "read_file") errors.push("malformed_tool_result");
        continue;
      }
      if (event.name === "update_file" || event.name === "create_file") {
        const path = event.arguments.path;
        const commitSha = result.commit_sha;
        if (typeof path !== "string" || typeof commitSha !== "string" || !SHA.test(commitSha)) {
          errors.push("invalid_commit_result");
          continue;
        }
        if (event.name === "update_file") filesModified.add(path);
        else filesCreated.add(path);
        revision = commitSha;
      }
      if (event.name === "run_tests") {
        const sha = result.tested_commit_sha;
        const profile = result.runner_profile;
        const pt = status(result.project_tests);
        const ra = status(result.researcher_acceptance);
        if (typeof sha !== "string" || !SHA.test(sha) || profile !== "poc-default"
            || (pt !== "pass" && pt !== "fail") || !ra) {
          errors.push("invalid_test_result");
          continue;
        }
        testedCommitSha = sha;
        revision = sha;
        runnerProfile = "poc-default";
        projectTests = pt;
        researcherAcceptance = ra;
      }
    }
    // Not an acceptable completed A2A task if any controlled tool failed.
    // This also prevents LLM prose from papering over denial or a malformed SHA.
    if (errors.length > 0) throw new Error("ADK controlled task failed: " + [...new Set(errors)].join(", "));
    if (revision === null) throw new Error("ADK task produced no confirmed repository revision");

    const testOutcome = projectTests === "pass" && researcherAcceptance === "pass"
      ? "pass" : (projectTests === "fail" || researcherAcceptance === "fail") ? "fail" : "not_run";
    if (context.role === "test" && testOutcome !== "pass") {
      throw new Error("ADK Test Agent requires passing controlled test evidence");
    }
    return {
      role: context.role,
      summary: "ADK " + context.role + " task completed with Gateway-confirmed operations",
      files_modified: [...filesModified],
      files_created: [...filesCreated],
      branch: context.subtask.branch,
      revision, commit_sha: revision, test_outcome: testOutcome, errors: [],
      model_id: model.model, model_iterations: model.turns,
      ...(testedCommitSha ? {tested_commit_sha: testedCommitSha} : {}),
      ...(runnerProfile ? {runner_profile: runnerProfile} : {}),
      ...(projectTests ? {project_tests: projectTests} : {}),
      ...(researcherAcceptance ? {researcher_acceptance: researcherAcceptance} : {})
    };
  };
}
