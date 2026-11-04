/**
 * Canonical A2A -> trusted cryptographic presentation contract.
 * A remote MCP transport is NOT part of this interface; approved Tasks use
 * the in-process LocalCryptoMcpBridge and one native Rust CryptoRuntime.
 */
import type {PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";

export interface CryptoPresentationPort {
 createSignedPresentation(prepared:PreparedGatewayAuthorization):Promise<string>;
}
