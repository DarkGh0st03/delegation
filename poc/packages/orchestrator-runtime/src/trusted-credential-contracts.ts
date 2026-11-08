/**
 * R384.9: neutral credential data contracts.
 *
 * Types only. Never import the historical HTTP Adapter transport or create
 * Engineer authority by evaluating the public orchestrator-runtime index.
 */
import type {DelegatedPermission} from "./delegated-permission.ts";

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

/** Trusted native Engineer credential config; no HTTP transport dependency. */
export interface TrustedEngineerCoreConfig {
 readonly bearerToken:string;
 readonly timeoutMs?:number;
}
