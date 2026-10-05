import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { GatewayError } from "./errors.ts";
import type { GatewayRuntime } from "./runtime.ts";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new GatewayError(413, "request_too_large", "Request body exceeds 2 MiB");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new GatewayError(400, "invalid_json", "JSON request body is required");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function errorResponse(response: ServerResponse, error: unknown): void {
  if (error instanceof GatewayError) {
    json(response, error.statusCode, { error: error.code, message: error.message });
    return;
  }
  json(response, 400, {
    error: "invalid_request",
    message: error instanceof Error ? error.message : String(error)
  });
}

export function createGatewayHttpServer(runtime: GatewayRuntime): Server {
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = request.url ?? "/";

      if (method === "GET" && url === "/health") {
        json(response, 200, {
          status: "ok",
          service: "cloud-access-gateway",
          authorization: "delegation-verifier",
          policy: "opa",
          provider: runtime.providerLabel
        });
        return;
      }

      if (method === "POST" && url === "/v1/authorization/prepare") {
        const body = await readJson(request);
        json(response, 201, runtime.prepare(body));
        return;
      }

      if (method === "POST" && url === "/v1/authorization/execute") {
        const body = await readJson(request);
        json(response, 200, await runtime.execute(body));
        return;
      }

      json(response, 404, { error: "not_found", message: "Route not found" });
    } catch (error) {
      errorResponse(response, error);
    }
  });
}
