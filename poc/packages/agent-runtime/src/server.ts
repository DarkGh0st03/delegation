import type { Server } from "node:http";
import express from "express";
import {
  AGENT_CARD_PATH,
  type AgentCard
} from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  restHandler
} from "@a2a-js/sdk/server/express";
import { createSpecializedAgentCard } from "./cards.ts";
import {
  DeterministicSpecializedAgentExecutor,
  type DeterministicArtifactPayloadBuilder,
  type DeterministicTaskHandler
} from "./executor.ts";
import type { SpecializedAgentRole } from "./contracts.ts";
import { createAdkA2ATaskHandler, type AdkA2ATaskHandlerConfig } from "./adk-a2a-handler.ts";

export interface SpecializedAgentServerOptions {
  role: SpecializedAgentRole;
  port: number;
  host?: string;
  delegatedAuthorization?: boolean;
  artifactBuilder?: DeterministicArtifactPayloadBuilder;
  taskHandler?: DeterministicTaskHandler;
  adk?: AdkA2ATaskHandlerConfig;
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
  const taskHandler = options.adk ? createAdkA2ATaskHandler(options.adk) : options.taskHandler;
  const executor = new DeterministicSpecializedAgentExecutor(
    options.role,
    undefined,
    options.artifactBuilder,
    taskHandler
  );
  const requestHandler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    executor
  );

  const app = express();
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
