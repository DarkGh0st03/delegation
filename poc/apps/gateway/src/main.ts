import { gatewayConfigFromEnv } from "./config.ts";
import { createGatewayHttpServer } from "./http.ts";
import { GatewayRuntime } from "./runtime.ts";
import {trustedPlanDeploymentFromEnv} from "./trusted-plan-deployment.ts";

const config = gatewayConfigFromEnv();
const trusted = await trustedPlanDeploymentFromEnv(config.prepare.repository);
const runtime = new GatewayRuntime(config,
  trusted ? {approvedPlans:trusted.plans} : {});
const server = createGatewayHttpServer(runtime);

// Private control must start securely BEFORE public provider-facing HTTP.
if(trusted)await trusted.ipc.start();
server.listen(config.bind_port, config.bind_host, () => {
  process.stdout.write(
    `cloud-access-gateway listening on ${config.bind_host}:${config.bind_port}\n`
  );
});

let shuttingDown=false;
function shutdown(): void {
  if(shuttingDown)return;
  shuttingDown=true;
  server.close((error) => {
    if(error){
      process.stderr.write(`Gateway shutdown failed: ${error.message}\n`);
      process.exitCode=1;
    }
    void trusted?.ipc.close().catch(error=>{
      process.stderr.write(`Trusted plan IPC shutdown failed: ${error.message}\n`);
      process.exitCode=1;
    });
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
