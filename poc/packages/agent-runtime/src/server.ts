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

import {startTrustedBackendDiscoveryHost} from "./trusted-backend-discovery-host.ts";

type DiscoveryHostConfig=Parameters<typeof startTrustedBackendDiscoveryHost>[0];

export interface SpecializedAgentServerOptions {
  role: SpecializedAgentRole;
  port: number;
  host?: string;
  delegatedAuthorization?: boolean;
  /** Advertise generic role skills for a trusted approved-plan workflow. */
  capabilityProfile?: "legacy" | "approved-plan";
  artifactBuilder?: DeterministicArtifactPayloadBuilder;
  taskHandler?: DeterministicTaskHandler;
  adk?: AdkA2ATaskHandlerConfig;
  /** Trusted Backend host configuration, never A2A task data. */
  backendDiscovery?:Omit<DiscoveryHostConfig,
    "adapterBaseUrl"|"backendToken"|"fetchFn"|"timeoutMs">;
  /** Opt-in only; the default A2A baseline stays unchanged. */
  mcpTaskSigning?: { signingPrivateKeyPem: string; signingPublicKeyPem: string };
}

export interface SpecializedAgentServer {
  role: SpecializedAgentRole;
  baseUrl: string;
  card: AgentCard;
  executor: DeterministicSpecializedAgentExecutor;
  server: Server;
  /** Owner/Gateway bootstrap selectors; never included in the Agent Card. */
  privateDiscoveryPorts?:Pick<Awaited<ReturnType<typeof startTrustedBackendDiscoveryHost>>,
    "ownerBinding"|"gatewaySigner">;
  close(): Promise<void>;
}

export async function startSpecializedAgentServer(
  options: SpecializedAgentServerOptions
): Promise<SpecializedAgentServer> {
  const host = options.host ?? "127.0.0.1";
  const baseUrl = `http://${host}:${options.port}`;
  const card = createSpecializedAgentCard(options.role, baseUrl, {
    delegatedAuthorization: options.delegatedAuthorization,
    capabilityProfile: options.capabilityProfile
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
  if(options.backendDiscovery&&(options.role!=="backend"||!options.adk||
     options.adk.trustedBackendDiscovery||options.adk.trustedBackendDiscoverySlot))
    throw Error("Private discovery host requires one Backend ADK signing source");
  const discovery=options.backendDiscovery?await startTrustedBackendDiscoveryHost({
    ...options.backendDiscovery,adapterBaseUrl:options.adk!.adapterBaseUrl,
    backendToken:options.adk!.adapterToken,
    ...(options.adk!.fetchFn?{fetchFn:((url,init)=>
      options.adk!.fetchFn!(String(url),init)) as typeof fetch}:{})
  }):undefined;
  try{
  const mcpTaskRegistry = options.mcpTaskSigning
    ? new PrivateMcpTaskRegistry({role:options.role, ...options.mcpTaskSigning})
    : undefined;
  const adkHandler = options.adk
    ? createAdkA2ATaskHandler({...options.adk,
      ...(discovery?{trustedBackendDiscoverySlot:discovery.slot}:{}), ...(mcpTaskRegistry ? {mcpTaskRegistry} : {})})
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
    // Express 5 invokes app.listen's callback with an Error when bind
    // fails (e.g. EADDRINUSE). Older Express versions instead report an
    // "error" event. The callback MUST inspect its argument: otherwise
    // a failed bind resolves as a ready A2A server and strands the
    // privileged operational root and CI runner.
    let settled = false;
    const onError = (error:Error) => {
      if (settled) return;
      settled = true;
      listening.removeListener("error", onError);
      reject(error);
    };
    const listening = app.listen(options.port, host, (error?:Error) => {
      if (error) {
        onError(error);
        return;
      }
      if (settled) return;
      settled = true;
      listening.removeListener("error", onError);
      resolve(listening);
    });
    listening.once("error", onError);
  });

  let closing:Promise<void>|undefined;
  return {
    ...(discovery?{privateDiscoveryPorts:Object.freeze({
      ownerBinding:discovery.ownerBinding,gatewaySigner:discovery.gatewaySigner
    })}:{}),
    role: options.role,
    baseUrl,
    card,
    executor,
    server,
    close: () => closing??=(async()=>{
      // close() fences the private holder before its first await.
      const results=await Promise.allSettled([discovery?.close(),
        new Promise<void>((resolve,reject)=>server.close(error=>
          error?reject(error):resolve()))]);
      const failed=results.find(r=>r.status==="rejected");
      if(failed?.status==="rejected")throw failed.reason;
    })()
  };
  }catch(error){
    await discovery?.close();
    throw error;
  }
}
