import OpenAI from "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

export interface ModelFunctionTool {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

export interface ModelFunctionCall {
  call_id: string;
  name: string;
  arguments: string;
}

export interface ModelFunctionOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface ModelTurnRequest {
  instructions: string;
  input: string | ModelFunctionOutput[];
  tools: ModelFunctionTool[];
  previous_response_id?: string;
}

export interface ModelTurnResponse {
  response_id: string;
  model_id: string;
  output_text: string;
  function_calls: ModelFunctionCall[];
}

export interface ModelClient {
  respond(request: ModelTurnRequest): Promise<ModelTurnResponse>;
}

export interface OpenAIResponsesClientConfig {
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  client?: Pick<OpenAI, "responses">;
}

export class OpenAIResponsesClient implements ModelClient {
  readonly #client: Pick<OpenAI, "responses">;
  readonly #model: string;
  readonly #maxOutputTokens: number;

  constructor(config: OpenAIResponsesClientConfig = {}) {
    this.#model = config.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    this.#maxOutputTokens = config.maxOutputTokens ?? 4096;

    if (this.#model.trim().length === 0) {
      throw new Error("OPENAI_MODEL cannot be empty");
    }
    if (!Number.isSafeInteger(this.#maxOutputTokens) || this.#maxOutputTokens <= 0) {
      throw new Error("maxOutputTokens must be a positive safe integer");
    }

    this.#client =
      config.client ??
      new OpenAI({
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY
      });
  }

  async respond(request: ModelTurnRequest): Promise<ModelTurnResponse> {
    const response = await this.#client.responses.create({
      model: this.#model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools,
      ...(request.previous_response_id === undefined
        ? {}
        : { previous_response_id: request.previous_response_id }),
      parallel_tool_calls: false,
      max_output_tokens: this.#maxOutputTokens
    });

    if (response.status !== "completed") {
      const details = response.error ?? response.incomplete_details;
      throw new Error(
        `OpenAI response did not complete: ${response.status ?? "unknown"}${details ? ` ${JSON.stringify(details)}` : ""}`
      );
    }

    const functionCalls = response.output
      .filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === "function_call"
      )
      .map((call) => ({
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments
      }));

    return {
      response_id: response.id,
      model_id: response.model,
      output_text: response.output_text,
      function_calls: functionCalls
    };
  }
}
