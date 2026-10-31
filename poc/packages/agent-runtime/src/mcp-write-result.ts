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
  // An authenticated shared MCP ToolResult may be text-only in some SDK
  // branches even when the server returned a structured result. Accept ONLY
  // one bounded JSON tool-result part, never model prose or an isError reply.
  let payload=record(envelope?.structuredContent);
  if(payload===null&&envelope?.isError!==true&&
     Array.isArray(envelope?.content)&&envelope.content.length===1){
    const part=record(envelope.content[0]);
    if(part?.type==="text"&&typeof part.text==="string"&&
       part.text.length<=8192){
      try{
        const decoded=record(JSON.parse(part.text));
        if(decoded&&Object.keys(decoded).sort().join(",")==="ok,result"&&
           decoded.ok===true)payload=decoded;
      }catch{/* A malformed text-only result is never a receipt. */}
    }
  }
  // This reports fixed enums and booleans only: never source bytes, paths,
  // arbitrary upstream messages or private authorization material.
  const safeFailure=(stage:string,kind:string|null=null,
    flags?:Record<string,boolean>):void=>{
    process.stderr.write(JSON.stringify({
      event:"mcp_update_safe_diagnostic",
      stage, ...(kind?{kind}:{}),
      ...(flags?{receipt_checks:flags}:{})
    })+"\n");
  };
  if(envelope?.isError===true||payload?.ok!==true){
    const kind=record(payload?.error)?.kind;
    const safeKinds=new Set([
      "authorization_denied","invalid_tool_call","inactive_task",
      "unauthorized","tool_unavailable","task_worker_unavailable",
      "task_worker_invalid_result","task_worker_rejected",
      "invalid_tool_arguments"
    ]);
    safeFailure(payload===null
      ?envelope?.isError===true?"unstructured_mcp_error":"missing_structured_content"
      :"upstream_failure",
      typeof kind==="string"&&safeKinds.has(kind)?kind:"unknown");
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
    safeFailure("invalid_provider_receipt",null,{
      gitea_provider:result?.provider==="gitea",
      provider_performed:result?.performed===true,
      expected_tool:result?.tool==="update_file",
      exact_branch:result?.branch===args.branch,
      exact_path:result?.path===args.path,
      commit_sha:typeof result?.commit_sha==="string"&&
        sha.test(result.commit_sha),
      consistent_revision:result?.revision===result?.commit_sha,
      blob_sha:typeof result?.blob_sha==="string"&&
        sha.test(result.blob_sha),
      precondition_sha:typeof result?.precondition_blob_sha==="string"&&
        sha.test(result.precondition_blob_sha)
    });
    return error("tool_unavailable");
  }
  return {ok:true,result:payload.result};
}
