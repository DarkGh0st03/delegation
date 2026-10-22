#!/usr/bin/env node
/**
 * Offline authenticated GitHub event INPUT check. No API key, no signing
 * key, no ADK/Gemini inference, no credential or approved plan activation.
 */
import {readFile,stat} from "node:fs/promises";
import {verifyGithubManualGeminiDispatch} from
  "../../../packages/orchestrator-runtime/src/trusted-manual-github-dispatch.ts";

try{
  const file=process.env.GITHUB_EVENT_PATH;
  if(!file)throw Error("GitHub event payload path missing");
  const metadata=await stat(file);
  if(!metadata.isFile()||metadata.size<1||metadata.size>65536)
    throw Error("Unexpected GitHub event payload size");
  const event=JSON.parse(await readFile(file,"utf8"));
  const checked=verifyGithubManualGeminiDispatch({
    env:process.env,
    event,
    pinned:{
      repository:"DarkGh0st03/delegation",
      ref:"refs/heads/refactor/post-prof-plan-contracts-20261021",
      workflowPath:".github/workflows/trusted-gemini-dispatch-preflight.yml"
    }
  });
  process.stdout.write(JSON.stringify({
    status:checked.status,
    source_ref:checked.source_ref,
    model_name:checked.model_name,
    max_model_turns:checked.max_model_turns,
    max_output_tokens:checked.max_output_tokens,
    max_model_call_ms:checked.max_model_call_ms,
    engineer_signature:"not_verified",
    active_planning_root:"not_verified",
    gemini_inference_calls:0
  })+"\n");
}catch(error){
  process.stderr.write("Manual dispatch input rejected: "+
    String(error?.message??"invalid_event")+"\n");
  process.exitCode=1;
}
