import {createHash} from "node:crypto";
import {safeProjectE2eFailureDiagnostic} from "../../test-runner-controller/scripts/project-e2e-failure-diagnostic.mjs";
import {safeAcceptanceFailureSummary} from "../../../runner/acceptance/failure-catalog.mjs";
import { ProviderUnavailableError } from "./errors.ts";
import {validateProjectProfile,projectProfileDigest,isRunnerPhaseName,testSourceProfileOf}
  from "../../../packages/plan-contracts/src/project-profile.mjs";
import {isProjectTestSource} from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import type {RunnerProjectProfile} from "../../test-runner-controller/src/types.ts";
import {sanitizeTypecheckLocations,sanitizeTypecheckErrorCodes,
  type TypecheckLocation}
  from "../../test-runner-controller/src/typecheck-diagnostics.ts";
import {sanitizeVitestFailureFiles}
  from "../../test-runner-controller/src/vitest-failure-files.ts";
import {sanitizeTestFailureMessages,type TestFailureMessage}
  from "../../test-runner-controller/src/test-failure-messages.ts";
import type { RunnerPhaseExecutionResult } from "./types.ts";

type FetchLike = typeof fetch;
type JsonObject = Record<string, unknown>;

export interface RunnerClientConfig {
  baseUrl: string;
  gatewayToken: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  /** Engineer-approved project profile of the session (owner-fixed). */
  projectProfile: unknown;
}

export interface RunnerClientRequest {
  request_id: string;
  repository: string;
  branch: string;
  commit_sha: string;
  profile: "poc-default";
}

export interface RunnerClientResult {
  request_id: string;
  repository: string;
  branch: string;
  tested_commit_sha: string;
  runner_profile: "poc-default";
  /** Digest of the Engineer-approved profile the Runner executed. */
  project_profile_sha256: string;
  status: "pass" | "fail";
  phases: RunnerPhaseExecutionResult[];
  project_tests?: {
    status: "pass" | "fail";
    phases: RunnerPhaseExecutionResult[];
  };
  researcher_acceptance?: RunnerPhaseExecutionResult & {
    phase: "researcher_acceptance";
  };
  acceptance_failure?: import("../../test-runner-controller/src/types.ts").RunnerRunResult["acceptance_failure"];
  log_reference?: string;
  typecheck_diagnostics?: TypecheckLocation[];
  typecheck_error_codes?: string[];
  failing_test_files?: string[];
  /** Failed tests of failing_test_files with their cleaned message (untrusted data). */
  test_failures?: TestFailureMessage[];
  project_e2e_failure?: NonNullable<ReturnType<typeof import("../../test-runner-controller/scripts/project-e2e-failure-diagnostic.mjs").safeProjectE2eFailureDiagnostic>>;
}

const trustedResultWitnesses=new WeakMap<RunnerClientResult,Readonly<{
 client:RunnerClient;request:string;digest:string
}>>();
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** A response must be the UNMODIFIED original result object produced by
 * this precise authenticated RunnerClient instance and request. Branding
 * alone does not prove Docker ran; it prevents model-forged result objects.
 */
export function assertTrustedRunnerClientResult(
 client:RunnerClient,request:RunnerClientRequest,result:RunnerClientResult
):void{
 const proof=result&&trustedResultWitnesses.get(result);
 if(!proof||proof.client!==client||proof.request!==digest(request)||
    proof.digest!==digest(result)||
    result.request_id!==request.request_id||
    result.repository!==request.repository||
    result.branch!==request.branch||
    result.tested_commit_sha!==request.commit_sha)
  throw new ProviderUnavailableError("Runner result lacks authenticated owner-bound request provenance");
}


