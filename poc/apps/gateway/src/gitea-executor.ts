import {createHash} from "node:crypto";
import { ProviderOperationUnavailableError } from "./errors.ts";
import { GiteaClient } from "./gitea-client.ts";
import type {
  ExecutionPort,
  ExecutionResult,
  GiteaReadFileExecutionResult,
  PreparedRequestRecord
} from "./types.ts";

const readWitnesses=new WeakMap<object,Readonly<{
 record:PreparedRequestRecord;request_id:string;fingerprint:string;
 branch:string;path:string;revision:string;blob_sha:string;
 source_sha256:string;source_bytes:number
}>>();
/**
 * Only an actual GiteaExecutor.read_file return is accepted as result
 * provenance. Reconstructed JSON, mutation and foreign Prepare objects fail.
 * This proves provider invocation in-process, not Engineer approval or VP.
 */
export function assertTrustedGatewayGiteaReadResult(
 record:PreparedRequestRecord,result:GiteaReadFileExecutionResult
):Readonly<{source_sha256:string;source_bytes:number}>{
 const proof=readWitnesses.get(result);
 if(!proof||proof.record!==record||proof.request_id!==record.request_id||
    proof.fingerprint!==record.request_fingerprint||
    result.provider!=="gitea"||result.performed!==true||
    result.tool!=="read_file"||
    result.branch!==proof.branch||result.path!==proof.path||
    result.revision!==proof.revision||
    result.blob_sha!==proof.blob_sha||
    typeof result.content!=="string")
  throw Error("Gateway Gitea read result missing trusted provider provenance");
 const bytes=Buffer.from(result.content,"utf8");
 if(bytes.length!==proof.source_bytes||
    createHash("sha256").update(bytes).digest("hex")!==proof.source_sha256)
  throw Error("Gateway Gitea read result changed after provider success");
 return Object.freeze({source_sha256:proof.source_sha256,
  source_bytes:proof.source_bytes});
}
export class GiteaExecutor implements ExecutionPort {
  readonly provider = "gitea" as const;
  readonly #client: GiteaClient;

  constructor(client: GiteaClient) {
    this.#client = client;
  }

  /** Resolve once before composite authorization; individual reads pass SHA. */
  async resolveReadRevision(branch:string):Promise<string>{
    return (await this.#client.getBranchMetadata(branch)).commit_sha;
  }

  providerFor(record: PreparedRequestRecord): "gitea" | "runner" {
    return record.request.tool === "run_tests" ? "runner" : "gitea";
  }

  /**
   * Reads only. Every mutation (branch, file, Runner, Draft PR) is executed
   * by its signed authority-only executor after Rust VP + OPA.
   */
  async execute(record: PreparedRequestRecord): Promise<ExecutionResult> {
    if (record.request.tool === "read_repository") {
      const snapshot = await this.#client.readRepository(record.pinned_revision);
      return {provider:"gitea",performed:true,tool:"read_repository",...snapshot};
    }

    if (record.request.tool === "list_directory") {
      const snapshot = await this.#client.listDirectory(
        record.request.arguments.branch,
        record.request.arguments.path,
        record.pinned_revision
      );
      return {provider:"gitea",performed:true,tool:"list_directory",...snapshot};
    }

    if (record.request.tool === "read_file") {
      const snapshot = await this.#client.readTextFile(
        record.request.arguments.branch,
        record.request.arguments.path,
        record.pinned_revision
      );

      const result: GiteaReadFileExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "read_file",
        ...snapshot
      };
      // Only record real GiteaClient provider output, not a mock executor.
      // WeakMap ties THIS original in-memory result and request object.
      if(this.#client instanceof GiteaClient){
       const bytes=Buffer.from(result.content,"utf8");
       readWitnesses.set(result,Object.freeze({
        record,request_id:record.request_id,
        fingerprint:record.request_fingerprint,
        branch:result.branch,path:result.path,revision:result.revision,
        blob_sha:result.blob_sha,
        source_sha256:createHash("sha256").update(bytes).digest("hex"),
        source_bytes:bytes.length
       }));
      }
      return result;
    }

    throw new ProviderOperationUnavailableError(
      `${record.request.tool} is executed only by its signed authority-only executor`
    );
  }
}
