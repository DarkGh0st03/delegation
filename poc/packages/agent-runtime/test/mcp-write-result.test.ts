import test from "node:test";
import assert from "node:assert/strict";
import {parseUpdateFileArgs,MAX_MCP_UPDATE_BYTES} from "../../../mcp-shared/src/catalog.ts";
import {normalizeMcpUpdateFileOutcome} from "../src/mcp-write-result.ts";

const args={branch:"feature/account-suspension",path:"apps/backend/src/users/user.service.ts",content:"export class UserService {}"};
const sha="b".repeat(40);
const result={
  provider:"gitea",performed:true,tool:"update_file",
  branch:args.branch,path:args.path,revision:sha,commit_sha:sha,
  blob_sha:"a".repeat(40),precondition_blob_sha:"c".repeat(40)
};
test("MCP update input rejects traversal, extra parameters and oversized source",()=>{
  assert.deepEqual(parseUpdateFileArgs(args),args);
  for(const bad of [
    {...args,path:"../secret"},
    {...args,path:"/etc/passwd"},
    {...args,path:"apps\\secret.ts"},
    {...args,path:"apps//secret.ts"},
    {...args,branch:"main"},
    {...args,authority:"different"},
    {...args,content:0},
    {...args,content:"é".repeat(MAX_MCP_UPDATE_BYTES/2+1)}
  ]){
    assert.throws(()=>parseUpdateFileArgs(bad),/invalid_tool_arguments/);
  }
});
test("MCP update requires Gateway-confirmed exact Gitea commit and blob precondition",()=>{
  const valid=normalizeMcpUpdateFileOutcome({
    isError:false,structuredContent:{ok:true,result}
  },args);
  assert.deepEqual(valid,{ok:true,result});
  // The exact same provider-verified commit must survive a text-only MCP
  // ToolResult; an isError result or model prose cannot forge success.
  assert.deepEqual(normalizeMcpUpdateFileOutcome({
    content:[{type:"text",text:JSON.stringify({ok:true,result})}]
  },args),{ok:true,result});
  assert.equal(normalizeMcpUpdateFileOutcome({
    isError:true,content:[{type:"text",text:JSON.stringify({ok:true,result})}]
  },args).ok,false);
  assert.equal(normalizeMcpUpdateFileOutcome({
    content:[{type:"text",text:"Updated successfully"}]
  },args).ok,false);
  assert.equal(normalizeMcpUpdateFileOutcome({
    content:[{type:"text",text:JSON.stringify({ok:true,result:{
      ...result,precondition_blob_sha:undefined
    }})}]
  },args).ok,false);
  const cases=[
    {...result,provider:"mock"},
    {...result,tool:"create_file"},
    {...result,path:"unexpected"},
    {...result,commit_sha:"not-a-sha"},
    {...result,revision:"d".repeat(40)},
    {...result,blob_sha:undefined},
    {...result,precondition_blob_sha:undefined}
  ];
  for(const candidate of cases){
    assert.deepEqual(normalizeMcpUpdateFileOutcome({
      isError:false,structuredContent:{ok:true,result:candidate}
    },args).ok,false);
  }
  assert.deepEqual(normalizeMcpUpdateFileOutcome({
    isError:true,structuredContent:{ok:false,error:{kind:"authorization_denied"}}
  },args).ok,false);
  // Exact MCP transport error kind is preserved without ever accepting an
  // isError ToolResult as proof of a committed update.
  for(const kind of ["authorization_denied","invalid_tool_call",
    "task_worker_invalid_result","task_worker_rejected",
    "task_worker_unavailable"]){
    const response={isError:true,content:[{type:"text",text:JSON.stringify({
      ok:false,error:{kind}
    })}]};
    const normalized=normalizeMcpUpdateFileOutcome(response,args);
    assert.equal(normalized.ok,false);
    assert.equal(normalized.error.kind,
      kind==="authorization_denied"?"authorization_denied":
      kind==="invalid_tool_call"?"invalid_tool_call":"tool_unavailable");
  }
  assert.equal(normalizeMcpUpdateFileOutcome({
    isError:true,content:[{type:"text",text:JSON.stringify({
      ok:true,result
    })}]
  },args).ok,false);
  // Model prose or an unstructured success claim is never a commit.
  assert.deepEqual(normalizeMcpUpdateFileOutcome({ok:true,result},args).ok,false);
});
