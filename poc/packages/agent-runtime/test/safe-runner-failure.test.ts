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
      {path:"tests/fix.test.ts",line:4,column:7,code:"TS2304"}]
  });
  assert.deepEqual(safeRunnerFailureDetails(raw),{first_failed_phase:"typecheck"});
  assert.ok(!JSON.stringify(safeRunnerFailedPhaseHint(actual))
    .includes("SECRET_FILE_CONTENT"));
});
