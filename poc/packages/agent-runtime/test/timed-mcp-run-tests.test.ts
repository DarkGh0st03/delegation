import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import type {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {MCP_RUN_TESTS_TIMEOUT_MS,requestTimedMcpRunTests}
  from "../src/timed-mcp-run-tests.ts";

const args={branch:"feature/account-suspension",profile:"poc-default"} as const;

test("long-running MCP run_tests sends 930s timeout instead of SDK's 60s default",async()=>{
  const seen:{request?:unknown;options?:unknown}={};
  const fake={
    callTool:async (request:unknown,_schema:unknown,options:unknown)=>{
      seen.request=request;seen.options=options;
      return {content:[],structuredContent:{ok:false,error:{kind:"tests_failed"}}};
    }
  } as unknown as Pick<Client,"callTool">;
  const result=await requestTimedMcpRunTests(fake,args);
  assert.deepEqual(seen.request,{name:"run_tests",arguments:args});
  assert.deepEqual(seen.options,{timeout:930_000});
  assert.ok(result.structuredContent);
  assert.equal(MCP_RUN_TESTS_TIMEOUT_MS,930_000);
});

test("long-running MCP request propagates task abort and rejects already aborted calls",async()=>{
  const controller=new AbortController();
  let calls=0;
  const fake={callTool:async (_request:unknown,_schema:unknown,options:unknown)=>{
    calls++;
    const settings=options as {timeout:number;signal:AbortSignal};
    assert.equal(settings.signal,controller.signal);
    assert.equal(settings.timeout,930_000);
    return {content:[]};
  }} as unknown as Pick<Client,"callTool">;
  await requestTimedMcpRunTests(fake,args,controller.signal);
  assert.equal(calls,1);
  controller.abort();
  await assert.rejects(requestTimedMcpRunTests(fake,args,controller.signal));
  assert.equal(calls,1);
});

test("invalid timeout fails before any MCP tool call",async()=>{
  let calls=0;
  const handler=async()=>{calls++;return {content:[]};};
  const fake={callTool:handler} as unknown as Pick<Client,"callTool">;
  await assert.rejects(requestTimedMcpRunTests(fake,args,undefined,0));
  await assert.rejects(requestTimedMcpRunTests(fake,args,undefined,930_001));
  assert.equal(calls,0);
});

test("live Test Agent routes run_tests through explicit MCP timeout, not native 60s wrapper",async()=>{
  const file=await readFile(new URL("../src/adk-specialized-agents.ts",import.meta.url),"utf8");
  assert.match(file,/callTimedMcpRunTests\(/);
  assert.match(file,/name:"run_tests"/);
  assert.doesNotMatch(file,/\.\.\.\(config\.mcpRunTests \? \["run_tests"\] : \[\]\)/);
  assert.match(file,/createTaskBearerFetch/);
});
