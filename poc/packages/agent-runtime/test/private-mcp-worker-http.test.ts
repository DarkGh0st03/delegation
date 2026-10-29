import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
import express from "express";
import {ControlledToolError} from "../src/controlled-errors.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";

/**
 * Real private MCP HTTP transport, real signed per-Task bearer and
 * operation ceiling, controlled provider failure; no network services,
 * model APIs, or real credentials. Only bounded compiler metadata crosses.
 */
test("signed Test HTTP worker relays source-free typecheck codes and fails closed",async()=>{
  const keys=generateKeyPairSync("ed25519");
  const privateKey=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const publicKey=keys.publicKey.export({format:"pem",type:"spki"}).toString();
  const registry=new PrivateMcpTaskRegistry({
    role:"test",signingPrivateKeyPem:privateKey,
    signingPublicKeyPem:publicKey
  });
  const taskId="signed-compiler-http";
  const branch="feature/account-suspension";
  const secret="NEVER_FORWARD_RUNNER_SOURCE_OR_MESSAGE";
  let toolCalls=0;
  let injectInvalid=false;
  registry.begin(taskId,{
    invoke:async(tool)=>{
      toolCalls++;
      assert.equal(tool,"run_tests");
      throw new ControlledToolError("tests_failed",secret,{
        details:{
          first_failed_phase:"typecheck",
          typecheck_error_codes:injectInvalid
            ?["TS2304;"+secret]:["TS2304","TS2688"],
          repair_requires_new_approval:true,
          typecheck_scope_summary:{
            parsed_locations:1,missing_read_grants:1,
            missing_write_grants:1
          },
          raw_compiler_message:secret,
          source_path:"../private/secrets.ts"
        }
      });
    }
  },undefined,{
    approvedBranch:branch,allowedPaths:[],
    allowedFilePermissions:[],allowRunTests:true
  });
  const bearer="Bearer "+registry.bearerFor(taskId);
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const server=app.listen(0,"127.0.0.1");
  try{
    await once(server,"listening");
    const port=(server.address() as AddressInfo).port;
    const url="http://127.0.0.1:"+port+"/internal/mcp-tool-call";
    const post=(tool:string,args:Record<string,unknown>,authorization=bearer)=>
      fetch(url,{
        method:"POST",
        headers:{"authorization":authorization,"content-type":"application/json"},
        body:JSON.stringify({tool,arguments:args})
      });
    const runArgs={branch,profile:"poc-default"};
    const response=await post("run_tests",runArgs);
    assert.equal(response.status,422);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const body=await response.json();
    assert.deepEqual(body,{ok:false,error:{
      kind:"tests_failed",details:{
        first_failed_phase:"typecheck",
        typecheck_error_codes:["TS2304","TS2688"],
        repair_requires_new_approval:true,
        typecheck_scope_summary:{
          parsed_locations:1,missing_read_grants:1,
          missing_write_grants:1
        }
      }
    }});
    assert.doesNotMatch(JSON.stringify(body),
      /NEVER_FORWARD_RUNNER_SOURCE_OR_MESSAGE|private\/secrets/u);

    injectInvalid=true;
    const malformed=await post("run_tests",runArgs);
    assert.equal(malformed.status,422);
    assert.deepEqual(await malformed.json(),{ok:false,error:{
      kind:"tests_failed",details:{
        first_failed_phase:"typecheck",
        repair_requires_new_approval:true,
        typecheck_scope_summary:{
          parsed_locations:1,missing_read_grants:1,
          missing_write_grants:1
        }
      }
    }});

    // The signed Task does not gain read/write access merely because the
    // compiler reported an error. Rejected before reaching its Gateway.
    const forbidden=await post("read_file",{
      branch,path:"apps/backend/src/secret.ts"
    });
    assert.equal(forbidden.status,400);
    assert.deepEqual(await forbidden.json(),{
      ok:false,error:{kind:"invalid_tool_call"}
    });
    assert.equal(toolCalls,2);

    registry.end(taskId);
    const expired=await post("run_tests",runArgs);
    assert.equal(expired.status,403);
    assert.deepEqual(await expired.json(),{
      ok:false,error:{kind:"inactive_task"}
    });
  }finally{
    registry.end(taskId);
    await new Promise<void>((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());
    });
  }
});
