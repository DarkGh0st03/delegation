import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  IsolatedDockerRunnerExecutor,
  runnerFixedPhaseCommands,
  runnerResearcherAcceptanceCommand
} from "../src/isolated-executor.ts";

const request = {
  request_id: "req-run-6b",
  repository: "gitea://gitea.local/thesis/iam-console-poc",
  branch: "feature/account-suspension",
  commit_sha: "a".repeat(40),
  profile: "poc-default" as const
};

const config = {
  gitea_base_url: "http://127.0.0.1:3000",
  gitea_owner: "thesis",
  gitea_repository: "iam-console-poc",
  gitea_token: "runner-read-only-secret",
  docker_image: "node:22.15.0-bookworm",
  phase_timeout_ms: 10_000,
  log_dir: "/tmp/delegation-runner-test-logs"
};

test("Phase 6B fixed pipeline contains no caller-controlled command", () => {
  assert.deepEqual(
    runnerFixedPhaseCommands.map((entry) => entry.phase),
    [
      "dependency_install",
      "typecheck",
      "backend_tests",
      "frontend_tests",
      "build",
      "playwright_e2e"
    ]
  );
  assert.equal(
    runnerFixedPhaseCommands.some((entry) => entry.command.includes(request.request_id)),
    false
  );
});

test("Phase 6B Playwright phase boots the controlled app services before E2E", () => {
  const command = runnerFixedPhaseCommands.find(
    (entry) => entry.phase === "playwright_e2e"
  )?.command;
  assert.ok(command);
  assert.match(command, /npm run start -w @iam\/backend/u);
  assert.match(command, /npm run dev -w @iam\/frontend/u);
  assert.match(command, /wait_port 3000/u);
  assert.match(command, /wait_port 5173/u);
  assert.match(command, /npm run test:e2e/u);
});

