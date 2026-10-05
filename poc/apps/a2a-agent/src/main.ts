import {
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

const runtime = await startSpecializedAgentServer({
  role,
  port,
  host: process.env.AGENT_BIND_HOST ?? "127.0.0.1"
});

process.stdout.write(
  JSON.stringify({
    event: "a2a_agent_started",
    role,
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
