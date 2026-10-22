/**
 * Fail-closed authorization PRECHECK before constructing a billable Gemini
 * model for a trusted Planning -> Execution handoff.
 *
 * This is not a payment authorization service and never performs inference.
 * The eventual manual workflow MUST invoke it in the trusted host process,
 * using the authenticated GitHub event/attempt and the actual API secret.
 *
 * Crucially, the paid opt-in never replaces the Engineer's independently
 * verified Ed25519 receipt. Neither a model-generated plan, a digest nor a
 * CI-only signing fixture can impersonate the human approval.
 */
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {TrustedPlanningReviewGate} from "./trusted-planning-review-gate.ts";
import {createGeminiAdkModel}
  from "../../agent-runtime/src/gemini-adk-model.ts";
import type {AdkA2ATaskHandlerConfig}
  from "../../agent-runtime/src/adk-a2a-handler.ts";
import {startSpecializedAgentServer,
  type SpecializedAgentServer}
  from "../../agent-runtime/src/server.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";

const CONFIRMATION="I AUTHORIZE GEMINI API CHARGES";
const MODEL=/^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const DIGEST=/^[0-9a-f]{64}$/u;

function reject(reason:string):never{
  throw new Error("Trusted paid Gemini readiness: "+reason);
}
export interface ManualGeminiExecutionReadinessInput{
  /** Read only from authenticated GitHub Actions runtime, not model text. */
  githubEventName:string;
  githubRunAttempt:string;
  authorizationInput:string;
  /** Actual secret stays in the trusted host; never returned or logged. */
  geminiApiKey:string|undefined;
  modelName:string;
  maxModelTurns:number;
  maxOutputTokens:number;
  /** Trusted Coordinator, not a model/UI-reported phase. */
  trustedPhase:()=>string;
  /** Only accepts a real Ed25519-verifying trusted receipt store. */
  reviewGate:TrustedPlanningReviewGate;
}
export interface ManualGeminiExecutionReadiness{
  status:"signed_engineer_approved_manual_gemini_ready";
  session_id:string;
  plan_digest:string;
  base_revision:string;
  model_name:string;
  max_model_turns:number;
  max_output_tokens:number;
  approved_permission_ids:readonly string[];
  authenticated_engineer_did:string;
}

/**
 * Verifies, in order: manual first attempt, explicit cost consent, usable
 * bounded model config, active trusted Planning and the EXACT signed Engineer
 * decision already persisted in the trusted store.
 *
 * The returned immutable metadata is NOT a root credential or permission to
 * write; real operational issuance is still delegated to the Coordinator
 * (which reloads the same signed decision) and Gateway + native Rust + OPA.
 */
export async function verifyManualGeminiExecutionReadiness(
  input:ManualGeminiExecutionReadinessInput
):Promise<Readonly<ManualGeminiExecutionReadiness>>{
  if(input.githubEventName!=="workflow_dispatch"||
     input.githubRunAttempt!=="1")
    reject("requires an explicitly dispatched first GitHub Actions attempt");
  if(input.authorizationInput!==CONFIRMATION)
    reject("explicit API-charge authorization is missing");
  if(typeof input.geminiApiKey!=="string"||
     !input.geminiApiKey.trim())
    reject("Gemini API secret is not configured");
  if(typeof input.modelName!=="string"||!MODEL.test(input.modelName)||
     input.modelName.length>80)
    reject("invalid explicitly selected Gemini Developer API model");
  if(!Number.isSafeInteger(input.maxModelTurns)||
     input.maxModelTurns<1||input.maxModelTurns>32)
    reject("model-call budget must be bounded to 1..32 turns per role");
  if(!Number.isSafeInteger(input.maxOutputTokens)||
     input.maxOutputTokens<1||input.maxOutputTokens>32000)
    reject("model output budget must be bounded to 1..32000 tokens");
  if(!(input.reviewGate instanceof TrustedPlanningReviewGate)||
     typeof input.trustedPhase!=="function"||
     input.trustedPhase()!=="planning")
    reject("trusted Planning review and active Coordinator are required");

  const packet=input.reviewGate.reviewPacket();
  if(packet.status!=="awaiting_engineer_signature"||
     !DIGEST.test(packet.plan_digest))
    reject("no immutable staged Planning proposal");
  const receipt=await input.reviewGate.loadAuthenticatedApproval(
    packet.session_id
  );
  if(input.trustedPhase()!=="planning")
    reject("Planning phase changed during approval verification");
  if(planDigest(receipt.plan)!==packet.plan_digest)
    reject("signed plan no longer matches the staged digest");
  const ids=receipt.approval.approved_permission_ids;
  if(!Array.isArray(ids)||ids.length===0)
    reject("Engineer must explicitly approve at least one permission");
  const result:ManualGeminiExecutionReadiness={
    status:"signed_engineer_approved_manual_gemini_ready",
    session_id:packet.session_id,
    plan_digest:packet.plan_digest,
    base_revision:packet.base_revision,
    model_name:input.modelName,
    max_model_turns:input.maxModelTurns,
    max_output_tokens:input.maxOutputTokens,
    approved_permission_ids:Object.freeze([...ids]),
    authenticated_engineer_did:receipt.authenticated_engineer_did
  };
  return Object.freeze(result);
}


