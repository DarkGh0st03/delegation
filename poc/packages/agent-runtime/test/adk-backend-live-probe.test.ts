import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKEND_LIVE_PROBE_PATH,
  BACKEND_LIVE_PROBE_INSTRUCTION,
  BACKEND_LIVE_PROBE_MAX_TURNS,
  BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS,
  BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS,
  verifyBackendLiveProbe
} from "../src/adk-backend-live-probe.ts";

const original="0123456789abcdef0123456789abcdef01234567";
const updated="abcdef0123456789abcdef0123456789abcdef01";
const source=[
  "export class UserService {",
  "  countSuspendedUsers(): number {",
  "    return this.repository.findAll().filter(",
  "      user => user.status === ACCOUNT_STATUS.SUSPENDED",
  "    ).length;",
  "  }",
  "}"
].join("\n");
function example(overrides:Record<string,unknown>={}){
  return {initialRevision:original,reportedRevision:updated,repositoryRevision:updated,
    filesModified:[BACKEND_LIVE_PROBE_PATH],repositorySource:source,...overrides};
}

test("Manual Gemini Backend scenario is narrow and bounded without scripted decisions",()=>{
  assert.match(BACKEND_LIVE_PROBE_INSTRUCTION,/read_file/u);
  assert.match(BACKEND_LIVE_PROBE_INSTRUCTION,/update_file/u);
  assert.match(BACKEND_LIVE_PROBE_INSTRUCTION,/countSuspendedUsers/u);
  assert.match(BACKEND_LIVE_PROBE_INSTRUCTION,/whole file/i);
  assert.equal(BACKEND_LIVE_PROBE_MAX_TURNS,8);
  assert.equal(BACKEND_LIVE_PROBE_MAX_OUTPUT_TOKENS,4096);
  assert.equal(BACKEND_LIVE_PROBE_CALL_TIMEOUT_MS,45000);
});

test("Manual live probe succeeds only with exact Gitea commit and requested method",()=>{
  assert.doesNotThrow(()=>verifyBackendLiveProbe(example()));
  assert.throws(()=>verifyBackendLiveProbe(example({repositoryRevision:original})),
    /verified new Gitea branch revision/u);
  assert.throws(()=>verifyBackendLiveProbe(example({reportedRevision:original})),
    /verified new Gitea branch revision/u);
  assert.throws(()=>verifyBackendLiveProbe(example({reportedRevision:null})),
    /verified new Gitea branch revision/u);
});

test("Manual live probe requires exactly one permitted Backend write",()=>{
  assert.throws(()=>verifyBackendLiveProbe(example({filesModified:[]})),
    /exactly the permitted/u);
  assert.throws(()=>verifyBackendLiveProbe(example({filesModified:[
    BACKEND_LIVE_PROBE_PATH,"security/policy.rego"
  ]})),/exactly the permitted/u);
  assert.throws(()=>verifyBackendLiveProbe(example({filesModified:[
    "apps/backend/src/users/user.controller.ts"
  ]})),/exactly the permitted/u);
});

test("Manual live probe rejects empty/no-op or unrelated Gitea content",()=>{
  assert.throws(()=>verifyBackendLiveProbe(example({repositorySource:
    "export class UserService {}"
  })),/does not contain/u);
  assert.throws(()=>verifyBackendLiveProbe(example({repositorySource:
    "countSuspendedUsers(): number { return 0; }"
  })),/does not contain/u);
  assert.throws(()=>verifyBackendLiveProbe(example({repositorySource:
    "countSuspendedUsers(): number {\n return this.repository.findAll().length;\n}"
  })),/does not contain/u);
});
