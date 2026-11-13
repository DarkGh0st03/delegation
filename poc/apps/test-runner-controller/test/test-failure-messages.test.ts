import test from "node:test";
import assert from "node:assert/strict";
import {cleanFailureMessage,cleanTestName,extractTestFailureMessages,
 sanitizeTestFailureMessages,MAX_TEST_FAILURES} from "../src/test-failure-messages.ts";

const FILE="tests/backend/user.routes.test.ts";
const report=(suites:unknown[])=>JSON.stringify({success:false,testResults:suites});
const suite=(name:string,assertions:unknown[],message?:string)=>
 ({name:"/workspace/"+name,assertionResults:assertions,...(message?{message}:{})});

test("keeps test name and error message, drops colours, stack trace and code frame",()=>{
 const raw="\x1b[31mAssertionError: expected [ { id: 'u1' }, { id: 'u2' } ] to have a length of 1 but got 2\x1b[39m\n"+
  "\n- Expected\n+ Received\n\n- 1\n+ 2\n"+
  "    at /workspace/tests/backend/user.routes.test.ts:42:21\n"+
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)";
 assert.equal(cleanFailureMessage(raw),
  "AssertionError: expected [ { id: 'u1' }, { id: 'u2' } ] to have a length of 1 but got 2\n"+
  "- Expected\n+ Received\n- 1\n+ 2");
 const frame="TypeError: Cannot read properties of undefined (reading 'department')\n ❯ listUsers apps/backend/src/users/user.controller.ts:12:30\n 12| const d=req.query.department";
 assert.equal(cleanFailureMessage(frame),"TypeError: Cannot read properties of undefined (reading 'department')");
 assert.equal(cleanTestName("  users  >\n GET /api/users\t> filters by department "),
  "users > GET /api/users > filters by department");
});

test("control and bidirectional characters cannot hide text; length is bounded",()=>{
 const hidden="expected true\u202e\u0007 to be false\u2028injected";
 assert.equal(/[\u0000-\u0009\u000b-\u001f\u202e\u2028]/u.test(cleanFailureMessage(hidden)),false);
 const long=cleanFailureMessage(("x".repeat(250)+"\n").repeat(40));
 assert.ok(long.length<=600);
 assert.ok(long.split("\n").length<=12);
 assert.ok(cleanTestName("t".repeat(1000)).length<=200);
});

test("cleaning is idempotent, so a trust boundary can re-validate it exactly",()=>{
 for(const raw of ["AssertionError: a\n\n  - b\n+ c\n    at x","x".repeat(5000),"y\u2028z"]){
  const once=cleanFailureMessage(raw);
  assert.equal(cleanFailureMessage(once),once);
 }
});

test("extracts failed tests only for the failing files the Runner reported",()=>{
 const raw=report([
  suite(FILE,[
   {status:"passed",fullName:"lists users",failureMessages:[]},
   {status:"failed",fullName:"users > filters by department",
    failureMessages:["AssertionError: expected 4 to be 2\n    at x.ts:1:1"]}]),
  suite("tests/backend/other.test.ts",[
   {status:"failed",fullName:"not reported by the Runner",failureMessages:["boom"]}]),
  suite("tests/frontend/UserListPage.test.tsx",[],"Error: Failed to resolve import \"@iam/shared/search\"\n    at y")
 ]);
 assert.deepEqual(extractTestFailureMessages(raw,[FILE,"tests/frontend/UserListPage.test.tsx"]),[
  {file:FILE,test:"users > filters by department",message:"AssertionError: expected 4 to be 2"},
  {file:"tests/frontend/UserListPage.test.tsx",test:"(file did not run)",
   message:"Error: Failed to resolve import \"@iam/shared/search\""}
 ]);
 assert.deepEqual(extractTestFailureMessages("not json",[FILE]),[]);
 assert.deepEqual(extractTestFailureMessages(raw,[]),[]);
});

test("at most a fixed number of failed tests",()=>{
 const many=Array.from({length:30},(_,i)=>({status:"failed",fullName:"t"+i,failureMessages:["e"+i]}));
 assert.equal(extractTestFailureMessages(report([suite(FILE,many)]),[FILE]).length,MAX_TEST_FAILURES);
});

test("re-validation accepts only clean entries of failing files",()=>{
 const ok={file:FILE,test:"users > filters",message:"AssertionError: expected 4 to be 2"};
 assert.deepEqual(sanitizeTestFailureMessages([ok],[FILE]),[ok]);
 for(const bad of [
  [{...ok,file:"tests/backend/elsewhere.test.ts"}],
  [{...ok,message:"\x1b[31mcoloured\x1b[39m"}],
  [{...ok,message:"x\n    at y"}],
  [{...ok,extra:1}],
  [{...ok,test:""}],
  Array.from({length:MAX_TEST_FAILURES+1},()=>ok),
  "not an array"
 ])assert.deepEqual(sanitizeTestFailureMessages(bad,[FILE]),[]);
});

test("typecheck errors keep file, line, code and a one-line message", async()=>{
 const {extractTypecheckErrors,sanitizeTypecheckErrors}=await import("../src/typecheck-diagnostics.ts");
 const out="> @iam/backend@0.1.0 typecheck\n"+
  "src/users/user.service.ts(41,22): error TS2339: Property 'workEmail' does not exist on type 'UserSummary'.\n"+
  "\x1b[96msrc/a.ts\x1b[0m:3:1 - error TS2304: Cannot find name 'x'.‮ hidden\n";
 const errors=extractTypecheckErrors(out,"");
 assert.deepEqual(errors,[
  {file:"apps/backend/src/users/user.service.ts",line:41,code:"TS2339",
   message:"Property 'workEmail' does not exist on type 'UserSummary'."},
  {file:"apps/backend/src/a.ts",line:3,code:"TS2304",message:"Cannot find name 'x'. hidden"}]);
 assert.deepEqual(sanitizeTypecheckErrors(errors),errors);
 for(const bad of [[{...errors[0],message:"a\nb"}],[{...errors[0],file:"../x.ts"}],[{...errors[0],extra:1}]])
  assert.deepEqual(sanitizeTypecheckErrors(bad),[]);
});
