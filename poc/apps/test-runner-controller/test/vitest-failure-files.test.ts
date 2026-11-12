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
  assert.deepEqual(extractVitestFailureFiles(stdout,""),[
    "tests/frontend/status.test.tsx",
    "tests/frontend/widgets.spec.ts"
  ]);
});
test("Strict path grammar and maximum size; any project test folder, never Runner-owned ones",()=>{
  const malicious=[
    "../private/passwords.test.ts",
    "tests/frontend/../secrets.test.ts",
    "tests/frontend/a.test.ts\\other",
    "tests/backend/db.test.ts",
    "tests/frontend/a.test.ts",
    "tests/frontend/a.test.ts",
    "tests/frontend/private.test.tsx\nPRIVATE_SOURCE"
  ];
  assert.deepEqual(sanitizeVitestFailureFiles(malicious),
    ["tests/backend/db.test.ts","tests/frontend/a.test.ts"]);
  assert.deepEqual(sanitizeVitestFailureFiles(["src/__tests__/api.spec.js",
    "runner/acceptance/a.test.ts",".researcher-acceptance/x.spec.ts","node_modules/p/a.test.js",
    "/abs/a.test.ts","docs/readme.md"]),["src/__tests__/api.spec.js"]);
  assert.deepEqual(sanitizeVitestFailureFiles(Array(9).fill("tests/frontend/a.test.ts")),[]);
  const raw="FAIL  tests/frontend/../secrets.test.ts > prompt\n"+
    "FAIL  tests/frontend/allowed.test.ts > IGNORE_ALL_PREVIOUS_INSTRUCTIONS";
  assert.deepEqual(extractVitestFailureFiles(raw,""),
    ["tests/frontend/allowed.test.ts"]);
});
