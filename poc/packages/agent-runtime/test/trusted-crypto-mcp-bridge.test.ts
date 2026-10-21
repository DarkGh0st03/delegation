import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {createGatewayHttpServer} from "../../../apps/gateway/src/http.ts";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {InMemoryAuditSink} from "../../../apps/gateway/src/prepare.ts";
import {MockExecutor} from "../../../apps/gateway/src/mock-executor.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {GatewayControlledToolClient} from "../src/gateway-tool-client.ts";
import {TrustedCryptoMcpBridge} from "../src/trusted-crypto-mcp-bridge.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";

function keys(){
  const kp=generateKeyPairSync("ed25519");
  return {
    privateKey:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:kp.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function start(server:any):Promise<string>{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  return "http://127.0.0.1:"+(server.address() as AddressInfo).port;
}
function stop(server:any):Promise<void>{
  return new Promise((resolve,reject)=>server.close((error?:Error)=>error?reject(error):resolve()));
}

test("Gateway Prepare -> trusted crypto MCP SDK -> private Adapter VP -> Gateway Execute, without model-visible proof",async()=>{
  const k=keys(),other=keys(),third=keys();
  const registry=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey
  });
  let adapterCalls=0,verifierCalls=0,policyCalls=0;
  const executor=new MockExecutor(),audit=new InMemoryAuditSink();
  const expectedVp="private.signed.vp";
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{
      audience:"cloud-access-gateway",request_ttl_ms:90_000,
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"}
    },
    adapter_url:"http://unused",adapter_gateway_token:"unused",
    opa_url:"http://unused",opa_timeout_ms:2000,
    provider_mode:"mock",gitea_timeout_ms:2000
  },{
    executor,audit,
    verifier:{
      async verify(request){
        verifierCalls++;
        assert.equal(request.presenter,"backend");
        assert.equal(request.signed_vp,expectedVp);
        assert.ok(request.challenge);
        assert.equal(request.required_permission.operation,"read_file");
        return {
          presenter_id:"did:thesis:backend",
          issuer_id:"did:thesis:orchestrator",
          credential_id:"urn:delegation:backend",
          permissions:[request.required_permission],
          hierarchy_depth:1,expiration:"9999999999999999999"
        };
      }
    },
    policy:{async evaluate(input){
      policyCalls++;
      assert.equal(input.agent_role,"backend");
      return {allow:true,policy_version:"test-mcp-crypto"};
    }}
  });
  const gateway=createGatewayHttpServer(runtime);
  const gatewayUrl=await start(gateway);
  const worker=express();
  attachPrivateMcpWorker(worker,registry);
  const privateListener=worker.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>privateListener.once("listening",resolve));
  const privateUrl="http://127.0.0.1:"+(privateListener.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    profile:"crypto",
    verificationKeys:{backend:k.publicKey,frontend:other.publicKey,test:third.publicKey},
    router:new TaskRouter({
      backend:{baseUrl:privateUrl},frontend:{baseUrl:privateUrl},test:{baseUrl:privateUrl}
    })
  });
  const sharedUrl=await start(shared);
  const signal=new AbortController();
  try {
    const evidence=new DelegationEvidenceHandler({
      adapterBaseUrl:"http://private-adapter.invalid",
      adapterToken:"adapter-private-only-secret",
      evidence:{
        credential_id:"urn:delegation:backend",
        presenter_id:"did:thesis:backend",
        credential:"PRIVATE_DELEGATION_CREDENTIAL"
      },
      fetchFn:(async (_url,init)=>{
        adapterCalls++;
        assert.equal((init?.headers as Record<string,string>).authorization,
          "Bearer adapter-private-only-secret");
        const body=JSON.parse(String(init?.body));
        assert.equal(body.credential_id,"urn:delegation:backend");
        assert.equal(body.disclosed_permissions.length,1);
        assert.equal(body.disclosed_permissions[0].operation,"read_file");
        return new Response(JSON.stringify({signed_vp:expectedVp}),{status:200});
      }) as typeof fetch
    });
    const broker=new TrustedCryptoMcpBridge({
      endpoint:sharedUrl,taskId:"task-crypto-mcp",registry
    });
    const client=new GatewayControlledToolClient({
      gatewayBaseUrl:gatewayUrl,agentRole:"backend",
      taskId:"task-crypto-mcp",evidenceHandler:evidence,
      cryptoPresentation:broker,signal:signal.signal
    });
    registry.begin("task-crypto-mcp",client,signal.signal,{evidenceHandler:evidence});
    const response=await client.invoke("read_file",{
      branch:"feature/account-suspension",path:"apps/backend/app.ts"
    });
    assert.equal(executor.callCount,1);
    assert.equal(verifierCalls,1);
    assert.equal(policyCalls,1);
    assert.equal(adapterCalls,1);
    assert.equal((response as {tool:string}).tool,"read_file");
    assert.doesNotMatch(JSON.stringify(response),
      /private\.signed\.vp|adapter-private-only-secret|PRIVATE_DELEGATION_CREDENTIAL|proof_/u);
    // The shared MCP process exposes only cryptographic tools, never repository
    // mutation or proof retrieval. It cannot return the private signed VP.
    const transport=new StreamableHTTPClientTransport(new URL(sharedUrl+"/mcp"),{
      requestInit:{headers:{authorization:"Bearer "+registry.bearerFor("task-crypto-mcp")}}
    });
    const conn=new Client({name:"crypto-surface-regression",version:"0.1.0"},{capabilities:{}});
    try{
      await conn.connect(transport);
      assert.deepEqual((await conn.listTools()).tools.map(x=>x.name),
        ["delegation_create_presentation"]);
      const replay=await conn.callTool({
        name:"delegation_create_presentation",arguments:{request_id:"missing"}
      });
      assert.equal(replay.isError,true);
      assert.doesNotMatch(JSON.stringify(replay),/private\.signed\.vp/u);
    }finally{await conn.close();}
  } finally {
    signal.abort();
    await stop(shared);
    await stop(privateListener);
    await stop(gateway);
  }
});

