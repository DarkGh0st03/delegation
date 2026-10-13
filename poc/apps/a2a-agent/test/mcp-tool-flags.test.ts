import test from "node:test";
import assert from "node:assert/strict";
import {resolveMcpToolFlags} from "../src/mcp-tool-flags.ts";

const endpoint="http://127.0.0.1:8131/mcp";
test("MCP specialized agent tools remain disabled by default",()=>{
  assert.deepEqual(resolveMcpToolFlags({},"test","adk",endpoint),{});
  assert.deepEqual(resolveMcpToolFlags({
    ADK_MCP_UPDATE_FILE:"false",
    ADK_MCP_CREATE_FILE:"false",
    ADK_MCP_RUN_TESTS:"false"
  },"test","adk",endpoint),{});
});
test("Explicit flags are independent while Test Agent can opt into all four tools",()=>{
  assert.deepEqual(resolveMcpToolFlags({ADK_MCP_UPDATE_FILE:"true"},
    "backend","adk",endpoint),{mcpUpdateFile:true});
  assert.deepEqual(resolveMcpToolFlags({
    ADK_MCP_UPDATE_FILE:"true",ADK_MCP_CREATE_FILE:"true",
    ADK_MCP_RUN_TESTS:"true"
  },"test","adk",endpoint),{
    mcpUpdateFile:true,mcpCreateFile:true,mcpRunTests:true
  });
});
test("MCP create/test are forbidden to Backend or Frontend even with valid config",()=>{
  for(const role of ["backend","frontend"] as const)
    for(const name of ["ADK_MCP_CREATE_FILE","ADK_MCP_RUN_TESTS"])
      assert.throws(()=>resolveMcpToolFlags({[name]:"true"},role,"adk",endpoint),
        /Only Test Agent/);
});
test("MCP write/test flags fail closed without shared MCP URL and ADK",()=>{
  for(const key of ["ADK_MCP_UPDATE_FILE","ADK_MCP_CREATE_FILE","ADK_MCP_RUN_TESTS"]){
    assert.throws(()=>resolveMcpToolFlags({[key]:"true"},"test","adk",undefined),
      /require ADK_MCP_SHARED_URL/);
    assert.throws(()=>resolveMcpToolFlags({[key]:"true"},"test","deterministic",endpoint),
      /require ADK_MCP_SHARED_URL/);
  }
});
test("Invalid flag text cannot silently enable or disable policy",()=>{
  for(const value of ["1","TRUE","yes","on"," false ","0"]){
    assert.throws(()=>resolveMcpToolFlags({ADK_MCP_RUN_TESTS:value},
      "test","adk",endpoint),/must be exactly true or false/);
  }
});
