import type {Express} from "express";
import express from "express";
import {ControlledToolError} from "./controlled-errors.ts";
import {PrivateMcpTaskError,PrivateMcpTaskRegistry} from "./private-mcp-task-registry.ts";

/** The only bridge from the shared MCP service into private per-A2A-task state. */
export function attachPrivateMcpWorker(app:Express,registry:PrivateMcpTaskRegistry):void {
  // The crypto profile never receives signing keys or signed VP bytes.
  // It calls this authenticated private worker, which returns only proof_ref.
  app.post("/internal/mcp-crypto-call",
    express.json({limit:"4kb",strict:true}),async(req,res)=>{
      res.setHeader("cache-control","no-store");
      try{
        const result=await registry.invokeCrypto(req.header("authorization"),req.body);
        res.status(200).json({ok:true,result});
      }catch(error){
        if(error instanceof PrivateMcpTaskError){
          const status=error.kind==="unauthorized"?401:
            error.kind==="inactive_task"?403:400;
          res.status(status).json({ok:false,error:{kind:error.kind}});
        }else if(error instanceof ControlledToolError){
          res.status(error.kind==="authorization_denied"?403:503)
            .json({ok:false,error:{kind:error.kind}});
        }else{
          res.status(503).json({ok:false,error:{kind:"tool_unavailable"}});
        }
      }
    }
  );
  app.post("/internal/mcp-tool-call",express.json({limit:"128kb",strict:true}),async(req,res)=>{
    res.setHeader("cache-control","no-store");
    try {
      const result=await registry.invoke(req.header("authorization"),req.body);
      res.status(200).json({ok:true,result});
    } catch(error) {
      if (error instanceof PrivateMcpTaskError) {
        const status=error.kind==="unauthorized"?401:error.kind==="inactive_task"?403:400;
        res.status(status).json({ok:false,error:{kind:error.kind}});
      } else if (error instanceof ControlledToolError) {
        const status=error.kind==="authorization_denied"?403:
          error.kind==="invalid_tool_call"?400:
          error.kind==="tests_failed"?422:503;
        // Never disclose Gateway or Adapter error text to the MCP caller.
        res.status(status).json({ok:false,error:{kind:error.kind}});
      } else {
        res.status(503).json({ok:false,error:{kind:"tool_unavailable"}});
      }
    }
  });
}
