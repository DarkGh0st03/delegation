import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";

const host = process.env.RUNNER_SENTINEL_HOST ?? "127.0.0.1";
const port = Number(process.env.RUNNER_SENTINEL_PORT ?? "8091");
const countFile =
  process.env.RUNNER_SENTINEL_COUNT_FILE ?? "/tmp/phase8c-runner-count.txt";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("RUNNER_SENTINEL_PORT must be a valid TCP port");
}

let runRequests = 0;
await writeFile(countFile, "0\n", "utf8");

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", run_requests: runRequests }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/runs") {
    runRequests += 1;
    await writeFile(countFile, `${runRequests}\n`, "utf8");
    response.statusCode = 503;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        error: "phase8c_runner_sentinel_reached",
        message:
          "A denied Phase 8C request reached the Controlled Test Runner boundary"
      })
    );
    return;
  }

  response.statusCode = 404;
  response.end();
});

server.listen(port, host, () => {
  process.stdout.write(
    JSON.stringify({
      event: "phase8c_runner_sentinel_started",
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
