import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {CallToolResult} from "@modelcontextprotocol/sdk/types.js";
import {createTaskBearerFetch} from "./mcp-task-fetch.ts";

// The MCP SDK default is 60 seconds per request. run_tests invokes the real
// Docker Runner, which may legitimately take longer. Keep this below the
// Agent -> Gateway execute ceiling (960s), and above the Gateway -> Runner
// ceiling (900s). Do not change the timeouts for read/write/create tools.
export const MCP_RUN_TESTS_TIMEOUT_MS = 930_000;

export type McpRunTestsArguments = {
  branch: string;
  profile: "poc-default";
};

/** Separate pure request boundary for offline timeout/abort regressions. */
export async function requestTimedMcpRunTests(
  client: Pick<Client, "callTool">,
  args: McpRunTestsArguments,
  signal?: AbortSignal,
  timeoutMs: number = MCP_RUN_TESTS_TIMEOUT_MS
): Promise<CallToolResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > MCP_RUN_TESTS_TIMEOUT_MS) {
    throw new Error("Invalid bounded MCP run_tests timeout");
  }
  signal?.throwIfAborted();
  return await client.callTool(
    {name:"run_tests",arguments:args},
    undefined,
    {timeout:timeoutMs,...(signal ? {signal} : {})}
  ) as CallToolResult;
}

/**
 * Test-only tool call through the SAME shared MCP endpoint and task bearer.
 * ADK's MCPTool wrapper currently does not pass per-tool request timeouts,
 * so the SDK's 60-second default aborts long-running run_tests calls.
 * Model inputs never contain credentials; the trusted fetch injects the
 * task-bound bearer and rejects redirects/other endpoints.
 */
export async function callTimedMcpRunTests(options:{
  endpoint:string;
  bearerForRequest:()=>string;
  args:McpRunTestsArguments;
  signal?:AbortSignal;
  fetchFn?:typeof fetch;
}):Promise<CallToolResult>{
  options.signal?.throwIfAborted();
  const authorizedFetch=createTaskBearerFetch(
    options.endpoint,options.bearerForRequest,options.fetchFn
  );
  const transport=new StreamableHTTPClientTransport(new URL(options.endpoint),{
    fetch:authorizedFetch
  });
  const client=new Client({name:"delegation-test-agent-runner",version:"1.0.0"});
  try{
    await client.connect(transport);
    options.signal?.throwIfAborted();
    return await requestTimedMcpRunTests(client,options.args,options.signal);
  }finally{
    await client.close();
  }
}
