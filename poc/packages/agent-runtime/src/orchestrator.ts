import { randomUUID } from "node:crypto";
import {
  Role,
  type AgentCard,
  type Task
} from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  ServiceParameters,
  withA2AExtensions
} from "@a2a-js/sdk/client";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  type DelegationEvidence,
  type DeterministicSubtask
} from "./contracts.ts";

export class IncompatibleAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleAgentError";
  }
}

export function assertDelegatedAuthorizationSupport(card: AgentCard): void {
  const extension = card.capabilities?.extensions.find(
    (candidate) => candidate.uri === DELEGATED_AUTHORIZATION_EXTENSION_URI
  );
  if (!extension) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not advertise required delegated-authorization extension`
    );
  }

  const restInterface = card.supportedInterfaces.find(
    (candidate) =>
      candidate.protocolBinding.toUpperCase() === "HTTP+JSON" &&
      candidate.protocolVersion === "1.0"
  );
  if (!restInterface) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not expose A2A HTTP+JSON protocolVersion 1.0`
    );
  }

  if (
    !card.defaultInputModes.includes("application/json") ||
    !card.defaultOutputModes.includes("application/json")
  ) {
    throw new IncompatibleAgentError(
      `Agent ${card.name} does not advertise application/json input/output modes`
    );
  }
}

export interface ProtectedA2ATaskRequest {
  agent_base_url: string;
  subtask: DeterministicSubtask;
  delegation_evidence: DelegationEvidence;
}

export interface ProtectedA2ATaskResult {
  card: AgentCard;
  task: Task;
}

export class DeterministicA2AOrchestrator {
  readonly #factory: ClientFactory;

  constructor() {
    this.#factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        preferredTransports: ["HTTP+JSON"]
      })
    );
  }

  async sendProtectedTask(
    request: ProtectedA2ATaskRequest
  ): Promise<ProtectedA2ATaskResult> {
    const client = await this.#factory.createFromUrl(request.agent_base_url);
    const card = await client.getAgentCard();
    assertDelegatedAuthorizationSupport(card);

    const result = await client.sendMessage(
      {
        tenant: "",
        message: {
          messageId: randomUUID(),
          contextId: "",
          taskId: "",
          role: Role.ROLE_USER,
          parts: [
            {
              content: {
                $case: "data",
                value: request.subtask
              },
              metadata: undefined,
              filename: "",
              mediaType: "application/json"
            }
          ],
          metadata: {
            delegation_evidence: request.delegation_evidence
          },
          extensions: [DELEGATED_AUTHORIZATION_EXTENSION_URI],
          referenceTaskIds: []
        },
        configuration: undefined,
        metadata: {
          workflow: "account-suspension"
        }
      },
      {
        serviceParameters: ServiceParameters.create(
          withA2AExtensions(DELEGATED_AUTHORIZATION_EXTENSION_URI)
        )
      }
    );

    if (!("id" in result)) {
      throw new Error(
        `Protected deterministic A2A request returned a Message instead of a Task from ${card.name}`
      );
    }

    return {
      card,
      task: result
    };
  }
}
