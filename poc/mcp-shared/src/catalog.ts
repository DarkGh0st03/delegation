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

/**
 * Experimental MCP write. Strictly bound to the feature branch; final
 * resource and permission evaluation is ALWAYS delegated to Gateway/OPA/DC.
 * Complete file replacements are capped at 60 KiB UTF-8 before forwarding.
 */
export const MAX_MCP_UPDATE_BYTES=60*1024;
export const MCP_UPDATE_FILE=Object.freeze({
  name:"update_file",
  operation:"update_file",
  resourceType:"repository_file",
  description:"Replace the complete contents of an existing authorized feature-branch file.",
  inputSchema:{
    type:"object",additionalProperties:false,
    properties:{
      branch:{type:"string",const:"feature/account-suspension"},
      path:{type:"string",minLength:1,maxLength:2048},
      content:{type:"string"}
    },
    required:["branch","path","content"]
  }
} as const);
export interface UpdateFileArgs extends ReadFileArgs {content:string}
export function parseUpdateFileArgs(raw:unknown):UpdateFileArgs {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid_tool_arguments");
  const obj=raw as Record<string,unknown>;
  if(Object.keys(obj).sort().join(",")!=="branch,content,path" ||
     typeof obj.content!=="string" ||
     Buffer.byteLength(obj.content,"utf8")>MAX_MCP_UPDATE_BYTES) {
    throw new Error("invalid_tool_arguments");
  }
  const file=parseReadFileArgs({branch:obj.branch,path:obj.path});
  return {...file,content:obj.content};
}

/**
 * Only the Test Agent may create the one declared E2E fixture.
 * Task-scoped role checks and real delegated authorization remain mandatory.
 */
export const MCP_CREATABLE_E2E_PATH="tests/e2e/account-suspension.spec.ts" as const;
export const MAX_MCP_CREATE_BYTES=MAX_MCP_UPDATE_BYTES;
export const MCP_CREATE_FILE=Object.freeze({
  name:"create_file",operation:"create_file",resourceType:"repository_file",
  description:"Create the delegated Account Suspension E2E test file on the controlled feature branch.",
  inputSchema:{
    type:"object",additionalProperties:false,
    properties:{
      branch:{type:"string",const:"feature/account-suspension"},
      path:{type:"string",const:MCP_CREATABLE_E2E_PATH},
      content:{type:"string"}
    },
    required:["branch","path","content"]
  }
} as const);
export interface CreateFileArgs extends UpdateFileArgs {path:typeof MCP_CREATABLE_E2E_PATH}
export function parseCreateFileArgs(raw:unknown):CreateFileArgs{
  const args=parseUpdateFileArgs(raw);
  if(args.path!==MCP_CREATABLE_E2E_PATH)throw new Error("invalid_tool_arguments");
  return {...args,path:MCP_CREATABLE_E2E_PATH};
}
