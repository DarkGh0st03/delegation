/**
 * Paid Gemini models for ONE console session, with cost limits and
 * owner-side diagnostics.
 *
 *   Outer observer -> canonical private budget (calls/tokens per phase and
 *   per session, STOP-only, buffered) -> inner observer -> Google ADK Gemini
 *
 * The inner observer sees the provider's real answer or error; the outer one
 * sees when the budget layer discards a call. Neither records prompts, file
 * contents or the API key: only timings, token counts, finish reasons, tool
 * names and a short, key-scrubbed preview of the model text.
 */
import {BaseLlm} from "@google/adk";

const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/gu;
export const scrub = text => String(text ?? "").replace(KEY_PATTERN, "[CHIAVE-OSCURATA]")
  .replace(/[\r\n\t]+/gu, " ").slice(0, 400);

/** Free, read-only check of key and model (no tokens, no generation). */
export async function preflightGemini({apiKey, model, fetchFn = fetch}) {
  if (!apiKey) throw Error("GEMINI_API_KEY non configurata nel file .env");
  if (!/^gemini-[a-z0-9.-]+$/u.test(model)) throw Error(`Nome del modello Gemini non valido: ${model}`);
  let response;
  try {
    response = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
      headers: {"x-goog-api-key": apiKey}, signal: AbortSignal.timeout(15000)});
  } catch (error) {
    throw Error("Google Gemini non raggiungibile dal container: " + scrub(error?.cause?.code ?? error?.message));
  }
  if (response.ok) return {model};
  const body = scrub(await response.text().catch(() => ""));
  if (response.status === 400 || response.status === 401 || response.status === 403)
    throw Error(`La chiave Gemini è stata rifiutata da Google (HTTP ${response.status}): ${body}`);
  if (response.status === 404) throw Error(`Il modello "${model}" non esiste per questa chiave (HTTP 404)`);
  throw Error(`Controllo Gemini fallito (HTTP ${response.status}): ${body}`);
}

function summarize(responses) {
  let usage, finish, tools = [], text = "";
  for (const r of responses) {
    if (r?.usageMetadata) usage = r.usageMetadata;
    if (r?.finishReason) finish = r.finishReason;
    for (const part of r?.content?.parts ?? []) {
      if (part.functionCall?.name) tools.push(part.functionCall.name);
      if (typeof part.text === "string" && !part.thought) text += part.text;
    }
    if (r?.errorCode || r?.errorMessage) finish = `ERRORE ${r.errorCode ?? ""} ${r.errorMessage ?? ""}`;
  }
  return {input_tokens: usage?.promptTokenCount ?? null, output_tokens: usage?.candidatesTokenCount ?? null,
    total_tokens: usage?.totalTokenCount ?? null, finish: finish ?? null, tools,
    preview: text ? scrub(text).slice(0, 240) : null};
}

/** Pass-through BaseLlm that reports every call (same model name). */
class ObservedModel extends BaseLlm {
  #delegate; #phase; #layer; #record;
  constructor({delegate, phase, layer, record}) {
    super({model: delegate.model});
    this.#delegate = delegate; this.#phase = phase; this.#layer = layer; this.#record = record;
  }
  async *generateContentAsync(request, stream, signal) {
    const started = Date.now(), seen = [];
    let recorded = false;
    try {
      for await (const response of this.#delegate.generateContentAsync(request, stream, signal)) {
        if (this.#layer === "provider") {
          seen.push(response);
          // Record at the final chunk, BEFORE the budget layer sees it: a
          // discarding consumer may abandon this stream without closing it.
          if (response?.finishReason && !recorded) {
            recorded = true;
            this.#record({phase: this.#phase, ok: true, ms: Date.now() - started, ...summarize(seen)});
          }
        }
        yield response;
      }
    } catch (error) {
      recorded = true;
      this.#record({phase: this.#phase, ok: false, layer: this.#layer, ms: Date.now() - started,
        error: scrub(error?.message ?? error), ...(seen.length ? summarize(seen) : {})});
      throw error;
    } finally {
      // Also when the consumer stops reading mid-stream (e.g. the budget
      // layer discarding a truncated answer): keep what the provider said.
      if (!recorded && this.#layer === "provider")
        this.#record({phase: this.#phase, ok: true, ms: Date.now() - started, ...summarize(seen)});
    }
  }
  connect() { throw Error("Streaming connections are disabled"); }
}

/**
 * All paid models of one session share ONE canonical session budget.
 * `record(entry)` receives one entry per provider call or rejection.
 */
export async function createSessionGeminiModels({apiKey, model, record, createProvider}) {
  // Tests inject a fake provider; production always uses Google ADK Gemini.
  const createGeminiAdkModel = createProvider ??
    (await import("../../packages/agent-runtime/src/gemini-adk-model.ts")).createGeminiAdkModel;
  const {DisposablePrivateBudgetedAdkModel, DisposablePrivateSessionUsageBudget, PRIVATE_GEMINI_SESSION_LIMITS} =
    await import("../../apps/orchestrator/src/disposable-gemini-live-budgeted-model.mjs");
  const sessionBudget = new DisposablePrivateSessionUsageBudget();
  const models = [];
  const forPhase = phase => {
    const provider = new ObservedModel({delegate: createGeminiAdkModel({apiKey, model}),
      phase, layer: "provider", record});
    const budgeted = new DisposablePrivateBudgetedAdkModel({delegate: provider, phase,
      ...PRIVATE_GEMINI_SESSION_LIMITS[phase], sessionBudget});
    models.push(budgeted);
    return new ObservedModel({delegate: budgeted, phase, layer: "budget", record});
  };
  return {
    planning: () => forPhase("planning"),
    execution: () => ({backend: forPhase("backend"), frontend: forPhase("frontend"),
      test: forPhase("test"), orchestrator: forPhase("adaptive-execution")}),
    summary: () => sessionBudget.publicSummary(),
    /** Stop: abort pending calls and refuse new ones (calls already sent may be billed). */
    cancel: () => { for (const m of models) m.fenceOwnerCancellation(); }
  };
}
