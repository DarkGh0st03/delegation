import { runnerConfigFromEnv } from "./config.ts";
import { createRunnerHttpServer } from "./http.ts";

const config = runnerConfigFromEnv();
const server = createRunnerHttpServer(config);

server.listen(config.bind_port, config.bind_host, () => {
  process.stdout.write(
    `test-runner-controller listening on ${config.bind_host}:${config.bind_port}\n`
  );
});
