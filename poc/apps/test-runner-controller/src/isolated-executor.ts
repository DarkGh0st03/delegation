import {extractPrivateVitestFailures} from "./private-vitest-failures.ts";
import {retainFailureEvidence} from "./failure-evidence.ts";
import {extractProjectE2eFailureDiagnostic} from "../scripts/project-e2e-failure-diagnostic.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import {extractTypecheckLocations,extractTypecheckErrorCodes,extractTypecheckErrors,type TypecheckError,
  sanitizeWorkspaceRoots,WORKSPACE_ROOTS_SCRIPT,type WorkspaceRoots} from "./typecheck-diagnostics.ts";
import {extractVitestFailureFiles} from "./vitest-failure-files.ts";
import {extractTestFailureMessages,type TestFailureMessage} from "./test-failure-messages.ts";
import type {RunnerExecutor,RunnerPhaseResult,RunnerRunRequest,RunnerRunResult} from "./types.ts";

/**
 * Host Docker CLI is a subprocess of the trusted Runner, not of the
 * untrusted repository. It must NOT inherit a model/API secret from the
 * Owner process (or NODE_OPTIONS, LD_PRELOAD, GitHub OIDC, injected proxy
 * settings, etc.) even if one was accidentally present in process.env.
 *
 * Explicit Docker-client OS settings only, with no wildcard/prefix passthru.
 * This is subprocess hygiene, NOT proof of isolated owner memory, provider
 * billing control or confidentiality from a malicious Docker daemon.
 */
const DOCKER_CLI_CHILD_KEYS=Object.freeze([
 "PATH","Path","HOME","USERPROFILE","SYSTEMROOT","SystemRoot","WINDIR",
 "COMSPEC","TEMP","TMP","TMPDIR","LANG","LC_ALL","APPDATA","LOCALAPPDATA",
 "XDG_RUNTIME_DIR","DOCKER_HOST","DOCKER_CONFIG","DOCKER_CONTEXT",
 "DOCKER_CERT_PATH","DOCKER_TLS_VERIFY","DOCKER_API_VERSION",
 "DOCKER_DEFAULT_PLATFORM"
]);
export function isolatedDockerCliEnvironment(
 source:NodeJS.ProcessEnv
):NodeJS.ProcessEnv{
 const child:NodeJS.ProcessEnv=Object.create(null);
 for(const name of DOCKER_CLI_CHILD_KEYS){
  const value=source[name];
  if(typeof value==="string"&&value.length>0&&
     ![...value].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127))
    child[name]=value;
 }
 return child;
}

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
// Must finish before the canonical Gateway -> Runner 900s timeout.
export const MAX_RUN_TOTAL_MS = 840_000;

export interface IsolatedRunnerConfig {
  gitea_base_url: string;
  gitea_token: string;
  phase_timeout_ms: number;
  total_timeout_ms?: number;
  log_dir: string;
  failure_evidence_dir?: string;
}

interface CommandOptions {
  cwd?: string;
  timeout_ms: number;
  signal?: AbortSignal;
}

interface CommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions
) => Promise<CommandResult>;

type FetchFn = typeof fetch;


function cappedAppend(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_COMMAND_OUTPUT_BYTES) return current;
  const remaining = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(current, "utf8");
  return current + chunk.subarray(0, remaining).toString("utf8");
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: isolatedDockerCliEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = cappedAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = cappedAppend(stderr, chunk);
    });
    const killChild = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(killChild, options.timeout_ms);
    options.signal?.addEventListener("abort", killChild, {once:true});
    if(options.signal?.aborted)killChild();
    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", killChild);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", killChild);
      resolvePromise({
        exit_code: code ?? 1,
        stdout,
        stderr,
        timed_out: timedOut
      });
    });
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Gitea response: missing ${label}`);
  }
  return value;
}

function branchHeadSha(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid Gitea branch response");
  }
  const commit = (payload as { commit?: unknown }).commit;
  if (typeof commit !== "object" || commit === null) {
    throw new Error("Invalid Gitea branch response: missing commit");
  }
  return requiredString((commit as { id?: unknown }).id, "commit.id");
}

/** owner/name of a validated gitea://<host>/<owner>/<name> repository URI. */
function repositoryApiPath(repository: string): string {
  const parts = /^gitea:\/\/[^/]+\/([^/]+)\/([^/]+)$/u.exec(repository);
  if (!parts) throw new Error("Runner repository URI is not canonical");
  return `${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `token ${token}`,
    accept: "application/json"
  };
}