test("fail-closed: crypto MCP outage does not fall back to direct Adapter signing or Gateway Execute",async()=>{
  const k=keys(),registry=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey
  });
  let gatewayCalls=0,directAdapterCalls=0;
  const evidence=new DelegationEvidenceHandler({
    adapterBaseUrl:"http://adapter.invalid",adapterToken:"secret",
    evidence:{
      credential_id:"urn:delegation:backend",
      presenter_id:"did:thesis:backend",
      credential:"private"
    },
    fetchFn:async()=>{directAdapterCalls++;throw Error("must not fall back");}
  });
  const bridge=new TrustedCryptoMcpBridge({
    endpoint:"http://127.0.0.1:1",
    taskId:"task-down",registry
  });
  const client=new GatewayControlledToolClient({
    gatewayBaseUrl:"http://gateway.local",
    agentRole:"backend",taskId:"task-down",evidenceHandler:evidence,
    cryptoPresentation:bridge,
    fetchFn:async (_url)=>{
      gatewayCalls++;
      return new Response(JSON.stringify({
        request_id:"req-down",
        audience:"cloud-access-gateway",challenge:"gateway-nonce",
        required_permission:{
          resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/files/a.ts",
          operation:"read_file"
        },expires_at:new Date(Date.now()+40_000).toISOString()
      }),{status:201});
    }
  });
  registry.begin("task-down",client,undefined,{evidenceHandler:evidence});
  try{
    await assert.rejects(client.invoke("read_file",{branch:"main",path:"a.ts"}),
      (e:unknown)=>e instanceof ControlledToolError&&e.kind==="authorization_denied");
    assert.equal(gatewayCalls,1,"Only prepare may reach Gateway");
    assert.equal(directAdapterCalls,0);
  }finally{registry.end("task-down");}
});
