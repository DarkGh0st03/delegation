/**
 * R406 — neutral type-only data boundary for an unsigned D1 repair proposal.
 *
 * This file never imports the executable legacy epoch Planner/controller,
 * HTTP Adapter, provider client, Rust signer, Gemini SDK or a URL.
 * Describes model *input data*, not approval, credential or execution grant.
 * The original signed Engineer root, Gateway and native coordinator retain
 * all operational authority and validation.
 */
import type {AcceptanceFailureSummary,ProjectTestFailureSummary}
 from "../../../apps/test-runner-controller/src/repair-failure-eligibility.ts";
type Role="backend"|"frontend"|"test"|"orchestrator";
type Grant={resource:string;operation:string};

export interface TrustedRepairPlanningObservation{
 readonly failed_phase:string;
 readonly typecheck_error_codes:readonly string[];
 readonly acceptance_failure?:AcceptanceFailureSummary;
 readonly project_test_failure?:ProjectTestFailureSummary;
 readonly tested_commit_sha:string;
 readonly work_branch:string;
 readonly remaining_repair_epochs:number;
}

export interface TrustedRepairDiscoveryObservation{
 readonly status:"gateway_discovery_read_confirmed_no_authority";
 readonly resource:string;readonly branch:string;
 readonly tested_commit_sha:string;readonly operation:"read_file";
}

export interface TrustedRepairDiagnosticSource{
 readonly status:"gateway_sha256_verified_source_data_no_authority";
 readonly resource:string;readonly branch:string;
 readonly tested_commit_sha:string;readonly bytes:number;readonly content:string;
}

export interface TrustedRepairModelInput {
 readonly requirement:string;
 readonly feedback:Readonly<TrustedRepairPlanningObservation>;
 readonly already_delegated_grants:ReadonlyArray<Readonly<Grant>>;
 readonly agents:readonly Role[];
 readonly diagnostic_read?:Readonly<TrustedRepairDiscoveryObservation>;
 readonly diagnostic_source?:Readonly<TrustedRepairDiagnosticSource>;
 /** Optional host-internal Runner attribution for a unique signed writer.
  * Only a planner caller that independently checked the real Docker/Gitea
  * receipts may supply it. Never authorization or a new root grant. */
 readonly diagnostic_target?:Readonly<{
  status:"verified_runner_single_file_repair_target";
  tested_commit_sha:string;
  role:"backend"|"frontend";
  resource:string;
 }|{
  status:"verified_acceptance_single_file_repair_candidate";
  tested_commit_sha:string;role:"backend"|"frontend";resource:string;
  failed_checks:readonly string[];
 }>;
 /** Original source options; model selection does not establish causal provenance. */
 readonly diagnostic_candidates?:Readonly<{
  status:"verified_original_acceptance_repair_scope";
  tested_commit_sha:string;failed_checks:readonly string[];
  causal_attribution:"not_established";
  candidates:readonly Readonly<{role:"backend"|"frontend";resource:string}>[];
 }|{
  status:"verified_original_project_test_repair_scope";
  tested_commit_sha:string;project_test_failure:ProjectTestFailureSummary;
  causal_attribution:"not_established";
  candidates:readonly Readonly<{role:"backend"|"frontend";resource:string}>[];
 }>;
 readonly diagnostic_targets?:Readonly<{
  status:"verified_runner_multi_file_repair_targets";
  tested_commit_sha:string;
  targets:ReadonlyArray<Readonly<{role:"backend"|"frontend";resource:string}>>;
 }>;
}
