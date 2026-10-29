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
    repair_requires_new_approval:true
  });
  assert.deepEqual(safeRunnerFailureDetails(raw),{
    first_failed_phase:"typecheck",repair_requires_new_approval:true
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
    repair_requires_new_approval:true});
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
