import {
  OpenAIAdkModel,
  createGeminiAdkModel,
  SPECIALIZED_AGENT_ROLES,
  startSpecializedAgentServer,
  TrustedEffectStagingTaskRegistry,
  connectTrustedOwnerEffectStagingClient,
  createTrustedEffectAgentBindingServer,
  type SpecializedAgentRole
} from "@thesis/agent-runtime";
import {requireProductionDirectGatewayTools,requireProductionNativeCrypto} from "./mcp-tool-flags.ts";
import {generateKeyPairSync} from "node:crypto";

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
  if (process.env.ADK_MAX_MODEL_TURNS === undefined) return 40;
  const count = Number(process.env.ADK_MAX_MODEL_TURNS);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error("ADK_MAX_MODEL_TURNS must be a positive integer up to 100");
  }
  return count;
}
function modelCallTimeoutFromEnvironment(): number {
  const value = process.env.ADK_MODEL_CALL_TIMEOUT_MS === undefined
    ? 60_000 : Number(process.env.ADK_MODEL_CALL_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 120_000) {
    throw new Error("ADK_MODEL_CALL_TIMEOUT_MS must be 1000..120000");
  }
  return value;
}
function gatewayTimeoutForRole(role: SpecializedAgentRole): number {
  const fallback = role === "test" ? 900000 : 30000;
  const key = role === "test" ? "TEST_RUNNER_TIMEOUT_MS" : "ADK_GATEWAY_TIMEOUT_MS";
  const value = process.env[key] === undefined ? fallback : Number(process.env[key]);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 900000) {
    throw new Error(key + " must be a timeout from 1000 to 900000 milliseconds");
  }
  return value;
}
const roleToken = {
  backend: "ADAPTER_CALLER_BACKEND",
  frontend: "ADAPTER_CALLER_FRONTEND",
  test: "ADAPTER_CALLER_TEST"
}[role];
const architecture=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
if(architecture!==undefined&&
   architecture!=="authority-only"&&architecture!=="legacy-signed-dag")
 throw Error("Unsupported Gateway architecture selector");
const ownerOnly=architecture==="authority-only";
if(ownerOnly&&engine!=="adk")
 throw Error("Authority-only Task binding requires ADK runtime");
const effectRegistry=ownerOnly?new TrustedEffectStagingTaskRegistry():undefined;
const ownerIpcFiles=[
 "ADK_OWNER_STAGE_SOCKET","ADK_OWNER_STAGE_SECRET_FILE",
 "ADK_PRIVATE_TASK_BIND_SOCKET","ADK_PRIVATE_TASK_BIND_SECRET_FILE"
] as const;
if(!ownerOnly&&ownerIpcFiles.some(name=>process.env[name]!==undefined))
 throw Error("Private authority-only Task transport cannot run in legacy mode");
const provider = process.env.ADK_MODEL_PROVIDER ?? "openai";
if (engine === "adk" && provider !== "openai" && provider !== "gemini") {
  throw new Error("ADK_MODEL_PROVIDER must be openai or gemini");
}
const adk = engine === "adk"
  ? {
      model: provider === "gemini"
        ? createGeminiAdkModel({
            apiKey: required("GEMINI_API_KEY"),
            model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash"
          })
        : new OpenAIAdkModel({ apiKey: required("OPENAI_API_KEY") }),
      gatewayBaseUrl: required("GATEWAY_URL"),
      ...(effectRegistry?{trustedEffectTaskRegistry:effectRegistry}:{}),
      // One native Rust crypto socket handles Child DC and VP; no Adapter HTTP URL.
      adapterToken: required(roleToken),
      maxModelTurns: turnsFromEnvironment(),
      maxModelCallMs: modelCallTimeoutFromEnvironment(),
      gatewayTimeoutMs: gatewayTimeoutForRole(role)
    }
  : undefined;

// Production ADK must use direct Gateway FunctionTools and task-local crypto
// backed by ONE native Rust issuer; no remote MCP worker or HTTP downgrade.
requireProductionDirectGatewayTools(process.env);
requireProductionNativeCrypto(process.env,engine);
if(engine==="adk")process.env.APPROVED_RUNNER_NATIVE_MCP="1";
const localKeys=engine==="adk" ? generateKeyPairSync("ed25519") : undefined;
const mcpTaskSigning=localKeys
  ? {signingPrivateKeyPem:localKeys.privateKey.export({
       format:"pem",type:"pkcs8"}).toString(),
     signingPublicKeyPem:localKeys.publicKey.export({
       format:"pem",type:"spki"}).toString()}
  : undefined;
// Owner-provisioned paths point to 0600 secret files in 0700 directories.
 // Env values select endpoints only: no Task, Child, HEAD or signer is
 // accepted from environment variables, A2A metadata, MCP or model calls.
const stageClient=effectRegistry
 ?await connectTrustedOwnerEffectStagingClient({
   socketPath:required("ADK_OWNER_STAGE_SOCKET"),
   secretFile:required("ADK_OWNER_STAGE_SECRET_FILE")
  }):undefined;
const bindingServer=effectRegistry&&stageClient
 ?await createTrustedEffectAgentBindingServer({
   socketPath:required("ADK_PRIVATE_TASK_BIND_SOCKET"),
   secretFile:required("ADK_PRIVATE_TASK_BIND_SECRET_FILE"),
   registry:effectRegistry,ownerStageClient:stageClient
  }):undefined;
await bindingServer?.start(); // HMAC owner bind ready BEFORE A2A starts
let runtime:Awaited<ReturnType<typeof startSpecializedAgentServer>>;
try{
 runtime=await startSpecializedAgentServer({
  role,
  port,
  host: process.env.AGENT_BIND_HOST ?? "127.0.0.1",
  ...(adk ? { adk } : {}),
  ...(mcpTaskSigning ? {mcpTaskSigning} : {})
 });
}catch(error){
 await bindingServer?.close(); // close and fence pending Task pins
 throw error;
}

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
  const result=await Promise.allSettled([
    runtime.close(),bindingServer?.close()
  ]);
  process.exit(result.some(r=>r.status==="rejected")?1:0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
