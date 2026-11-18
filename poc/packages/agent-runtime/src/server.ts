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
import { createSpecializedAgentCard,createOwnerAdditionalSpecialistCard,
 type OwnerAdditionalCardPin} from "./cards.ts";
import { PrivateEvidenceTaskStore } from "./private-task-store.ts";
import { PrivateEvidenceRequestHandler } from "./private-request-handler.ts";
import {
  DeterministicSpecializedAgentExecutor,
  type DeterministicTaskHandler
} from "./executor.ts";
import {SPECIALIZED_AGENT_ROLES,type SpecializedAgentRole} from "./contracts.ts";
import { createAdkA2ATaskHandler, type AdkA2ATaskHandlerConfig } from "./adk-a2a-handler.ts";
import { PrivateMcpTaskRegistry } from "./private-mcp-task-registry.ts";

export interface SpecializedAgentServerOptions {
  role: string;
  /** Owner-only non-native extra-role Card; never A2A/Task/LLM input. */
  ownerAdditionalCardPin?:OwnerAdditionalCardPin;
  port: number;
  host?: string;
  delegatedAuthorization?: boolean;
  /** Custom Task handler (tests only); production agents use `adk`. */
  taskHandler?: DeterministicTaskHandler;
  adk?: AdkA2ATaskHandlerConfig;
  /** Opt-in only; the default A2A baseline stays unchanged. */
  mcpTaskSigning?: { signingPrivateKeyPem: string; signingPublicKeyPem: string };
  /** Original host role DID; MUST equal the configured native Rust signer. */
  nativeSignerDid?: string;
}

export interface SpecializedAgentServer {
  role: string;
  baseUrl: string;
  card: AgentCard;
  executor: DeterministicSpecializedAgentExecutor;
  server: Server;
  /** Host-only evidence counter, never a public A2A or ADK capability. */
  cryptoProofCount?:()=>number;
  close(): Promise<void>;
}

export async function startSpecializedAgentServer(
  options: SpecializedAgentServerOptions
): Promise<SpecializedAgentServer> {
  const host = options.host ?? "127.0.0.1";
  const baseUrl = `http://${host}:${options.port}`;
  // Native identity cannot be substituted on a deterministic or unbound
  // A2A worker. All native role keys remain exclusively with the Rust owner.
  if(options.nativeSignerDid!==undefined&&(!options.adk||!options.mcpTaskSigning))
    throw Error("Trusted native A2A signer DID requires an original ADK Task host");
  const extra=!SPECIALIZED_AGENT_ROLES.includes(options.role as SpecializedAgentRole);
  // Extra roles are NEVER authorized by the Card itself. The only native
  // opt-in is a previously provisioned signer DID and read-only profile,
  // with a separate private one-shot MCP key and an exact Owner Task binder.
  // The original synthetic offline test mode remains strictly non-native.
  const pinned=options.ownerAdditionalCardPin;
  const nativeExtra=extra&&!!options.adk;
  if(extra&&(!pinned||options.delegatedAuthorization===false))
    throw Error("Additional A2A specialist requires exact Owner Card pins");
  if(extra&&nativeExtra&&(
     !options.mcpTaskSigning||!options.nativeSignerDid||
     options.nativeSignerDid!==pinned!.did||
     process.env["ADAPTER_ID_"+options.role.toUpperCase()]!==pinned!.did||
     process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
     process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
     options.adk?.nativePresentationTransport!=="mcp-stdio"||
     !Array.isArray(pinned!.capabilities)||
     pinned!.capabilities.length!==1||pinned!.capabilities[0]!=="read_file"))
    throw Error("Additional native A2A worker requires original Owner-signed read-only identity");
  if(extra&&!nativeExtra&&(!options.taskHandler||
     options.nativeSignerDid||options.mcpTaskSigning))
    throw Error("Additional A2A specialist requires owner-pinned non-native test handler");
  if(!extra&&options.ownerAdditionalCardPin)
    throw Error("Original specialist cannot replace its trusted Agent Card");
  const card=extra
    ?createOwnerAdditionalSpecialistCard(
       options.role,baseUrl,options.ownerAdditionalCardPin!)
    :createSpecializedAgentCard(options.role as SpecializedAgentRole,baseUrl,{
       delegatedAuthorization:options.delegatedAuthorization,
       ...(options.nativeSignerDid===undefined?{}:{nativeSignerDid:options.nativeSignerDid})
     });
  if (options.adk && options.taskHandler) throw new Error("Choose either ADK or custom taskHandler");
  if (!options.adk && !options.taskHandler) throw new Error("A2A agent requires an ADK runtime or a Task handler");
  // A private Rust MCP subprocess is an owner-bound signing
  // transport, never a free-standing A2A capability. Refuse it BEFORE any
  // listener or Task is created without the original
  // authority-only host and its private one-shot Task registry.
  if(options.adk?.nativePresentationTransport==="mcp-stdio"&&(
       process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
       !options.mcpTaskSigning))
    throw Error("private_native_mcp_requires_owner_bound_task");
  if(options.adk?.nativePresentationTransport==="mcp-stdio"&&
     !options.nativeSignerDid)
    throw Error("private_native_mcp_requires_signer_did");

  if (options.mcpTaskSigning && !options.adk) {
    throw new Error("Private MCP task worker requires a configured ADK runtime");
  }
  try{
  const mcpTaskRegistry = options.mcpTaskSigning
    ? new PrivateMcpTaskRegistry({role:options.role as SpecializedAgentRole,
       ...options.mcpTaskSigning})
    : undefined;
  const adkHandler = options.adk
    ? createAdkA2ATaskHandler({...options.adk,
      ...(mcpTaskRegistry ? {mcpTaskRegistry} : {}),
      ...(nativeExtra?{trustedAdditionalReadOnlyRole:{
       role:options.role,capabilities:[...pinned!.capabilities]
      }}:{})})
    : undefined;
  const taskHandler: DeterministicTaskHandler = adkHandler
    ? async (context,signal) => {
        try { return await adkHandler(context,signal); }
        finally { mcpTaskRegistry?.end(context.task_id); }
      }
    : options.taskHandler!;
  const executor = new DeterministicSpecializedAgentExecutor(
    options.role as SpecializedAgentRole,
    taskHandler
  );
  const requestHandler = new PrivateEvidenceRequestHandler(
    card,
    new PrivateEvidenceTaskStore(),
    executor
  );

  // Only the A2A service listener remains. Crypto presentations are
  // one-use task-local MCP SDK calls; no /internal/mcp-crypto-call route.
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
    role: options.role,
    baseUrl,
    card,
    executor,
    server,
    ...(mcpTaskRegistry?{cryptoProofCount:()=>mcpTaskRegistry.completedCryptoProofs}:{}),
    close: () => closing??=(async()=>{
      // close() fences private Task effects BEFORE awaiting HTTP shutdown.
      options.adk?.trustedEffectTaskRegistry?.retireAll();
      await new Promise<void>((resolve,reject)=>server.close(error=>
        error?reject(error):resolve()));
    })()
  };
  }catch(error){
    options.adk?.trustedEffectTaskRegistry?.retireAll();
    throw error;
  }
}