function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderUnavailableError(`${label} is not an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderUnavailableError(`Runner response is missing ${label}`);
  }
  return value;
}

function parsePhase(value: unknown, label: string): RunnerPhaseExecutionResult {
  const phase = object(value, label);
  const name = string(phase.phase, `${label}.phase`);
  const status = string(phase.status, `${label}.status`);
  if (!isRunnerPhaseName(name)) {
    throw new ProviderUnavailableError(`Runner returned unknown phase ${name}`);
  }
  if (!["pass", "fail", "skipped"].includes(status)) {
    throw new ProviderUnavailableError(`Runner returned invalid phase status ${status}`);
  }
  return {
    phase: name as RunnerPhaseExecutionResult["phase"],
    status: status as RunnerPhaseExecutionResult["status"],
    ...(typeof phase.passed === "number" ? { passed: phase.passed } : {}),
    ...(typeof phase.failed === "number" ? { failed: phase.failed } : {}),
    ...(Array.isArray(phase.errors) &&
    phase.errors.every((entry) => typeof entry === "string")
      ? { errors: phase.errors as string[] }
      : {})
  };
}

function parsePhases(value: unknown): RunnerPhaseExecutionResult[] {
  if (!Array.isArray(value)) {
    throw new ProviderUnavailableError("Runner response is missing phases");
  }
  return value.map((raw, index) => parsePhase(raw, `phases[${index}]`));
}

export class RunnerClient {
  readonly #baseUrl: string;
  readonly #gatewayToken: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #profile: RunnerProjectProfile;
  readonly #profileSha256: string;

  constructor(config: RunnerClientConfig) {
    // The profile is fixed for the client's lifetime: no request can change it.
    this.#profile = validateProjectProfile(config.projectProfile) as RunnerProjectProfile;
    this.#profileSha256 = projectProfileDigest(this.#profile);
    if (config.baseUrl.trim().length === 0) {
      throw new Error("Runner base URL cannot be empty");
    }
    if (config.gatewayToken.trim().length === 0) {
      throw new Error("Runner Gateway token cannot be empty");
    }
    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#gatewayToken = config.gatewayToken;
    this.#timeoutMs = config.timeoutMs ?? 900_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  /** Engineer-approved profile whose phases every run must execute. */
  get projectProfile(): RunnerProjectProfile { return this.#profile; }
  get projectProfileSha256(): string { return this.#profileSha256; }

  async run(request: RunnerClientRequest, signal?: AbortSignal): Promise<RunnerClientResult> {
    let response: Response;
    try {
      signal?.throwIfAborted();
      response = await this.#fetch(`${this.#baseUrl}/v1/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#gatewayToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({...request, project_profile: this.#profile,
          project_profile_sha256: this.#profileSha256}),
        signal: signal
          ? AbortSignal.any([signal,AbortSignal.timeout(this.#timeoutMs)])
          : AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ProviderUnavailableError(
        `Controlled Test Runner request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `Controlled Test Runner returned HTTP ${response.status}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderUnavailableError("Controlled Test Runner returned invalid JSON");
    }
    const body = object(parsed, "Runner response");

    const status = string(body.status, "status");
    if (status !== "pass" && status !== "fail") {
      throw new ProviderUnavailableError(`Runner returned invalid status ${status}`);
    }
    const profile = string(body.runner_profile, "runner_profile");
    if (profile !== "poc-default" || body.project_profile_sha256 !== this.#profileSha256) {
      throw new ProviderUnavailableError("Runner returned an unexpected profile");
    }
    // Every reported phase belongs to the approved profile (or is the
    // researcher slot); PASS/FAIL validators then enforce the exact sequence.
    const known = new Set([...this.#profile.phases.map(p => p.name), "researcher_acceptance"]);
    if (parsePhases(body.phases).some(p => !known.has(p.phase)))
      throw new ProviderUnavailableError("Runner phase is not in the approved project profile");

    // An authenticated controller must not report PASS while sending any
    // failure evidence (even an empty or malformed failure field).
    if(status==="pass"&&[
      "acceptance_failure","typecheck_diagnostics","typecheck_error_codes",
      "failing_test_files","test_failures","project_e2e_failure"
    ].some(key=>Object.hasOwn(body,key)&&body[key]!==null))
      throw new ProviderUnavailableError(
        "Runner PASS response contains contradictory failure evidence");

    const projectTests =
      body.project_tests === undefined
        ? undefined
        : object(body.project_tests, "project_tests");
    const projectStatus =
      projectTests === undefined
        ? undefined
        : string(projectTests.status, "project_tests.status");
    if (
      projectStatus !== undefined &&
      projectStatus !== "pass" &&
      projectStatus !== "fail"
    ) {
      throw new ProviderUnavailableError(
        `Runner returned invalid project_tests status ${projectStatus}`
      );
    }

    const researcherAcceptance =
      body.researcher_acceptance === undefined
        ? undefined
        : parsePhase(body.researcher_acceptance, "researcher_acceptance");
    if (
      researcherAcceptance !== undefined &&
      researcherAcceptance.phase !== "researcher_acceptance"
    ) {
      throw new ProviderUnavailableError(
        "Runner researcher_acceptance has an unexpected phase name"
      );
    }

    const acceptanceFailure = status==="fail"&&projectStatus==="pass"&&
      researcherAcceptance?.status==="fail"&&
      parsePhases(body.phases).every(p=>p.phase==="researcher_acceptance"
        ?p.status==="fail":p.status==="pass")
      ?safeAcceptanceFailureSummary(body.acceptance_failure):null;
    const firstFailedPhase=parsePhases(body.phases).find(p=>p.status==="fail")?.phase;
    const vitestFailurePhase=this.#profile.phases.some(p=>p.name===firstFailedPhase&&
      p.failure_report==="vitest")?firstFailedPhase:null;
    const projectE2eFailure=status==="fail"&&firstFailedPhase==="playwright_e2e"
      ?safeProjectE2eFailureDiagnostic(body.project_e2e_failure):null;
    const result: RunnerClientResult = {
      ...(projectE2eFailure?{project_e2e_failure:projectE2eFailure}:{}),
      ...(acceptanceFailure?{acceptance_failure:acceptanceFailure}:{}),
      request_id: string(body.request_id, "request_id"),
      repository: string(body.repository, "repository"),
      branch: string(body.branch, "branch"),
      tested_commit_sha: string(body.tested_commit_sha, "tested_commit_sha"),
      runner_profile: "poc-default",
      project_profile_sha256: this.#profileSha256,
      status,
      phases: parsePhases(body.phases),
      ...(projectTests !== undefined && projectStatus !== undefined
        ? {
            project_tests: {
              status: projectStatus as "pass" | "fail",
              phases: parsePhases(projectTests.phases)
            }
          }
        : {}),
      ...(researcherAcceptance !== undefined
        ? {
            researcher_acceptance: researcherAcceptance as RunnerPhaseExecutionResult & {
              phase: "researcher_acceptance";
            }
          }
        : {}),
      ...(typeof body.log_reference === "string" && body.log_reference.length > 0
        ? { log_reference: body.log_reference }
        : {}),
      ...(status==="fail"&&body.typecheck_diagnostics!==undefined
        ?{typecheck_diagnostics:sanitizeTypecheckLocations(body.typecheck_diagnostics)}
        :{}),
      ...(status==="fail"&&body.typecheck_error_codes!==undefined&&
         parsePhases(body.phases).some(p=>p.phase==="typecheck"&&p.status==="fail")
        ?{typecheck_error_codes:sanitizeTypecheckErrorCodes(body.typecheck_error_codes)}
        :{}),
      ...(status==="fail"&&vitestFailurePhase&&body.failing_test_files!==undefined
        // Only test sources of the approved profile (its folders/suffixes).
        ?{failing_test_files:sanitizeVitestFailureFiles(body.failing_test_files)
           .filter(path=>isProjectTestSource(path,testSourceProfileOf(this.#profile)))}: {})
    };
    // Messages only for failing files kept above; malformed input is dropped.
    if(result.failing_test_files?.length&&body.test_failures!==undefined){
      const messages=sanitizeTestFailureMessages(body.test_failures,result.failing_test_files);
      if(messages.length)result.test_failures=messages;
    }

    if (
      result.request_id !== request.request_id ||
      result.repository !== request.repository ||
      result.branch !== request.branch ||
      result.tested_commit_sha !== request.commit_sha
    ) {
      throw new ProviderUnavailableError(
        "Controlled Test Runner response does not match the authorized request"
      );
    }

    trustedResultWitnesses.set(result,Object.freeze({
      client:this,request:digest(request),digest:digest(result)
    }));
    return result;
  }
}
