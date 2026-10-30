/**
 * R130 cross-process fixture. Node has separate memory and a fake Adapter,
 * but runs the ACTUAL authenticated Unix listener + actual signer class.
 * This script is never a production service bootstrap.
 */
import {TrustedOrchestratorRootPresenter} from
 "../../src/trusted-orchestrator-root-presenter.ts";
import {createTrustedRootVpSignerServer} from
 "../../src/trusted-root-vp-private-ipc.ts";

const [socketPath,secretFile]=process.argv.slice(2);
const rootCredentialId="urn:credential:r130-cross-process";
const audience="urn:thesis:gateway:r130";
const permissions=[{
 resource:"gitea://gitea.local/sample/invoice-service",
 operation:"read_file"
}];
const presenter=new TrustedOrchestratorRootPresenter({
 adapterBaseUrl:"http://adapter.fixture:8090",
 orchestratorToken:"fake-private-orchestrator-token-only-in-child",
 rootCredentialId,rootPermissions:permissions,
 fetchFn:async(url,init)=>{
  if(String(url)!=="http://adapter.fixture:8090/v1/presentations"||
     new Headers(init?.headers).get("authorization")!==
      "Bearer fake-private-orchestrator-token-only-in-child")
   throw Error("Orchestrator bearer not locally pinned");
  const body=JSON.parse(String(init.body));
  if(body.credential_id!==rootCredentialId||body.audience!==audience||
     !/^[a-f0-9]{64}$/.test(body.challenge)||
     JSON.stringify(body.disclosed_permissions)!==JSON.stringify(permissions))
   throw Error("Untrusted root signing request");
  return new Response(JSON.stringify({
   signed_vp:"signed-root-vp:"+body.challenge
  }),{status:200,headers:{"content-type":"application/json"}});
 }
});
const server=await createTrustedRootVpSignerServer({
 socketPath,secretFile,presenter,rootCredentialId,
 rootPermissions:permissions,audience
});
await server.start();
process.stdout.write("READY\n");
process.on("SIGTERM",()=>{
 void server.close().then(()=>process.exit(0),()=>process.exit(1));
});
