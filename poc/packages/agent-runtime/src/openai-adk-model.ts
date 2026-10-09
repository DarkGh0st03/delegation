import OpenAI from "openai";
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from "@google/adk";
import { DEFAULT_OPENAI_MODEL } from "./llm-client.ts";

type Dict = Record<string, unknown>;
const TOOLS = new Set(["read_file", "update_file", "create_file", "run_tests"]);
function object(value: unknown, name: string): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(name + " must be an object");
  }
  return value as Dict;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(name + " must be nonempty");
  return value;
}
/** Fail closed on unsupported schema keywords and never create permissive tools. */
function parameters(value: unknown): Dict {
  const schema = object(value, "ADK parameter schema");
  const supported = new Set(["type","description","properties","required","items",
    "additionalProperties","enum","nullable","minLength","maxLength",
    "minimum","maximum","minItems","maxItems","propertyOrdering"]);
  for (const key of Object.keys(schema)) {
    if (!supported.has(key)) throw new Error("Unsupported ADK schema keyword " + key);
  }
  const type = string(schema.type, "schema.type").toLowerCase();
  if (!["object","string","integer","number","boolean","array"].includes(type)) {
    throw new Error("Unsupported ADK schema type " + type);
  }
  const converted: Dict = { type: schema.nullable === true ? [type,"null"] : type };
  if (typeof schema.description === "string") converted.description = schema.description;
  if (Array.isArray(schema.enum)) converted.enum = schema.enum;
  for (const key of ["minLength","maxLength","minimum","maximum","minItems","maxItems"]) {
    if (schema[key] !== undefined) {
      // ADK v2.2.1's Zod converter encodes these GenAI numeric limits as strings.
      const raw = schema[key];
      const value = typeof raw === "string" && /^\\d+$/u.test(raw) ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Invalid ADK schema " + key);
      }
      converted[key] = value;
    }
  }
  if (type === "object") {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      throw new Error("Open-ended ADK schema is forbidden");
    }
    const fields = schema.properties === undefined ? {} : object(schema.properties, "schema.properties");
    const mapped: Dict = {};
    for (const [name, field] of Object.entries(fields)) mapped[name] = parameters(field);
    const required = schema.required === undefined ? Object.keys(mapped) : schema.required;
    if (!Array.isArray(required) || required.length !== Object.keys(mapped).length
      || Object.keys(mapped).some(name => !required.includes(name))
      || required.some(name => typeof name !== "string" || !(name in mapped))) {
      throw new Error("Strict tools require all declared properties");
    }
    converted.properties = mapped;
    converted.required = [...required];
    converted.additionalProperties = false;
  } else if (type === "array") {
    converted.items = parameters(schema.items);
  } else if (schema.properties !== undefined || schema.items !== undefined) {
    throw new Error("Scalar schema contains object/array members");
  }
  return converted;
}
export interface OpenAIAdkModelOptions {
  model?: string;
  apiKey?: string;
  maxOutputTokens?: number;
  client?: Pick<OpenAI, "responses">;
}
/**
 * ADK BaseLlm implementation for the existing OpenAI Responses API.
 * History is reconstructed from the ADK session every turn (no shared response
 * IDs or credentials). Only role-scoped controlled function tools are accepted.
 */
