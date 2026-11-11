import test from "node:test";
import assert from "node:assert/strict";
import {selectMcpToolProfile,requireProductionCryptoMcpProfile}
 from "../src/profile.ts";
test("R188 only crypto MCP profile is accepted",()=>{
 assert.equal(selectMcpToolProfile(undefined),"crypto");
 assert.equal(selectMcpToolProfile("crypto"),"crypto");
 for(const v of ["legacy","","mcp","repository","CRYPTO","legacy "])
  assert.throws(()=>selectMcpToolProfile(v),/MCP_TOOL_PROFILE/);
});
test("R188 production MCP profile rejects legacy opt-in",()=>{
 assert.equal(requireProductionCryptoMcpProfile(undefined),"crypto");
 assert.equal(requireProductionCryptoMcpProfile("crypto"),"crypto");
 for(const v of ["legacy","","repository","CRYPTO"])
  assert.throws(()=>requireProductionCryptoMcpProfile(v),/production_mcp_crypto_only/);
});
