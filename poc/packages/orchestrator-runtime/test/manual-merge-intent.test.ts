import assert from "node:assert/strict";
import test from "node:test";
import {
  validateManualMergeIntent,expectedMergeConfirmation,ManualMergeIntentDenied
} from "../src/manual-merge-intent.ts";

const sha="c".repeat(40);
const good={
  eventName:"workflow_dispatch",actor:"Engineer-03",
  triggeringActor:"Engineer-03",authorizedActor:"Engineer-03",
  ref:"refs/heads/main",pr:"17",sha,
  confirmation:expectedMergeConfirmation(17,sha)
};
function denied(patch:Record<string,unknown>,reason:string){
  assert.throws(()=>validateManualMergeIntent({...good,...patch}),
    (e:unknown)=>e instanceof ManualMergeIntentDenied&&e.reason===reason);
}
test("requires exact manually typed PR, lowercase SHA and operator confirmation",()=>{
  assert.deepEqual(validateManualMergeIntent(good),{
    pullRequestNumber:17,expectedHeadSha:sha,
    authorizedGitHubActor:"Engineer-03"
  });
  assert.equal(expectedMergeConfirmation(17,sha),
    "MERGE PR #17 AT "+sha);
});
test("never authorize automatic events, feature branch, or re-runs by another actor",()=>{
  for(const eventName of ["push","pull_request","schedule","workflow_run","repository_dispatch","workflow_call",""]){
    denied({eventName},"invalid_dispatch");
  }
  for(const ref of ["refs/heads/feat/shared-mcp-spike","refs/tags/main",
    "refs/heads/other",""]){
    denied({ref},"invalid_dispatch");
  }
  denied({authorizedActor:"someone-else"},"untrusted_dispatch_actor");
  denied({triggeringActor:"someone-else"},"untrusted_dispatch_actor");
  denied({actor:"someone-else"},"untrusted_dispatch_actor");
  denied({authorizedActor:""},"untrusted_dispatch_actor");
  denied({actor:"hacker\ncommand"},"untrusted_dispatch_actor");
});
test("reject accidental merges and mutable or malformed identifiers",()=>{
  for(const pr of ["0","-1","1.5","01","1 ","1x",
    "99999999999999999999",""]){
    denied({pr},"invalid_merge_intent");
  }
  for(const value of ["a".repeat(39),"A".repeat(40),
    "c".repeat(40)+"\n","7".repeat(41),""]){
    denied({sha:value},"invalid_merge_intent");
  }
  denied({confirmation:"approved"},"invalid_merge_intent");
  denied({confirmation:expectedMergeConfirmation(18,sha)},
    "invalid_merge_intent");
  denied({confirmation:"MERGE PR #17 AT "+"a".repeat(40)},
    "invalid_merge_intent");
});
test("GitHub actor comparison is case insensitive, confirmation never is",()=>{
  assert.equal(validateManualMergeIntent({
    ...good,actor:"engineer-03",triggeringActor:"ENGINEER-03"
  }).authorizedGitHubActor,"engineer-03");
  denied({confirmation:good.confirmation.toLowerCase()},
    "invalid_merge_intent");
});
