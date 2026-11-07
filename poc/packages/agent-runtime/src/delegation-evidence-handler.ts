import type { DelegationEvidence } from "./contracts.ts";
import { ControlledToolError } from "./controlled-errors.ts";
import {invokeNativeCrypto} from "./native-crypto-ipc.ts";
import {createOwnerPrivateNativeCryptoMcpSession}
 from "../../../mcp-shared/src/owner-private-native-crypto-stdio.mjs";

type FetchLike = typeof fetch;

export interface PreparedGatewayAuthorization {
  request_id: string;
  audience: string;
  challenge: string;
  required_permission: {
    resource: string;
    operation: string;
  };
  expires_at: string;
}

export interface DelegationEvidenceHandlerConfig {
  /** Historical unsigned HTTP fixture only; native Rust VP needs no Adapter URL. */
  adapterBaseUrl?: string;
  adapterToken: string;
  evidence: DelegationEvidence;
  timeoutMs?: number;
  nativeSocketPath?: string;
  /** Trusted host only; not received from A2A/ADK/model/tool arguments. */
  nativePresentationTransport?: "direct"|"mcp-stdio";
  fetchFn?: FetchLike;
  signal?: AbortSignal;
}

export class DelegationEvidenceHandler {
  readonly #adapterBaseUrl: string;
  readonly #adapterToken: string;
  readonly #evidence: DelegationEvidence;
  readonly #timeoutMs: number;
  readonly #nativeSocketPath?:string;
  readonly #nativePresentationTransport:"direct"|"mcp-stdio";
  readonly #fetch: FetchLike;
  readonly #signal?: AbortSignal;

  constructor(config: DelegationEvidenceHandlerConfig) {
    if (!config.nativeSocketPath && !config.adapterBaseUrl?.trim()) {
      throw new Error("Delegation Adapter base URL cannot be empty");
    }
    if(config.nativePresentationTransport!==undefined&&
       config.nativePresentationTransport!=="direct"&&
       config.nativePresentationTransport!=="mcp-stdio")
      throw Error("Native MCP presenter transport unavailable");
    if(config.nativePresentationTransport==="mcp-stdio"&&
       !config.nativeSocketPath)
      throw Error("Private MCP native presenter requires trusted Rust socket");
    if (config.adapterToken.trim().length === 0) {
      throw new Error("Delegation Adapter token cannot be empty");
    }
    if (config.evidence.credential_id.trim().length === 0) {
      throw new Error("Delegation credential id cannot be empty");
    }

    // Signed canonical Tasks must not fall back to the old Adapter HTTP
    // presenter when the native Rust socket is absent.
    if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1"&&!config.nativeSocketPath)
      throw Error("Canonical signed Task VP requires native Rust signer socket");
    this.#adapterBaseUrl = (config.adapterBaseUrl??"").replace(/\/+$/u, "");
    this.#adapterToken = config.adapterToken;
    this.#evidence = structuredClone(config.evidence);
    this.#timeoutMs = config.timeoutMs ?? 5_000;
    this.#nativeSocketPath=config.nativeSocketPath;
    this.#nativePresentationTransport=config.nativePresentationTransport??"direct";
    this.#fetch = config.fetchFn ?? fetch;
    this.#signal = config.signal;
  }

  get credentialId(): string {
    return this.#evidence.credential_id;
  }

  get presenterId(): string {
    return this.#evidence.presenter_id;
  }

  async createPresentation(
    prepared: PreparedGatewayAuthorization
  ): Promise<string> {
    this.#signal?.throwIfAborted();
    // Native path uses the SAME Rust CryptoRuntime as the Engineer root
    // and the Orchestrator child. NEVER fall back to HTTP after native denial.
    if(this.#nativeSocketPath){
      let issued:unknown;
      try{
        const args={
          credential_id:this.#evidence.credential_id,
          disclosed_permissions:[prepared.required_permission],
          audience:prepared.audience,challenge:prepared.challenge
        };
        // The original A2A Task's signed Child and Gateway challenge are
        // fixed by the trusted handler before this host-selected transport.
        // A failed/ambiguous MCP signing call is never retried directly.
        issued=this.#nativePresentationTransport==="mcp-stdio"
          ?await createOwnerPrivateNativeCryptoMcpSession(
            "presentation_create",{
              socketPath:this.#nativeSocketPath,
              bearerToken:this.#adapterToken,timeoutMs:this.#timeoutMs,
              signal:this.#signal
            },args).invokeOnce()
          :await invokeNativeCrypto({
            socketPath:this.#nativeSocketPath,token:this.#adapterToken,
            timeoutMs:this.#timeoutMs
          },"create_presentation",args);
      }catch{
        throw new ControlledToolError("tool_unavailable",
          "Native Rust cryptographic presentation unavailable");
      }
      this.#signal?.throwIfAborted();
      const signed=issued&&typeof issued==="object"&&!Array.isArray(issued)
        ?(issued as {signed_vp?:unknown}).signed_vp:undefined;
      if(typeof signed!=="string"||!signed.trim())
        throw new ControlledToolError("tool_unavailable",
          "Native Rust cryptographic presentation malformed");
      return signed;
    }
    let response: Response;
    try {
      response = await this.#fetch(`${this.#adapterBaseUrl}/v1/presentations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#adapterToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          credential_id: this.#evidence.credential_id,
          disclosed_permissions: [prepared.required_permission],
          audience: prepared.audience,
          challenge: prepared.challenge
        }),
        signal: this.#signal
            ? AbortSignal.any([this.#signal, AbortSignal.timeout(this.#timeoutMs)])
            : AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ControlledToolError(
        "tool_unavailable",
        `Delegation Adapter is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.#signal?.throwIfAborted();
    const raw = await response.text();
    let body: unknown = {};
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ControlledToolError(
          "tool_unavailable",
          "Delegation Adapter returned invalid JSON"
        );
      }
    }

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Delegation Adapter rejected presentation with HTTP ${response.status}`;

      throw new ControlledToolError(
        response.status >= 500 ? "tool_unavailable" : "authorization_denied",
        message,
        { statusCode: response.status }
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("signed_vp" in body) ||
      typeof (body as { signed_vp?: unknown }).signed_vp !== "string" ||
      (body as { signed_vp: string }).signed_vp.trim().length === 0
    ) {
      throw new ControlledToolError(
        "tool_unavailable",
        "Delegation Adapter response is missing signed_vp"
      );
    }

    return (body as { signed_vp: string }).signed_vp;
  }
}
