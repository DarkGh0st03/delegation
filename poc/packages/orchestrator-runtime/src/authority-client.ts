/**
 * Trusted Engineer Adapter client and neutral credential types.
 * Historical static-template issuance is defined only by the legacy module.
 */
import type {DelegatedPermission} from "./delegated-permission.ts";
import {postCredential,validateCommon} from "./authority-adapter-transport.ts";
import type {AdapterClientConfig} from "./authority-adapter-transport.ts";

export interface CredentialStatusInput {
  type: "BitstringStatusListEntry";
  statusPurpose: "revocation";
  statusListIndex: string;
  statusListCredential: string;
}

export interface RootIssuanceInput {
  credential_id: string;
  valid_from: string;
  validity_seconds: number;
  credential_status: CredentialStatusInput;
}

export interface ChildIssuanceInput {
  parent_credential_id: string;
  credential_id: string;
  valid_from: string;
  validity_seconds: number;
  credential_status: CredentialStatusInput;
  selection: unknown;
  /** Trusted signed plan Task ID; ignored by the unchanged legacy issuer. */
  approved_task_id?:string;
}

export interface IssuedDelegationCredential {
  "@context": string[];
  type: string[];
  id: string;
  issuer: string;
  validFrom: string;
  credentialStatus?: CredentialStatusInput;
  credentialSubject: {
    sub: string;
    per: DelegatedPermission[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class SoftwareEngineerAuthorityBootstrap {
  readonly #config: AdapterClientConfig;

  constructor(config: AdapterClientConfig) {
    if (config.adapterBaseUrl.trim().length === 0) {
      throw new Error("Delegation Adapter base URL cannot be empty");
    }
    if (config.bearerToken.trim().length === 0) {
      throw new Error("Engineer Adapter token cannot be empty");
    }
    this.#config = config;
  }

  /**
   * Trusted Engineer backend ONLY. Unlike the legacy IAM Console bootstrap,
   * these permissions come from a validated planning manifest or immutable
   * approval snapshot; never from a model-provided tool invocation.
   */
  async issueScopedOrchestratorRoot(
    input: RootIssuanceInput & { permissions: readonly DelegatedPermission[] }
  ): Promise<IssuedDelegationCredential> {
    validateCommon(input);
    if (!Array.isArray(input.permissions) ||
        input.permissions.length < 1 || input.permissions.length > 128) {
      throw new Error("Scoped root needs 1–128 explicit permissions");
    }
    const seen = new Set<string>();
    for (const item of input.permissions) {
      if (!item || typeof item.resource !== "string" || !item.resource.startsWith("gitea://") ||
          typeof item.operation !== "string" || !item.operation) {
        throw new Error("Scoped root permission must be a canonical Gitea resource and operation");
      }
      const key=JSON.stringify([item.resource,item.operation]);
      if (seen.has(key)) throw new Error("Scoped root cannot contain duplicate permissions");
      seen.add(key);
    }
    const requested=input.permissions.map(p=>({...p}));
    const issued=await postCredential(this.#config,"/v1/credentials/root",{
      credential_id:input.credential_id,
      delegatee:"orchestrator",
      valid_from:input.valid_from,
      validity_seconds:input.validity_seconds,
      credential_status:input.credential_status,
      permissions:requested
    });
    // Do not return an unexpectedly amplified root as trusted state.
    if(issued.id!==input.credential_id ||
       !Array.isArray(issued.credentialSubject?.per) ||
       issued.credentialSubject.per.length!==requested.length ||
       issued.credentialSubject.per.some((p,i)=>
         p.resource!==requested[i].resource || p.operation!==requested[i].operation)) {
      throw new Error("Adapter root issuance response differs from exact trusted permissions");
    }
    return issued;
  }

  /** Root DC revocation is irreversible, enforced by the existing Rust Adapter. */
  async revokeRoot(credential_id:string):Promise<void> {
    if(typeof credential_id!=="string" || !credential_id.trim()) {
      throw new Error("Root credential id required for revocation");
    }
    const response=await (this.#config.fetchFn??fetch)(
      `${this.#config.adapterBaseUrl.replace(/\/+$/u,"")}/v1/credentials/status`,
      {
        method:"POST",
        headers:{
          authorization:`Bearer ${this.#config.bearerToken}`,
          "content-type":"application/json",accept:"application/json"
        },
        body:JSON.stringify({credential_id,status_set:true}),
        signal:AbortSignal.timeout(this.#config.timeoutMs??5_000)
      }
    );
    if(!response.ok)throw new Error("Adapter did not confirm root DC revocation");
    let raw:unknown;
    try{raw=await response.json();}catch{throw new Error("Malformed revocation response");}
    if(!raw || typeof raw!=="object" ||
       (raw as {credential_id?:unknown}).credential_id!==credential_id ||
       (raw as {status_purpose?:unknown}).status_purpose!=="revocation" ||
       (raw as {status_set?:unknown}).status_set!==true) {
      throw new Error("Adapter root DC revocation not confirmed");
    }
  }

}

