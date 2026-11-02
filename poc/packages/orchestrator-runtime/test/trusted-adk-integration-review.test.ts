
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection}
 from "@google/adk";
import {TrustedAdkIntegrationReviewer,OfflineIntegrationReviewModel,
 verifyTrustedIntegrationTestBrief} from "../src/trusted-adk-integration-review.ts";

const input=(path:string)=>({
 session_id:"session_f3",plan_digest:"a".repeat(64),
 test_task_id:"tests",branch:"feature/account-suspension",
 requirement:"Implement account suspension and reactivation",
 task_brief:"Validate the approved account behavior",
 implementations:[{
  status:"gateway_verified_implementation" as const,
  session_id:"session_f3",plan_digest:"a".repeat(64),
  plan_task_id:"backend-task",runtime_task_id:"dispatch_"+"A".repeat(22),
  role:"backend" as const,branch:"feature/account-suspension",
  revision:"b".repeat(40),
  changed_files:[{path,operation:"update_file" as const,commit_sha:"b".repeat(40)}],
  gateway_provider_effect_count:2
 }]
});
test("F3 same requirement and different attested implementation yield different ADK Test Briefs",async()=>{
 const reviewer=new TrustedAdkIntegrationReviewer(new OfflineIntegrationReviewModel());
 const a=input("apps/backend/user.ts"),b=input("apps/backend/account.ts");
 const one=await reviewer.review(a),two=await reviewer.review(b);
 assert.equal(one.status,"trusted_metadata_based_integration_review");
 assert.notEqual(one.evidence_digest,two.evidence_digest);
 assert.notDeepEqual(one.source_tasks,two.source_tasks);
 assert.equal(one.source_tasks[0]?.changed_files[0],"apps/backend/user.ts");
 assert.equal(two.source_tasks[0]?.changed_files[0],"apps/backend/account.ts");
 assert.equal(one.evidence_limit,"provider_mutations_only_no_semantic_diff");
 assert.ok(!JSON.stringify(one).includes("source_content"));
 assert.deepEqual(verifyTrustedIntegrationTestBrief(one,a),one);
});
test("F3 forged Task, SHA and scope never become accepted review evidence",async()=>{
 const reviewer=new TrustedAdkIntegrationReviewer(new OfflineIntegrationReviewModel());
 const a=input("apps/backend/user.ts");
 const result=await reviewer.review(a);
 for(const changed of [
  {...a,session_id:"different"},
  {...a,plan_digest:"c".repeat(64)},
  {...a,branch:"feature/other"},
  {...a,implementations:[{...a.implementations[0],role:"test" as any}]},
  {...a,implementations:[{...a.implementations[0],changed_files:[{
   path:"../private/secret.ts",operation:"update_file" as const,commit_sha:"b".repeat(40)}]}]}
 ]) await assert.rejects(reviewer.review(changed as any),/F3 trusted integration review/);
 assert.throws(()=>verifyTrustedIntegrationTestBrief({...result,
  source_tasks:[{...result.source_tasks[0],changed_files:["private/secret.ts"]}]},a),
  /F3 trusted integration review/);
});
class Forbidden extends BaseLlm{
 constructor(readonly output:unknown){super({model:"invalid-integration-review"});}
 override async *generateContentAsync(_r:LlmRequest):AsyncGenerator<LlmResponse,void>{
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.output)}]}};
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("No provider"));
 }
}
test("F3 rejects free prose, forged permissions and unsupported model checks",async()=>{
 for(const output of [
  {checks:["grant_write_file"]},{checks:["regression_coverage"],new_permission:"update_file"},
  {checks:["regression_coverage","regression_coverage"]},{checks:[]}
 ]){
  await assert.rejects(new TrustedAdkIntegrationReviewer(new Forbidden(output))
   .review(input("apps/backend/user.ts")) ,/F3 trusted integration review/);
 }
});
