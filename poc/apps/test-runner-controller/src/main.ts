import { runnerConfigFromEnv } from "./config.ts";
import { createRunnerHttpServer } from "./http.ts";
import { IsolatedDockerRunnerExecutor } from "./isolated-executor.ts";

const config = runnerConfigFromEnv();
if (!config.execution) {
  throw new Error("Runner isolated execution configuration is required");
}
const executor = new IsolatedDockerRunnerExecutor(config.execution);
const server = createRunnerHttpServer(config, executor);

server.listen(config.bind_port, config.bind_host, () => {
  process.stdout.write(
    `test-runner-controller listening on ${config.bind_host}:${config.bind_port}\n`
  );
});
