/**
 * Internal credential Adapter transport, not exported from public index.
 * The caller's independently authenticated Engineer session or historical
 * fixture decides root scope; transport alone grants no authority.
 */
import type {
  CredentialStatusInput,RootIssuanceInput,ChildIssuanceInput,
  IssuedDelegationCredential
} from "./authority-client.ts";

type FetchLike = typeof fetch;

export interface AdapterClientConfig {
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

export function validateCommon(input: RootIssuanceInput | ChildIssuanceInput): void {
  if (input.credential_id.trim().length === 0) {
    throw new Error("credential_id cannot be empty");
  }
  if (input.valid_from.trim().length === 0) {
    throw new Error("valid_from cannot be empty");
  }
  ensurePositiveInteger(input.validity_seconds, "validity_seconds");
  validateStatus(input.credential_status);
}

export async function postCredential(
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

