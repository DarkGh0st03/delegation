/**
 * MCP tools are an implemented SUBSET of Rust delegation::authorization::Operation.
 * The Gateway, not this catalog, derives the authoritative ResourceUri + Operation.
 */
export const MCP_READ_FILE = Object.freeze({
  name:"read_file",
  operation:"read_file",
  resourceType:"repository_file",
  description:"Read a file from the controlled feature branch.",
  inputSchema:{
    type:"object", additionalProperties:false,
    properties:{
      branch:{type:"string",const:"feature/account-suspension"},
      path:{type:"string",minLength:1}
    },
    required:["branch","path"]
  }
} as const);
export interface ReadFileArgs {branch:"feature/account-suspension"; path:string}
export function parseReadFileArgs(raw: unknown): ReadFileArgs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_tool_arguments");
  const obj = raw as Record<string,unknown>;
  if (Object.keys(obj).sort().join(",") !== "branch,path" ||
      obj.branch !== "feature/account-suspension" ||
      typeof obj.path !== "string" || !obj.path || obj.path.length > 2048 ||
      obj.path.startsWith("/") || obj.path.endsWith("/") ||
      obj.path.includes("\\") || obj.path.split("/").some(x => !x || x==="." || x===".." || x.includes("\0"))) {
    throw new Error("invalid_tool_arguments");
  }
  return {branch:"feature/account-suspension",path:obj.path};
}
