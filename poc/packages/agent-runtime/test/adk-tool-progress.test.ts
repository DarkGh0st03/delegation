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

test("Legacy approval referral without a failed phase remains terminal",()=>{
  const progress=new AdkToolProgress();
  progress.observe({name:"run_tests",arguments:{branch:"feature/test"},
    payload:{ok:false,error:{kind:"tests_failed",message:"controlled",
      details:{repair_requires_new_approval:true,
        private_source:"NEVER_EXPOSE_THIS"}}}});
  assert.equal(progress.requiresFreshEngineerApproval,true);
  assert.equal(progress.typecheckScopeSummary,null);
});

test("all ADK role prompts encourage bounded investigation and safe full-file writes",()=>{
  for(const role of ["backend","frontend","test"] as const){
    const prompt=SPECIALIZED_AGENT_PROFILES[role].system_prompt;
    assert.match(prompt,/do not reread an unchanged file/i);
    assert.match(prompt,/REPLACES the entire target file/i);
    assert.match(prompt,/Never attempt to bypass an authorization denial/i);
  }
});

test("A trusted out-of-scope Runner repair remains terminal even after other tools",()=>{
  const progress=new AdkToolProgress();
  const secret="PRIVATE_FILE_DO_NOT_LOG";
  progress.observe({name:"run_tests",arguments:{branch:"feature/test"},
    payload:{ok:false,error:{kind:"tests_failed",message:"controlled error",
      details:{first_failed_phase:"typecheck",repair_requires_new_approval:true,
        typecheck_scope_summary:{parsed_locations:2,missing_read_grants:1,
          missing_write_grants:2},untrusted:secret}}}});
  assert.equal(progress.requiresFreshEngineerApproval,true);
  assert.deepEqual(progress.typecheckScopeSummary,{
    parsed_locations:2,missing_read_grants:1,missing_write_grants:2});
  progress.observe({name:"run_tests",arguments:{branch:"feature/test"},
    payload:{ok:true,result:{status:"pass"}}});
  assert.equal(progress.requiresFreshEngineerApproval,true);
  assert.ok(!JSON.stringify(progress.snapshot()).includes(secret));
  const ordinary=new AdkToolProgress();
  ordinary.observe({name:"run_tests",arguments:{branch:"feature/test"},
    payload:{ok:false,error:{kind:"tests_failed",message:"failed",
      details:{first_failed_phase:"typecheck"}}}});
  assert.equal(ordinary.requiresFreshEngineerApproval,false);
  ordinary.observe({name:"run_tests",arguments:{branch:"feature/test"},
    payload:{ok:false,error:{kind:"tests_failed",message:"failed",
      details:{repair_requires_new_approval:"true"}}}});
  assert.equal(ordinary.requiresFreshEngineerApproval,false);
});
