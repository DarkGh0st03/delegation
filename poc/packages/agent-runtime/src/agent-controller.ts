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
import type { ModelClient, ModelFunctionOutput } from "./llm-client.ts";
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
export interface AgentRuntimeAuditSink { emit(event: AgentRuntimeAuditEvent): void; }
export class InMemoryAgentRuntimeAuditSink implements AgentRuntimeAuditSink {
  readonly events: AgentRuntimeAuditEvent[] = [];
  emit(event: AgentRuntimeAuditEvent): void { this.events.push(structuredClone(event)); }
}
export interface AgentControllerConfig {
  modelClient: ModelClient; toolRegistry: ControlledToolRegistry; maxIterations?: number;
  audit?: AgentRuntimeAuditSink; instructions?: string;
}
export interface AgentControllerRunInput { task_id: string; role: SpecializedAgentRole; subtask: DeterministicSubtask; }
export interface AgentControllerFailureRecord { iteration: number; tool: string; kind: ControlledToolErrorKind; message: string; }
export interface AgentControllerRunResult {
  status: "completed" | "failed"; summary: string; model_id: string | null; iterations: number;
  tool_calls: number; controlled_failures: AgentControllerFailureRecord[];
  files_modified: string[]; files_created: string[]; revision: string | null;
  tested_commit_sha?: string; runner_profile?: "poc-default";
  project_tests?: "pass" | "fail"; researcher_acceptance?: "pass" | "fail" | "skipped";
}
const DEFAULT_INSTRUCTIONS = [
  "You are a controlled software-engineering Agent in a delegated-authorization thesis PoC.",
  "Use only the function tools provided by the runtime.",
  "Never claim a repository operation succeeded unless the corresponding tool result says it succeeded.",
  "If a controlled tool reports authorization_denied, do not attempt to bypass the boundary.",
  "If tests fail, inspect the structured result and decide whether another permitted edit is appropriate.",
  "Finish with a concise summary of work actually completed."
].join("\n");
export function modelVisibleTaskContext(context: AgentTaskContext): AgentControllerRunInput {
  return { task_id: context.task_id, role: context.role, subtask: structuredClone(context.subtask) };
}
function recordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export class AgentController {
  readonly #model: ModelClient; readonly #registry: ControlledToolRegistry; readonly #maxIterations: number;
  readonly #audit: AgentRuntimeAuditSink; readonly #instructions: string;
  constructor(config: AgentControllerConfig) {
    this.#model=config.modelClient; this.#registry=config.toolRegistry; this.#maxIterations=config.maxIterations ?? 8;
    this.#audit=config.audit ?? { emit:()=>undefined }; this.#instructions=config.instructions ?? DEFAULT_INSTRUCTIONS;
    if (!Number.isSafeInteger(this.#maxIterations) || this.#maxIterations <= 0) throw new Error("Agent Controller maxIterations must be a positive safe integer");
  }
  async run(input: AgentControllerRunInput): Promise<AgentControllerRunResult> {
    let previousResponseId: string | undefined;
    let nextInput: string | ModelFunctionOutput[] = JSON.stringify({task:input});
    let modelId: string | null=null; let toolCalls=0; let revision: string | null=null;
    const filesModified=new Set<string>(); const filesCreated=new Set<string>();
    let testedCommitSha: string | undefined; let runnerProfile: "poc-default" | undefined;
    let projectTests: "pass" | "fail" | undefined; let researcherAcceptance: "pass" | "fail" | "skipped" | undefined;
    const controlledFailures: AgentControllerFailureRecord[]=[];
    const snapshot=(status:"completed"|"failed",summary:string,iterations:number):AgentControllerRunResult=>({
      status,summary,model_id:modelId,iterations,tool_calls:toolCalls,controlled_failures:controlledFailures,
      files_modified:[...filesModified],files_created:[...filesCreated],revision,
      ...(testedCommitSha?{tested_commit_sha:testedCommitSha}:{}),...(runnerProfile?{runner_profile:runnerProfile}:{}),
      ...(projectTests?{project_tests:projectTests}:{}),...(researcherAcceptance?{researcher_acceptance:researcherAcceptance}:{})
    });
    for(let iteration=1;iteration<=this.#maxIterations;iteration+=1){
      const response=await this.#model.respond({instructions:this.#instructions,input:nextInput,tools:this.#registry.modelTools,...(previousResponseId?{previous_response_id:previousResponseId}:{})});
      modelId=response.model_id; previousResponseId=response.response_id;
      this.#audit.emit({event:"model_turn",iteration,model_id:response.model_id,response_id:response.response_id});
      if(response.function_calls.length===0) return snapshot("completed",response.output_text,iteration);
      const outputs:ModelFunctionOutput[]=[];
      for(const call of response.function_calls){
        toolCalls+=1;
        try{
          const result=await this.#registry.execute(call);
          const resultRecord=recordObject(result); const args=recordObject(JSON.parse(call.arguments));
          if((call.name==="update_file"||call.name==="create_file") && resultRecord && args){
            const path=typeof args.path==="string"?args.path:null; const sha=typeof resultRecord.commit_sha==="string"?resultRecord.commit_sha:null;
            if(path){ if(call.name==="update_file") filesModified.add(path); else filesCreated.add(path); }
            if(sha) revision=sha;
          }
          if(call.name==="run_tests" && resultRecord){
            if(typeof resultRecord.tested_commit_sha==="string"){testedCommitSha=resultRecord.tested_commit_sha; revision=testedCommitSha;}
            if(resultRecord.runner_profile==="poc-default") runnerProfile="poc-default";
            const pt=recordObject(resultRecord.project_tests); if(pt?.status==="pass"||pt?.status==="fail") projectTests=pt.status;
            const ra=recordObject(resultRecord.researcher_acceptance); if(ra?.status==="pass"||ra?.status==="fail"||ra?.status==="skipped") researcherAcceptance=ra.status;
          }
          outputs.push({type:"function_call_output",call_id:call.call_id,output:JSON.stringify({ok:true,result})});
          this.#audit.emit({event:"tool_result",iteration,tool:call.name,outcome:"success"});
        }catch(error){
          const payload=controlledToolErrorPayload(error);
          outputs.push({type:"function_call_output",call_id:call.call_id,output:JSON.stringify(payload)});
          const kind=error instanceof ControlledToolError?error.kind:payload.error.kind;
          controlledFailures.push({iteration,tool:call.name,kind,message:payload.error.message});
          this.#audit.emit({event:"tool_result",iteration,tool:call.name,outcome:"controlled_failure",failure_kind:kind});
        }
      }
      nextInput=outputs;
    }
    controlledFailures.push({iteration:this.#maxIterations,tool:"controller",kind:"iteration_limit",message:"Agent Controller reached the configured iteration limit."});
    return snapshot("failed","Agent Controller reached the configured iteration limit.",this.#maxIterations);
  }
}
