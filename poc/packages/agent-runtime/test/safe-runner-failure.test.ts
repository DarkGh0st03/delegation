import test from "node:test";
import assert from "node:assert/strict";
import {safeRunnerFailureDetails,safeRunnerFailedPhaseHint}
  from "../src/safe-runner-failure.ts";
test("Only same Task read grants reveal sanitized compiler locations",()=>{
  const raw={phases:[{phase:"typecheck",status:"fail"}],
    typecheck_diagnostics:[
      {path:"tests/fix.test.ts",line:4,column:7,code:"TS2304"},
      {path:"apps/backend/src/private.ts",line:3,column:1,code:"TS2322"},
      {path:"tests/fix.test.ts",line:6,column:1,code:"TS7006",
        raw_source:"SECRET_FILE_CONTENT"}
    ]};
  const actual=safeRunnerFailureDetails(raw,["tests/fix.test.ts"]);
  assert.deepEqual(actual,{first_failed_phase:"typecheck",
    typecheck_diagnostics:[
      {path:"tests/fix.test.ts",line:4,column:7,code:"TS2304"}],
    repair_requires_new_approval:true,
    typecheck_scope_summary:{parsed_locations:2,missing_read_grants:1,
      missing_write_grants:2}
  });
  assert.deepEqual(safeRunnerFailureDetails(raw),{
    first_failed_phase:"typecheck",repair_requires_new_approval:true,
    typecheck_scope_summary:{parsed_locations:2,missing_read_grants:2,
      missing_write_grants:2}
  });
  assert.ok(!JSON.stringify(safeRunnerFailedPhaseHint(actual))
    .includes("SECRET_FILE_CONTENT"));
});

test("TypeScript repair needs both signed read and update rights",()=>{
  const local="tests/fix.test.ts",outside="apps/frontend/private.tsx";
  const raw={phases:[{phase:"typecheck",status:"fail"}],typecheck_diagnostics:[
    {path:local,line:2,column:3,code:"TS2304"},
    {path:outside,line:4,column:5,code:"TS2322"}
  ]};
  const scoped=safeRunnerFailureDetails(raw,[local],[local]);
  assert.deepEqual(scoped,{first_failed_phase:"typecheck",
    typecheck_diagnostics:[{path:local,line:2,column:3,code:"TS2304"}],
    repair_requires_new_approval:true,
    typecheck_scope_summary:{parsed_locations:2,missing_read_grants:1,
      missing_write_grants:1}});
  assert.deepEqual(safeRunnerFailedPhaseHint(scoped)?.typecheck_scope_summary,{
    parsed_locations:2,missing_read_grants:1,missing_write_grants:1});
  assert.equal(safeRunnerFailedPhaseHint({
    first_failed_phase:"typecheck",repair_requires_new_approval:true,
    typecheck_scope_summary:{parsed_locations:1,missing_read_grants:2,
      missing_write_grants:0}
  })?.typecheck_scope_summary,undefined);
  assert.ok(!JSON.stringify(scoped).includes(outside));
  const onlyLocal={...raw,typecheck_diagnostics:[raw.typecheck_diagnostics[0]]};
  assert.equal(safeRunnerFailureDetails(onlyLocal,[local],[local])
    ?.repair_requires_new_approval,undefined);
  assert.equal(safeRunnerFailureDetails(onlyLocal,[local],[])
    ?.repair_requires_new_approval,true);
  assert.equal(safeRunnerFailedPhaseHint({
    first_failed_phase:"typecheck",repair_requires_new_approval:true,
    secret:"PRIVATE"
  })?.repair_requires_new_approval,true);
});

test("Frontend Vitest metadata is disclosed only for signed read paths",()=>{
  const allowed="tests/frontend/suspension.test.tsx",
    outside="tests/frontend/private.test.ts";
  const result={phases:[{phase:"frontend_tests",status:"fail"}],
    failing_test_files:[allowed,outside],
    hidden:"SECRET_ASSERTION_TEXT"};
  assert.deepEqual(safeRunnerFailureDetails(result,[allowed],[allowed]),{
    first_failed_phase:"frontend_tests",
    failing_test_files:[allowed],
    repair_requires_new_approval:true
  });
  assert.deepEqual(safeRunnerFailureDetails(result,[],[]),{
    first_failed_phase:"frontend_tests",
    repair_requires_new_approval:true
  });
  assert.deepEqual(safeRunnerFailureDetails({
    ...result,failing_test_files:[allowed]
  },[allowed],[allowed]),{
    first_failed_phase:"frontend_tests",
    failing_test_files:[allowed]
  });
  assert.deepEqual(safeRunnerFailedPhaseHint({
    first_failed_phase:"frontend_tests",
    failing_test_files:[allowed,outside],
    repair_requires_new_approval:true,
    hidden:"NEVER_LEAK_RUNNER_LOG"
  }),{
    first_failed_phase:"frontend_tests",
    failing_test_files:[allowed,outside],
    repair_requires_new_approval:true
  });
});

test("Untrusted typecheck scope metadata with extra fields never leaves the sanitizer",()=>{
  const secret="NEVER_PUBLISH_UNAPPROVED_TYPECHECK_SOURCE";
  const hint=safeRunnerFailedPhaseHint({
    first_failed_phase:"typecheck",
    repair_requires_new_approval:true,
    typecheck_scope_summary:{
      parsed_locations:1,missing_read_grants:1,missing_write_grants:1,
      source:secret
    }
  });
  assert.deepEqual(hint,{
    first_failed_phase:"typecheck",repair_requires_new_approval:true
  });
  assert.equal(JSON.stringify(hint).includes(secret),false);
});


test("Fileless TypeScript errors reach Test as bounded code-only metadata",()=>{
  const secret="NEVER_EXPOSE_RAW_COMPILER_MESSAGE";
  const codes=["TS2304","TS2688"];
  const raw={phases:[{phase:"typecheck",status:"fail"}],
    typecheck_error_codes:codes,untrusted_error_message:secret};
  const safe=safeRunnerFailureDetails(raw,[],[]);
  assert.deepEqual(safe,{first_failed_phase:"typecheck",
    typecheck_error_codes:codes});
  assert.deepEqual(safeRunnerFailedPhaseHint({...safe,
    injected_source:secret}),safe);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.deepEqual(safeRunnerFailureDetails({...raw,
    typecheck_error_codes:["TS2688","TS2304"]}),{
      first_failed_phase:"typecheck"});
  assert.deepEqual(safeRunnerFailureDetails({...raw,
    phases:[{phase:"frontend_tests",status:"fail"}]}),{
    first_failed_phase:"frontend_tests"});
  assert.deepEqual(safeRunnerFailedPhaseHint({
    first_failed_phase:"typecheck",
    typecheck_error_codes:["TS2304;"+secret]}),{
    first_failed_phase:"typecheck"});
});
