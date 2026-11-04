/** R188 shared MCP offers ONLY its cryptographic presentation profile. */
export function selectMcpToolProfile(raw:string|undefined):"crypto"{
 if(raw!==undefined&&raw!=="crypto")
  throw Error("MCP_TOOL_PROFILE must be crypto");
 return "crypto";
}
export function requireProductionCryptoMcpProfile(raw:string|undefined):"crypto"{
 const selected=raw??"crypto";
 if(selected!=="crypto")throw Error("production_mcp_crypto_only");
 return "crypto";
}
