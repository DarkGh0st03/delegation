/**
 * Typed, owner-private facade for the ONE shared Rust IPC wire.
 * R381.3: both this Agent port and the private MCP subprocess use
 * the same bounded native client. Never expose the bearer to ADK.
 */
import {invokeNativeCryptoWire}
 from "../../../mcp-shared/src/native-rust-transport.mjs";

export async function invokeNativeCrypto(
 config:{socketPath:string;token:string;timeoutMs?:number},
 operation:"issue_child"|"create_presentation"|"read_issued_root"|"read_credential_status",
 body:unknown
):Promise<unknown>{
 return invokeNativeCryptoWire(config,operation,body);
}
