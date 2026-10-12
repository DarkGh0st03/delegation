import {ControlledToolError,controlledToolErrorPayload} from "./controlled-errors.ts";

/** Reject any MCP write output not backed by an exact Gateway Gitea commit. */
export function normalizeMcpUpdateFileOutcome(
  response:unknown,args:Record<string,unknown>
):{ok:true;result:unknown}|ReturnType<typeof controlledToolErrorPayload>{
  function error(kind:"authorization_denied"|"invalid_tool_call"|"tool_unavailable"){
    return controlledToolErrorPayload(new ControlledToolError(kind,"MCP "+kind));
  }
  function record(v:unknown):Record<string,unknown>|null{
    return v!==null&&typeof v==="object"&&!Array.isArray(v)
      ? v as Record<string,unknown>:null;
  }
  const envelope=record(response);
  const payload=record(envelope?.structuredContent);
  if(envelope?.isError===true||payload?.ok!==true){
    const kind=record(payload?.error)?.kind;
    if(kind==="authorization_denied")return error("authorization_denied");
    if(kind==="invalid_tool_call")return error("invalid_tool_call");
    return error("tool_unavailable");
  }
  const result=record(payload.result);
  const sha=/^[a-f0-9]{40}$/u;
  if(result?.provider!=="gitea"||result?.performed!==true||
     result?.tool!=="update_file"||result?.branch!==args.branch||
     result?.path!==args.path||typeof result?.commit_sha!=="string"||
     !sha.test(result.commit_sha)||result.revision!==result.commit_sha||
     typeof result?.blob_sha!=="string"||!sha.test(result.blob_sha)||
     typeof result?.precondition_blob_sha!=="string"||
     !sha.test(result.precondition_blob_sha)){
    return error("tool_unavailable");
  }
  return {ok:true,result:payload.result};
}
