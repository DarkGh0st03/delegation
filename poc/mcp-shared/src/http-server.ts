import {MCP_CREATE_PRESENTATION} from "./crypto-catalog.ts";
import {createServer, type ServerResponse} from "node:http";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {z} from "zod";
import {bearerToken, verifyTaskToken, type VerificationKeys} from "./task-token.ts";
import {TaskRouter,WorkerTestsFailedError} from "./task-router.ts";
import {MCP_READ_FILE,MCP_UPDATE_FILE,MCP_CREATE_FILE,MCP_RUN_TESTS,MAX_MCP_UPDATE_BYTES,MAX_MCP_CREATE_BYTES,isMcpFeatureBranch} from "./catalog.ts";

export interface SharedMcpConfig {
  verificationKeys:VerificationKeys;
  router:TaskRouter;
  /** Legacy is retained only until the paid baseline is safely migrated. */
  profile?:"legacy"|"crypto";
}
function reply(res:ServerResponse,status:number,body:unknown) {
  res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
  res.end(JSON.stringify(body));
}
/** One long-running shared HTTP listener; stateless per-request MCP transports. */
export function createSharedMcpHttpServer(config:SharedMcpConfig) {
  return createServer(async(req,res)=>{
    if (req.method==="GET" && req.url==="/health") {
      reply(res,200,{status:"ok",service:"thesis-shared-mcp",tool_count:config.profile==="crypto"?1:4,profile:config.profile??"legacy"}); return;
    }
    if (req.url!=="/mcp") {reply(res,404,{error:"not_found"});return;}
    // MCP Streamable HTTP requires protecting local listeners from
    // cross-origin browser/DNS-rebinding requests.
    if (req.headers.origin !== undefined) {
      reply(res,403,{error:"origin_not_allowed"});return;
    }
    if (req.method!=="POST") {reply(res,405,{error:"method_not_allowed"});return;}
    let token: string;
    let claims;
    try {
      token=bearerToken(req.headers.authorization);
      claims=verifyTaskToken(token,config.verificationKeys);
    } catch {reply(res,401,{error:"unauthorized"});return;}
    // Strictly cap incoming JSON before handing it to the MCP transport.
    // Bounded write/create source uploads; never accept unbounded source code.
    const MAX_BODY=128*1024;
    const chunks:Buffer[]=[];
    let total=0;
    let parsedBody:unknown;
    try {
      for await (const part of req) {
        const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
        total+=bytes.length;
        if (total>MAX_BODY) throw new Error("body_too_large");
        chunks.push(bytes);
      }
      parsedBody=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reply(res,400,{error:"invalid_or_oversized_mcp_json"});return;
    }
    const mcp=new McpServer({name:"thesis-shared-mcp",version:"0.1.0"});
    // A tool schema validates syntax, not grant: active Task worker is authoritative.
    const featureBranch=z.string().max(120).refine(isMcpFeatureBranch);
    if(config.profile!=="crypto") {
    mcp.registerTool(MCP_READ_FILE.name,{
      description:MCP_READ_FILE.description,
      inputSchema:{
        branch:featureBranch,
        path:z.string().min(1).max(2048)
      }
    },async args=>{
      try {
        const result=await config.router.readFile(claims,token,args);
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
        const payload={ok:false,error:{kind}};
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
        const result=await config.router.updateFile(claims,token,args);
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
        const payload={ok:false,error:{kind}};
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
        const result=await config.router.createFile(claims,token,args);
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
        const payload={ok:false,error:{kind}};
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
        const result=await config.router.runTests(claims,token,args);
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
          ...(bounded.repair_requires_new_approval===true
            ?{repair_requires_new_approval:true}:{})
        }:undefined;
        const payload={ok:false,error:{kind,...(details?{details}:{})}};
        return {isError:true,
          content:[{type:"text" as const,text:JSON.stringify(payload)}],
          structuredContent:payload};
      }
    });
    } else {
      // Crypto-only surface: no general read/write/run_test tools.
      // All signing material and the VP stay inside the private task worker.
      mcp.registerTool(MCP_CREATE_PRESENTATION.name,{
        description:MCP_CREATE_PRESENTATION.description,
        inputSchema:{request_id:z.string().min(1).max(256)}
      },async args=>{
        try {
          const result=await config.router.createPresentation(claims,token,args);
          const payload={ok:true,result};
          return {
            content:[{type:"text" as const,text:JSON.stringify(payload)}],
            structuredContent:payload
          };
        }catch(e){
          const candidate=e instanceof Error?e.message:"tool_unavailable";
          const kind=[
            "invalid_tool_arguments","task_worker_unavailable",
            "task_worker_rejected","task_worker_invalid_result",
            "authorization_denied","invalid_tool_call","inactive_task",
            "unauthorized","tool_unavailable"
          ].includes(candidate)?candidate:"tool_unavailable";
          const payload={ok:false,error:{kind}};
          return {
            isError:true,
            content:[{type:"text" as const,text:JSON.stringify(payload)}],
            structuredContent:payload
          };
        }
      });
    }
    const transport=new StreamableHTTPServerTransport({
      sessionIdGenerator:undefined,enableJsonResponse:true
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req,res,parsedBody);
    } catch {
      if (!res.headersSent) reply(res,500,{error:"mcp_transport_error"});
    } finally {
      res.once("close",()=>{void transport.close();void mcp.close();});
      if (res.writableEnded) {await transport.close();await mcp.close();}
    }
  });
}