/**
 * Instantiate, but NEVER invoke, the real Google ADK Gemini model only
 * AFTER independent signature verification and manual API-charge consent.
 * Construction alone performs no inference or credential issuance.
 *
 * The caller must separately enforce readiness.max_model_turns and
 * readiness.max_output_tokens in its ADK task handler. The returned model
 * is never added to the unapproved Planning/LLM tool registry.
 */
export async function createReviewedGeminiAdkModel(
  input:ManualGeminiExecutionReadinessInput
){
  const readiness=await verifyManualGeminiExecutionReadiness(input);
  // The secret remains confined to the trusted process and model constructor.
  const model=createGeminiAdkModel({
    apiKey:input.geminiApiKey!,
    model:readiness.model_name
  });
  return {readiness,model};
}


export type ReviewedGeminiAgentRole="backend"|"frontend"|"test";
export interface TrustedGeminiAgentTransport{
  gatewayBaseUrl:string;
  adapterBaseUrl:string;
  /** Private role-specific service token. Never forwarded to the LLM. */
  adapterToken:string;
}
export interface ReviewedGeminiA2ARoleRuntime{
  readonly readiness:Readonly<ManualGeminiExecutionReadiness>;
  /** Pass ONLY to the trusted A2A server, not the model/session context. */
  readonly role_configs:Readonly<Record<
    ReviewedGeminiAgentRole,AdkA2ATaskHandlerConfig
  >>;
}
const ROLES=["backend","frontend","test"] as const;
// Only a verified receipt can mint a role configuration in this host process.
// A caller-supplied object with a copied digest is not a verified runtime.
const mintedRoleRuntimes=new WeakSet<object>();

/**
 * Convert verified manual consent plus authentic Engineer approval into
 * explicitly bounded ADK Agent server configurations. The limits come from
 * the SAME preflight, not loose caller defaults. This never invokes a model,
 * provisions a DC, starts A2A or approves a plan.
 *
 * Caller responsibilities: pass only trusted host transport settings;
 * connect the resulting configs to the SAME signed Approved A2A Dispatcher;
 * call Coordinator.beginExecution with the exact approved receipt; preserve
 * Gateway/Core Rust/OPA enforcement for every requested operation.
 */
