/** Only fixed classifications leave the isolated native A2A executor. */
export function classifyApprovedDagFailure(error){
  const m=typeof error?.message==="string"?error.message:"";
  if(m.startsWith("Trusted dispatch failed;"))return "a2a_dispatch_failed";
  if(m.startsWith("Trusted Orchestrator Task failed;"))return "orchestrator_task_failed";
  if(m.startsWith("Trusted DAG termination or revocation not confirmed"))return "root_revocation_unconfirmed";
  if(m.startsWith("Approved Task dependencies not verified"))return "dependency_denied";
  if(m.startsWith("ADK protected model failure:"))return "adk_model_failure";
  if(m.startsWith("ADK controlled task failed:"))return "controlled_tool_failure";
  if(m.startsWith("ADK task produced no confirmed repository revision"))return "no_confirmed_revision";
  // A2A reports a failed terminal Task even when Docker's own FAIL receipt
  // is authentic. This does not mean the Test Task completed successfully.
  if(m==="Protected A2A task ended without completion")
    return "a2a_task_not_completed";
  if(/^Remote A2A Task [^\r\n]{1,120} is not completed$/u.test(m))return "a2a_task_not_completed";
  if(/^Remote A2A Task [^\r\n]{1,120} must return exactly one Artifact$/u.test(m)||
     m==="Remote A2A Artifact must contain exactly one JSON data part")return "a2a_artifact_invalid";
  if(m.startsWith("Protected A2A result does not match"))return "a2a_result_mismatch";
  if(m.startsWith("Gateway provider effects changed"))return "attestation_effect_race";
  if(error?.code==="approved_plan_denied")return "approved_plan_denied";
  if(error?.code==="ERR_ASSERTION")return "test_assertion";
  return "unclassified";
}


/**
 * R116: publish no raw error text or stack traces. Surface only a fixed
 * first-party code-site enum, an allowlisted error kind and a bounded
 * cause chain. A source filename is allowed only if explicitly enumerated;
 * diagnostics from third-party code, generated source and model text
 * remain "unknown". Numbers are source-code line indices, not secrets.
 */
const TRUSTED_SITES=Object.freeze(new Set([
  "native-approved-planner-dag-positive.mjs",
  "trusted-approved-a2a-dispatcher.ts",
  "a2a-workflow.ts",
  "orchestrator.ts",
  "executor.ts",
  "adk-a2a-handler.ts",
  "artifact-validation.ts",
  "private-request-handler.ts",
  "gateway-tool-client.ts",
  "adk-tool-progress.ts",
  "approved-execution-plans.ts",
  "runtime.ts",
  "execute.ts",
  "runner-client.ts",
  "isolated-executor.ts",
  "native-approved-dag-failure-category.mjs"
]));
const KNOWN_CODES=new Set([
  "ERR_ASSERTION","approved_plan_denied","ERR_INVALID_ARG_TYPE",
  "ERR_HTTP_HEADERS_SENT","ECONNRESET","ETIMEDOUT","ECONNREFUSED",
  "ABORT_ERR","ERR_INVALID_STATE"
]);
const KNOWN_KINDS=new Set([
  "Error","AssertionError","TypeError","RangeError","SyntaxError",
  "AbortError","TimeoutError","AggregateError"
]);
function approvedSite(stack){
  if(typeof stack!=="string")return null;
  for(const line of stack.split("\n").slice(0,18)){
    // Only paths inside our own first-party packages/apps can be disclosed.
    const m=line.match(/(?:poc\/(?:packages|apps)\/[A-Za-z0-9_./-]+\/)([A-Za-z0-9_.-]+\.(?:ts|mjs)):(\d{1,4}):\d{1,4}/u);
    if(m&&TRUSTED_SITES.has(m[1])){
      const lineNumber=Number(m[2]);
      if(lineNumber>=1&&lineNumber<=2500)
        return Object.freeze({module:m[1],line:lineNumber});
    }
  }
  return null;
}
export function safeApprovedDagFailureTrace(error){
  const result=[];
  let current=error;
  const seen=new Set();
  for(let depth=0;depth<4;depth++){
    if(!current||typeof current!=="object"||seen.has(current))break;
    seen.add(current);
    const code=typeof current.code==="string"&&KNOWN_CODES.has(current.code)
      ?current.code:"unknown";
    const kind=typeof current.name==="string"&&KNOWN_KINDS.has(current.name)
      ?current.name:"unknown";
    result.push(Object.freeze({
      category:classifyApprovedDagFailure(current),kind,code,
      site:approvedSite(current.stack)
    }));
    current=current.cause;
  }
  return Object.freeze(result);
}
