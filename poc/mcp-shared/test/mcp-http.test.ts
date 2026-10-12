import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {type AddressInfo} from "node:net";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {createSharedMcpHttpServer} from "../src/http-server.ts";
import {TaskRouter} from "../src/task-router.ts";
import {issueTaskToken, type AgentRole} from "../src/task-token.ts";

function pair() {
  const kp=generateKeyPairSync("ed25519");
  return {
    privateKey:kp.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:kp.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}

test("native MCP Streamable HTTP tools/list and tools/call reuse one shared server",async()=>{
  const backend=pair(), frontend=pair(), testing=pair();
  const reached:{role:AgentRole;task:string}[]=[];
  const router=new TaskRouter({
    backend:{baseUrl:"http://backend.internal:3001"},
    frontend:{baseUrl:"http://frontend.internal:3002"},
    test:{baseUrl:"http://test.internal:3003"}
  },async (input,init)=>{
    const name=new URL(String(input)).hostname;
    const role=name.split(".")[0] as AgentRole;
    const token=new Headers(init?.headers).get("authorization")?.slice(7);
    assert.ok(token);
    const claims=JSON.parse(Buffer.from(token.split(".")[1]!,"base64url").toString("utf8"));
    reached.push({role,task:claims.task_id});
    const args=JSON.parse(String(init?.body)).arguments;
    return new Response(JSON.stringify({
      ok:true,
      result:{
        provider:"gitea",performed:true,tool:"read_file",...args,
        revision:"a".repeat(40),blob_sha:"b".repeat(40),
        last_commit_sha:"a".repeat(40),size:4,encoding:"utf-8",content:"code"
      }
    }),{status:200,headers:{"content-type":"application/json"}});
  });
  const server=createSharedMcpHttpServer({
    verificationKeys:{
      backend:backend.publicKey,frontend:frontend.publicKey,test:testing.publicKey
    },
    router
  });
  const listening=await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  void listening;
  const port=(server.address() as AddressInfo).port;
  const endpoint=new URL("http://127.0.0.1:"+port+"/mcp");
  const clients:Client[]=[];
  try {
    for(const [role,privateKey] of [
      ["backend",backend.privateKey],["frontend",frontend.privateKey]
    ] as const){
      const token=issueTaskToken(privateKey,role,"task-"+role);
      const transport=new StreamableHTTPClientTransport(endpoint,{
        requestInit:{headers:{authorization:"Bearer "+token}}
      });
      const client=new Client({name:"thesis-test-"+role,version:"0.1.0"},{capabilities:{}});
      await client.connect(transport);
      clients.push(client);
      const list=await client.listTools();
      assert.deepEqual(list.tools.map(t=>t.name),["read_file","update_file"]);
      const result=await client.callTool({
        name:"read_file",arguments:{
          branch:"feature/account-suspension",
          path:"apps/backend/src/users/user.model.ts"
        }
      });
      assert.notEqual(result.isError,true);
      const sc=result.structuredContent as {ok:boolean;result:{content:string}};
      assert.equal(sc.ok,true);
      assert.equal(sc.result.content,"code");
    }
    assert.deepEqual(reached,[
      {role:"backend",task:"task-backend"},
      {role:"frontend",task:"task-frontend"}
    ]);
    const unsigned=await fetch(endpoint,{method:"POST",
      headers:{"content-type":"application/json"},body:"{}"});
    assert.equal(unsigned.status,401);
    const originDenied=await fetch(endpoint,{method:"POST",
      headers:{origin:"https://evil.example","content-type":"application/json"},
      body:"{}"});
    assert.equal(originDenied.status,403);
  } finally {
    for(const client of clients) await client.close();
    await new Promise<void>((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());
    });
  }
});
