import type { GatewayPrepareConfig } from "./types.ts";

export interface GatewayRuntimeConfig {
  bind_host: string;
  bind_port: number;
  prepare: GatewayPrepareConfig;
  adapter_url: string;
  adapter_gateway_token: string;
  opa_url: string;
  opa_timeout_ms: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function bindAddress(value: string): { host: string; port: number } {
  const match = /^(.*):(\d+)$/u.exec(value);
  if (!match || match[1].trim().length === 0) {
    throw new Error("GATEWAY_BIND_ADDR must use host:port form");
  }
  return { host: match[1], port: positiveInteger(match[2], "Gateway port") };
}

export function gatewayConfigFromEnv(): GatewayRuntimeConfig {
  const bind = bindAddress(process.env.GATEWAY_BIND_ADDR ?? "0.0.0.0:8080");
  return {
    bind_host: bind.host,
    bind_port: bind.port,
    prepare: {
      audience: process.env.GATEWAY_AUDIENCE ?? "cloud-access-gateway",
      request_ttl_ms: positiveInteger(
        process.env.GATEWAY_REQUEST_TTL_MS ?? "120000",
        "GATEWAY_REQUEST_TTL_MS"
      ),
      repository: {
        authority: process.env.GATEWAY_RESOURCE_AUTHORITY ?? "gitea.local",
        owner: process.env.GITEA_OWNER ?? "thesis",
        repository: process.env.GITEA_REPOSITORY ?? "iam-console-poc"
      }
    },
    adapter_url: required("DELEGATION_ADAPTER_URL"),
    adapter_gateway_token: required("ADAPTER_CALLER_GATEWAY"),
    opa_url: required("OPA_URL"),
    opa_timeout_ms: positiveInteger(
      process.env.OPA_TIMEOUT_MS ?? "2000",
      "OPA_TIMEOUT_MS"
    )
  };
}
