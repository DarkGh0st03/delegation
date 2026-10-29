import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import {extractTypecheckLocations} from "./typecheck-diagnostics.ts";
import {extractVitestFailureFiles} from "./vitest-failure-files.ts";
import type {
  RunnerExecutor,
  RunnerPhaseName,
  RunnerPhaseResult,
  RunnerRunRequest,
  RunnerRunResult
} from "./types.ts";

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
// Must finish before the canonical Gateway -> Runner 900s timeout.
export const MAX_RUN_TOTAL_MS = 840_000;

export interface IsolatedRunnerConfig {
  gitea_base_url: string;
  gitea_owner: string;
  gitea_repository: string;
  gitea_token: string;
  docker_image: string;
  phase_timeout_ms: number;
  total_timeout_ms?: number;
  log_dir: string;
  acceptance_enabled?: boolean;
  acceptance_dir?: string;
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

const FIXED_PHASES: ReadonlyArray<{
  phase: Exclude<RunnerPhaseName, "researcher_acceptance">;
  command: string;
}> = [
  {
    phase: "dependency_install",
    command: "npm ci && npx playwright install --with-deps chromium"
  },
  { phase: "typecheck", command: "npm run typecheck" },
  { phase: "backend_tests", command: "npx vitest run tests/backend" },
  { phase: "frontend_tests", command: "npx vitest run tests/frontend" },
  { phase: "build", command: "npm run build" },
  {
    phase: "playwright_e2e",
    command:
      "set -euo pipefail; " +
      "npm run start -w @iam/backend >/tmp/runner-backend.log 2>&1 & backend_pid=$!; " +
      "npm run dev -w @iam/frontend -- --host 127.0.0.1 >/tmp/runner-frontend.log 2>&1 & frontend_pid=$!; " +
      "cleanup() { kill \"$backend_pid\" \"$frontend_pid\" 2>/dev/null || true; }; " +
      "trap cleanup EXIT; " +
      "wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/\"$1\") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo \"Timed out waiting for port $1\" >&2; return 1; }; " +
      "wait_port 3000; wait_port 5173; npm run test:e2e"
  }
];

const RESEARCHER_ACCEPTANCE_COMMAND =
  "set -euo pipefail; " +
  "npm run start -w @iam/backend >/tmp/runner-acceptance-backend.log 2>&1 & backend_pid=$!; " +
  "npm run dev -w @iam/frontend -- --host 127.0.0.1 >/tmp/runner-acceptance-frontend.log 2>&1 & frontend_pid=$!; " +
  "cleanup() { kill \"$backend_pid\" \"$frontend_pid\" 2>/dev/null || true; }; " +
  "trap cleanup EXIT; " +
  "wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/\"$1\") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo \"Timed out waiting for port $1\" >&2; return 1; }; " +
  "wait_port 3000; wait_port 5173; " +
  "npx playwright test --config .researcher-acceptance/playwright.config.ts";

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
      env: process.env,
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
      `${encodeURIComponent(this.#config.gitea_owner)}/` +
      `${encodeURIComponent(this.#config.gitea_repository)}/branches/${branch}`;

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
      `${encodeURIComponent(this.#config.gitea_owner)}/` +
      `${encodeURIComponent(this.#config.gitea_repository)}/archive/` +
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
    let failingTestFiles:string[]=[];
    let containerCreateAttempted = false;
    let failed = false;

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
      if (this.#config.acceptance_enabled) {
        if (!this.#config.acceptance_dir) {
          throw new Error("Researcher acceptance directory is not configured");
        }
        dockerCreateArgs.push(
          "--mount",
          `type=bind,src=${resolve(this.#config.acceptance_dir)},dst=/workspace/.researcher-acceptance,readonly`
        );
      }
      dockerCreateArgs.push(this.#config.docker_image, "sleep", "infinity");

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

      for (const fixed of FIXED_PHASES) {
        if (failed) {
          phases.push({ phase: fixed.phase, status: "skipped" });
          continue;
        }

        const result = await executeCommand(
          "docker",
          ["exec", containerName, "bash", "-lc", fixed.command]
      );

        logs.push(
          `=== ${fixed.phase} ===\n${result.stdout}\n${result.stderr}\n`
        );

        if (result.exit_code === 0 && !result.timed_out) {
          phases.push({ phase: fixed.phase, status: "pass" });
        } else {
          if(fixed.phase==="typecheck"&&!result.timed_out)
            typecheckDiagnostics=extractTypecheckLocations(result.stdout,result.stderr);
          if((fixed.phase==="frontend_tests"||fixed.phase==="backend_tests")&&
             !result.timed_out)
            failingTestFiles=extractVitestFailureFiles(
              result.stdout,result.stderr,fixed.phase);
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

      let researcherAcceptance: RunnerPhaseResult = {
        phase: "researcher_acceptance",
        status: "skipped"
      };
      if (this.#config.acceptance_enabled && !failed) {
        const result = await executeCommand(
          "docker",
          ["exec", containerName, "bash", "-lc", RESEARCHER_ACCEPTANCE_COMMAND]
      );

        logs.push(
          `=== researcher_acceptance ===\n${result.stdout}\n${result.stderr}\n`
        );

        if (result.exit_code === 0 && !result.timed_out) {
          researcherAcceptance = {
            phase: "researcher_acceptance",
            status: "pass"
          };
        } else {
          failed = true;
          researcherAcceptance = {
            phase: "researcher_acceptance",
            status: "fail",
            errors: [
              result.timed_out
                ? "researcher acceptance timed out"
                : `researcher acceptance exited with code ${result.exit_code}`
            ]
          };
        }
      }
      phases.push(researcherAcceptance);

      await mkdir(this.#config.log_dir, { recursive: true });
      await writeFile(
        join(this.#config.log_dir, `${logId}.log`),
        logs.join("\n"),
        { mode: 0o600 }
      );

      signal.throwIfAborted();
      return {
        request_id: request.request_id,
        repository: request.repository,
        branch: request.branch,
        tested_commit_sha: request.commit_sha,
        runner_profile: request.profile,
        status: failed ? "fail" : "pass",
        phases,
        ...(typecheckDiagnostics.length>0
          ?{typecheck_diagnostics:typecheckDiagnostics}:{}),
        ...(failingTestFiles.length>0
          ?{failing_test_files:failingTestFiles}:{}),
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

export const runnerFixedPhaseCommands = FIXED_PHASES;


export const runnerResearcherAcceptanceCommand = RESEARCHER_ACCEPTANCE_COMMAND;
