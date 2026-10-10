import assert from "node:assert/strict";
import test from "node:test";
import {
 BACKEND_LIVE_PROBE_PATHS,
 BACKEND_LIVE_PROBE_INSTRUCTION,
 BACKEND_LIVE_PROBE_MAX_TURNS,
 BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS,
 BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS,
 verifyBackendLiveProbe
} from "../src/adk-backend-live-probe.ts";

const original="0123456789abcdef0123456789abcdef01234567";
const updated="abcdef0123456789abcdef0123456789abcdef01";
const all=[...BACKEND_LIVE_PROBE_PATHS];
function fixture(overrides:Record<string,unknown>={}) {
  return {
    initialRevision:original,reportedRevision:updated,
    repositoryRevision:updated,filesModified:all,verifiedFilePaths:all,
    ...overrides
  };
}

test("Live Backend task restores the complete original four-file Account Suspension scope",()=>{
  assert.equal(BACKEND_LIVE_PROBE_INSTRUCTION,
    "Implement the backend Account Suspension lifecycle and shared status contract.");
  assert.deepEqual(all,[
    "packages/shared/src/account-status.ts",
    "apps/backend/src/users/user.service.ts",
    "apps/backend/src/users/user.controller.ts",
    "apps/backend/src/users/user.routes.ts"
  ]);
  assert.equal(BACKEND_LIVE_PROBE_MAX_TURNS,16);
  assert.equal(BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS,16384);
  assert.equal(BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS,60000);
});

test("Complete Backend writes must be confirmed by an exact new Gitea revision",()=>{
  assert.doesNotThrow(()=>verifyBackendLiveProbe(fixture()));
  assert.throws(()=>verifyBackendLiveProbe(fixture({repositoryRevision:original})),
    /verified new Gitea branch revision/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({reportedRevision:original})),
    /verified new Gitea branch revision/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({reportedRevision:null})),
    /verified new Gitea branch revision/u);
});

test("Full Backend validation never accepts a partial, extra or duplicate file write",()=>{
  assert.throws(()=>verifyBackendLiveProbe(fixture({filesModified:all.slice(0,1)})),
    /exactly the four delegated paths/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({filesModified:[...all,"security/policy.rego"]})),
    /exactly the four delegated paths/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({filesModified:[...all.slice(0,3),all[0]]})),
    /exactly the four delegated paths/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({verifiedFilePaths:all.slice(0,3)})),
    /exactly the four delegated paths/u);
  assert.throws(()=>verifyBackendLiveProbe(fixture({verifiedFilePaths:[...all,"security/policy.rego"]})),
    /exactly the four delegated paths/u);
});
