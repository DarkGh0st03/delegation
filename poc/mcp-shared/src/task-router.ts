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
    return this.#invoke(claims,taskToken,"read_file",parseReadFileArgs(raw));
  }
  async updateFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    return this.#invoke(claims,taskToken,"update_file",parseUpdateFileArgs(raw));
  }
  async createFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    return this.#invoke(claims,taskToken,"create_file",parseCreateFileArgs(raw));
  }
  async runTests(claims: Readonly<TaskClaims>, taskToken: string, raw:unknown):Promise<unknown>{
    return this.#invoke(claims,taskToken,"run_tests",parseRunTestsArgs(raw));
  }
  async #invoke(claims: Readonly<TaskClaims>, taskToken: string,
    tool: "read_file"|"update_file"|"create_file"|"run_tests",
    args: ReadFileArgs|UpdateFileArgs|CreateFileArgs|RunTestsArgs): Promise<unknown> {
    const url=new URL("/internal/mcp-tool-call", this.#workers[claims.role].baseUrl);
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
      const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as {error?:{kind?:unknown}}).error?.kind : undefined;
      const safe = ["authorization_denied", "invalid_tool_call", "inactive_task",
                    "unauthorized", "tool_unavailable", "tests_failed"];
      // Errors are fixed-category only. Never forward a worker's raw error text.
      throw new Error(typeof candidate === "string" && safe.includes(candidate)
        ? candidate : "task_worker_rejected");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        (parsed as Record<string,unknown>).ok !== true || !("result" in parsed)) {
      throw new Error("task_worker_invalid_result");
    }
    return (parsed as {result:unknown}).result;
  }
}