export async function createReviewedGeminiA2ARoleRuntime(input:
  ManualGeminiExecutionReadinessInput&{
    transports:Readonly<Record<ReviewedGeminiAgentRole,
      TrustedGeminiAgentTransport>>;
    maxModelCallMs:number;
  }
):Promise<ReviewedGeminiA2ARoleRuntime>{
  const {readiness,model:backendModel}=
    await createReviewedGeminiAdkModel(input);
  if(!Number.isSafeInteger(input.maxModelCallMs)||
     input.maxModelCallMs<1000||input.maxModelCallMs>360000)
    reject("invalid bounded per-inference timeout");
  const configs={} as Record<ReviewedGeminiAgentRole,
    AdkA2ATaskHandlerConfig>;
  const seenTokens=new Set<string>();
  for(const role of ROLES){
    const transport=input.transports?.[role];
    if(!transport||typeof transport.gatewayBaseUrl!=="string"||
       typeof transport.adapterBaseUrl!=="string"||
       typeof transport.adapterToken!=="string"||
       !/^https?:\/\/[^/\s]+(?:\/[^?\s#]*)?$/u.test(transport.gatewayBaseUrl)||
       !/^https?:\/\/[^/\s]+(?:\/[^?\s#]*)?$/u.test(transport.adapterBaseUrl)||
       !transport.adapterToken.trim()||seenTokens.has(transport.adapterToken))
      reject("trusted per-role transport or unique service token is invalid");
    seenTokens.add(transport.adapterToken);
    configs[role]=Object.freeze({
      model:role==="backend"?backendModel:createGeminiAdkModel({
        apiKey:input.geminiApiKey!,
        model:readiness.model_name
      }),
      gatewayBaseUrl:transport.gatewayBaseUrl,
      adapterBaseUrl:transport.adapterBaseUrl,
      adapterToken:transport.adapterToken,
      maxModelTurns:readiness.max_model_turns,
      maxModelCallMs:input.maxModelCallMs,
      generateContentConfig:Object.freeze({
        maxOutputTokens:readiness.max_output_tokens
      }),
      // File lists and operations are derived afresh from signed A2A task
      // context by the handler, never from an LLM's role suggestion.
      scopeModelPaths:true
    });
  }
  const runtime=Object.freeze({
    readiness,
    role_configs:Object.freeze(configs)
  });
  mintedRoleRuntimes.add(runtime);
  return runtime;
}


export interface ReviewedGeminiA2AServers{
  readonly servers:Readonly<Record<ReviewedGeminiAgentRole,
    SpecializedAgentServer>>;
  readonly endpoints:Readonly<Record<ReviewedGeminiAgentRole,string>>;
  /** Closing servers is not approval or operational DC revocation. */
  close():Promise<void>;
}

/**
 * Connect the approved, already bounded Gemini role configurations to actual
 * localhost A2A servers ONLY after the Coordinator has issued and activated
 * the independently verified operational root on the Gateway.
 *
 * On any start/configuration failure after activation, fail closed by
 * shutting down the already-started servers AND revoking operational authority.
 * No inference is performed by merely starting the servers.
 */
export async function startReviewedGeminiA2AServers(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewed:ReviewedGeminiA2ARoleRuntime;
  ports:Readonly<Record<ReviewedGeminiAgentRole,number>>;
}):Promise<ReviewedGeminiA2AServers>{
  if(!(input.coordinator instanceof TrustedExecutionCoordinator))
    reject("trusted operational Coordinator is required");
  // Reject a fabricated or copied approval token without touching any model.
  if(!mintedRoleRuntimes.has(input.reviewed))
    reject("only an authenticated minted Gemini runtime can start A2A roles");
  if(input.coordinator.phase!=="execution")
    reject("operational root and Gateway plan must be active before A2A start");
  const started:SpecializedAgentServer[]=[];
  const servers={} as Record<ReviewedGeminiAgentRole,SpecializedAgentServer>;
  try{
    const root=input.coordinator.trustedOperationalAuthority();
    if(root.plan_digest!==input.reviewed.readiness.plan_digest)
      reject("operational plan digest differs from signed Engineer decision");
    const ports=ROLES.map(role=>input.ports?.[role]);
    if(ports.some(port=>!Number.isSafeInteger(port)||port<1024||port>65535)||
       new Set(ports).size!==ROLES.length)
      reject("distinct, valid local A2A ports are required");
    for(const role of ROLES){
      if(input.coordinator.phase!=="execution")
        reject("operational execution phase changed during server startup");
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:input.ports[role],
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        adk:input.reviewed.role_configs[role]
      });
      started.push(server);
      servers[role]=server;
    }
    const endpoints=Object.freeze(Object.fromEntries(
      ROLES.map(role=>[role,servers[role].baseUrl])
    ) as Record<ReviewedGeminiAgentRole,string>);
    return Object.freeze({
      servers:Object.freeze(servers),
      endpoints,
      close:async()=>{
        for(const server of [...started].reverse())await server.close();
      }
    });
  }catch(error){
    for(const server of started.reverse()){
      try{await server.close();}catch{/* best-effort A2A cleanup */}
    }
    if(input.coordinator.phase==="execution"){
      try{await input.coordinator.closeExecution();}
      catch{
        throw new Error("Gemini A2A startup failed; operational root revocation needs operator reconciliation");
      }
    }
    throw error;
  }
}
