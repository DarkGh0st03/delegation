import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { RunnerServiceConfig } from "./config.ts";
import {
  DisabledRunnerExecutor,
  RunnerExecutionUnavailableError
} from "./executor.ts";
import type { RunnerExecutor } from "./types.ts";
import { validateRunnerRunRequest } from "./validation.ts";

const MAX_BODY_BYTES = 64 * 1024;

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("request body exceeds 64 KiB");
    }
    chunks.push(bytes);
  }

  if (chunks.length === 0) {
    throw new Error("request body cannot be empty");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

export function createRunnerHttpServer(
  config: RunnerServiceConfig,
  executor: RunnerExecutor = new DisabledRunnerExecutor()
) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, {
        status: "ok",
        service: "test-runner-controller",
        execution: executor instanceof DisabledRunnerExecutor ? "disabled_phase6a" : "configured"
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/v1/runs") {
      json(response, 404, { error: "not_found" });
      return;
    }

    if (!authorized(request, config.gateway_token)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }

    let normalized;
    try {
      normalized = validateRunnerRunRequest(await readJsonBody(request), config.contract);
    } catch (error) {
      json(response, 400, {
        error: "invalid_runner_request",
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    try {
      const result = await executor.run(normalized);
      json(response, 200, result);
    } catch (error) {
      if (error instanceof RunnerExecutionUnavailableError) {
        json(response, 501, {
          error: "runner_execution_unavailable",
          message: error.message
        });
        return;
      }

      json(response, 503, {
        error: "runner_execution_failed",
        message: "Controlled Test Runner failed closed"
      });
    }
  });
}
