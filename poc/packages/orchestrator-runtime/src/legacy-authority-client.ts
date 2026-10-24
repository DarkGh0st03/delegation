/**
 * Historical Phase 9A/9B Account Suspension experiment ONLY.
 * This intentionally exports the frozen role/skill-template child issuer
 * outside the canonical Orchestrator API. No trusted signed-approval path
 * imports this module. Do not use it in approved DAG Execution.
 */
import type {SpecializedAgentRole} from "@thesis/agent-runtime";
import {resolveDelegationTemplate,rootAuthorityPermissions}
  from "./permission-templates.ts";
import {SoftwareEngineerAuthorityBootstrap} from "./authority-client.ts";
import type {
  RootIssuanceInput,ChildIssuanceInput,IssuedDelegationCredential
} from "./authority-client.ts";
import {postCredential,validateCommon} from "./authority-adapter-transport.ts";
import type {AdapterClientConfig} from "./authority-adapter-transport.ts";

/** @deprecated Old fixed-scope Account Suspension root, NEVER canonical. */
export class LegacySoftwareEngineerAuthorityBootstrap
  extends SoftwareEngineerAuthorityBootstrap {
  readonly #legacyConfig: AdapterClientConfig;
  constructor(config: AdapterClientConfig) {
    super(config);
    this.#legacyConfig=config;
  }
  /**
   * @deprecated Historical Account Suspension root with a frozen, broad
   * permission matrix. ONLY for the legacy experiment and its regression.
   * Trusted Planning/Execution must use issueScopedOrchestratorRoot with
   * the independently reviewed exact permission subset.
   */
  async issueOrchestratorRoot(
    input: RootIssuanceInput
  ): Promise<IssuedDelegationCredential> {
    validateCommon(input);

    return postCredential(this.#legacyConfig, "/v1/credentials/root", {
      credential_id: input.credential_id,
      delegatee: "orchestrator",
      valid_from: input.valid_from,
      validity_seconds: input.validity_seconds,
      credential_status: input.credential_status,
      permissions: rootAuthorityPermissions()
    });
  }

}

/** @deprecated Legacy static role/skill authority: use signed Task-scoped issuer. */
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
