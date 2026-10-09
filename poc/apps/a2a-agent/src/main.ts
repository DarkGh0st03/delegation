import {
  OpenAIAdkModel,
  SPECIALIZED_AGENT_ROLES,
  startSpecializedAgentServer,
  type SpecializedAgentRole
} from "@thesis/agent-runtime";

function roleFromEnvironment(value: string | undefined): SpecializedAgentRole {
  if (
    value === undefined ||
    !SPECIALIZED_AGENT_ROLES.includes(value as SpecializedAgentRole)
  ) {
    throw new Error(
      `AGENT_ROLE must be one of ${SPECIALIZED_AGENT_ROLES.join(", ")}`
    );
  }
  return value as SpecializedAgentRole;
}

function portFromEnvironment(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AGENT_PORT must be a valid TCP port");
  }
  return port;
}

const role = roleFromEnvironment(process.env.AGENT_ROLE);
const port = portFromEnvironment(process.env.AGENT_PORT);

const engine = process.env.AGENT_RUNTIME_ENGINE ?? "deterministic";
if (engine !== "deterministic" && engine !== "adk") {
  throw new Error("AGENT_RUNTIME_ENGINE must be deterministic or adk");
}
function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(name + " is required when AGENT_RUNTIME_ENGINE=adk");
  return value;
}
function turnsFromEnvironment(): number {
  if (process.env.ADK_MAX_MODEL_TURNS === undefined) return 8;
  const count = Number(process.env.ADK_MAX_MODEL_TURNS);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error("ADK_MAX_MODEL_TURNS must be a positive integer up to 100");
  }
  return count;
}
const roleToken = {
  backend: "ADAPTER_CALLER_BACKEND",
  frontend: "ADAPTER_CALLER_FRONTEND",
  test: "ADAPTER_CALLER_TEST"
}[role];
const adk = engine === "adk"
  ? {
      model: new OpenAIAdkModel({ apiKey: required("OPENAI_API_KEY") }),
      gatewayBaseUrl: required("GATEWAY_URL"),
      adapterBaseUrl: required("DELEGATION_ADAPTER_URL"),
      adapterToken: required(roleToken),
      maxModelTurns: turnsFromEnvironment()
    }
  : undefined;

const runtime = await startSpecializedAgentServer({
  role,
  port,
  host: process.env.AGENT_BIND_HOST ?? "127.0.0.1",
  ...(adk ? { adk } : {})
});

process.stdout.write(
  JSON.stringify({
    event: "a2a_agent_started",
    role,
    engine,
    base_url: runtime.baseUrl,
    agent_card: `${runtime.baseUrl}/.well-known/agent-card.json`
  }) + "\n"
);

async function shutdown(): Promise<void> {
  await runtime.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
