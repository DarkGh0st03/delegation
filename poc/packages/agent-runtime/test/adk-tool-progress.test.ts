import assert from "node:assert/strict";
import test from "node:test";
import {AdkToolProgress} from "../src/adk-tool-progress.ts";
import {SPECIALIZED_AGENT_PROFILES} from "../src/specialized-agents.ts";

const ok=(name:"read_file"|"update_file",path:string)=>({
  name,arguments:{branch:"feature/account-suspension",path},
  payload:{ok:true as const,result:{provider:"synthetic"}}
});
const fail=(name:"read_file"|"update_file",path:string)=>({
  name,arguments:{branch:"feature/account-suspension",path},
  payload:{ok:false as const,error:{kind:"invalid_tool_call" as const,message:"synthetic error"}}
});

test("aggregate distinguishes legitimate different reads from duplicate reads",()=>{
  const progress=new AdkToolProgress();
  const secretPath="NEVER_ECHO_PRIVATE_FILENAME";
  progress.observe(ok("read_file","apps/backend/src/users/user.service.ts"));
  progress.observe(ok("read_file","apps/backend/src/users/user.model.ts"));
  progress.observe(ok("read_file","apps/backend/src/users/user.service.ts"));
  progress.observe(ok("read_file",secretPath));
  progress.observe(fail("read_file","outside.txt"));
  progress.observe(ok("update_file","apps/backend/src/users/user.service.ts"));
  progress.observe(fail("update_file","outside.txt"));
  const metrics=progress.snapshot();
  assert.deepEqual(metrics,{
    successful_reads:4,distinct_read_paths:3,duplicate_reads:1,
    failed_reads:1,successful_writes:1,failed_writes:1
  });
  assert.equal(JSON.stringify(metrics).includes(secretPath),false);
});

test("all ADK role prompts encourage bounded investigation and safe full-file writes",()=>{
  for(const role of ["backend","frontend","test"] as const){
    const prompt=SPECIALIZED_AGENT_PROFILES[role].system_prompt;
    assert.match(prompt,/do not reread an unchanged file/i);
    assert.match(prompt,/REPLACES the entire target file/i);
    assert.match(prompt,/Never attempt to bypass an authorization denial/i);
  }
});
