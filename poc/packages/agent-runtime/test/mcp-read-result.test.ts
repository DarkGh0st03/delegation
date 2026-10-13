import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMcpReadFileOutcome} from "../src/mcp-read-result.ts";
const args={branch:"feature/account-suspension",path:"apps/backend/src/users/user.model.ts"};
const read={provider:"gitea",performed:true,tool:"read_file",...args,
  revision:"a".repeat(40),blob_sha:"b".repeat(40),last_commit_sha:"a".repeat(40),
  size:2,encoding:"utf-8",content:"ok"};
test("only a confirmed matching Gitea MCP read becomes a success",()=>{
  const actual=normalizeMcpReadFileOutcome({
    isError:false,structuredContent:{ok:true,result:read}
  },args);
  assert.deepEqual(actual,{ok:true,result:read});
});
test("MCP denial cannot be converted into a successful read",()=>{
  const actual=normalizeMcpReadFileOutcome({
    isError:true,structuredContent:{ok:false,error:{kind:"authorization_denied"}}
  },args);
  assert.equal(actual.ok,false);
  if(!actual.ok)assert.equal(actual.error.kind,"authorization_denied");
});
test("missing or mismatched structured result fails closed",()=>{
  for(const bad of [
    {content:[{type:"text",text:"ok"}]},
    {structuredContent:{ok:true,result:{...read,path:"other.ts"}}},
    {structuredContent:{ok:true,result:{...read,revision:"garbage"}}},
    {isError:true,structuredContent:{ok:true,result:read}},
    {structuredContent:{ok:true,result:"Gemini says success"}}
  ]){
    const value=normalizeMcpReadFileOutcome(bad,args);
    assert.equal(value.ok,false);
  }
});
