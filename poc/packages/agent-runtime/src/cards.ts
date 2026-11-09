import {
  A2A_PROTOCOL_VERSION,
  type AgentCard
} from "@a2a-js/sdk";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  type SpecializedAgentRole
} from "./contracts.ts";

import {
 LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_CONTENT,
 LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_TAGS
} from "./fixtures/account-suspension-agent-cards.ts";

import {APPROVED_SPECIALIZED_AGENT_PROFILES,
 nativeAuthorityOnlyAdvertisedCapabilities} from "./approved-specialized-profiles.ts";

const ROLE_CONFIG = {
  backend:{name:"Backend Development Agent",did:"did:thesis:backend-agent"},
  frontend:{name:"Frontend Development Agent",did:"did:thesis:frontend-agent"},
  test:{name:"Software Testing Agent",did:"did:thesis:test-agent"}
} as const;

// Agent Cards advertise generic ROLE CAPABILITIES only. Per-Task file and
// operation permissions are signed separately and enforced by Gateway/Rust/OPA.
const APPROVED_PLAN_SKILLS = {
  backend: {
    id: "backend-software-engineering",
    name: "Backend Software Engineering",
    description: "Implement authorized backend Tasks using delegated, verified repository operations.",
    example: "Implement an approved backend change within the assigned repository files."
  },
  frontend: {
    id: "frontend-software-engineering",
    name: "Frontend Software Engineering",
    description: "Implement authorized frontend Tasks using delegated, verified repository operations.",
    example: "Implement an approved user-interface change within the assigned repository files."
  },
  test: {
    id: "software-testing",
    name: "Software Testing",
    description: "Develop and run approved software tests under delegated, verified authorization.",
    example: "Validate an approved change with the authorized test files and test profile."
  }
} as const;

export function agentDid(role: SpecializedAgentRole): string {
  return ROLE_CONFIG[role].did;
}

/**
 * R382.3: in the original authority-only native Rust profile, the Card
 * asserts the SAME already-provisioned role DID used by the Rust signer,
 * not the historical static demonstration DID. This is private host
 * configuration, not a model/Task-selected identity or authorization grant.
 */
export function trustedSignerAgentDid(role: SpecializedAgentRole):string {
 if(process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only")
  return agentDid(role);
 const configured=process.env["ADAPTER_ID_"+role.toUpperCase()];
 if(typeof configured!=="string"||
    !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u.test(configured)||
    (process.env.ADAPTER_TRUST_PROFILE==="evm"&&
     !configured.startsWith("did:ethr:")))
  throw Error("Trusted native A2A Agent Card signer DID mismatch");
 return configured;
}

export function createSpecializedAgentCard(
  role: SpecializedAgentRole,
  baseUrl: string,
  options: {
    delegatedAuthorization?: boolean;
    /** Trusted server-startup choice, not a per-Task grant or identity proof. */
    capabilityProfile?: "legacy" | "approved-plan";
    /** Original native Rust role signer DID; never an A2A/ADK/model input. */
    nativeSignerDid?: string;
  } = {}
): AgentCard {
  const config = ROLE_CONFIG[role];
  // R382.3: the native Rust signer DID is not the historical static
  // demonstration Card DID. Publish ONLY the already provisioned role's
  // actual signing identity, and only in the verified authority-only host.
  // The owner Review Host will independently compare this public assertion
  // with the DID in its immutable trusted registry and signed Child.
  const nativeDid=options.nativeSignerDid;
  if(nativeDid!==undefined&&(
      process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
      process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
      nativeDid!==trustedSignerAgentDid(role)))
   throw Error("Trusted native A2A Agent Card signer DID mismatch");
  const signerDid=nativeDid??config.did;
  // General role capabilities are the default for all new A2A discovery.
  // Historical scenario Card descriptions are explicit opt-in test fixtures.
  const approved = options.capabilityProfile !== "legacy";
  const skill = approved ? APPROVED_PLAN_SKILLS[role] : undefined;
  const legacy = !approved ? LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_CONTENT[role] : undefined;
  const delegatedAuthorization = options.delegatedAuthorization ?? true;
  // Native role discovery uses the original owner-approved capability
  // catalog. Test CREATE remains restricted to exact project test sources
  // under independently signed Root/Child, VP/OPA and CAS.
  const advertisedTools=nativeDid!==undefined?
    nativeAuthorityOnlyAdvertisedCapabilities(role):
    APPROVED_SPECIALIZED_AGENT_PROFILES[role].tools;

  return {
    name: config.name,
    description: skill?.description ?? legacy!.description,
    supportedInterfaces: [
      {
        url: `${baseUrl.replace(/\/+$/u, "")}/a2a/rest`,
        protocolBinding: "HTTP+JSON",
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION
      }
    ],
    provider: {
      organization: "Thesis PoC",
      url: "https://github.com/DarkGh0st03/delegation"
    },
    version: "0.1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: delegatedAuthorization
        ? [
            {
              uri: DELEGATED_AUTHORIZATION_EXTENSION_URI,
              description:
                "Carries Delegation Evidence in Message.metadata while authority remains enforced by the Delegation Credential/Gateway path.",
              required: true,
              params: {
                agentDid: signerDid,
                ...(approved?{taskCapabilities:[...advertisedTools]}:{}),
                evidenceLocation: "message.metadata.delegation_evidence"
              }
            }
          ]
        : [],
      extendedAgentCard: false
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: skill?.id ?? legacy!.skillId,
        name: skill?.name ?? legacy!.skillName,
        description: skill?.description ?? legacy!.description,
        tags: approved
          ? ["thesis", "software-engineering", "delegated-authorization", role]
          : [...LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_TAGS, role],
        examples: [skill?.example ?? legacy!.example],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: []
      }
    ],
    documentationUrl: "",
    signatures: []
  };
}

