/**
 * DISPOSABLE native EVM test child: signed Engineer plan, real native Core Rust
 * VP verifier, live Adapter and OPA, but intentionally MOCKED Gitea effects.
 *
 * Never call the production trustedPlanDeploymentFromEnv here: it correctly
 * refuses a mock provider. Owner-created test-only plan registry + Unix IPC
 * use the same enforcement classes while a deterministic no-Gitea executor
 * intentionally cannot corroborate successful provider work.
 */
import {readFile} from "node:fs/promises";
import {gatewayConfigFromEnv} from "../../src/config.ts";
import {GatewayRuntime} from "../../src/runtime.ts";
import {createGatewayHttpServer} from "../../src/http.ts";
import {TrustedApprovedExecutionPlans} from "../../src/approved-execution-plans.ts";
import {TrustedPlanningRevisions} from "../../src/planning-revisions.ts";
import {GatewayCorroboratedTaskAttestor} from "../../src/trusted-task-observation.ts";
import {createTrustedPlanIpcServer} from "../../src/trusted-plan-ipc.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../../packages/orchestrator-runtime/src/signed-approval-store.ts";

const cfg=gatewayConfigFromEnv();
if(cfg.provider_mode!=="mock"||cfg.verifier_mode!=="core-rust"||
   process.env.ADAPTER_TRUST_PROFILE!=="evm"||
   !process.env.TRUSTED_PLAN_APPROVAL_DIR||
   !process.env.TRUSTED_PLAN_ENGINEER_DID||
   !process.env.TRUSTED_PLAN_KEY_ID||
   !process.env.TRUSTED_PLAN_PUBLIC_KEY_FILE||
   !process.env.TRUSTED_PLAN_IPC_SOCKET||
   !process.env.TRUSTED_PLAN_IPC_SECRET_FILE)
  throw Error("Native EVM mock Gateway fixture requires isolated offline authority");

const engineerDid=process.env.TRUSTED_PLAN_ENGINEER_DID;
const keyId=process.env.TRUSTED_PLAN_KEY_ID;
const publicKey=await readFile(process.env.TRUSTED_PLAN_PUBLIC_KEY_FILE,"utf8");
const approvals=new SignedEngineerApprovalFileStore({
  directory:process.env.TRUSTED_PLAN_APPROVAL_DIR,engineerDid,
  trustedKeys:{[keyId]:{engineer_did:engineerDid,public_key_pem:publicKey}}
});
const leaseRaw=process.env.TRUSTED_PLAN_OPERATIONAL_LEASE_MS;
const plans=new TrustedApprovedExecutionPlans({
  repository:cfg.prepare.repository,engineerDid,approvals,
  ...(leaseRaw?{operationalLeaseMs:Number(leaseRaw)}:{}),
  completionAttestor:new GatewayCorroboratedTaskAttestor()
});
const planningRevisions=new TrustedPlanningRevisions({
  async readRepository(){
    // This child never claims authenticated real-Gitea Planning.
    return {default_branch:"main",revision:"a".repeat(40)};
  }
});
const runtime=new GatewayRuntime(cfg,{approvedPlans:plans,planningRevisions});
const control=await createTrustedPlanIpcServer({
  socketPath:process.env.TRUSTED_PLAN_IPC_SOCKET,
  secretFile:process.env.TRUSTED_PLAN_IPC_SECRET_FILE,
  plans,planningRevisions
});
const server=createGatewayHttpServer(runtime);
await control.start();
server.listen(cfg.bind_port,cfg.bind_host,()=>{
  process.stdout.write("offline-native-scoped-gateway-ready\n");
});
let stopped=false;
function shutdown(){
  if(stopped)return;
  stopped=true;
  server.close(error=>{
    if(error)process.exitCode=1;
    void control.close().catch(()=>{
      process.exitCode=1;
    });
  });
}
process.on("SIGINT",shutdown);
process.on("SIGTERM",shutdown);
