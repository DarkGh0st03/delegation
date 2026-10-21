#!/usr/bin/env node
/**
 * INTERACTIVE OPERATOR ACTION: no automated/LLM signature bypass.
 *
 * Usage:
 *  ENGINEER_DID=did:thesis:engineer node --experimental-strip-types \
 *    poc/apps/orchestrator/src/sign-engineer-approval.mjs \
 *    <plan.json> <approval.json> <protected-output-directory> \
 *    <ed25519-private-pem-path> <pinned-key-id>
 *
 * For an UNTRUSTED review exported by the offline GUI, use:
 *    --review <trusted-plan.json> <mock-review.json>
 *      <protected-output-directory> <ed25519-private-pem-path> <pinned-key-id>
 * The trusted plan MUST come independently from the Engineer backend.
 * The review may only select an exact subset of the trusted plan's permissions.
 *
 * Never commit private keys or signed decisions to the repository.
 * A signed receipt proves possession of the configured Engineer signing
 * key, not the human's identity-provider login. Full authenticated GUI
 * approval remains a separate integration requirement.
 */
import {readFile,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {createInterface} from "node:readline/promises";
import {assertApprovedPlanScope,planDigest} from
  "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval,verifyEngineerApproval} from
  "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../gateway/src/operation-catalog.ts";
import {createPublicKey,createPrivateKey,randomUUID} from "node:crypto";
import {makeApprovalFromMockReview} from
  "../../../packages/plan-contracts/src/review-bridge.mjs";

const args=process.argv.slice(2);
const reviewMode=args[0]==="--review";
const [planFile,approvalFile,outputDir,keyFile,keyId,...extra]=
  reviewMode?args.slice(1):args;
const did=process.env.ENGINEER_DID;
if(extra.length||!planFile||!approvalFile||!outputDir||!keyFile||!keyId||
   !did?.startsWith("did:")||!process.stdin.isTTY||!process.stdout.isTTY) {
  throw new Error("Interactive Engineer terminal, ENGINEER_DID and five explicit paths/IDs required");
}
const [meta,outputMeta]=await Promise.all([stat(keyFile),stat(outputDir)]);
if(!meta.isFile()||(meta.mode&0o077)!==0) {
  throw new Error("Engineer signing key must be a private, owner-only file (0600)");
}
if(!outputMeta.isDirectory()||(outputMeta.mode&0o077)!==0) {
  throw new Error("Protected approval output directory must be owner-only (0700)");
}
const [plan,submittedApproval,privateKeyPem]=await Promise.all([
  readFile(planFile,"utf8").then(JSON.parse),
  readFile(approvalFile,"utf8").then(JSON.parse),
  readFile(keyFile,"utf8")
]);
const now=new Date();
const approval=reviewMode?makeApprovalFromMockReview({
  trustedPlan:plan,review:submittedApproval,engineerDid:did,
  allowedOperations:new Set(RUST_OPERATIONS),
  decisionId:"approval-"+randomUUID(),approvedAt:now.toISOString()
}):submittedApproval;
assertApprovedPlanScope(plan,approval,{
  expectedEngineerDid:did,allowedOperations:new Set(RUST_OPERATIONS)
});
const digest=planDigest(plan);
if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(plan.session_id)) {
  throw new Error("Invalid session ID");
}
process.stdout.write(
  "\nSIGNED ENGINEER APPROVAL — REVIEW BEFORE SIGNING\n"+
  "Engineer: "+did+"\n"+
  "Repository: "+JSON.stringify(plan.repository)+"\n"+
  "Gitea base SHA: "+plan.base_revision+"\n"+
  "Plan: "+plan.plan_id+" v"+plan.version+"\n"+
  "Plan SHA-256: "+digest+"\n"+
  "Approved permission IDs: "+approval.approved_permission_ids.join(", ")+"\n"+
  "Signing key ID: "+keyId+"\n"+
  (reviewMode?"Source: GUI mock selection matched to independent trusted plan\n":"")+
  "\n"
);
const terminal=createInterface({input:process.stdin,output:process.stdout});
let entered;
try {
  entered=await terminal.question("To sign, type APPROVE "+digest+": ");
}finally{terminal.close();}
if(entered.trim()!=="APPROVE "+digest)throw new Error("Approval cancelled");
const expires=new Date(now.getTime()+30*60*1000);
const receipt=signEngineerApproval({
  plan,approval,engineerDid:did,keyId,privateKeyPem,
  issuedAt:now.toISOString(),expiresAt:expires.toISOString()
});
const pub=createPublicKey(createPrivateKey(privateKeyPem)).export({
  format:"pem",type:"spki"
}).toString();
verifyEngineerApproval(receipt,{
  expectedEngineerDid:did,allowedOperations:new Set(RUST_OPERATIONS),
  trustedKeys:{[keyId]:{engineer_did:did,public_key_pem:pub}}
});
const out=join(outputDir,plan.session_id+".json");
// Exclusive creation: never silently overwrite a previous decision.
await writeFile(out,JSON.stringify(receipt,null,2)+"\n",{
  flag:"wx",mode:0o600
});
process.stdout.write("Signed approval saved to the protected destination.\n");
