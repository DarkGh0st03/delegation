/**
 * MCP tools are an implemented SUBSET of Rust delegation::authorization::Operation.
 * The Gateway, not this catalog, derives the authoritative ResourceUri + Operation.
 */
export type McpBranchMode="legacy"|"approved";
/** Syntax only: private worker verifies exact Task branch and grants. */
export function isMcpFeatureBranch(value:unknown):value is string{
  return typeof value==="string"&&value.length<=120&&
    /^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(value)&&
    !value.endsWith("/")&&!value.endsWith(".")&&
    !value.endsWith(".lock")&&!value.includes("..")&&
    !value.includes("//")&&!value.includes("@{");
}
function checkedBranch(value:unknown,mode:McpBranchMode):string{
  if(!isMcpFeatureBranch(value)||
     (mode==="legacy"&&value!=="feature/account-suspension"))
    throw Error("invalid_tool_arguments");
  return value;
}
export const MCP_READ_FILE = Object.freeze({
  name:"read_file",
  operation:"read_file",
  resourceType:"repository_file",
  description:"Read a file from the controlled feature branch.",
  inputSchema:{
    type:"object", additionalProperties:false,
    properties:{
      branch:{type:"string",pattern:"^feature/[a-z0-9][a-z0-9./_-]*$"},
      path:{type:"string",minLength:1}
    },
    required:["branch","path"]
  }
} as const);
export interface ReadFileArgs {branch:string; path:string}
export function parseReadFileArgs(raw: unknown,mode:McpBranchMode="legacy"): ReadFileArgs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_tool_arguments");
  const obj = raw as Record<string,unknown>;
  if (Object.keys(obj).sort().join(",") !== "branch,path" ||
      !isMcpFeatureBranch(obj.branch) ||
      typeof obj.path !== "string" || !obj.path || obj.path.length > 2048 ||
      obj.path.startsWith("/") || obj.path.endsWith("/") ||
      obj.path.includes("\\") || obj.path.split("/").some(x => !x || x==="." || x===".." || x.includes("\0"))) {
    throw new Error("invalid_tool_arguments");
  }
  return {branch:checkedBranch(obj.branch,mode),path:obj.path};
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
      branch:{type:"string",pattern:"^feature/[a-z0-9][a-z0-9./_-]*$"},
      path:{type:"string",minLength:1,maxLength:2048},
      content:{type:"string"}
    },
    required:["branch","path","content"]
  }
} as const);
export interface UpdateFileArgs extends ReadFileArgs {content:string}
export function parseUpdateFileArgs(raw:unknown,mode:McpBranchMode="legacy"):UpdateFileArgs {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid_tool_arguments");
  const obj=raw as Record<string,unknown>;
  if(Object.keys(obj).sort().join(",")!=="branch,content,path" ||
     typeof obj.content!=="string" ||
     Buffer.byteLength(obj.content,"utf8")>MAX_MCP_UPDATE_BYTES) {
    throw new Error("invalid_tool_arguments");
  }
  const file=parseReadFileArgs({branch:obj.branch,path:obj.path},mode);
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
      branch:{type:"string",pattern:"^feature/[a-z0-9][a-z0-9./_-]*$"},
      path:{type:"string",minLength:1,maxLength:2048},
      content:{type:"string"}
    },
    required:["branch","path","content"]
  }
} as const);
export interface CreateFileArgs extends UpdateFileArgs {path:string}
export function parseCreateFileArgs(raw:unknown,mode:McpBranchMode="legacy"):CreateFileArgs{
  const args=parseUpdateFileArgs(raw,mode);
  if(mode==="legacy"&&args.path!==MCP_CREATABLE_E2E_PATH)
    throw new Error("invalid_tool_arguments");
  return args;
}

/**
 * Controlled test execution is not a shell command.
 * The Runner profile and branch are fixed by the Gateway contract.
 */
export const MCP_RUN_TESTS=Object.freeze({
  name:"run_tests",
  operation:"run_tests",
  resourceType:"repository_branch",
  description:"Execute the predefined controlled test profile for the delegated feature branch.",
  inputSchema:{
    type:"object",additionalProperties:false,
    properties:{
      branch:{type:"string",pattern:"^feature/[a-z0-9][a-z0-9./_-]*$"},
      profile:{type:"string",const:"poc-default"}
    },
    required:["branch","profile"]
  }
} as const);
export interface RunTestsArgs{
  branch:string;
  profile:"poc-default";
}
export function parseRunTestsArgs(raw:unknown,mode:McpBranchMode="legacy"):RunTestsArgs{
  if(!raw||typeof raw!=="object"||Array.isArray(raw)){
    throw new Error("invalid_tool_arguments");
  }
  const args=raw as Record<string,unknown>;
  if(Object.keys(args).sort().join(",")!=="branch,profile"||
     !isMcpFeatureBranch(args.branch)||
     args.profile!=="poc-default"){
    throw new Error("invalid_tool_arguments");
  }
  return {branch:checkedBranch(args.branch,mode),profile:"poc-default"};
}