test("Phase 6C mounts researcher acceptance read-only and reports a separate verdict", async () => {
  // Use a host-native absolute path so the test is valid on both Windows and Linux.
  const acceptanceDir = resolve("researcher-owned", "acceptance");
  const calls: Array<{ command: string; args: string[] }> = [];
  let fetchCount = 0;

  const executor = new IsolatedDockerRunnerExecutor(
    {
      ...config,
      acceptance_enabled: true,
      acceptance_dir: acceptanceDir
    },
    {
      fetch_fn: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(
            JSON.stringify({ commit: { id: request.commit_sha } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(Buffer.from("fake-tar-gz"), { status: 200 });
      },
      command_runner: async (command, args) => {
        calls.push({ command, args });
        return {
          exit_code: 0,
          stdout: "",
          stderr: "",
          timed_out: false
        };
      }
    }
  );

  const result = await executor.run(request);

  const create = calls.find(
    (call) => call.command === "docker" && call.args[0] === "create"
  );
  assert.ok(create);
  const mountIndex = create.args.indexOf("--mount");
  assert.notEqual(mountIndex, -1);
  assert.equal(
    create.args[mountIndex + 1],
    `type=bind,src=${acceptanceDir},dst=/workspace/.researcher-acceptance,readonly`
  );

  const acceptance = calls.find(
    (call) =>
      call.command === "docker" &&
      call.args[0] === "exec" &&
      call.args.at(-1) === runnerResearcherAcceptanceCommand
  );
  assert.ok(acceptance);
  assert.equal(result.status, "pass");
  assert.equal(result.project_tests?.status, "pass");
  assert.equal(result.researcher_acceptance?.status, "pass");
  assert.equal(result.researcher_acceptance?.phase, "researcher_acceptance");
});

test("isolated executor pins branch head to the exact requested SHA and destroys its container", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  let fetchCount = 0;

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({ commit: { id: request.commit_sha } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(Buffer.from("fake-tar-gz"), {
        status: 200,
        headers: { "content-type": "application/gzip" }
      });
    },
    command_runner: async (command, args) => {
      calls.push({ command, args });
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  const result = await executor.run(request);

  assert.equal(result.status, "pass");
  assert.equal(result.tested_commit_sha, request.commit_sha);
  assert.equal(result.phases.at(-1)?.phase, "researcher_acceptance");
  assert.equal(result.phases.at(-1)?.status, "skipped");

  const dockerExecCalls = calls.filter(
    (call) => call.command === "docker" &&
      call.args[0] === "exec" && call.args[2] === "bash"
  );
  assert.equal(calls.some((call) => call.command === "tar"), false,
    "Archive extraction must not depend on host tar");
  const extract = calls.find((call) =>
    call.command === "docker" && call.args[0] === "exec" &&
    call.args[2] === "tar");
  assert.ok(extract, "Runner must extract archive inside its Linux container");
  assert.deepEqual(extract.args.slice(2, 6),
    ["tar", "-xzf", "/workspace/.runner-source.tar.gz", "-C"]);
  assert.deepEqual(
    dockerExecCalls.map((call) => call.args.at(-1)),
    runnerFixedPhaseCommands.map((entry) => entry.command)
  );

  const cleanup = calls.find(
    (call) =>
      call.command === "docker" &&
      call.args[0] === "rm" &&
      call.args[1] === "-f"
  );
  assert.ok(cleanup, "expected ephemeral container cleanup");
});

test("isolated executor fails closed before materialization when branch head changed", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () =>
      new Response(
        JSON.stringify({ commit: { id: "b".repeat(40) } }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    command_runner: async (command, args) => {
      calls.push({ command, args });
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  await assert.rejects(
    () => executor.run(request),
    /exact-SHA precondition failed/u
  );
  assert.deepEqual(calls, []);
});

test("fixed pipeline stops after a failing phase and marks later phases skipped", async () => {
  let fetchCount = 0;
  let execCount = 0;

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ commit: { id: request.commit_sha } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(Buffer.from("fake-tar-gz"), { status: 200 });
    },
    command_runner: async (command, args) => {
      if (command === "docker" && args[0] === "exec" && args[2] === "bash") {
        execCount += 1;
        if (execCount === 2) {
          return {
            exit_code: 2,
            stdout: "",
            stderr: "typecheck failed",
            timed_out: false
          };
        }
      }
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  const result = await executor.run(request);

  assert.equal(result.status, "fail");
  assert.equal(result.phases[0].status, "pass");
  assert.equal(result.phases[1].status, "fail");
  assert.equal(result.phases[2].status, "skipped");
  assert.equal(execCount, 2);
});

test("Runner fails closed on Linux-container archive extraction error and cleans Docker",async()=>{
  const calls:Array<{command:string;args:string[]}>= [];
  let fetchCount=0;
  const executor=new IsolatedDockerRunnerExecutor(config,{
    fetch_fn:async()=>{
      fetchCount++;
      if(fetchCount===1)return new Response(JSON.stringify({
        commit:{id:request.commit_sha}
      }),{status:200,headers:{"content-type":"application/json"}});
      return new Response(Buffer.from("invalid archive"),{status:200});
    },
    command_runner:async(command,args)=>{
      calls.push({command,args});
      const failed=command==="docker" && args[0]==="exec" && args[2]==="tar";
      return {exit_code:failed?2:0,stdout:"",stderr:failed?"UNTRUSTED ARCHIVE DETAILS":"",timed_out:false};
    }
  });
  await assert.rejects(()=>executor.run(request),
    /Could not materialize exact repository archive: container tar exit 2/u);
  assert.ok(calls.some(call=>call.command==="docker"&&call.args[0]==="rm"&&call.args[1]==="-f"),
    "Isolated Runner container must be cleaned after extraction failure");
  assert.equal(calls.some(call=>call.command==="tar"),false);
  assert.equal(calls.some(call=>call.command==="docker"&&call.args[0]==="exec"&&call.args[2]==="bash"),
    false,"Never start project tests after untrusted archive extraction failure");
});

function archiveFixtureFetch() {
  let calls = 0;
  return async (): Promise<Response> => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ commit: { id: request.commit_sha } }), { status: 200 });
    }
    return new Response(Buffer.from("fake-tar-gz"), { status: 200 });
  };
}

test("AUD-009: ambiguous Docker create failure still removes its unique container name", async () => {
  const commands: string[] = [];
  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: archiveFixtureFetch(),
    command_runner: async (command, args) => {
      commands.push(command + " " + args.join(" "));
      return { exit_code: args[0] === "create" ? 2 : 0, stdout: "", stderr: "", timed_out: false };
    }
  });
  await assert.rejects(() => executor.run(request), /Could not create isolated Runner container/u);
  assert.equal(commands.some(cmd => cmd.startsWith("docker rm -f delegation-runner-")), true);
});

test("AUD-009: a failed Docker remove invalidates even an otherwise passing run", async () => {
  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: archiveFixtureFetch(),
    command_runner: async (_command, args) => ({
      exit_code: args[0] === "rm" ? 9 : 0,
      stdout: "",
      stderr: args[0] === "rm" ? "daemon unavailable" : "",
      timed_out: false
    })
  });
  await assert.rejects(() => executor.run(request), /Runner Docker container cleanup failed/u);
});

