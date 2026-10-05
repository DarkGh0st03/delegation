import type { SpecializedAgentRole } from "@thesis/agent-runtime";
import {
  resolveDelegationTemplate,
  rootAuthorityPermissions,
  type DelegatedPermission
} from "./permission-templates.ts";

type FetchLike = typeof fetch;

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

interface AdapterClientConfig {
  adapterBaseUrl: string;
  bearerToken: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

function ensurePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function validateStatus(status: CredentialStatusInput): void {
  if (status.type !== "BitstringStatusListEntry") {
    throw new Error("Only BitstringStatusListEntry is supported");
  }
  if (status.statusPurpose !== "revocation") {
    throw new Error("Phase 9A authority bootstrap uses revocation status entries");
  }
  if (!/^\d+$/u.test(status.statusListIndex)) {
    throw new Error("statusListIndex must be decimal");
  }
  if (status.statusListCredential.trim().length === 0) {
    throw new Error("statusListCredential cannot be empty");
  }
}

function validateCommon(input: RootIssuanceInput | ChildIssuanceInput): void {
  if (input.credential_id.trim().length === 0) {
    throw new Error("credential_id cannot be empty");
  }
  if (input.valid_from.trim().length === 0) {
    throw new Error("valid_from cannot be empty");
  }
  ensurePositiveInteger(input.validity_seconds, "validity_seconds");
  validateStatus(input.credential_status);
}

async function postCredential(
  config: AdapterClientConfig,
  path: string,
  body: unknown
): Promise<IssuedDelegationCredential> {
  let response: Response;
  try {
    response = await (config.fetchFn ?? fetch)(
      `${config.adapterBaseUrl.replace(/\/+$/u, "")}${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.bearerToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5_000)
      }
    );
  } catch (error) {
    throw new Error(
      `Delegation Adapter request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    throw new Error("Delegation Adapter returned invalid JSON");
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(`Delegation Adapter rejected issuance: ${message}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("credentialSubject" in parsed)
  ) {
    throw new Error("Delegation Adapter returned a malformed credential");
  }

  return parsed as IssuedDelegationCredential;
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

  async issueOrchestratorRoot(
    input: RootIssuanceInput
  ): Promise<IssuedDelegationCredential> {
    validateCommon(input);

    return postCredential(this.#config, "/v1/credentials/root", {
      credential_id: input.credential_id,
      delegatee: "orchestrator",
      valid_from: input.valid_from,
      validity_seconds: input.validity_seconds,
      credential_status: input.credential_status,
      permissions: rootAuthorityPermissions()
    });
  }
}

export class DeterministicOrchestratorAuthorityIssuer {
  readonly #config: AdapterClientConfig;

  constructor(config: AdapterClientConfig) {
    if (config.adapterBaseUrl.trim().length === 0) {
      throw new Error("Delegation Adapter base URL cannot be empty");
    }
    if (config.bearerToken.trim().length === 0) {
      throw new Error("Orchestrator Adapter token cannot be empty");
    }
    this.#config = config;
  }

  async issueSpecializedChild(
    input: ChildIssuanceInput
  ): Promise<{
    role: SpecializedAgentRole;
    credential: IssuedDelegationCredential;
  }> {
    validateCommon(input);
    if (input.parent_credential_id.trim().length === 0) {
      throw new Error("parent_credential_id cannot be empty");
    }

    const template = resolveDelegationTemplate(input.selection);

    const credential = await postCredential(
      this.#config,
      "/v1/credentials/child",
      {
        parent_credential_id: input.parent_credential_id,
        credential_id: input.credential_id,
        delegatee: template.role,
        valid_from: input.valid_from,
        validity_seconds: input.validity_seconds,
        credential_status: input.credential_status,
        permissions: template.permissions
      }
    );

    return {
      role: template.role,
      credential
    };
  }
}