export class IsolatedDockerRunnerExecutor implements RunnerExecutor {
  readonly #config: IsolatedRunnerConfig;
  readonly #fetch: FetchFn;
  readonly #runCommand: CommandRunner;

  constructor(
    config: IsolatedRunnerConfig,
    dependencies: {
      fetch_fn?: FetchFn;
      command_runner?: CommandRunner;
    } = {}
  ) {
    this.#config = config;
    this.#fetch = dependencies.fetch_fn ?? fetch;
    this.#runCommand = dependencies.command_runner ?? defaultCommandRunner;
    const total = config.total_timeout_ms ?? MAX_RUN_TOTAL_MS;
    if(!Number.isSafeInteger(total)||total<1||total>MAX_RUN_TOTAL_MS){
      throw new Error("Runner total timeout must be 1..840000 ms");
    }
  }

  async #verifyExactBranchHead(request: RunnerRunRequest, signal: AbortSignal): Promise<void> {
    const branch = encodeURIComponent(request.branch);
    const url =
      `${this.#config.gitea_base_url}/api/v1/repos/` +
      `${repositoryApiPath(request.repository)}/branches/${branch}`;

    const response = await this.#fetch(url, {
      headers: authHeaders(this.#config.gitea_token),signal
    });
    if (!response.ok) {
      throw new Error(`Could not resolve controlled branch (HTTP ${response.status})`);
    }

    const observed = branchHeadSha(await response.json());
    if (observed !== request.commit_sha) {
      throw new Error(
        `Runner exact-SHA precondition failed: branch head ${observed} != requested ${request.commit_sha}`
      );
    }
  }

  async #downloadArchive(request: RunnerRunRequest, archivePath: string, signal: AbortSignal): Promise<void> {
    const url =
      `${this.#config.gitea_base_url}/api/v1/repos/` +
      `${repositoryApiPath(request.repository)}/archive/` +
      `${request.commit_sha}.tar.gz`;

    const response = await this.#fetch(url, {
      headers: authHeaders(this.#config.gitea_token),signal
    });
    if (!response.ok) {
      throw new Error(`Could not fetch exact repository archive (HTTP ${response.status})`);
    }

    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_ARCHIVE_BYTES) {
      throw new Error("Repository archive exceeds Runner size limit");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error("Repository archive exceeds Runner size limit");
    }
    await writeFile(archivePath, bytes, { mode: 0o600 });
  }

  async run(request: RunnerRunRequest, callerSignal?: AbortSignal): Promise<RunnerRunResult> {
    const total=this.#config.total_timeout_ms ?? MAX_RUN_TOTAL_MS;
    const deadlineAt=performance.now()+total;
    const deadlineSignal=AbortSignal.timeout(total);
    const signal=callerSignal?AbortSignal.any([callerSignal,deadlineSignal]):deadlineSignal;
    signal.throwIfAborted();
    await this.#verifyExactBranchHead(request,signal);
    signal.throwIfAborted();

    const executeCommand=(command:string,args:string[]):Promise<CommandResult>=>{
      signal.throwIfAborted();
      const remainingMs=Math.floor(deadlineAt-performance.now());
      if(remainingMs<=0)throw new Error("Runner total execution budget expired");
      return this.#runCommand(command,args,{
        timeout_ms:Math.max(1,Math.min(this.#config.phase_timeout_ms,remainingMs)),
        signal
      });
    };

    const runRoot = await mkdtemp(join(tmpdir(), "delegation-runner-"));
    const archivePath = join(runRoot, "source.tar.gz");
    const containerName = `delegation-runner-${randomUUID()}`;
    const logId = randomUUID();
    const logReference = `runner-log://${logId}`;
    const logs: string[] = [];
    const phases: RunnerPhaseResult[] = [];
    let typecheckDiagnostics:ReturnType<typeof extractTypecheckLocations>=[];
    let typecheckErrorCodes:string[]=[];
    let typecheckErrors:TypecheckError[]=[];
    let failingTestFiles:string[]=[];
    let projectE2eFailure:ReturnType<typeof extractProjectE2eFailureDiagnostic>=null;
    let containerCreateAttempted = false;
    let failed = false;
    let privateVitestFailure:ReturnType<typeof extractPrivateVitestFailures>|undefined;
    let testFailures:TestFailureMessage[]=[];

    try {
      signal.throwIfAborted();
      await this.#downloadArchive(request, archivePath, signal);

      // Extract inside the already constrained Linux Runner container.
      // Host-side tar may be GNU tar, bsdtar, or Windows/Git Bash tar and
      // may interpret drive-letter paths differently. This also ensures the
      // archive is unpacked in the same filesystem used for execution.
      const dockerCreateArgs = [
        "create",
        "--name",
        containerName,
        "--workdir",
        "/workspace",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev",
        "--pids-limit",
        "512",
        "--memory",
        "3g",
        "--cpus",
        "2",
        "-e",
        "CI=1"
      ];
      dockerCreateArgs.push(request.project_profile.image, "sleep", "infinity");

      // A timed-out/ambiguous Docker CLI response may still leave this named
      // container in the daemon. Attempt cleanup even when create fails.
      containerCreateAttempted = true;
      const create = await executeCommand(
        "docker",
        dockerCreateArgs
      );
      if (create.exit_code !== 0 || create.timed_out) {
        throw new Error("Could not create isolated Runner container");
      }

      const start = await executeCommand(
        "docker",
        ["start", containerName]
      );
      if (start.exit_code !== 0 || start.timed_out) {
        throw new Error("Could not start isolated Runner container");
      }

      // Docker CLI on Windows handles host drive-letter paths natively. No
      // archive extraction command ever runs on the host computer.
      const containerArchive = "/workspace/.runner-source.tar.gz";
      const copy = await executeCommand(
        "docker",
        ["cp", archivePath, `${containerName}:${containerArchive}`]
      );
      if (copy.exit_code !== 0 || copy.timed_out) {
        throw new Error("Could not copy exact repository archive into Runner container");
      }

      const extract = await executeCommand(
        "docker",
        ["exec", containerName, "tar", "-xzf", containerArchive,
          "-C", "/workspace", "--strip-components=1", "--no-same-owner"]
      );
      if (extract.exit_code !== 0 || extract.timed_out) {
        // Do not echo untrusted stderr (archive member names and file data
        // can be attacker controlled). Only expose the safe exit category.
        throw new Error(extract.timed_out
          ? "Could not materialize exact repository archive: container extraction timeout"
          : "Could not materialize exact repository archive: container tar exit " + extract.exit_code);
      }
      const removeArchive = await executeCommand(
        "docker",
        ["exec", containerName, "rm", "-f", containerArchive]
      );
      if (removeArchive.exit_code !== 0 || removeArchive.timed_out) {
        throw new Error("Could not remove Runner archive from execution container");
      }

      // Phases and commands of the Engineer-approved project profile.
      for (const fixed of request.project_profile.phases.map(p =>
        ({phase: p.name, command: p.command, vitest: p.failure_report === "vitest"}))) {
        if (failed) {
          phases.push({ phase: fixed.phase, status: "skipped" });
          continue;
        }

        // A Vitest phase also writes a JSON report to a fixed Runner-owned
        // path in the throw-away container: the source of the failed test
        // names and error messages (untrusted, bounded data).
        const privateVitest=this.#config.failure_evidence_dir&&fixed.vitest;
        const reportPath="/tmp/runner-"+fixed.phase+"-vitest.json";
        const command=fixed.vitest?fixed.command+
          " --reporter=default --reporter=json --outputFile="+reportPath:fixed.command;
        const result = await executeCommand(
          "docker",
          ["exec", containerName, "bash", "-lc", command]
      );

        logs.push(
          `=== ${fixed.phase} ===\n${result.stdout}\n${result.stderr}\n`
        );

        if (result.exit_code === 0 && !result.timed_out) {
          phases.push({ phase: fixed.phase, status: "pass" });
        } else {
          if(fixed.phase==="playwright_e2e")
            projectE2eFailure=extractProjectE2eFailureDiagnostic(
              result.stdout,result.stderr,result.timed_out);
          if(fixed.phase==="typecheck"&&!result.timed_out){
            // npm workspace names -> directories of THIS repository, read by a
            // fixed script in the throw-away container (diagnostic data only).
            const listed=await executeCommand("docker",
              ["exec",containerName,"node","-e",WORKSPACE_ROOTS_SCRIPT]);
            let roots:WorkspaceRoots={};
            if(listed.exit_code===0&&!listed.timed_out){
              try{roots=sanitizeWorkspaceRoots(JSON.parse(listed.stdout));}catch{roots={};}
            }
            typecheckDiagnostics=extractTypecheckLocations(result.stdout,result.stderr,roots);
            typecheckErrorCodes=extractTypecheckErrorCodes(result.stdout,result.stderr);
            typecheckErrors=extractTypecheckErrors(result.stdout,result.stderr,roots);
          }
          if(fixed.vitest&&!result.timed_out){
            failingTestFiles=extractVitestFailureFiles(result.stdout,result.stderr);
            // A fixed Runner-owned path, never a path supplied by an agent.
            const report=await executeCommand("docker",["exec",containerName,"cat",reportPath]);
            const json=report.exit_code===0&&!report.timed_out?report.stdout:"";
            testFailures=extractTestFailureMessages(json,failingTestFiles);
            if(privateVitest)privateVitestFailure=extractPrivateVitestFailures(json);
          }
          failed = true;
          phases.push({
            phase: fixed.phase,
            status: "fail",
            failed: 1,
            errors: [
              result.timed_out
                ? "phase timed out"
                : `phase exited with code ${result.exit_code}`
            ]
          });
        }
      }

      const projectPhases = [...phases];
      const projectStatus = failed ? "fail" : "pass";

      // PASS means the project's own test phases (Engineer-signed profile).
      // The historical researcher acceptance suite is not run: the phase is
      // reported as skipped to keep the Runner/Gateway evidence contract.
      const researcherAcceptance: RunnerPhaseResult = {
        phase: "researcher_acceptance",
        status: "skipped"
      };
      phases.push(researcherAcceptance);

      await mkdir(this.#config.log_dir, { recursive: true });
      await writeFile(
        join(this.#config.log_dir, `${logId}.log`),
        logs.join("\n"),
        { mode: 0o600 }
      );

      if(failed&&this.#config.failure_evidence_dir){
        await retainFailureEvidence({directory:this.#config.failure_evidence_dir,
          archivePath,log:logs.join("\n"),request,phases,privateVitestFailure,logReference});
      }
      signal.throwIfAborted();
      return {
        request_id: request.request_id,
        repository: request.repository,
        branch: request.branch,
        tested_commit_sha: request.commit_sha,
        runner_profile: request.profile,
        project_profile_sha256: request.project_profile_sha256,
        status: failed ? "fail" : "pass",
        phases,
        ...(typecheckDiagnostics.length>0
          ?{typecheck_diagnostics:typecheckDiagnostics}:{}),
        ...(typecheckErrorCodes.length>0
          ?{typecheck_error_codes:typecheckErrorCodes}:{}),
        ...(typecheckErrors.length>0?{typecheck_errors:typecheckErrors}:{}),
        ...(failingTestFiles.length>0
          ?{failing_test_files:failingTestFiles}:{}),
        ...(testFailures.length>0?{test_failures:testFailures}:{}),
        ...(projectE2eFailure?{project_e2e_failure:projectE2eFailure}:{}),
        project_tests: {
          status: projectStatus,
          phases: projectPhases
        },
        researcher_acceptance: researcherAcceptance,
        log_reference: logReference
      };
    } finally {
      let cleanupFailure: Error | undefined;
      if (containerCreateAttempted) {
        try {
          const removal = await this.#runCommand(
            "docker",
            ["rm", "-f", containerName],
            { timeout_ms: Math.min(this.#config.phase_timeout_ms, 30_000) }
          );
          // The name is unique to this request. A genuine "not found" after
          // an ambiguous create is also a confirmed clean outcome.
          const absent = !removal.timed_out &&
            /no such (?:container|object)/iu.test(removal.stderr);
          if (removal.timed_out || (removal.exit_code !== 0 && !absent)) {
            cleanupFailure = new Error("Runner Docker container cleanup failed");
          }
        } catch {
          cleanupFailure = new Error("Runner Docker container cleanup failed");
        }
      }
      try {
        await rm(runRoot, { recursive: true, force: true });
      } catch {
        cleanupFailure = new Error("Runner temporary workspace cleanup failed");
      }
      if (cleanupFailure) throw cleanupFailure;
    }
  }
}



