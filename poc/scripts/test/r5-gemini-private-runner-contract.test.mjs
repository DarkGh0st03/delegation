import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const workflowUrl=new URL("../../../.github/workflows/trusted-gemini-private-session-hold.yml",import.meta.url);
const holdUrl=new URL("../../apps/orchestrator/src/hold-private-github-session.mjs",import.meta.url);
const registerUrl=new URL("../r5-gemini-private-dispatch-registration.mjs",import.meta.url);

test("paid Gemini private workflow is separate, explicit, self-hosted and never infers on runner",async()=>{
  const y=await readFile(workflowUrl,"utf8");
  assert.match(y,/workflow_dispatch:/);
  assert.match(y,/environment: r5-private-gemini-admission/);
  assert.match(y,/runs-on: \[self-hosted, linux, x64, delegation-private\]/);
  assert.match(y,/id-token: write/);
  assert.match(y,/github\.run_attempt == 1/);
  assert.match(y,/inputs\.authorization == 'I AUTHORIZE GEMINI API CHARGES'/);
  assert.match(y,/inputs\.model == 'gemini-3\.8-flash'/);
  assert.match(y,/timeout-minutes: 75/);
  assert.doesNotMatch(y,/actions\/checkout@|actions\/setup-node@/);
  assert.doesNotMatch(y,/npm (?:ci|install)|geminiApiKey|GEMINI_API_KEY|a2a-production-coordinator/);
  const reg=y.indexOf("r5-gemini-private-dispatch-registration.mjs");
  const hold=y.indexOf("hold-private-github-session.mjs");
  assert.ok(reg>0&&hold>reg,"registration must precede OIDC admission");
});

test("private paid hold rechecks the pinned immutable install in the OIDC process",async()=>{
  const s=await readFile(holdUrl,"utf8");
  const config=s.indexOf("loadProtectedRunnerOidcConfig(");
  const integrity=s.indexOf("await verifyProtectedPrivateRunnerInstallation({");
  const admission=s.indexOf("await submitProtectedPrivateRunnerAdmission()");
  assert.ok(config>=0&&integrity>config&&admission>integrity);
  assert.match(s,/trusted\.expectedWorkflowPath!==/);
  assert.match(s,/trusted-gemini-private-session-hold\.yml/);
  const registration=await readFile(registerUrl,"utf8");
  assert.match(registration,/verifyProtectedPrivateRunnerInstallation/);
  assert.match(registration,/DELEGATION_RUNNER_OIDC_CONFIG/);
  assert.match(registration,/trusted-gemini-private-session-hold\.yml/);
  assert.doesNotMatch(registration,/startAdmittedGithubReviewedGeminiHandoff|generateContentAsync|createGeminiAdkModel/);
});

test("paid Gemini hold executes only pinned reviewed commands and fixed runner-only receipt",async()=>{
  const y=await readFile(workflowUrl,"utf8");
  // No marketplace action, container image or new executable shell step may
  // acquire the paid job identity. This is a deliberately narrow contract.
  assert.doesNotMatch(y,/^\s*(?:-\s*)?(?:uses|container)\s*:/mu);
  const runLines=y.split(/\r?\n/u)
    .filter(line=>/^\s+run:\s*/u.test(line))
    .map(line=>line.trim());
  assert.deepEqual(runLines,[
    "run: node --experimental-strip-types /opt/delegation/r5/poc/scripts/r5-gemini-private-dispatch-registration.mjs",
    "run: node --experimental-strip-types /opt/delegation/r5/poc/apps/orchestrator/src/hold-private-github-session.mjs",
    "run: |"
  ]);
  // Disallow a future unreviewed multiline command even when it is placed
  // under the already permitted final reporting step.
  const reportingMarker="        run: |\n";
  assert.equal(y.split(reportingMarker).length,2);
  assert.deepEqual(y.split(reportingMarker)[1].trimEnd().split(/\r?\n/u),[
    '          echo "Original Engineer Host independently confirmed approved DAG and root closure."',
    '          echo "This runner had no model key, no Engineer signing key and no authority to merge."'
  ]);
});