/**
 * Owner-provisioned, read-only synthetic A2A specialist Card.
 * This is a local NON-NATIVE server contract: it does not issue a Child,
 * register an executable native Rust signer or add Gateway capabilities.
 * Only the trusted owner may supply this immutable pin at server startup.
 */
export interface OwnerAdditionalCardPin{
 did:string;name:string;skillId:string;capabilities:readonly string[];
}
export function createOwnerAdditionalSpecialistCard(
 role:string,baseUrl:string,pin:OwnerAdditionalCardPin
):AgentCard{
 const CORE=["backend","frontend","test"];
 const validRole=/^[a-z][a-z0-9_-]{0,23}$/u;
 const validDid=/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
 const validSkill=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
 if(!validRole.test(role)||CORE.includes(role)||
    ["orchestrator","constructor","prototype"].includes(role)||
    !pin||typeof pin!=="object"||Array.isArray(pin)||
    Object.keys(pin).sort().join(",")!=="capabilities,did,name,skillId"||
    typeof pin.did!=="string"||!validDid.test(pin.did)||
    typeof pin.name!=="string"||!pin.name.trim()||
    pin.name.length>128||/[\x00-\x1f\x7f]/u.test(pin.name)||
    typeof pin.skillId!=="string"||!validSkill.test(pin.skillId)||
    !Array.isArray(pin.capabilities)||!pin.capabilities.length||
    pin.capabilities.length>3||
    new Set(pin.capabilities).size!==pin.capabilities.length||
    pin.capabilities.some(operation=>
     !["read_file","update_file","create_file"].includes(operation)))
   throw Error("Additional A2A Card requires exact trusted Owner identity and capability pins");
 return {
  name:pin.name,
  description:"Owner-provisioned delegated software specialist",
  supportedInterfaces:[{
   url:`${baseUrl.replace(/\/+$/u,"")}/a2a/rest`,
   protocolBinding:"HTTP+JSON",tenant:"",protocolVersion:A2A_PROTOCOL_VERSION
  }],
  provider:{organization:"Thesis PoC",url:"https://github.com/DarkGh0st03/delegation"},
  version:"0.1.0",
  capabilities:{
   streaming:false,pushNotifications:false,extendedAgentCard:false,
   extensions:[{
    uri:DELEGATED_AUTHORIZATION_EXTENSION_URI,
    description:"Signed Task evidence; only Gateway/Rust/OPA can authorize a provider effect",
    required:true,
    params:{agentDid:pin.did,taskCapabilities:[...pin.capabilities],
     evidenceLocation:"message.metadata.delegation_evidence"}
   }]
  },
  securitySchemes:{},securityRequirements:[],
  defaultInputModes:["application/json"],defaultOutputModes:["application/json"],
  skills:[{
   id:pin.skillId,name:pin.name,
   description:"Work only within the signed owner-bound Task grant",
   tags:["thesis","delegated-authorization","owner-provisioned",role],
   examples:["Inspect an explicitly authorized repository file"],
   inputModes:["application/json"],outputModes:["application/json"],
   securityRequirements:[]
  }],
  documentationUrl:"",signatures:[]
 };
}
