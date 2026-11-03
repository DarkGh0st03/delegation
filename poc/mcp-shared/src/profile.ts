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
