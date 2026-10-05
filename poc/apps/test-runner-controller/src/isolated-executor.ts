import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type {
  RunnerExecutor,
  RunnerPhaseName,
  RunnerPhaseResult,
  RunnerRunRequest,
  RunnerRunResult
} from "./types.ts";

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export interface IsolatedRunnerConfig {
  gitea_base_url: string;
  gitea_owner: string;
  gitea_repository: string;
  gitea_token: string;
  docker_image: string;
  phase_timeout_ms: number;
  log_dir: string;
  acceptance_enabled?: boolean;
  acceptance_dir?: string;
}

interface CommandOptions {
  cwd?: string;
  timeout_ms: number;
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
    child.once("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout_ms);

    child.once("close", (code) => {
      clearTimeout(timer);
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
  }

  async #verifyExactBranchHead(request: RunnerRunRequest): Promise<void> {
    const branch = encodeURIComponent(request.branch);
    const url =
      `${this.#config.gitea_base_url}/api/v1/repos/` +
      `${encodeURIComponent(this.#config.gitea_owner)}/` +
      `${encodeURIComponent(this.#config.gitea_repository)}/branches/${branch}`;

    const response = await this.#fetch(url, {
      headers: authHeaders(this.#config.gitea_token)
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

  async #downloadArchive(request: RunnerRunRequest, archivePath: string): Promise<void> {
    const url =
      `${this.#config.gitea_base_url}/api/v1/repos/` +
      `${encodeURIComponent(this.#config.gitea_owner)}/` +
      `${encodeURIComponent(this.#config.gitea_repository)}/archive/` +
      `${request.commit_sha}.tar.gz`;

    const response = await this.#fetch(url, {
      headers: authHeaders(this.#config.gitea_token)
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

  async run(request: RunnerRunRequest): Promise<RunnerRunResult> {
    await this.#verifyExactBranchHead(request);

    const runRoot = await mkdtemp(join(tmpdir(), "delegation-runner-"));
    const workspace = join(runRoot, "workspace");
    const archivePath = join(runRoot, "source.tar.gz");
    const containerName = `delegation-runner-${randomUUID()}`;
    const logId = randomUUID();
    const logReference = `runner-log://${logId}`;
    const logs: string[] = [];
    const phases: RunnerPhaseResult[] = [];
    let containerCreated = false;
    let failed = false;

    try {
      await mkdir(workspace, { recursive: true });
      await this.#downloadArchive(request, archivePath);

      const extract = await this.#runCommand(
        "tar",
        [
          "-xzf",
          archivePath,
          "-C",
          workspace,
          "--strip-components=1",
          "--no-same-owner"
        ],
        { timeout_ms: this.#config.phase_timeout_ms }
      );
      if (extract.exit_code !== 0 || extract.timed_out) {
        throw new Error("Could not materialize exact repository archive");
      }

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

      const create = await this.#runCommand(
        "docker",
        dockerCreateArgs,
        { timeout_ms: this.#config.phase_timeout_ms }
      );
      if (create.exit_code !== 0 || create.timed_out) {
        throw new Error("Could not create isolated Runner container");
      }
      containerCreated = true;

      const copy = await this.#runCommand(
        "docker",
        ["cp", `${resolve(workspace)}/.`, `${containerName}:/workspace`],
        { timeout_ms: this.#config.phase_timeout_ms }
      );
      if (copy.exit_code !== 0 || copy.timed_out) {
        throw new Error("Could not copy exact repository snapshot into Runner container");
      }

      const start = await this.#runCommand(
        "docker",
        ["start", containerName],
        { timeout_ms: this.#config.phase_timeout_ms }
      );
      if (start.exit_code !== 0 || start.timed_out) {
        throw new Error("Could not start isolated Runner container");
      }

      for (const fixed of FIXED_PHASES) {
        if (failed) {
          phases.push({ phase: fixed.phase, status: "skipped" });
          continue;
        }

        const result = await this.#runCommand(
          "docker",
          ["exec", containerName, "bash", "-lc", fixed.command],
          { timeout_ms: this.#config.phase_timeout_ms }
        );

        logs.push(
          `=== ${fixed.phase} ===\n${result.stdout}\n${result.stderr}\n`
        );

        if (result.exit_code === 0 && !result.timed_out) {
          phases.push({ phase: fixed.phase, status: "pass" });
        } else {
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
        const result = await this.#runCommand(
          "docker",
          ["exec", containerName, "bash", "-lc", RESEARCHER_ACCEPTANCE_COMMAND],
          { timeout_ms: this.#config.phase_timeout_ms }
        );

        logs.push(
          `=== researcher_acceptance ===\n${result.stdout}\n${result.stderr}\n`
        );

        if (result.exit_code === 0 && !result.timed_out) {
          researcherAcceptance = {
            phase: "researcher_acceptance",
            status: "pass",
            passed: 1,
            failed: 0
          };
        } else {
          failed = true;
          researcherAcceptance = {
            phase: "researcher_acceptance",
            status: "fail",
            passed: 0,
            failed: 1,
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

      return {
        request_id: request.request_id,
        repository: request.repository,
        branch: request.branch,
        tested_commit_sha: request.commit_sha,
        runner_profile: request.profile,
        status: failed ? "fail" : "pass",
        phases,
        project_tests: {
          status: projectStatus,
          phases: projectPhases
        },
        researcher_acceptance: researcherAcceptance,
        log_reference: logReference
      };
    } finally {
      if (containerCreated) {
        await this.#runCommand(
          "docker",
          ["rm", "-f", containerName],
          { timeout_ms: this.#config.phase_timeout_ms }
        ).catch(() => undefined);
      }
      await rm(runRoot, { recursive: true, force: true });
    }
  }
}

export const runnerFixedPhaseCommands = FIXED_PHASES;


export const runnerResearcherAcceptanceCommand = RESEARCHER_ACCEPTANCE_COMMAND;