test("AUD-009: no-such-container is safe after failed Docker create", async () => {
  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: archiveFixtureFetch(),
    command_runner: async (_command, args) => ({
      exit_code: args[0] === "create" ? 1 : args[0] === "rm" ? 1 : 0,
      stdout: "",
      stderr: args[0] === "rm" ? "Error response from daemon: No such container: removed" : "",
      timed_out: false
    })
  });
  await assert.rejects(() => executor.run(request), /Could not create isolated Runner container/u);
});

test("AUD-009: timed-out Docker create also triggers cleanup attempt", async () => {
  let sawRm = false;
  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: archiveFixtureFetch(),
    command_runner: async (_command, args) => {
      if (args[0] === "rm") sawRm = true;
      return { exit_code: 1, stdout: "", stderr: "", timed_out: args[0] === "create" };
    }
  });
  await assert.rejects(() => executor.run(request), /Runner Docker container cleanup failed/u);
  assert.equal(sawRm, true);
});


test("AUD-010: total Runner budget cannot exceed Gateway reserve",()=>{
  assert.throws(()=>new IsolatedDockerRunnerExecutor({
    ...config,total_timeout_ms:840_001
  }),/total timeout/);
  assert.throws(()=>new IsolatedDockerRunnerExecutor({
    ...config,total_timeout_ms:0
  }),/total timeout/);
  assert.doesNotThrow(()=>new IsolatedDockerRunnerExecutor({
    ...config,total_timeout_ms:840_000
  }));
});

test("AUD-010: caller abort during Docker work cancels run and still removes container",async()=>{
  const controller=new AbortController();
  const commands:Array<{args:string[];timeout:number;hasSignal:boolean}>=[];
  const executor=new IsolatedDockerRunnerExecutor({
    ...config,total_timeout_ms:10_000
  },{
    fetch_fn:archiveFixtureFetch(),
    command_runner:async(_command,args,options)=>{
      commands.push({args,timeout:options.timeout_ms,hasSignal:Boolean(options.signal)});
      if(args[0]==="start")controller.abort(new Error("caller disconnected"));
      return {exit_code:0,stdout:"",stderr:"",timed_out:false};
    }
  });
  await assert.rejects(()=>executor.run(request,controller.signal),
    /caller disconnected/);
  assert.ok(commands.some(x=>x.args[0]==="create"));
  assert.ok(commands.some(x=>x.args[0]==="start"));
  const cleanup=commands.find(x=>x.args[0]==="rm"&&x.args[1]==="-f");
  assert.ok(cleanup,"Even canceled work must remove its unique Docker container");
  assert.equal(cleanup.hasSignal,false,"Cleanup must not inherit aborted caller signal");
  assert.equal(cleanup.timeout,10_000,"Preserve smaller cleanup timeout");
  assert.equal(commands.some(x=>x.args[0]==="cp"),false);
  assert.ok(commands.filter(x=>x.args[0]!=="rm").every(x=>x.hasSignal));
});

test("AUD-010: total budget limits per-stage wait and keeps a short independent cleanup",async()=>{
  const seen:Array<{args:string[];timeout:number;hasSignal:boolean}>=[];
  const executor=new IsolatedDockerRunnerExecutor({
    ...config,phase_timeout_ms:600_000,total_timeout_ms:900
  },{
    fetch_fn:archiveFixtureFetch(),
    command_runner:async(_command,args,options)=>{
      seen.push({args,timeout:options.timeout_ms,hasSignal:Boolean(options.signal)});
      return {exit_code:0,stdout:"",stderr:"",timed_out:false};
    }
  });
  const result=await executor.run(request);
  assert.equal(result.status,"pass");
  const commands=seen.filter(x=>x.args[0]!=="rm");
  assert.ok(commands.length>=7);
  assert.ok(commands.every(x=>x.timeout>0&&x.timeout<=900));
  assert.ok(commands.every(x=>x.hasSignal));
  const cleanup=seen.find(x=>x.args[0]==="rm");
  assert.ok(cleanup);
  assert.equal(cleanup.timeout,30_000);
  assert.equal(cleanup.hasSignal,false);
});

test("AUD-010: expiration mid-pipeline cannot return PASS and cleanup runs",async()=>{
  let sawCreate=false,sawCleanup=false;
  const executor=new IsolatedDockerRunnerExecutor({
    ...config,total_timeout_ms:80,phase_timeout_ms:600_000
  },{
    fetch_fn:archiveFixtureFetch(),
    command_runner:async(_command,args)=>{
      if(args[0]==="create"){
        sawCreate=true;
        await new Promise(resolve=>setTimeout(resolve,125));
      }
      if(args[0]==="rm")sawCleanup=true;
      return {exit_code:0,stdout:"",stderr:"",timed_out:false};
    }
  });
  await assert.rejects(()=>executor.run(request));
  assert.equal(sawCreate,true);
  assert.equal(sawCleanup,true);
});
