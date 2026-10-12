import type { Server } from "node:http";
import express from "express";
import {
  AGENT_CARD_PATH,
  type AgentCard
} from "@a2a-js/sdk";

import {
  UserBuilder,
  agentCardHandler,
  restHandler
} from "@a2a-js/sdk/server/express";
import { createSpecializedAgentCard } from "./cards.ts";
import { PrivateEvidenceTaskStore } from "./private-task-store.ts";
import { PrivateEvidenceRequestHandler } from "./private-request-handler.ts";
import {
  DeterministicSpecializedAgentExecutor,
  type DeterministicArtifactPayloadBuilder,
  type DeterministicTaskHandler
} from "./executor.ts";
import type { SpecializedAgentRole } from "./contracts.ts";
import { createAdkA2ATaskHandler, type AdkA2ATaskHandlerConfig } from "./adk-a2a-handler.ts";
import { PrivateMcpTaskRegistry } from "./private-mcp-task-registry.ts";
import { attachPrivateMcpWorker } from "./private-mcp-worker-http.ts";

export interface SpecializedAgentServerOptions {
  role: SpecializedAgentRole;
  port: number;
  host?: string;
  delegatedAuthorization?: boolean;
  artifactBuilder?: DeterministicArtifactPayloadBuilder;
  taskHandler?: DeterministicTaskHandler;
  adk?: AdkA2ATaskHandlerConfig;
  /** Opt-in only; the default A2A baseline stays unchanged. */
  mcpTaskSigning?: { signingPrivateKeyPem: string; signingPublicKeyPem: string };
}

export interface SpecializedAgentServer {
  role: SpecializedAgentRole;
  baseUrl: string;
  card: AgentCard;
  executor: DeterministicSpecializedAgentExecutor;
  server: Server;
  close(): Promise<void>;
}

export async function startSpecializedAgentServer(
  options: SpecializedAgentServerOptions
): Promise<SpecializedAgentServer> {
  const host = options.host ?? "127.0.0.1";
  const baseUrl = `http://${host}:${options.port}`;
  const card = createSpecializedAgentCard(options.role, baseUrl, {
    delegatedAuthorization: options.delegatedAuthorization
  });
  if (options.adk && options.taskHandler) throw new Error("Choose either ADK or custom taskHandler");
  if (options.adk?.mcpCreateFile && options.role!=="test") {
    throw new Error("Only Test Agent may enable shared MCP create_file");
  }
  if (options.adk?.mcpRunTests && options.role!=="test") {
    throw new Error("Only Test Agent may enable shared MCP run_tests");
  }
  if (options.mcpTaskSigning && !options.adk) {
    throw new Error("Private MCP task worker requires a configured ADK runtime");
  }
  const mcpTaskRegistry = options.mcpTaskSigning
    ? new PrivateMcpTaskRegistry({role:options.role, ...options.mcpTaskSigning})
    : undefined;
  const adkHandler = options.adk
    ? createAdkA2ATaskHandler({...options.adk, ...(mcpTaskRegistry ? {mcpTaskRegistry} : {})})
    : undefined;
  const taskHandler: DeterministicTaskHandler | undefined = adkHandler
    ? async (context,signal) => {
        try { return await adkHandler(context,signal); }
        finally { mcpTaskRegistry?.end(context.task_id); }
      }
    : options.taskHandler;
  const executor = new DeterministicSpecializedAgentExecutor(
    options.role,
    undefined,
    options.artifactBuilder,
    taskHandler
  );
  const requestHandler = new PrivateEvidenceRequestHandler(
    card,
    new PrivateEvidenceTaskStore(),
    executor
  );

  const app = express();
  if (mcpTaskRegistry) attachPrivateMcpWorker(app,mcpTaskRegistry);
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(
    "/a2a/rest",
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication
    })
  );

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(options.port, host, () => resolve(listening));
    listening.once("error", reject);
  });

  return {
    role: options.role,
    baseUrl,
    card,
    executor,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      })
  };
}
