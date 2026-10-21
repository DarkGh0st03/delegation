/**
 * Disposable separate-process Gateway for trusted Unix IPC security tests.
 * Real signed-approval verification; mocked VP/OPA/provider ONLY.
 */
import {readFile} from "node:fs/promises";
import {SignedEngineerApprovalFileStore} from
  "../../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedApprovedExecutionPlans} from "../../src/approved-execution-plans.ts";
import {createTrustedPlanIpcServer} from "../../src/trusted-plan-ipc.ts";
import {GatewayRuntime} from "../../src/runtime.ts";
import {createGatewayHttpServer} from "../../src/http.ts";

const cfg=JSON.parse(await readFile(process.env.IPC_TEST_CONFIG!,"utf8"));
const approvals=new SignedEngineerApprovalFileStore({
  directory:cfg.approvalDir,engineerDid:cfg.engineerDid,
  trustedKeys:{[cfg.keyId]:{
    engineer_did:cfg.engineerDid,public_key_pem:cfg.publicKey
  }}
});
const plans=new TrustedApprovedExecutionPlans({
  repository:cfg.repository,engineerDid:cfg.engineerDid,approvals,
  completionAttestor:{async confirmCompleted(){return false;}}
});
const control=await createTrustedPlanIpcServer({
  socketPath:cfg.socketPath,secretFile:cfg.secretFile,plans
});
const runtime=new GatewayRuntime({
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{
    audience:"cloud-access-gateway",request_ttl_ms:120000,
    repository:cfg.repository
  },
  adapter_url:"http://test-disabled",adapter_gateway_token:"test-disabled",
  opa_url:"http://test-disabled",opa_timeout_ms:500,
  provider_mode:"mock",gitea_timeout_ms:500
},{
  approvedPlans:plans,
  verifier:{async verify(req){
    return {
      presenter_id:"did:thesis:orchestrator",issuer_id:cfg.engineerDid,
      credential_id:"urn:operational-root",permissions:[req.required_permission],
      hierarchy_depth:1,expiration:new Date(Date.now()+60000).toISOString()
    };
  }},
  policy:{async evaluate(){return {allow:true,policy_version:"test-opa"};}}
});
const server=createGatewayHttpServer(runtime);
await control.start();
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
process.send?.({ready:true,pid:process.pid,port:(server.address() as any).port});
async function close(){
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await control.close();
}
process.on("SIGTERM",()=>{void close().then(()=>process.exit(0)).catch(()=>process.exit(1));});
