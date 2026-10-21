import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";
import {ControlledToolError} from "./controlled-errors.ts";
import {PrivateMcpTaskRegistry} from "./private-mcp-task-registry.ts";

/**
 * Trusted runtime ONLY. This is not an ADK tool and is never registered for
 * Gemini. It consumes a real Gateway prepare response and invokes the crypto
 * MCP on behalf of the private task worker.
 *
 * The shared MCP server sees only a signed task bearer, a request_id and an
 * opaque proof_ref; the signed JWT VP, Adapter caller secret, challenge, and
 * delegated DC never leave the private Agent runtime (except to the trusted
 * Gateway execute endpoint, which must verify the VP).
 */
export interface CryptoPresentationPort {
  createSignedPresentation(prepared:PreparedGatewayAuthorization):Promise<string>;
}

const PROOF_REF=/^proof_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export class TrustedCryptoMcpBridge implements CryptoPresentationPort {
  readonly #endpoint:URL;
  readonly #registry:PrivateMcpTaskRegistry;
  readonly #taskId:string;

  constructor(config:{
    endpoint:string;
    taskId:string;
    registry:PrivateMcpTaskRegistry;
  }){
    const url=new URL(config.endpoint);
    if(!["http:","https:"].includes(url.protocol) ||
       url.username || url.password || url.hash || url.search ||
       (url.pathname!=="/" && url.pathname!=="/mcp")) {
      throw new Error("Trusted crypto MCP endpoint must be an absolute HTTP(S) service URL");
    }
    if(!config.taskId || !REQUEST_ID.test(config.taskId)) {
      throw new Error("Trusted crypto MCP requires a valid task identifier");
    }
    this.#endpoint=new URL("/mcp",url);
    this.#registry=config.registry;
    this.#taskId=config.taskId;
  }

  async createSignedPresentation(prepared:PreparedGatewayAuthorization):Promise<string> {
    // Stage before MCP connection; neither a model nor the MCP server can
    // register authority details. Reject inactive task / malformed challenge.
    this.#registry.stageGatewayChallenge(this.#taskId,prepared);
    const token=this.#registry.bearerFor(this.#taskId);
    const transport=new StreamableHTTPClientTransport(this.#endpoint,{
      requestInit:{headers:{authorization:"Bearer "+token}}
    });
    const client=new Client({name:"trusted-delegation-crypto-client",version:"0.1.0"},
      {capabilities:{}});
    try {
      await client.connect(transport);
      const response=await client.callTool({
        name:"delegation_create_presentation",
        arguments:{request_id:prepared.request_id}
      });
      if(response.isError===true ||
         !response.structuredContent ||
         typeof response.structuredContent!=="object" ||
         Array.isArray(response.structuredContent)) {
        throw new Error("Crypto MCP failed or did not return an opaque proof");
      }
      const payload=response.structuredContent as Record<string,unknown>;
      if(payload.ok!==true || !payload.result ||
         typeof payload.result!=="object" || Array.isArray(payload.result)) {
        throw new Error("Crypto MCP returned an invalid proof acknowledgement");
      }
      const result=payload.result as Record<string,unknown>;
      if(Object.keys(result).sort().join(",")!==
           "credential_id,prepared,presenter_id,proof_ref,request_id" ||
         result.prepared!==true ||
         result.request_id!==prepared.request_id ||
         typeof result.proof_ref!=="string" || !PROOF_REF.test(result.proof_ref) ||
         typeof result.credential_id!=="string" || !result.credential_id ||
         typeof result.presenter_id!=="string" || !result.presenter_id) {
        throw new Error("Crypto MCP returned unbound or unexpected proof metadata");
      }
      // The one-shot lookup is process-local and never an HTTP endpoint. This
      // also checks the Task is still active (including cancellation).
      return this.#registry.takeSignedPresentation(this.#taskId,result.proof_ref);
    }catch{
      // Never forward SDK/server text containing untrusted content or proof
      // material into model-visible controlled tool failure messages.
      throw new ControlledToolError(
        "authorization_denied","Trusted cryptographic presentation unavailable"
      );
    }finally{
      await client.close().catch(()=>undefined);
    }
  }
}
