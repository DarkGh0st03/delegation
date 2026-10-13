import {ControlledToolError,controlledToolErrorPayload} from "./controlled-errors.ts";

/**
 * ADK 2.2.1 MCPTool.runAsync returns an MCP CallToolResult. Its trusted
 * Gateway-confirmed payload is inside structuredContent, NOT at top level.
 * Fail closed if the envelope or Gitea read result is malformed.
 */
export function normalizeMcpReadFileOutcome(
  response: unknown, args: Record<string,unknown>
): {ok:true;result:unknown} | ReturnType<typeof controlledToolErrorPayload> {
  function reject(kind:"authorization_denied"|"invalid_tool_call"|"tool_unavailable") {
    return controlledToolErrorPayload(new ControlledToolError(kind,"MCP "+kind));
  }
  function record(value:unknown):Record<string,unknown>|null {
    return value!==null && typeof value==="object" && !Array.isArray(value)
      ? value as Record<string,unknown> : null;
  }
  const envelope=record(response);
  const payload=record(envelope?.structuredContent);
  const declaredError=record(payload?.error);
  if (envelope?.isError===true || payload?.ok!==true) {
    const value=declaredError?.kind;
    if(value==="authorization_denied")return reject("authorization_denied");
    if(value==="invalid_tool_call")return reject("invalid_tool_call");
    return reject("tool_unavailable");
  }
  const result=record(payload.result);
  if (result?.provider!=="gitea" || result?.performed!==true ||
      result?.tool!=="read_file" ||
      result?.branch!==args.branch || result?.path!==args.path ||
      typeof result?.revision!=="string" ||
      !/^[a-f0-9]{40}$/u.test(result.revision) ||
      typeof result?.content!=="string") {
    return reject("tool_unavailable");
  }
  return {ok:true,result:payload.result};
}
