import {createOwnerPrivateCryptographicMcpSession}
  from "../../../mcp-shared/src/owner-private-child-mcp.ts";
import {invokeNativeCrypto} from "../../agent-runtime/src/native-crypto-ipc.ts";

/** Owner-private VP transport for Planning, branch creation and Draft PR.
 * Only an opaque reference crosses MCP. Rust receives the original challenge
 * and exact disclosure, and the returned VP stays with the caller. */
export async function createNativeOrchestratorPresentation(
  config: Parameters<typeof invokeNativeCrypto>[0],
  input: Readonly<{credential_id:string;disclosed_permissions:readonly {resource:string;operation:string}[];
    audience:string;challenge:string}>,
  signal?: AbortSignal
): Promise<string> {
  const assertActive=()=>{
    if(signal?.aborted)
      throw new Error("Trusted Gateway invocation cancelled");
  };
  assertActive();
  let proof: unknown;
  try {
    proof=await createOwnerPrivateCryptographicMcpSession("presentation_create",()=>{
      assertActive();
      return invokeNativeCrypto(config,"create_presentation",input);
    }).invokeOnce();
  } catch {
    assertActive();
    throw new Error("Native Rust Orchestrator presentation denied");
  }
  assertActive();
  if(!proof||typeof proof!=="object"||Array.isArray(proof))
    throw new Error("Native Rust Orchestrator presentation malformed");
  const signedVp=(proof as {signed_vp?:unknown}).signed_vp;
  if(typeof signedVp!=="string"||!signedVp.trim())
    throw new Error("Native Rust signed_vp must be a non-empty string");
  return signedVp;
}
