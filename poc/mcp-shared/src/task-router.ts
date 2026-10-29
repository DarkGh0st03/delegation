import {parseCreatePresentationArgs,type CreatePresentationArgs} from "./crypto-catalog.ts";
import {sanitizeTypecheckLocations,sanitizeTypecheckErrorCodes,
  type TypecheckLocation}
  from "../../apps/test-runner-controller/src/typecheck-diagnostics.ts";
/** Shared MCP must independently revalidate even prefiltered private-worker
 * evidence, without importing the worker's private authority or secrets. */
type ScopeSummary=Readonly<{
  parsed_locations:number;
  missing_read_grants:number;
  missing_write_grants:number;
}>;
function safeScopeSummary(value:unknown):ScopeSummary|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const x=value as Record<string,unknown>;
  if(Object.keys(x).sort().join(",")!==
     "missing_read_grants,missing_write_grants,parsed_locations")
    return undefined;
  const valid=(n:unknown)=>typeof n==="number"&&
    Number.isSafeInteger(n)&&n>=0&&n<=8;
  if(!valid(x.parsed_locations)||!valid(x.missing_read_grants)||
     !valid(x.missing_write_grants)||
     (x.missing_read_grants as number)>(x.parsed_locations as number)||
     (x.missing_write_grants as number)>(x.parsed_locations as number))
    return undefined;
  return Object.freeze({
    parsed_locations:x.parsed_locations as number,
    missing_read_grants:x.missing_read_grants as number,
    missing_write_grants:x.missing_write_grants as number
  });
}
/** Only whitelisted failure metadata, no arbitrary untrusted error message. */
export class WorkerTestsFailedError extends Error {
  readonly phase:string|null;
  readonly typecheck_diagnostics:TypecheckLocation[];
  readonly typecheck_error_codes:readonly string[];
  readonly repair_requires_new_approval?:true;
  readonly typecheck_scope_summary?:ScopeSummary;
  constructor(phase:string|null,diagnostics:TypecheckLocation[],
    needsApproval=false,codes:readonly string[]=[],scope?:ScopeSummary){
    super("tests_failed"+(phase?":"+phase:""));
    this.name="WorkerTestsFailedError";
    this.phase=phase;
    this.typecheck_diagnostics=diagnostics;
    this.typecheck_error_codes=Object.freeze([...codes]);
    if(needsApproval)this.repair_requires_new_approval=true;
    if(needsApproval&&scope)this.typecheck_scope_summary=scope;
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
        const codes=validPhase==="typecheck"&&details&&
          typeof details==="object"&&!Array.isArray(details)
          ?sanitizeTypecheckErrorCodes(
            (details as {typecheck_error_codes?:unknown}).typecheck_error_codes):[];
        const newApproval=validPhase==="typecheck"&&details!==null&&
          typeof details==="object"&&!Array.isArray(details)&&
          (details as {repair_requires_new_approval?:unknown})
            .repair_requires_new_approval===true;
        const scope=newApproval===true&&details&&
          typeof details==="object"&&!Array.isArray(details)
          ?safeScopeSummary(
            (details as {typecheck_scope_summary?:unknown}).typecheck_scope_summary)
          :undefined;
        throw new WorkerTestsFailedError(validPhase,diagnostics,
          newApproval===true,codes,scope);
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
