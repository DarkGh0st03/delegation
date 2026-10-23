import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
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
import {makeApproval,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {SignedEngineerApprovalFileStore}
  from "../../orchestrator-runtime/src/signed-approval-store.ts";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";

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
    // The former bug blocked the ninth sequential operation even though
    // no other crypto request was in flight. Exercise the SAME real MCP
    // HTTP transport, private worker, Adapter and Gateway across 12 reads.
    for(let operation=0;operation<12;operation++){
      const response=await client.invoke("read_file",{
        branch:"feature/account-suspension",path:"apps/backend/app.ts"
      });
      assert.equal((response as {tool:string}).tool,"read_file");
      assert.doesNotMatch(JSON.stringify(response),
        /private\.signed\.vp|adapter-private-only-secret|PRIVATE_DELEGATION_CREDENTIAL|proof_/u);
    }
    assert.equal(executor.callCount,12);
    assert.equal(verifierCalls,12);
    assert.equal(policyCalls,12);
    assert.equal(adapterCalls,12);
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


test("R1 signed nonlegacy Task traverses real MCP HTTP, private VP and approved Gateway before provider effects",async()=>{
  // The same GatewayRuntime instance owns the immutable Engineer-reviewed
  // plan and normal HTTP Prepare/Execute routes. Crypto/OPA/provider adapters
  // are instrumented fixtures; no Gemini, network Gitea or billed inference.
  const k=keys(),front=keys(),testKey=keys();
  const repo={authority:"gitea.local",owner:"thesis",repository:"invoices"};
  const branch="feature/invoice-sort",path="src/billing/invoice.ts";
  const root="gitea://gitea.local/thesis/invoices";
  const resource=root+"/branches/"+encodeURIComponent(branch)+"/files/"+path;
  const sessionId="session-invoice-reviewed",taskId="dispatch_invoice_signed_01";
  const engineer="did:thesis:engineer",sha="a".repeat(40);
  const reviewedAt=new Date();
  const plan={
    schema_version:"1.0.0",plan_id:"invoice-dynamic-mcp",
    session_id:sessionId,version:1,repository:repo,base_revision:sha,
    requirement:"Implement invoice sorting in the approved existing file",
    candidate_agents:[{
      agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
    }],
    tasks:[{id:"invoice",agent_id:"backend",title:"Implement invoice sorting",
      description:"Change approved invoice implementation",depends_on:[],
      resources:[resource]}],
    requested_permissions:[{id:"permission-invoice-write",
      task_id:"invoice",agent_id:"backend",resource,operation:"update_file",
      reason:"Modify the approved invoice module"}],
    assumptions:[],uncertainties:[]
  };
  const signedSubset=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"decision-invoice",approved_by:engineer,
    approved_at:reviewedAt.toISOString(),
    approved_permission_ids:["permission-invoice-write"]
  });
  // The trusted Gateway consumes an Ed25519 Engineer-signed receipt from
  // the real protected file store. This proves signature and immutable
  // plan binding (human GUI authentication is tested in a separate suite).
  const approvalDirectory=await mkdtemp(join(tmpdir(),"r1-mcp-signed-engineer-"));
  const engineerKey=keys();
  const signedReceipt=signEngineerApproval({
    plan,approval:signedSubset,engineerDid:engineer,
    keyId:"r1-engineer-key",privateKeyPem:engineerKey.privateKey,
    issuedAt:reviewedAt.toISOString(),
    expiresAt:new Date(reviewedAt.getTime()+600_000).toISOString()
  });
  await writeFile(join(approvalDirectory,sessionId+".json"),
    JSON.stringify(signedReceipt),{mode:0o600});
  const approvalStore=new SignedEngineerApprovalFileStore({
    directory:approvalDirectory,engineerDid:engineer,
    trustedKeys:{"r1-engineer-key":{
      engineer_did:engineer,public_key_pem:engineerKey.publicKey
    }}
  });
  const approvedPlans=new TrustedApprovedExecutionPlans({
    repository:repo,engineerDid:engineer,approvals:approvalStore,
    completionAttestor:{async confirmCompleted(){return false;}},
    operationalLeaseMs:45_000
  });
  const digest=await approvedPlans.activate(sessionId,sha);
  assert.equal(digest,planDigest(plan));
  approvedPlans.bindTask(sessionId,"invoice",taskId,"backend");

  let adapterCalls=0,coreCalls=0,opaCalls=0,providerCalls=0;
  let opaAllows=true;
  const vp="opaque.private.adapter.vp";
  const audit=new InMemoryAuditSink();
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:90_000,
      repository:repo},
    adapter_url:"http://unused",adapter_gateway_token:"unused",
    opa_url:"http://unused",opa_timeout_ms:2000,
    provider_mode:"mock",gitea_timeout_ms:2000
  },{
    approvedPlans,audit,
    executor:{
      provider:"gitea",
      providerFor(){return "gitea";},
      async execute(record:any){
        providerCalls++;
        assert.equal(record.request.tool,"update_file");
        assert.equal(record.request.arguments.branch,branch);
        assert.equal(record.approved_plan_digest,digest);
        return {provider:"gitea",performed:true,tool:"update_file",
          branch,path,revision:sha,commit_sha:sha,
          blob_sha:"b".repeat(40),precondition_blob_sha:"c".repeat(40)};
      }
    } as any,
    verifier:{async verify(request){
      coreCalls++;
      assert.equal(request.signed_vp,vp);
      assert.equal(request.presenter,"backend");
      assert.equal(request.required_permission.operation,"update_file");
      assert.equal(request.required_permission.resource,resource);
      return {
        presenter_id:"did:thesis:backend",issuer_id:engineer,
        credential_id:"urn:dc:approved:invoice",
        permissions:[request.required_permission],
        hierarchy_depth:1,expiration:"999999999999999999"
      };
    }},
    policy:{async evaluate(input){
      opaCalls++;
      assert.equal(input.approved_plan_digest,digest);
      return {allow:opaAllows,policy_version:"opa-invoice-test"};
    }}
  });
  const gateway=createGatewayHttpServer(runtime);
  const gatewayUrl=await start(gateway);
  const registry=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey
  });
  const worker=express();
  attachPrivateMcpWorker(worker,registry);
  const privateListener=worker.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>privateListener.once("listening",resolve));
  const workerUrl="http://127.0.0.1:"+
    (privateListener.address() as AddressInfo).port;
  const route=new TaskRouter({
    backend:{baseUrl:workerUrl},frontend:{baseUrl:workerUrl},
    test:{baseUrl:workerUrl}
  });
  const keysByRole={
    backend:k.publicKey,frontend:front.publicKey,test:testKey.publicKey
  };
  const shared=createSharedMcpHttpServer({
    verificationKeys:keysByRole,router:route
  });
  const crypto=createSharedMcpHttpServer({
    profile:"crypto",verificationKeys:keysByRole,router:route
  });
  const sharedUrl=await start(shared),cryptoUrl=await start(crypto);
  const cancelled=new AbortController();
  let conn:Client|undefined;
  try{
    const evidence=new DelegationEvidenceHandler({
      adapterBaseUrl:"http://adapter.invalid",
      adapterToken:"private-adapter-token",
      evidence:{
        credential_id:"urn:dc:approved:invoice",
        presenter_id:"did:thesis:backend",credential:"private-dc-material"
      },
      fetchFn:(async(_url,init)=>{
        adapterCalls++;
        assert.equal((init?.headers as Record<string,string>).authorization,
          "Bearer private-adapter-token");
        const parsed=JSON.parse(String(init?.body));
        assert.equal(parsed.disclosed_permissions[0].operation,"update_file");
        assert.equal(parsed.disclosed_permissions[0].resource,resource);
        return new Response(JSON.stringify({signed_vp:vp}),{status:200});
      }) as typeof fetch
    });
    const cryptoBroker=new TrustedCryptoMcpBridge({
      endpoint:cryptoUrl,taskId,registry
    });
    const controlled=new GatewayControlledToolClient({
      gatewayBaseUrl:gatewayUrl,agentRole:"backend",taskId,
      evidenceHandler:evidence,cryptoPresentation:cryptoBroker,
      signal:cancelled.signal
    });
    registry.begin(taskId,controlled,cancelled.signal,{
      approvedBranch:branch,allowedPaths:[path],
      allowedFilePermissions:[{operation:"update_file",path}],
      allowUpdateFile:true,evidenceHandler:evidence
    });
    const transport=new StreamableHTTPClientTransport(
      new URL(sharedUrl+"/mcp"),{
        requestInit:{headers:{authorization:"Bearer "+registry.bearerFor(taskId)}}
      }
    );
    conn=new Client({
      name:"reviewed-branch-gateway-bridge",version:"1.0.0"
    },{capabilities:{}});
    await conn.connect(transport);
    const approvedCall={branch,path,content:"export const sortedInvoices=true;"};
    const ok=await conn.callTool({name:"update_file",arguments:approvedCall});
    assert.notEqual(ok.isError,true);
    assert.equal(providerCalls,1);
    assert.equal(adapterCalls,1);
    assert.equal(coreCalls,1);
    assert.equal(opaCalls,1);
    assert.doesNotMatch(JSON.stringify(ok),
      /opaque\.private\.adapter\.vp|private-dc-material|private-adapter-token|proof_/u);

    // All three are denied in the private worker or MCP parser BEFORE
    // another Gateway Prepare / Adapter / provider operation.
    for(const rejected of [
      {name:"update_file",arguments:{
        ...approvedCall,branch:"feature/attacker"}},
      {name:"update_file",arguments:{
        ...approvedCall,path:"src/billing/tax.ts"}},
      {name:"create_file",arguments:approvedCall},
      {name:"update_file",arguments:{...approvedCall,branch:"main"}}
    ]){
      const denial=await conn.callTool(rejected);
      assert.equal(denial.isError,true);
    }
    assert.equal(adapterCalls,1);
    assert.equal(providerCalls,1);

    // An exact Task operation and file are not enough if OPA denies.
    opaAllows=false;
    const opaDenied=await conn.callTool({
      name:"update_file",arguments:approvedCall
    });
    assert.equal(opaDenied.isError,true);
    assert.equal(opaCalls,2);
    assert.equal(providerCalls,1);
    opaAllows=true;

    // Trust-session termination blocks even the same signed Task bearer.
    approvedPlans.closeSession(sessionId);
    const afterClose=await conn.callTool({
      name:"update_file",arguments:approvedCall
    });
    assert.equal(afterClose.isError,true);
    assert.equal(adapterCalls,2);
    assert.equal(providerCalls,1);
  } finally {
    cancelled.abort();
    registry.end(taskId);
    if(conn)await conn.close();
    await stop(crypto);await stop(shared);
    await stop(privateListener);await stop(gateway);
    await rm(approvalDirectory,{recursive:true,force:true});
  }
});
