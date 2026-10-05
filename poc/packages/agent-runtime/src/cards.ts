import {
  A2A_PROTOCOL_VERSION,
  type AgentCard
} from "@a2a-js/sdk";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  type SpecializedAgentRole
} from "./contracts.ts";

const ROLE_CONFIG = {
  backend: {
    name: "Backend Development Agent",
    did: "did:thesis:backend-agent",
    skillId: "backend-account-lifecycle",
    skillName: "Backend Account Lifecycle",
    description:
      "Deterministic Phase 7 backend agent for the IAM Account Suspension workflow."
  },
  frontend: {
    name: "Frontend Development Agent",
    did: "did:thesis:frontend-agent",
    skillId: "frontend-account-lifecycle",
    skillName: "Frontend Account Lifecycle",
    description:
      "Deterministic Phase 7 frontend agent for the IAM Account Suspension workflow."
  },
  test: {
    name: "Software Testing Agent",
    did: "did:thesis:test-agent",
    skillId: "test-account-lifecycle",
    skillName: "Account Suspension Validation",
    description:
      "Deterministic Phase 7 testing agent for the IAM Account Suspension workflow."
  }
} as const;

export function agentDid(role: SpecializedAgentRole): string {
  return ROLE_CONFIG[role].did;
}

export function createSpecializedAgentCard(
  role: SpecializedAgentRole,
  baseUrl: string,
  options: { delegatedAuthorization?: boolean } = {}
): AgentCard {
  const config = ROLE_CONFIG[role];
  const delegatedAuthorization = options.delegatedAuthorization ?? true;

  return {
    name: config.name,
    description: config.description,
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
                agentDid: config.did,
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
        id: config.skillId,
        name: config.skillName,
        description: config.description,
        tags: ["thesis", "iam", "account-suspension", role],
        examples: [
          role === "backend"
            ? "Implement the backend account suspension lifecycle."
            : role === "frontend"
              ? "Implement administrator Suspend/Reactivate controls."
              : "Validate the Account Suspension workflow."
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: []
      }
    ],
    documentationUrl: "",
    signatures: []
  };
}
