import {parseCreatePresentationArgs,type CreatePresentationArgs} from "./crypto-catalog.ts";
import {sanitizeTypecheckLocations,type TypecheckLocation}
  from "../../apps/test-runner-controller/src/typecheck-diagnostics.ts";
/** Only whitelisted failure metadata, no arbitrary untrusted error message. */
export class WorkerTestsFailedError extends Error {
  readonly phase:string|null;
  readonly typecheck_diagnostics:TypecheckLocation[];
  constructor(phase:string|null,diagnostics:TypecheckLocation[]){
    super("tests_failed"+(phase?":"+phase:""));
    this.name="WorkerTestsFailedError";
    this.phase=phase;
    this.typecheck_diagnostics=diagnostics;
  }
}
import type {AgentRole, TaskClaims} from "./task-token.ts";
import {parseReadFileArgs,parseUpdateFileArgs,parseCreateFileArgs,parseRunTestsArgs,type ReadFileArgs,type UpdateFileArgs,type CreateFileArgs,type RunTestsArgs} from "./catalog.ts";
export type WorkerEndpoints = Readonly<Record<AgentRole,{baseUrl:string}>>;
/**
 * MCP keeps only public keys and routes to an Agent's trusted private worker.
 * The worker MUST reverify token signature, check ACTIVE task_id, and use its
 * existing per-task GatewayControlledToolClient (which owns private evidence).
 */
export class TaskRouter {
  readonly #workers: WorkerEndpoints;
  readonly #fetch: typeof fetch;
  constructor(workers: WorkerEndpoints, fetchFn: typeof fetch = fetch) {
    for (const role of ["backend","frontend","test"] as const) {
      const u=new URL(workers[role].baseUrl);
      if (!["http:","https:"].includes(u.protocol) || u.username || u.password || u.hash) {
        throw new Error("invalid_worker_endpoint");
      }
    }
    this.#workers=workers; this.#fetch=fetchFn;
  }
  async readFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    return this.#invoke(claims,taskToken,"read_file",parseReadFileArgs(raw,"approved"));
  }
  async updateFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    return this.#invoke(claims,taskToken,"update_file",parseUpdateFileArgs(raw,"approved"));
  }
  async createFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    return this.#invoke(claims,taskToken,"create_file",parseCreateFileArgs(raw,"approved"));
  }
  async runTests(claims: Readonly<TaskClaims>, taskToken: string, raw:unknown):Promise<unknown>{
    return this.#invoke(claims,taskToken,"run_tests",parseRunTestsArgs(raw,"approved"));
  }
  async createPresentation(
    claims:Readonly<TaskClaims>,taskToken:string,raw:unknown
  ):Promise<unknown>{
    return this.#invoke(
      claims,taskToken,"delegation_create_presentation",
      parseCreatePresentationArgs(raw),"/internal/mcp-crypto-call"
    );
  }
  async #invoke(claims: Readonly<TaskClaims>, taskToken: string,
    tool: "read_file"|"update_file"|"create_file"|"run_tests"|"delegation_create_presentation",
    args: ReadFileArgs|UpdateFileArgs|CreateFileArgs|RunTestsArgs|CreatePresentationArgs,
    route="/internal/mcp-tool-call"): Promise<unknown> {
    const url=new URL(route, this.#workers[claims.role].baseUrl);
    let response: Response;
    try {
      response=await this.#fetch(url,{
        method:"POST",
        headers:{authorization:"Bearer "+taskToken,"content-type":"application/json"},
        body:JSON.stringify({tool,arguments:args}),
        redirect:"error",
        // The controlled Runner may take minutes. Other MCP operations remain at 10s.
        signal:AbortSignal.timeout(tool==="run_tests"?990_000:10_000)
      });
    } catch { throw new Error("task_worker_unavailable"); }
    if (Number(response.headers.get("content-length"))>2_000_000) throw new Error("task_worker_invalid_result");
    let parsed: unknown;
    try {
      const body=await response.text();
      if (body.length>2_000_000) throw new Error("oversized");
      parsed=JSON.parse(body);
    } catch { throw new Error("task_worker_invalid_result"); }
    if (!response.ok) {
      const failure=parsed && typeof parsed==="object"&&!Array.isArray(parsed)
        ? (parsed as {error?:{kind?:unknown;details?:unknown}}).error:undefined;
      const candidate=failure?.kind;
      const safe=["authorization_denied","invalid_tool_call","inactive_task",
        "unauthorized","tool_unavailable","tests_failed"];
      if(candidate==="tests_failed"&&tool==="run_tests"){
        const details=failure?.details;
        const phase=details&&typeof details==="object"&&!Array.isArray(details)
          ?(details as {first_failed_phase?:unknown}).first_failed_phase:null;
        const phases=new Set(["dependency_install","typecheck","backend_tests",
          "frontend_tests","build","playwright_e2e","researcher_acceptance"]);
        // Only a fixed enum crosses to shared MCP; no free-form exception.
        const validPhase=typeof phase==="string"&&phases.has(phase)?phase:null;
        const diagnostics=validPhase==="typecheck"&&details&&
          typeof details==="object"&&!Array.isArray(details)
          ?sanitizeTypecheckLocations((details as {typecheck_diagnostics?:unknown})
            .typecheck_diagnostics):[];
        throw new WorkerTestsFailedError(validPhase,diagnostics);
      }
      throw new Error(typeof candidate==="string"&&safe.includes(candidate)
        ?candidate:"task_worker_rejected");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        (parsed as Record<string,unknown>).ok !== true || !("result" in parsed)) {
      throw new Error("task_worker_invalid_result");
    }
    return (parsed as {result:unknown}).result;
  }
}
