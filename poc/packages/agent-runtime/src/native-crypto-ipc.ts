/**
 * Typed, owner-private facade for the ONE shared Rust IPC wire.
 * R381.3: both this Agent port and the private MCP subprocess use
 * the same bounded native client. Never expose the bearer to ADK.
 */
import {invokeNativeCryptoWire}
 from "../../../mcp-shared/src/native-rust-transport.mjs";

export async function invokeNativeCrypto(
 config:{socketPath:string;token:string;timeoutMs?:number},
 operation:"issue_child"|"create_presentation"|"store_credential"|"read_issued_root"|"read_credential_status",
 body:unknown
):Promise<unknown>{
 return invokeNativeCryptoWire(config,operation,body);
}

/**
 * Socket of the per-role WALLET holding only that role's signing key
 * (DELEGATION_WALLET_SOCKET_<ROLE>, set by the trusted owner when it starts
 * the wallets). Without per-role wallets (historical/offline setups) the
 * shared native runtime socket is used.
 */
export function roleWalletSocket(role:string):string|undefined{
 if(typeof role!=="string"||!/^[a-z][a-z0-9_-]{0,23}$/u.test(role))return undefined;
 const own=process.env["DELEGATION_WALLET_SOCKET_"+role.toUpperCase().replace(/-/gu,"_")];
 return own??process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
}
