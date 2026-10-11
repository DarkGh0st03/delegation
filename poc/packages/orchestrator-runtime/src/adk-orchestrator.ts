import {
  BaseLlm,
  FunctionTool,
  InMemorySessionService,
  LlmAgent,
  Runner,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import { z } from "zod";
import {
  ACCOUNT_SUSPENSION_REQUIREMENT
} from "./workflow.ts";
import type {
  AccountSuspensionSequentialRunResult
} from "./sequential-coordinator.ts";

export interface FixedWorkflowExecutor {
  run(): Promise<AccountSuspensionSequentialRunResult>;
}

export interface AdkOrchestratorConfig {
  model: BaseLlm;
  workflow: FixedWorkflowExecutor;
  maxModelTurns?: number;
}

/** The model's tool selection is never an authority delegation decision. */
class BoundedOrchestratorModel extends BaseLlm {
  turns = 0;
  exceeded = false;
  readonly delegate: BaseLlm;
  readonly limit: number;

  constructor(delegate: BaseLlm, limit: number) {
    super({model:delegate.model});
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Orchestrator ADK turn budget must be between 1 and 100");
    }
    this.delegate = delegate;
    this.limit = limit;
  }

  override async *generateContentAsync(
    request: LlmRequest, stream?: boolean, signal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void> {
    if (this.turns >= this.limit) {
      this.exceeded = true;
      throw new Error("Orchestrator ADK model turn budget exceeded");
    }
    this.turns += 1;
    yield* this.delegate.generateContentAsync(request, stream, signal);
  }

  override connect(_request:LlmRequest):Promise<BaseLlmConnection> {
    return Promise.reject(new Error("Protected Orchestrator does not permit live connections"));
  }
}

/**
 * Google ADK is the real task/tool-calling runtime for the user-facing
 * orchestrator; the existing deterministic coordinator stays authoritative.
 *
 * The only ADK tool is a one-shot invocation of the entire immutable
 * workflow. ADK never receives root DCs, child DCs, delegation evidence,
 * keys, permission templates, provider tokens or unrestricted tool handles.
 * The result is taken from the coordinator, not from LLM prose.
 *
 * PR creation is allowed by existing Gateway/DC/OPA controls. This does NOT
 * expose or authorize a merge tool, which will require separate human approval.
 */
export class AdkAccountSuspensionOrchestrator {
  readonly #config: AdkOrchestratorConfig;

  constructor(config: AdkOrchestratorConfig) {
    if (!config.workflow || typeof config.workflow.run !== "function") {
      throw new Error("ADK Orchestrator requires the deterministic workflow executor");
    }
    this.#config=config;
  }

  async run(): Promise<AccountSuspensionSequentialRunResult> {
    const model = new BoundedOrchestratorModel(
      this.#config.model, this.#config.maxModelTurns ?? 4
    );
    let invocations = 0;
    let toolError = false;
    let coordinatorResult: AccountSuspensionSequentialRunResult | undefined;

    const tool = new FunctionTool({
      name: "run_account_suspension_workflow",
      description:
        "Run the fixed, Gateway-authorized Account Suspension workflow " +
        "(branch -> Backend -> Frontend -> Test -> Pull Request). " +
        "No arbitrary role, permission, repository, revision or merge arguments.",
      parameters: z.object({
        workflow: z.literal("account_suspension")
      }).strict(),
      execute: async () => {
        invocations++;
        if (invocations !== 1) {
          toolError = true;
          return {ok:false,error:"workflow_already_invoked"};
        }
        try {
          coordinatorResult = await this.#config.workflow.run();
          if (coordinatorResult.workflow.state !== "pr_created" ||
              coordinatorResult.workflow.pull_request === null ||
              coordinatorResult.workflow.completed_roles.join(",") !== "backend,frontend,test") {
            toolError = true;
            return {ok:false,error:"workflow_not_completed"};
          }
          return {
            ok:true,
            workflow_state:"pr_created",
            branch:"feature/account-suspension",
            completed_roles:["backend","frontend","test"],
            pull_request_number:coordinatorResult.pull_request.pull_request_number,
            head_revision:coordinatorResult.pull_request.revision
          };
        } catch {
          toolError = true;
          // Never send credentials, Adapter/Gateway errors, or stack traces to LLM.
          return {ok:false,error:"protected_workflow_failed"};
        }
      }
    });

    const agent = new LlmAgent({
      name:"account_suspension_orchestrator",
      description:"Delegated and bounded Account Suspension workflow orchestrator",
      model,
      instruction:
        "You are the workflow interface for the Account Suspension thesis PoC. " +
        "For an authorized user request, invoke run_account_suspension_workflow " +
        "exactly once with workflow=account_suspension. This tool encapsulates " +
        "the immutable role/delegation sequence. Never request custom permissions, " +
        "skip tests, select another repository or merge a pull request. " +
        "A tool failure is terminal. Do not fabricate success.",
      tools:[tool],
      disallowTransferToParent:true,
      disallowTransferToPeers:true
    });
    const appName="thesis_delegation_orchestrator";
    const userId="software_engineer";
    const sessionId="account_suspension_workflow";
    const sessionService=new InMemorySessionService();
    const runner=new Runner({agent,appName,sessionService});
    await sessionService.createSession({appName,userId,sessionId});
    let modelError=false;
    for await (const event of runner.runAsync({
      userId,sessionId,newMessage:{
        role:"user",
        parts:[{text:ACCOUNT_SUSPENSION_REQUIREMENT}]
      }
    })) {
      if (event.errorCode || event.errorMessage) modelError=true;
    }

    // A claimed success in model text is never sufficient.
    if (modelError || model.exceeded || toolError || invocations !== 1 ||
        coordinatorResult?.workflow.state !== "pr_created") {
      throw new Error("ADK Orchestrator did not finish the authorized one-shot workflow");
    }
    return coordinatorResult;
  }
}
