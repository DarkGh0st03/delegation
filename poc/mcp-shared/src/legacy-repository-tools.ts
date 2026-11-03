/**
 * R166 — deliberately isolated historical repository/Runner MCP tools.
 *
 * Only the explicit profile:"legacy" call in http-server.ts registers this
 * surface. The canonical signed DAG uses FunctionTools -> Gateway directly
 * and an entirely different crypto-only MCP catalog. This is retained to
 * reproduce pre-20 October regressions; never import into approved agents.
 */
import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {toolFailureReasonFields} from "./tool-failure-reason.ts";
import type {verifyTaskToken} from "./task-token.ts";
import {TaskRouter,WorkerTestsFailedError} from "./task-router.ts";
import {MCP_READ_FILE,MCP_UPDATE_FILE,MCP_CREATE_FILE,MCP_RUN_TESTS,
  MAX_MCP_UPDATE_BYTES,MAX_MCP_CREATE_BYTES,isMcpFeatureBranch}
  from "./catalog.ts";

export function registerLegacyRepositoryTools(
 mcp:McpServer,router:TaskRouter,
 claims:ReturnType<typeof verifyTaskToken>,token:string
):void {
 // Parsed tool arguments never create a grant: task worker controls scope.
 const featureBranch=z.string().max(120).refine(isMcpFeatureBranch);
 mcp.registerTool(MCP_READ_FILE.name,{
   description:MCP_READ_FILE.description,
   inputSchema:{
     branch:featureBranch,
     path:z.string().min(1).max(2048)
   }
 },async args=>{
   try {
     const result=await router.readFile(claims,token,args);
     const payload={ok:true,result};
     return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
   } catch(e) {
     const candidate=e instanceof Error?e.message:"tool_unavailable";
     const kind=[
       "invalid_tool_arguments","task_worker_unavailable",
       "task_worker_rejected","task_worker_invalid_result",
       "authorization_denied","invalid_tool_call","inactive_task",
       "unauthorized","tool_unavailable","tests_failed"
     ].includes(candidate)?candidate:"tool_unavailable";
     const payload={ok:false,error:{kind,...toolFailureReasonFields(e),
       ...(candidate==="invalid_tool_arguments"?{reason:"invalid_arguments"}:{})}};
     return {isError:true,content:[{type:"text" as const,text:JSON.stringify(payload)}],
       structuredContent:payload};
   }
 });
 mcp.registerTool(MCP_UPDATE_FILE.name,{
   description:MCP_UPDATE_FILE.description,
   inputSchema:{
     branch:featureBranch,
     path:z.string().min(1).max(2048),
     // The transport caps the full HTTP body; parser checks actual UTF-8 bytes.
     content:z.string().max(MAX_MCP_UPDATE_BYTES)
   }
 },async args=>{
   try {
     const result=await router.updateFile(claims,token,args);
     const payload={ok:true,result};
     return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
   }catch(e){
     const candidate=e instanceof Error?e.message:"tool_unavailable";
     const kind=[
       "invalid_tool_arguments","task_worker_unavailable",
       "task_worker_rejected","task_worker_invalid_result",
       "authorization_denied","invalid_tool_call","inactive_task",
       "unauthorized","tool_unavailable","tests_failed"
     ].includes(candidate)?candidate:"tool_unavailable";
     const payload={ok:false,error:{kind,...toolFailureReasonFields(e),
       ...(candidate==="invalid_tool_arguments"?{reason:"invalid_arguments"}:{})}};
     return {isError:true,content:[{type:"text" as const,text:JSON.stringify(payload)}],
       structuredContent:payload};
   }
 });
 mcp.registerTool(MCP_CREATE_FILE.name,{
   description:MCP_CREATE_FILE.description,
   inputSchema:{
     branch:featureBranch,
     path:z.string().min(1).max(2048),
     content:z.string().max(MAX_MCP_CREATE_BYTES)
   }
 },async args=>{
   try{
     const result=await router.createFile(claims,token,args);
     const payload={ok:true,result};
     return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
   }catch(e){
     const candidate=e instanceof Error?e.message:"tool_unavailable";
     const kind=[
       "invalid_tool_arguments","task_worker_unavailable",
       "task_worker_rejected","task_worker_invalid_result",
       "authorization_denied","invalid_tool_call","inactive_task",
       "unauthorized","tool_unavailable","tests_failed"
     ].includes(candidate)?candidate:"tool_unavailable";
     const payload={ok:false,error:{kind,...toolFailureReasonFields(e),
       ...(candidate==="invalid_tool_arguments"?{reason:"invalid_arguments"}:{})}};
     return {isError:true,
       content:[{type:"text" as const,text:JSON.stringify(payload)}],
       structuredContent:payload};
   }
 });
 mcp.registerTool(MCP_RUN_TESTS.name,{
   description:MCP_RUN_TESTS.description,
   inputSchema:{
     branch:featureBranch,
     profile:z.literal("poc-default")
   }
 },async args=>{
   try{
     const result=await router.runTests(claims,token,args);
     const payload={ok:true,result};
     return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
   }catch(e){
     const candidate=e instanceof Error?e.message:"tool_unavailable";
     const bounded=e instanceof WorkerTestsFailedError?e:null;
     const allowed=[
       "invalid_tool_arguments","task_worker_unavailable",
       "task_worker_rejected","task_worker_invalid_result",
       "authorization_denied","invalid_tool_call","inactive_task",
       "unauthorized","tool_unavailable","tests_failed"
     ];
     const kind=bounded?"tests_failed":allowed.includes(candidate)
       ?candidate:"tool_unavailable";
     const details=bounded?.phase?{
       first_failed_phase:bounded.phase,
       ...(bounded.typecheck_diagnostics.length
         ?{typecheck_diagnostics:bounded.typecheck_diagnostics}:{}),
       ...(bounded.typecheck_error_codes.length
         ?{typecheck_error_codes:bounded.typecheck_error_codes}:{}),
       ...(bounded.typecheck_scope_summary
         ?{typecheck_scope_summary:bounded.typecheck_scope_summary}:{}),
       ...(bounded.repair_requires_new_approval===true
         ?{repair_requires_new_approval:true}:{})
     }:undefined;
     const payload={ok:false,error:{kind,...(details?{details}:{})}};
     return {isError:true,
       content:[{type:"text" as const,text:JSON.stringify(payload)}],
       structuredContent:payload};
   }
 });

}
