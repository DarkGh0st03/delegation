import test from "node:test";
import assert from "node:assert/strict";
import {selectMcpToolProfile,requireProductionCryptoMcpProfile} from "../src/profile.ts";

test("R159 standalone MCP defaults to the real cryptographic profile",()=>{
 assert.equal(selectMcpToolProfile(undefined),"crypto");
 assert.equal(selectMcpToolProfile("crypto"),"crypto");
 assert.equal(selectMcpToolProfile("legacy"),"legacy");
 for(const invalid of ["","mcp","repository","CRYPTO","legacy "])
  assert.throws(()=>selectMcpToolProfile(invalid),/MCP_TOOL_PROFILE/);
});

test("R180 production MCP entrypoint cannot enable repository router",()=>{
 assert.equal(requireProductionCryptoMcpProfile(undefined),"crypto");
 assert.equal(requireProductionCryptoMcpProfile("crypto"),"crypto");
 for(const raw of ["legacy","","repository","CRYPTO"])
  assert.throws(()=>requireProductionCryptoMcpProfile(raw),
   /production_mcp_crypto_only|MCP_TOOL_PROFILE/);
});
