/**
 * Standalone MCP is crypto-only by default after the 20 October migration.
 * Legacy repository tool routing remains opt-in solely for historical CI.
 */
export function selectMcpToolProfile(raw:string|undefined):"crypto"|"legacy"{
 const selected=raw??"crypto";
 if(selected!=="crypto"&&selected!=="legacy")
   throw new Error("MCP_TOOL_PROFILE must be crypto or legacy");
 return selected;
}

/** Public production MCP process MUST expose only crypto. Historical legacy
 * factory fixtures are not a deployable service and cannot opt in here. */
export function requireProductionCryptoMcpProfile(raw:string|undefined):"crypto"{
 const selected=selectMcpToolProfile(raw);
 if(selected!=="crypto")throw Error("production_mcp_crypto_only");
 return selected;
}
