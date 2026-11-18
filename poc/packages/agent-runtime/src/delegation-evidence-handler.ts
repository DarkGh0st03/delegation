import type { DelegationEvidence } from "./contracts.ts";
import { ControlledToolError } from "./controlled-errors.ts";
import {invokeNativeCrypto} from "./native-crypto-ipc.ts";
import {createOwnerPrivateNativeCryptoMcpSession}
 from "../../../mcp-shared/src/owner-private-native-crypto-stdio.mjs";

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

/** The exact presentation an agent's wallet is asked to sign. */
export interface PresentationRequest {
  credential_id: string;
  disclosed_permissions: PreparedGatewayAuthorization["required_permission"][];
  audience: string;
  challenge: string;
}

/**
 * TESTS ONLY: an explicit, injected fake signer. Production agents sign
 * every VP in their own native Rust wallet (nativeSocketPath); a signer is
 * refused whenever the canonical native mode is on.
 */
export type PresentationSigner = (
  request: Readonly<PresentationRequest>
) => Promise<string>;

export interface DelegationEvidenceHandlerConfig {
  /** Caller token of this agent for its own wallet. */
  adapterToken: string;
  evidence: DelegationEvidence;
  timeoutMs?: number;
  /** This agent's Rust wallet socket (production). */
  nativeSocketPath?: string;
  /** Trusted host only; not received from A2A/ADK/model/tool arguments. */
  nativePresentationTransport?: "direct"|"mcp-stdio";
  /** Tests only; see PresentationSigner. */
  presentationSigner?: PresentationSigner;
  signal?: AbortSignal;
}

export class DelegationEvidenceHandler {
  readonly #adapterToken: string;
  readonly #evidence: DelegationEvidence;
  readonly #timeoutMs: number;
  readonly #nativeSocketPath?:string;
  readonly #nativePresentationTransport:"direct"|"mcp-stdio";
  readonly #presentationSigner?: PresentationSigner;
  readonly #signal?: AbortSignal;

  constructor(config: DelegationEvidenceHandlerConfig) {
    if(config.nativePresentationTransport!==undefined&&
       config.nativePresentationTransport!=="direct"&&
       config.nativePresentationTransport!=="mcp-stdio")
      throw Error("Native MCP presenter transport unavailable");
    if(config.nativePresentationTransport==="mcp-stdio"&&
       !config.nativeSocketPath)
      throw Error("Private MCP native presenter requires trusted Rust socket");
    if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1"&&
       (!config.nativeSocketPath||config.presentationSigner))
      throw Error("Canonical signed Task VP requires native Rust signer socket");
    if (!config.nativeSocketPath === !config.presentationSigner) {
      throw new Error("Delegation evidence needs exactly one signer: the native wallet or an explicit test signer");
    }
    if (config.adapterToken.trim().length === 0) {
      throw new Error("Delegation wallet token cannot be empty");
    }
    if (config.evidence.credential_id.trim().length === 0) {
      throw new Error("Delegation credential id cannot be empty");
    }
    this.#adapterToken = config.adapterToken;
    this.#evidence = structuredClone(config.evidence);
    this.#timeoutMs = config.timeoutMs ?? 5_000;
    this.#nativeSocketPath=config.nativeSocketPath;
    this.#nativePresentationTransport=config.nativePresentationTransport??"direct";
    this.#presentationSigner=config.presentationSigner;
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
    const request: PresentationRequest = {
      credential_id: this.#evidence.credential_id,
      disclosed_permissions: [prepared.required_permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    };
    let issued: unknown;
    try {
      issued = this.#nativeSocketPath
        ? await this.#signNatively(this.#nativeSocketPath, request)
        : {signed_vp: await this.#presentationSigner!(Object.freeze({...request}))};
    } catch {
      // A signer failure is terminal: never retried through another route.
      throw new ControlledToolError("tool_unavailable",
        "Cryptographic presentation unavailable");
    }
    this.#signal?.throwIfAborted();
    const signed=issued&&typeof issued==="object"&&!Array.isArray(issued)
      ?(issued as {signed_vp?:unknown}).signed_vp:undefined;
    if(typeof signed!=="string"||!signed.trim())
      throw new ControlledToolError("tool_unavailable",
        "Cryptographic presentation malformed");
    return signed;
  }

  /** The agent's own Child DC travels as DATA to its wallet, which holds
   * only this agent's key and no shared credential store. */
  async #signNatively(socketPath: string, request: PresentationRequest): Promise<unknown> {
    let credential:unknown;
    try{credential=JSON.parse(this.#evidence.credential);}catch{credential=undefined;}
    const args={...request,
      ...(credential&&typeof credential==="object"&&!Array.isArray(credential)&&
        (credential as {id?:unknown}).id===this.#evidence.credential_id?{credential}:{})
    };
    // The signed Child and the Gateway challenge are fixed by the trusted
    // handler before this host-selected transport.
    return this.#nativePresentationTransport==="mcp-stdio"
      ?await createOwnerPrivateNativeCryptoMcpSession(
        "presentation_create",{
          socketPath,bearerToken:this.#adapterToken,timeoutMs:this.#timeoutMs,
          signal:this.#signal
        },args).invokeOnce()
      :await invokeNativeCrypto({
        socketPath,token:this.#adapterToken,timeoutMs:this.#timeoutMs
      },"create_presentation",args);
  }
}
