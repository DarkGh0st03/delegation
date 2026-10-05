import {
  ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const client = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: required("DELEGATION_ADAPTER_URL"),
  bearerToken: required("ADAPTER_CALLER_ENGINEER")
});

const credential = await client.issueOrchestratorRoot({
  credential_id:
    process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
    "urn:thesis:dc:orchestrator-root",
  valid_from:
    process.env.ORCHESTRATOR_ROOT_VALID_FROM ?? new Date().toISOString(),
  validity_seconds: positiveInteger(
    process.env.ORCHESTRATOR_ROOT_VALIDITY_SECONDS ?? "3600",
    "ORCHESTRATOR_ROOT_VALIDITY_SECONDS"
  ),
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex:
      process.env.ORCHESTRATOR_ROOT_STATUS_INDEX ?? "9000",
    statusListCredential:
      process.env.ORCHESTRATOR_ROOT_STATUS_LIST ??
      "https://status.example/lists/orchestrator-root"
  }
});

process.stdout.write(
  JSON.stringify(
    {
      event: "orchestrator_root_authority_issued",
      credential_id: credential.id,
      delegatee: credential.credentialSubject.sub,
      permission_count: ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY.length
    },
    null,
    2
  ) + "\n"
);
