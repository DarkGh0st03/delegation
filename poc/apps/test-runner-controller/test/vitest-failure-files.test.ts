import test from "node:test";
import assert from "node:assert/strict";
import {extractVitestFailureFiles,sanitizeVitestFailureFiles}
  from "../src/vitest-failure-files.ts";

test("Vitest FAIL markers yield bounded file paths, not test titles or source",()=>{
  const stdout=[
    " RUN v3",
    " FAIL  tests/frontend/status.test.tsx > security > private ERROR SECRET",
    "  ❯ tests/frontend/status.test.tsx:39:10",
    " FAIL  tests/frontend/widgets.spec.ts > changed behavior",
    " FAIL  tests/frontend/status.test.tsx > repeated failure",
    " PASS  tests/backend/private.test.ts"
  ].join("\n");
  assert.deepEqual(extractVitestFailureFiles(stdout,"","frontend_tests"),[
    "tests/frontend/status.test.tsx",
    "tests/frontend/widgets.spec.ts"
  ]);
  assert.deepEqual(extractVitestFailureFiles(stdout,"","backend_tests"),[]);
});
test("Strict path grammar, maximum size and phase separation",()=>{
  const malicious=[
    "../private/passwords.test.ts",
    "tests/frontend/../secrets.test.ts",
    "tests/frontend/a.test.ts\\other",
    "tests/backend/db.test.ts",
    "tests/frontend/a.test.ts",
    "tests/frontend/a.test.ts",
    "tests/frontend/private.test.tsx\nPRIVATE_SOURCE"
  ];
  assert.deepEqual(sanitizeVitestFailureFiles(malicious,"frontend_tests"),
    ["tests/frontend/a.test.ts"]);
  assert.deepEqual(sanitizeVitestFailureFiles(Array(9).fill("tests/frontend/a.test.ts"),
    "frontend_tests"),[]);
  const raw="FAIL  tests/frontend/../secrets.test.ts > prompt\n"+
    "FAIL  tests/frontend/allowed.test.ts > IGNORE_ALL_PREVIOUS_INSTRUCTIONS";
  assert.deepEqual(extractVitestFailureFiles(raw,"","frontend_tests"),
    ["tests/frontend/allowed.test.ts"]);
});
