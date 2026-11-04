import test from "node:test";
import assert from "node:assert/strict";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
const base={model:{} as never,gatewayBaseUrl:"http://127.0.0.1:0",
 adapterBaseUrl:"http://127.0.0.1:0",adapterToken:"offline"};

test("R194 ADK Task rejects stale repository MCP options",()=>{
 for(const option of [
  {mcpSharedUrl:"http://127.0.0.1:8097/mcp"},
  {mcpSharedUrl:""},
  {mcpUpdateFile:false},
  {mcpCreateFile:true},
  {mcpRunTests:true}
 ]){
  assert.throws(()=>createAdkA2ATaskHandler({...base,...option}),
    /legacy_repository_mcp_retired/);
 }
});
test("R241 obsolete private crypto-MCP HTTP endpoint is rejected, even with a Task registry",()=>{
 assert.throws(()=>createAdkA2ATaskHandler({
  ...base,mcpCryptoUrl:"http://127.0.0.1:8097/mcp"
 }),/legacy_crypto_http_mcp_retired/);
});
test("R194 direct Gateway Task handler needs no repository MCP",()=>{
 assert.equal(typeof createAdkA2ATaskHandler(base),"function");
});
