/**
 * Disposable separate-process Gateway for trusted Unix IPC security tests.
 * Real signed-approval verification; mocked VP/OPA/provider ONLY.
 */
import {readFile} from "node:fs/promises";
import {trustedPlanDeploymentFromEnv} from "../../src/trusted-plan-deployment.ts";
import {GatewayRuntime} from "../../src/runtime.ts";
import {createGatewayHttpServer} from "../../src/http.ts";

const cfg=JSON.parse(await readFile(process.env.IPC_TEST_CONFIG!,"utf8"));
// Exercise the SAME optional deployment bootstrap that main.ts uses.
const deployed=await trustedPlanDeploymentFromEnv(cfg.repository);
if(!deployed)throw Error("Trusted deployment was not enabled in test process");
const {plans,ipc:control}=deployed;
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
      presenter_id:"did:thesis:"+req.presenter,issuer_id:cfg.engineerDid,
      credential_id:"urn:operational-root",permissions:[req.required_permission],
      hierarchy_depth:1,expiration:new Date(Date.now()+60000).toISOString()
    };
  }},
  policy:{async evaluate(){return {allow:true,policy_version:"test-opa"};}},
  // Deterministic test substitute for REAL Gitea I/O. Production requires
  // the actual provider executor to corroborate work against the repository.
  executor:{
    provider:"gitea",
    async execute(record){
      const request=record.request,sha=cfg.repositoryBaseSha||"a".repeat(40);
      if(request.tool==="create_branch")return {
        provider:"gitea",performed:true,tool:"create_branch",
        branch:request.arguments.branch,base_branch:"main",
        revision:sha,commit_sha:sha
      };
      if(request.tool==="update_file")return {
        provider:"gitea",performed:true,tool:"update_file",
        branch:request.arguments.branch,path:request.arguments.path,
        revision:sha,commit_sha:sha,blob_sha:"b",precondition_blob_sha:"a"
      };
      throw Error("Fixture only creates a branch and edits a test file");
    }
  }
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