export class OpenAIAdkModel extends BaseLlm {
  readonly #client: Pick<OpenAI, "responses">;
  readonly #maxOutputTokens: number;
  constructor(config: OpenAIAdkModelOptions = {}) {
    super({model:string(config.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,"OpenAI model")});
    this.#maxOutputTokens = config.maxOutputTokens ?? 4096;
    if (!Number.isSafeInteger(this.#maxOutputTokens) || this.#maxOutputTokens < 1) {
      throw new Error("maxOutputTokens must be a positive integer");
    }
    const key = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!config.client && !key?.trim()) throw new Error("OPENAI_API_KEY is required for ADK OpenAI");
    this.#client = config.client ?? new OpenAI({apiKey:key});
  }
  override async *generateContentAsync(
    request: LlmRequest, stream = false, abortSignal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void> {
    if (stream) throw new Error("Streaming is disabled for protected ADK agents");
    const config = (request.config ?? {}) as Dict;
    let instructions = "";
    if (typeof config.systemInstruction === "string") {
      instructions = config.systemInstruction;
    } else if (config.systemInstruction !== undefined) {
      const sys = object(config.systemInstruction,"ADK system instruction");
      if (!Array.isArray(sys.parts) || !sys.parts.every(p => typeof object(p,"system part").text === "string")) {
        throw new Error("Only text system instructions are supported");
      }
      instructions = sys.parts.map(p => string(object(p,"system part").text,"system text")).join("\n");
    }
    const definitions = new Set<string>();
    const tools: Array<{type:"function";name:string;description:string;strict:true;parameters:Dict}> = [];
    const configuredTools = config.tools ?? [];
    if (!Array.isArray(configuredTools)) throw new Error("ADK tools must be an array");
    for (const item of configuredTools) {
      const tool = object(item,"ADK tool");
      if (Object.keys(tool).some(k => k !== "functionDeclarations")) {
        throw new Error("ADK built-in and remote tools are not allowed");
      }
      if (!Array.isArray(tool.functionDeclarations)) throw new Error("Malformed ADK function declarations");
      for (const raw of tool.functionDeclarations) {
        const declared = object(raw,"ADK function");
        const name = string(declared.name,"ADK function name");
        if (!TOOLS.has(name) || definitions.has(name)) throw new Error("Forbidden or duplicate ADK tool " + name);
        definitions.add(name);
        tools.push({type:"function",name,description:typeof declared.description==="string"?declared.description:"",
          strict:true,parameters:parameters(declared.parameters)});
      }
    }
    if (request.allowedTools && request.allowedTools.some(t => !definitions.has(t))) {
      throw new Error("ADK allowedTools contains an unregistered tool");
    }
    const enabled = request.allowedTools ? tools.filter(t => request.allowedTools?.includes(t.name)) : tools;
    const input: OpenAI.Responses.ResponseInputItem[] = [];
    for (const content of request.contents) {
      const role = content.role === "model" ? "assistant" : content.role;
      if (role !== "assistant" && role !== "user") throw new Error("Unsupported ADK message role");
      for (const part of content.parts ?? []) {
        if (typeof part.text === "string") {
          input.push({role,content:part.text});
        } else if (part.functionCall) {
          if (role !== "assistant") throw new Error("Function calls require model role");
          const call = part.functionCall;
          const name = string(call.name,"history function name");
          if (!definitions.has(name)) throw new Error("Undeclared function in ADK history");
          input.push({type:"function_call",name,call_id:string(call.id,"function call id"),
            arguments:JSON.stringify(object(call.args,"function arguments"))});
        } else if (part.functionResponse) {
          if (role !== "user") throw new Error("Function response requires user role");
          const response = part.functionResponse;
          if (!definitions.has(string(response.name,"history function response"))) {
            throw new Error("Unregistered function response in ADK history");
          }
          input.push({type:"function_call_output",call_id:string(response.id,"function response id"),
            output:JSON.stringify(response.response ?? {})});
        } else {
          throw new Error("Images, raw credentials and unsupported ADK parts are not accepted");
        }
      }
    }
    if (!input.length) throw new Error("OpenAI ADK request has no content");
    const response = await this.#client.responses.create({
      model:this.model,instructions,input,tools:enabled,
      parallel_tool_calls:false,max_output_tokens:this.#maxOutputTokens
    },abortSignal ? {signal:abortSignal} : undefined);
    if (response.status !== "completed") throw new Error("OpenAI Responses returned non-completed status");
    const parts: Array<{text:string}|{functionCall:{id:string;name:string;args:Dict}}> = [];
    for (const item of response.output) {
      if (item.type === "reasoning") continue;
      if (item.type === "function_call") {
        if (!enabled.some(tool => tool.name === item.name)) throw new Error("Unexpected OpenAI function call");
        let args: unknown;
        try { args = JSON.parse(item.arguments); } catch { throw new Error("Invalid OpenAI function arguments"); }
        parts.push({functionCall:{id:string(item.call_id,"OpenAI call id"),name:item.name,
          args:object(args,"OpenAI function arguments")}});
      } else if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") parts.push({text:part.text});
          else throw new Error("Unsupported/refused OpenAI message content");
        }
      } else {
        throw new Error("Unsupported OpenAI output item");
      }
    }
    if (!parts.length) throw new Error("OpenAI returned no usable content");
    yield {content:{role:"model",parts},modelVersion:response.model};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection> {
    return Promise.reject(new Error("Protected ADK live connections are disabled"));
  }
}
