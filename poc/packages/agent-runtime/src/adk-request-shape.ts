import type { LlmRequest } from "@google/adk";

/**
 * Diagnose ADK request SHAPE without returning any prompt, tool argument,
 * tool schema, model response, URL, credential, or provider error string.
 * Counts are UTF-16 characters, not billable tokens.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function safeCount(n: number): number | null {
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function textParts(value: unknown): {count: number; chars: number} {
  const source = record(value);
  const parts = Array.isArray(source?.parts) ? source.parts : [];
  let count = 0, chars = 0;
  for (const part of parts) {
    const text = record(part)?.text;
    if (typeof text === "string") {
      count += 1;
      chars += text.length;
    }
  }
  return {count, chars};
}
export interface AdkSafeRequestShape {
  content_messages: number | null;
  content_text_parts: number | null;
  content_text_chars: number | null;
  system_instruction_text_chars: number | null;
  declared_tool_groups: number | null;
  function_declarations: number | null;
  declaration_json_chars: number | null;
  max_output_tokens: number | null;
  temperature: number | null;
  thinking_level: "LOW" | "MEDIUM" | "HIGH" | "MINIMAL" | null;
}
export function safeAdkRequestShape(request: LlmRequest): AdkSafeRequestShape {
  const source = record(request);
  const config = record(source?.config);
  const contents = Array.isArray(source?.contents) ? source.contents : null;
  let contentTextParts = 0, contentTextChars = 0;
  if (contents) {
    for (const content of contents) {
      const summary = textParts(content);
      contentTextParts += summary.count;
      contentTextChars += summary.chars;
    }
  }
  const instruction = config?.systemInstruction;
  const instructionChars = typeof instruction === "string"
    ? instruction.length : instruction == null ? null : textParts(instruction).chars;
  const tools = Array.isArray(config?.tools) ? config.tools : null;
  let functionDeclarations = 0, declarationChars = 0;
  let jsonValid = true;
  if (tools) {
    for (const tool of tools) {
      const declarations = record(tool)?.functionDeclarations;
      if (!Array.isArray(declarations)) continue;
      functionDeclarations += declarations.length;
      for (const declaration of declarations) {
        // Never emit the serialized declaration; only its aggregate length.
        try {
          const serialized = JSON.stringify(declaration);
          if (typeof serialized !== "string") jsonValid = false;
          else declarationChars += serialized.length;
        } catch {
          jsonValid = false;
        }
      }
    }
  }
  const maxOutput = config?.maxOutputTokens;
  const temperature = config?.temperature;
  const rawThinking = record(config?.thinkingConfig)?.thinkingLevel;
  // Whitelist static enum identifiers; never echo arbitrary provider data.
  const thinkingLevel = rawThinking === "LOW" || rawThinking === "MEDIUM" ||
    rawThinking === "HIGH" || rawThinking === "MINIMAL" ? rawThinking : null;
  return {
    content_messages: contents ? safeCount(contents.length) : null,
    content_text_parts: contents ? safeCount(contentTextParts) : null,
    content_text_chars: contents ? safeCount(contentTextChars) : null,
    system_instruction_text_chars: instructionChars === null ? null : safeCount(instructionChars),
    declared_tool_groups: tools ? safeCount(tools.length) : null,
    function_declarations: tools ? safeCount(functionDeclarations) : null,
    declaration_json_chars: tools && jsonValid ? safeCount(declarationChars) : null,
    max_output_tokens: typeof maxOutput === "number" && Number.isSafeInteger(maxOutput)
      && maxOutput > 0 ? maxOutput : null,
    temperature: typeof temperature === "number" && Number.isFinite(temperature)
      && temperature >= 0 && temperature <= 2 ? temperature : null,
    thinking_level: thinkingLevel
  };
}
