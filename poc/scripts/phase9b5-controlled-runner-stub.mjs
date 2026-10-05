import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";

const host = process.env.RUNNER_STUB_HOST ?? "127.0.0.1";
const port = Number(process.env.RUNNER_STUB_PORT ?? "8091");
const expectedToken =
  process.env.TEST_RUNNER_GATEWAY_TOKEN ?? "phase9b5-runner-secret";
const countFile =
  process.env.RUNNER_STUB_COUNT_FILE ??
  "/tmp/phase9b5-runner-count.txt";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("RUNNER_STUB_PORT must be a valid TCP port");
}

let runRequests = 0;
await writeFile(countFile, "0\n", "utf8");

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(payload);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, {
      status: "ok",
      run_requests: runRequests
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/runs") {
    if (
      request.headers.authorization !==
      `Bearer ${expectedToken}`
    ) {
      json(response, 401, {
        error: "unauthorized"
      });
      return;
    }

    const body = await readJson(request);
    runRequests += 1;
    await writeFile(
      countFile,
      `${runRequests}\n`,
      "utf8"
    );

    if (
      body.branch !== "feature/account-suspension" ||
      body.profile !== "poc-default" ||
      typeof body.commit_sha !== "string" ||
      !/^[0-9a-f]{40}$/u.test(body.commit_sha)
    ) {
      json(response, 400, {
        error: "invalid_runner_contract"
      });
      return;
    }

    const projectPhases = [
      "dependency_install",
      "typecheck",
      "backend_tests",
      "frontend_tests",
      "build",
      "playwright_e2e"
    ].map((phase) => ({
      phase,
      status: "pass"
    }));

    const researcherAcceptance = {
      phase: "researcher_acceptance",
      status: "pass"
    };

    json(response, 200, {
      request_id: body.request_id,
      repository: body.repository,
      branch: body.branch,
      tested_commit_sha: body.commit_sha,
      runner_profile: body.profile,
      status: "pass",
      phases: [
        ...projectPhases,
        researcherAcceptance
      ],
      project_tests: {
        status: "pass",
        phases: projectPhases
      },
      researcher_acceptance: researcherAcceptance,
      log_reference:
        `phase9b5-controlled-runner://${body.commit_sha}`
    });
    return;
  }

  response.statusCode = 404;
  response.end();
});

server.listen(port, host, () => {
  process.stdout.write(
    JSON.stringify({
      event: "phase9b5_runner_stub_started",
      host,
      port,
      count_file: countFile
    }) + "\n"
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
