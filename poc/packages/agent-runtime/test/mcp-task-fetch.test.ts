import test from "node:test";
import assert from "node:assert/strict";
import {createTaskBearerFetch} from "../src/mcp-task-fetch.ts";

test("a fresh trusted task token is supplied for each MCP request",async()=>{
  const tokens=["task-token-A","task-token-B"];
  let calls=0;
  const received:string[]=[];
  const transport=createTaskBearerFetch(
    "https://mcp.example.test/mcp",
    ()=>tokens[calls],
    async (_input,init)=>{
      const h=new Headers(init?.headers);
      received.push(h.get("authorization")??"");
      assert.equal(h.get("x-request-id"),"safe");
      assert.equal(init?.redirect,"error");
      calls++;
      return new Response("{}",{status:200});
    }
  );
  for(let i=0;i<2;i++){
    const r=await transport("https://mcp.example.test/mcp",{
      method:"POST",headers:{"x-request-id":"safe","authorization":"Bearer attacker"}
    });
    assert.equal(r.status,200);
  }
  assert.deepEqual(received,["Bearer task-token-A","Bearer task-token-B"]);
});

test("a token cannot be sent to a different endpoint or through redirects",async()=>{
  let tokens=0,network=0;
  const fn=createTaskBearerFetch("https://mcp.example.test/mcp",()=>{tokens++;return "trusted";},
    async()=>{network++;return new Response("ok");});
  await assert.rejects(fn("https://attacker.test/mcp"),/Unexpected shared MCP endpoint/);
  await assert.rejects(fn("https://mcp.example.test/other"),/Unexpected shared MCP endpoint/);
  assert.equal(tokens,0);
  assert.equal(network,0);
});
test("unsecured remote HTTP and invalid bearer are rejected",async()=>{
  assert.throws(()=>createTaskBearerFetch("http://mcp.example.test/mcp",()=> "a"));
  const fn=createTaskBearerFetch("http://127.0.0.1:8097/mcp",()=> "Bearer injected");
  await assert.rejects(fn("http://127.0.0.1:8097/mcp"),/invalid private task bearer/);
});
