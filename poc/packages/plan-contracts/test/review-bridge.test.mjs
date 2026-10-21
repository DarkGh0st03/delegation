import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {webcrypto,generateKeyPairSync} from "node:crypto";
import {makeApprovalFromMockReview} from "../src/review-bridge.mjs";
import {assertApprovedPlanScope,planDigest} from "../src/plan.mjs";
import {signEngineerApproval,verifyEngineerApproval} from "../src/signed-approval.mjs";

const base=new URL("../../../workflow-ui/",import.meta.url);
const context={crypto:webcrypto,TextEncoder};
for(const file of ["mock-plan.js","review-model.js"]){
  runInNewContext(readFileSync(new URL(file,base),"utf8"),context);
}
const plan=JSON.parse(JSON.stringify(context.DELEGATION_MOCK_PLAN));
const model=context.DELEGATION_REVIEW_MODEL;
const operations=new Set(context.DELEGATION_MOCK_OPERATION_CHOICES);
const DID="did:thesis:software-engineer";
const AT="2026-10-21T12:00:00.000Z";
const options=(review)=>({
  trustedPlan:plan,review,engineerDid:DID,allowedOperations:operations,
  decisionId:"decision-from-reviewed-ui",approvedAt:AT
});
const candidate=async()=>{
  const state=model.createState(plan);
  model.togglePermission(state,"p3",false);
  return model.makeMockReview(state,[...operations],webcrypto);
};

test("a GUI selection maps to a real plan-contract approval, without trusting browser identity",async()=>{
  const review=await candidate();
  const approval=makeApprovalFromMockReview(options(review));
  assert.equal(approval.plan_digest,planDigest(plan));
  assert.equal(approval.approved_by,DID);
  assert.equal(approval.approved_at,AT);
  assert.ok(!approval.approved_permission_ids.includes("p3"));
  assert.deepEqual(Array.from(approval.approved_permission_ids),Array.from(review.approved_permission_ids));
  assertApprovedPlanScope(plan,approval,{expectedEngineerDid:DID,allowedOperations:operations});
});

test("signed receipt produced from reviewed IDs verifies under pinned Engineer key",async()=>{
  const approval=makeApprovalFromMockReview(options(await candidate()));
  const keys=generateKeyPairSync("ed25519");
  const privateKeyPem=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const publicKeyPem=keys.publicKey.export({format:"pem",type:"spki"}).toString();
  const signed=signEngineerApproval({
    plan,approval,engineerDid:DID,keyId:"test-engineer-key",
    privateKeyPem,issuedAt:AT,expiresAt:"2026-10-21T12:30:00.000Z"
  });
  const verified=verifyEngineerApproval(signed,{
    expectedEngineerDid:DID,allowedOperations:operations,
    trustedKeys:{"test-engineer-key":{engineer_did:DID,public_key_pem:publicKeyPem}},
    nowMs:Date.parse("2026-10-21T12:05:00Z")
  });
  assert.equal(verified.approval.plan_digest,planDigest(plan));
});

test("edits, other repository revisions and falsified selection fail closed",async()=>{
  const original=await candidate();
  const attempts=[
    r=>{r.plan.requirement="Different requirement";},
    r=>{r.plan.base_revision="f".repeat(40);},
    r=>{r.plan_digest="0".repeat(64);},
    r=>{r.approved_permission_ids.push("p3");},
    r=>{r.approved_permission_ids.push("p2");},
    r=>{r.approved_permission_ids.push("not-proposed");},
    r=>{r.excluded_permission_ids=[];},
    r=>{r.excluded_permission_ids.push("p2");},
    r=>{r.approved_permission_ids=[];},
    r=>{r.simulated=false;},
    r=>{r.approved_by="did:thesis:attacker";},
    r=>{r.kind="trusted_authorization_review";}
  ];
  for(const change of attempts){
    const altered=JSON.parse(JSON.stringify(original));
    change(altered);
    assert.throws(()=>makeApprovalFromMockReview(options(altered)),/Untrusted review export/);
  }
});

test("a GUI-edited plan needs new trusted validation instead of silently promoting draft",async()=>{
  const state=model.createState(plan);
  model.setTaskAgent(state,"backend-1","frontend");
  const edited=await model.makeMockReview(state,[...operations],webcrypto);
  assert.notEqual(edited.plan_digest,planDigest(plan));
  assert.throws(()=>makeApprovalFromMockReview(options(edited)),/differs from trusted plan/);
});
