import type {
  Message, Task, SendMessageRequest, GetTaskRequest, StreamResponse,
  SubscribeToTaskRequest
} from "@a2a-js/sdk";
import {DefaultRequestHandler, type ServerCallContext} from "@a2a-js/sdk/server";

/**
 * The upstream ResultManager prepends the original user Message to Task
 * history. For this protected A2A endpoint that Message includes DC evidence
 * in metadata. Force historyLength=0 for EVERY caller, not just our own
 * Orchestrator, including immediately returned nonblocking Task snapshots.
 */
export class PrivateEvidenceRequestHandler extends DefaultRequestHandler {
  override sendMessage(params: SendMessageRequest, context: ServerCallContext): Promise<Task | Message> {
    return super.sendMessage({
      ...params,
      configuration: {...params.configuration, historyLength: 0}
    }, context);
  }

  override getTask(params: GetTaskRequest, context: ServerCallContext): Promise<Task> {
    return super.getTask({...params, historyLength: 0}, context);
  }

  // The advertised Agent Card has streaming=false. The streaming and
  // resubscription transports are deliberately disabled for this PoC.
  override async *sendMessageStream(
    _params: SendMessageRequest, _context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined> {
    throw new Error("Protected A2A streaming is disabled");
  }

  override async *resubscribe(
    _params: SubscribeToTaskRequest, _context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined> {
    throw new Error("Protected A2A resubscription is disabled");
  }
}
