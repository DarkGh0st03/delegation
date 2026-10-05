import { gatewayConfigFromEnv } from "./config.ts";
import { createGatewayHttpServer } from "./http.ts";
import { GatewayRuntime } from "./runtime.ts";

const config = gatewayConfigFromEnv();
const runtime = new GatewayRuntime(config);
const server = createGatewayHttpServer(runtime);

server.listen(config.bind_port, config.bind_host, () => {
  process.stdout.write(
    `cloud-access-gateway listening on ${config.bind_host}:${config.bind_port}\n`
  );
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      process.stderr.write(`Gateway shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
