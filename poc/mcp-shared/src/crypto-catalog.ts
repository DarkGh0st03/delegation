/**
 * Opt-in cryptographic MCP surface. Nothing in the request grants authority:
 * the private worker resolves a previously trusted Gateway challenge by ID.
 */
export const MCP_CREATE_PRESENTATION = Object.freeze({
  name:"delegation_create_presentation",
  description:"Ask the trusted task worker to create and privately retain a signed delegation VP for an existing Gateway challenge. Returns no JWT, keys or executable capability.",
  inputSchema:{
    type:"object",additionalProperties:false,
    properties:{request_id:{type:"string",minLength:1,maxLength:256}},
    required:["request_id"]
  }
} as const);

export interface CreatePresentationArgs {request_id:string}

export function parseCreatePresentationArgs(raw:unknown):CreatePresentationArgs {
  if (raw===null || typeof raw!=="object" || Array.isArray(raw)) {
    throw new Error("invalid_tool_arguments");
  }
  const v=raw as Record<string,unknown>;
  if (Object.keys(v).length!==1 || !Object.hasOwn(v,"request_id") ||
      typeof v.request_id!=="string" || v.request_id.trim()!==v.request_id ||
      v.request_id.length<1 || v.request_id.length>256 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v.request_id)) {
    throw new Error("invalid_tool_arguments");
  }
  return {request_id:v.request_id};
}
